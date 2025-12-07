import { mat4, vec3 } from 'gl-matrix';
import { GPUContext } from '../core/GPUContext';
import { PlaneGeometry } from '../geometry/Plane';
import { PerlinNoise } from '../utils/PerlinNoise';
import terrainShaderRaw from '../shaders/terrain.wgsl?raw';

// Strip any "export default" wrapper if Vite added it
let terrainShader = terrainShaderRaw;
if (terrainShader.startsWith('export default "')) {
    const match = terrainShader.match(/^export default "(.*)"$/s);
    if (match) {
        terrainShader = match[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }
}

export class TerrainRenderer {
    private gpuContext: GPUContext;
    private pipeline: GPURenderPipeline;
    private vertexBuffer: GPUBuffer;
    private normalBuffer: GPUBuffer;
    private uvBuffer: GPUBuffer;
    private indexBuffer: GPUBuffer;
    private uniformBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;
    private indexCount: number;
    private heightTexture: GPUTexture;
    private sampler: GPUSampler;

    constructor(gpuContext: GPUContext, geometry: PlaneGeometry) {
        this.gpuContext = gpuContext;
        this.indexCount = geometry.indexCount;

        // Create vertex buffers
        this.vertexBuffer = this.createBuffer(geometry.positions, GPUBufferUsage.VERTEX);
        this.normalBuffer = this.createBuffer(geometry.normals, GPUBufferUsage.VERTEX);
        this.uvBuffer = this.createBuffer(geometry.uvs, GPUBufferUsage.VERTEX);
        this.indexBuffer = this.createBuffer(geometry.indices, GPUBufferUsage.INDEX);

        // Create uniform buffer
        // Layout: mat4 (64) + mat4 (64) + vec3 (12) + f32 (4) + vec3 (12) + f32 (4) + vec3 (12) + f32 (4) + vec3 (12) + f32 (4) = 192 bytes, padded to 256
        this.uniformBuffer = gpuContext.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create a default height texture
        this.heightTexture = gpuContext.createTexture({
            width: 512,
            height: 512,
            format: 'rgba32float',
        });
        
        // Initialize with Perlin noise terrain
        this.generateTerrain();

        // Create sampler (nearest for float textures)
        this.sampler = gpuContext.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        // Create shader module
        const shaderModule = gpuContext.device.createShaderModule({
            label: 'Terrain Shader',
            code: terrainShader,
        });
        
        // Check for shader compilation errors
        shaderModule.getCompilationInfo().then(info => {
            if (info.messages.length > 0) {
                console.log('Shader compilation messages:');
                for (const message of info.messages) {
                    const logFunc = message.type === 'error' ? console.error : console.warn;
                    logFunc(`  ${message.type} at line ${message.lineNum}: ${message.message}`);
                }
            } else {
                console.log('Shader compiled successfully');
            }
        });

        // Create pipeline
        console.log('Creating render pipeline...');
        try {
            this.pipeline = gpuContext.device.createRenderPipeline({
            label: 'Terrain Pipeline',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
                buffers: [
                    {
                        arrayStride: 16, // 4 floats * 4 bytes
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x4',
                        }],
                    },
                    {
                        arrayStride: 16,
                        attributes: [{
                            shaderLocation: 1,
                            offset: 0,
                            format: 'float32x4',
                        }],
                    },
                    {
                        arrayStride: 8, // 2 floats * 4 bytes
                        attributes: [{
                            shaderLocation: 2,
                            offset: 0,
                            format: 'float32x2',
                        }],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: gpuContext.format,
                }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Disable culling temporarily
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
        console.log('Pipeline created successfully');
    } catch (error) {
        console.error('Failed to create pipeline:', error);
        throw error;
    }

        // Create bind group
        this.bindGroup = gpuContext.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
                {
                    binding: 1,
                    resource: this.heightTexture.createView(),
                },
            ],
        });

        console.log('✓ Terrain renderer initialized');
    }

    /**
     * Update the geometry with new mesh data
     */
    public updateGeometry(geometry: PlaneGeometry): void {
        // Destroy old buffers
        this.vertexBuffer?.destroy();
        this.normalBuffer?.destroy();
        this.uvBuffer?.destroy();
        this.indexBuffer?.destroy();

        // Create new buffers
        this.vertexBuffer = this.createBuffer(geometry.positions, GPUBufferUsage.VERTEX);
        this.normalBuffer = this.createBuffer(geometry.normals, GPUBufferUsage.VERTEX);
        this.uvBuffer = this.createBuffer(geometry.uvs, GPUBufferUsage.VERTEX);
        this.indexBuffer = this.createBuffer(geometry.indices, GPUBufferUsage.INDEX);
        this.indexCount = geometry.indexCount;
    }

    private createBuffer(data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer {
        const buffer = this.gpuContext.device.createBuffer({
            size: data.byteLength,
            usage,
            mappedAtCreation: true,
        });

        if (data instanceof Float32Array) {
            new Float32Array(buffer.getMappedRange()).set(data);
        } else {
            new Uint32Array(buffer.getMappedRange()).set(data);
        }
        buffer.unmap();

        return buffer;
    }

    updateUniforms(
        modelMatrix: mat4,
        viewProjMatrix: mat4,
        cameraPos: vec3,
        visualizationMode: string = 'terrain',
        disableDisplacement: boolean = false,
        lowColor: [number, number, number] = [51, 128, 51],
        midColor: [number, number, number] = [128, 102, 77],
        highColor: [number, number, number] = [230, 230, 230],
        lowThreshold: number = 0.3,
        highThreshold: number = 0.6,
        wireframe: boolean = false
    ) {
        const uniformData = new Float32Array(64); // 256 bytes / 4 = 64 floats
        
        // Model matrix (16 floats at offset 0)
        uniformData.set(modelMatrix, 0);
        
        // ViewProj matrix (16 floats at offset 16)
        uniformData.set(viewProjMatrix, 16);
        
        // Camera position (3 floats + 1 padding at offset 32)
        uniformData[32] = cameraPos[0];
        uniformData[33] = cameraPos[1];
        uniformData[34] = cameraPos[2];
        uniformData[35] = visualizationMode === 'heightmap' ? 1.0 : 0.0;
        
        // Low color (3 floats + 1 padding at offset 36)
        uniformData[36] = lowColor[0];
        uniformData[37] = lowColor[1];
        uniformData[38] = lowColor[2];
        uniformData[39] = disableDisplacement ? 1.0 : 0.0;
        
        // Mid color (3 floats + 1 padding at offset 40)
        uniformData[40] = midColor[0];
        uniformData[41] = midColor[1];
        uniformData[42] = midColor[2];
        uniformData[43] = lowThreshold;
        
        // High color (3 floats + 1 padding at offset 44)
        uniformData[44] = highColor[0];
        uniformData[45] = highColor[1];
        uniformData[46] = highColor[2];
        uniformData[47] = highThreshold;
        
        // Wireframe mode (1 float + 3 padding at offset 48)
        uniformData[48] = wireframe ? 1.0 : 0.0;
        
        this.gpuContext.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    }

    render(passEncoder: GPURenderPassEncoder) {
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.normalBuffer);
        passEncoder.setVertexBuffer(2, this.uvBuffer);
        passEncoder.setIndexBuffer(this.indexBuffer, 'uint32');
        passEncoder.drawIndexed(this.indexCount);
        // Debug: Try drawing just first 3 vertices without index
        // passEncoder.draw(3, 1, 0, 0);
    }

    destroy() {
        this.vertexBuffer.destroy();
        this.normalBuffer.destroy();
        this.uvBuffer.destroy();
        this.indexBuffer.destroy();
        this.uniformBuffer.destroy();
        this.heightTexture.destroy();
    }

    /**
     * Generate terrain height data using Perlin noise
     */
    public generateTerrain(
        seed: number = 12345,
        scale: number = 4.0,
        octaves: number = 4,
        persistence: number = 0.5,
        lacunarity: number = 2.0,
        amplitude: number = 0.5,
        baseHeight: number = 0.3
    ): void {
        const noise = new PerlinNoise(seed);
        const pixels = 512 * 512;
        const data = new Float32Array(pixels * 4);
        
        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 512; x++) {
                const i = (y * 512 + x);
                
                // Normalize coordinates to 0-1
                const fx = x / 512;
                const fy = y / 512;
                
                // Generate Perlin noise value (-1 to 1)
                const noiseValue = noise.octaveNoise(
                    fx * scale,
                    fy * scale,
                    octaves,
                    persistence,
                    lacunarity
                );
                
                // Map to height range: baseHeight ± amplitude
                const height = baseHeight + (noiseValue * amplitude);
                
                data[i * 4] = Math.max(0, Math.min(1, height)); // R: height (clamped 0-1)
                data[i * 4 + 1] = 0;  // G: water = 0
                data[i * 4 + 2] = 0;  // B: unused
                data[i * 4 + 3] = 1;  // A: unused
            }
        }
        
        // Upload to GPU
        this.gpuContext.device.queue.writeTexture(
            { texture: this.heightTexture },
            data,
            { bytesPerRow: 512 * 4 * 4 }, // 4 channels * 4 bytes per float
            { width: 512, height: 512 }
        );
    }
}
