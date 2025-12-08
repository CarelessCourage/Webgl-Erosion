import { mat4, vec3 } from "gl-matrix";
import { GPUContext } from "../core/GPUContext";
import { PlaneGeometry } from "../geometry/Plane";
import { PerlinNoise } from "../utils/PerlinNoise";
import { LayerCompute } from "../core/LayerCompute";
import { LayerStack } from "../core/LayerSystem";
import terrainShaderRaw from "../shaders/terrain.wgsl?raw";
import shadowMapShaderRaw from "../shaders/shadowmap.wgsl?raw";

// Strip any "export default" wrapper if Vite added it
let terrainShader = terrainShaderRaw;
if (terrainShader.startsWith('export default "')) {
  const match = terrainShader.match(/^export default "(.*)"$/s);
  if (match) {
    terrainShader = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

let shadowMapShader = shadowMapShaderRaw;
if (shadowMapShader.startsWith('export default "')) {
  const match = shadowMapShader.match(/^export default "(.*)"$/s);
  if (match) {
    shadowMapShader = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
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
  private bindGroup!: GPUBindGroup;
  private indexCount: number;
  private layerBuffer: GPUBuffer; // Store layer data for vertex shader

  // Shadow mapping
  private shadowPipeline: GPURenderPipeline;
  private shadowMapTexture: GPUTexture;
  private shadowMapView: GPUTextureView;
  private shadowSampler: GPUSampler;
  private shadowUniformBuffer: GPUBuffer;
  private shadowBindGroup!: GPUBindGroup;
  private readonly shadowMapSize = 2048;

  // Height texture sampling
  private layerCompute?: LayerCompute;
  private dummyTexture: GPUTexture;

  // Bind group layout for reuse
  private bindGroupLayout: GPUBindGroupLayout;

  constructor(gpuContext: GPUContext, geometry: PlaneGeometry) {
    this.gpuContext = gpuContext;
    this.indexCount = geometry.indexCount;

    // Create layer buffer for vertex shader
    this.layerBuffer = gpuContext.device.createBuffer({
      size: 5 * 18 * 4, // 5 layers * 18 floats * 4 bytes (matching WGSL struct size)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create vertex buffers
    this.vertexBuffer = this.createBuffer(
      geometry.positions,
      GPUBufferUsage.VERTEX
    );
    this.normalBuffer = this.createBuffer(
      geometry.normals,
      GPUBufferUsage.VERTEX
    );
    this.uvBuffer = this.createBuffer(geometry.uvs, GPUBufferUsage.VERTEX);
    this.indexBuffer = this.createBuffer(
      geometry.indices,
      GPUBufferUsage.INDEX
    );

    // Create uniform buffer
    // Layout: mat4 model (64) + mat4 viewProj (64) + mat4 lightViewProj (64) +
    // vec3 camera (12) + f32 mode (4) + vec3 lowColor (12) + f32 disableDisp (4) +
    // vec3 midColor (12) + f32 lowThresh (4) + vec3 highColor (12) + f32 highThresh (4) +
    // vec3 bottomColor (12) + f32 shadowsEnabled (4) + vec3 lightDir (12) + f32 shadowIntensity (4) = 320 bytes
    this.uniformBuffer = gpuContext.device.createBuffer({
      size: 320,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create shadow map texture
    this.shadowMapTexture = gpuContext.device.createTexture({
      size: [this.shadowMapSize, this.shadowMapSize],
      format: "depth32float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowMapView = this.shadowMapTexture.createView();

    // Create shadow sampler (comparison sampler for shadow mapping)
    this.shadowSampler = gpuContext.device.createSampler({
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
    });

    // Create shadow uniform buffer (for model matrix + light view-proj matrix + disableDisplacement)
    this.shadowUniformBuffer = gpuContext.device.createBuffer({
      size: 160, // mat4x4 (64) + mat4x4 (64) + vec4f (16) = 160 bytes (WGSL alignment)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create dummy texture for when height texture is not available
    this.dummyTexture = gpuContext.device.createTexture({
      size: { width: 1, height: 1 },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Initialize dummy texture with zero height
    const dummyData = new Float32Array(4); // RGBA, all zeros
    gpuContext.device.queue.writeTexture(
      { texture: this.dummyTexture },
      dummyData,
      { bytesPerRow: 16 },
      { width: 1, height: 1 }
    );

    // Create shader module
    const shaderModule = gpuContext.device.createShaderModule({
      label: "Terrain Shader",
      code: terrainShader,
    });

    // Check for shader compilation errors
    shaderModule.getCompilationInfo().then((info) => {
      if (info.messages.length > 0) {
        console.log("Shader compilation messages:");
        for (const message of info.messages) {
          const logFunc =
            message.type === "error" ? console.error : console.warn;
          logFunc(
            `  ${message.type} at line ${message.lineNum}: ${message.message}`
          );
        }
      } else {
        console.log("Shader compiled successfully");
      }
    });

    // Create explicit bind group layout
    this.bindGroupLayout = gpuContext.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: "read-only-storage",
          },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: "unfilterable-float",
            viewDimension: "2d",
          },
        },
      ],
    });

    // Create pipeline layout
    const pipelineLayout = gpuContext.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    // Create pipeline
    console.log("Creating render pipeline...");
    try {
      this.pipeline = gpuContext.device.createRenderPipeline({
        label: "Terrain Pipeline",
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain",
          buffers: [
            {
              arrayStride: 16, // 4 floats * 4 bytes
              attributes: [
                {
                  shaderLocation: 0,
                  offset: 0,
                  format: "float32x4",
                },
              ],
            },
            {
              arrayStride: 16,
              attributes: [
                {
                  shaderLocation: 1,
                  offset: 0,
                  format: "float32x4",
                },
              ],
            },
            {
              arrayStride: 8, // 2 floats * 4 bytes
              attributes: [
                {
                  shaderLocation: 2,
                  offset: 0,
                  format: "float32x2",
                },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [
            {
              format: gpuContext.format,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "none", // Disable culling temporarily
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      console.log("Pipeline created successfully");
    } catch (error) {
      console.error("Failed to create pipeline:", error);
      throw error;
    }

    // Create shadow map shader and pipeline
    const shadowShaderModule = gpuContext.device.createShaderModule({
      label: "Shadow Map Shader",
      code: shadowMapShader,
    });

    this.shadowPipeline = gpuContext.device.createRenderPipeline({
      label: "Shadow Map Pipeline",
      layout: pipelineLayout,
      vertex: {
        module: shadowShaderModule,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: "float32x4",
              },
            ],
          },
          {
            arrayStride: 16,
            attributes: [
              {
                shaderLocation: 1,
                offset: 0,
                format: "float32x4",
              },
            ],
          },
          {
            arrayStride: 8,
            attributes: [
              {
                shaderLocation: 2,
                offset: 0,
                format: "float32x2",
              },
            ],
          },
        ],
      },
      fragment: {
        module: shadowShaderModule,
        entryPoint: "fragmentMain",
        targets: [], // No color output, only depth
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back", // Cull back faces for shadows
      },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // Create initial bind groups
    this.createBindGroups();

    console.log("✓ Terrain renderer initialized");
  }

  /**
   * Update layer data in the vertex shader
   */
  private updateLayerBuffer(layerStack: LayerStack): void {
    const layers = layerStack.getAllLayers();
    const data = new Float32Array(5 * 18); // 5 layers * 18 floats (matching WGSL struct)

    console.log("Updating layer buffer with", layers.length, "layers:");

    for (let i = 0; i < Math.min(layers.length, 5); i++) {
      const layer = layers[i];
      const offset = i * 18; // 18 floats per layer

      console.log(`Layer ${i}:`, {
        name: layer.name,
        type: layer.type,
        enabled: layer.enabled,
        strength: layer.strength,
        blendMode: layer.blendMode,
      });

      // Serialize layer data to match WGSL struct (18 floats)
      data[offset + 0] =
        layer.type === "noise" ? 0.0 : layer.type === "circle" ? 1.0 : 2.0; // layerType
      data[offset + 1] =
        layer.blendMode === "add"
          ? 0.0
          : layer.blendMode === "mask"
          ? 1.0
          : layer.blendMode === "multiply"
          ? 2.0
          : 3.0; // blendMode
      data[offset + 2] = layer.enabled ? 1.0 : 0.0; // enabled
      data[offset + 3] = layer.strength; // strength

      if (layer.type === "noise") {
        const noiseLayer = layer as any;
        data[offset + 4] = noiseLayer.scale || 8.0; // scale
        data[offset + 5] = noiseLayer.octaves || 4.0; // octaves
        data[offset + 6] = noiseLayer.persistence || 0.5; // persistence
        data[offset + 7] = noiseLayer.lacunarity || 2.0; // lacunarity
        data[offset + 8] = noiseLayer.amplitude || 1.0; // amplitude
        data[offset + 9] = noiseLayer.seed || 12345; // seed
        data[offset + 10] = 0.0; // centerX (unused for noise)
        data[offset + 11] = 0.0; // centerY (unused for noise)
        data[offset + 12] = 0.0; // radius (unused for noise)
        data[offset + 13] = 0.0; // falloff (unused for noise)
        data[offset + 14] = 0.0; // offsetX (unused for noise)
        data[offset + 15] = 0.0; // offsetY (unused for noise)
      } else if (layer.type === "circle") {
        const circleLayer = layer as any;
        data[offset + 4] = 0.0; // scale (unused for circle)
        data[offset + 5] = 0.0; // octaves (unused for circle)
        data[offset + 6] = 0.0; // persistence (unused for circle)
        data[offset + 7] = 0.0; // lacunarity (unused for circle)
        data[offset + 8] = 0.0; // amplitude (unused for circle)
        data[offset + 9] = 0.0; // seed (unused for circle)
        data[offset + 10] = circleLayer.centerX || 0.0; // centerX
        data[offset + 11] = circleLayer.centerY || 0.0; // centerY
        data[offset + 12] = circleLayer.radius || 1.0; // radius
        data[offset + 13] = circleLayer.falloff || 0.5; // falloff
        data[offset + 14] = 0.0; // offsetX (unused for circle)
        data[offset + 15] = 0.0; // offsetY (unused for circle)
      }
      data[offset + 16] = 0.0; // imageIndex (unused)
      data[offset + 17] = 0.0; // padding
    }

    this.gpuContext.device.queue.writeBuffer(this.layerBuffer, 0, data);
  }

  /**
   * Recreate bind groups when needed
   */
  private createBindGroups(): void {
    // Get height texture or use dummy
    let heightTexture = this.dummyTexture;
    let textureSource = "dummy";

    if (this.layerCompute) {
      const layerTexture = this.layerCompute.getOutputTexture();
      if (layerTexture) {
        heightTexture = layerTexture;
        textureSource = "layerCompute";
      }
    }

    console.log(`🔧 Creating bind groups with ${textureSource} texture`);
    console.log(
      `🔧 Texture dimensions: ${heightTexture.width}x${heightTexture.height}`
    );
    console.log(`🔧 Texture format: ${heightTexture.format}`);

    // Create shadow bind group
    this.shadowBindGroup = this.gpuContext.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.shadowUniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.layerBuffer },
        },
        {
          binding: 2,
          resource: heightTexture.createView(),
        },
      ],
    });

    // Create main bind group
    this.bindGroup = this.gpuContext.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.layerBuffer },
        },
        {
          binding: 2,
          resource: heightTexture.createView(),
        },
      ],
    });
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
    this.vertexBuffer = this.createBuffer(
      geometry.positions,
      GPUBufferUsage.VERTEX
    );
    this.normalBuffer = this.createBuffer(
      geometry.normals,
      GPUBufferUsage.VERTEX
    );
    this.uvBuffer = this.createBuffer(geometry.uvs, GPUBufferUsage.VERTEX);
    this.indexBuffer = this.createBuffer(
      geometry.indices,
      GPUBufferUsage.INDEX
    );
    this.indexCount = geometry.indexCount;
  }

  private createBuffer(
    data: Float32Array | Uint32Array,
    usage: GPUBufferUsageFlags
  ): GPUBuffer {
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
    lightViewProjMatrix: mat4,
    cameraPos: vec3,
    visualizationMode: string = "terrain",
    disableDisplacement: boolean = false,
    lowColor: [number, number, number] = [51, 128, 51],
    midColor: [number, number, number] = [128, 102, 77],
    highColor: [number, number, number] = [230, 230, 230],
    bottomColor: [number, number, number] = [40, 30, 20],
    lowThreshold: number = 0.3,
    highThreshold: number = 0.6,
    shadowsEnabled: boolean = true,
    lightDirection: vec3 = vec3.fromValues(0.5, 1.0, 0.3),
    shadowIntensity: number = 0.5
  ) {
    const uniformData = new Float32Array(80); // 320 bytes / 4 = 80 floats

    // Model matrix (16 floats at offset 0)
    uniformData.set(modelMatrix, 0);

    // ViewProj matrix (16 floats at offset 16)
    uniformData.set(viewProjMatrix, 16);

    // Light ViewProj matrix (16 floats at offset 32)
    uniformData.set(lightViewProjMatrix, 32);

    // Camera position (3 floats + 1 padding at offset 48)
    uniformData[48] = cameraPos[0];
    uniformData[49] = cameraPos[1];
    uniformData[50] = cameraPos[2];
    uniformData[51] = visualizationMode === "heightmap" ? 1.0 : 0.0;

    // Low color (3 floats + 1 padding at offset 52)
    uniformData[52] = lowColor[0];
    uniformData[53] = lowColor[1];
    uniformData[54] = lowColor[2];
    uniformData[55] = disableDisplacement ? 1.0 : 0.0;

    // Mid color (3 floats + 1 padding at offset 56)
    uniformData[56] = midColor[0];
    uniformData[57] = midColor[1];
    uniformData[58] = midColor[2];
    uniformData[59] = lowThreshold;

    // High color (3 floats + 1 padding at offset 60)
    uniformData[60] = highColor[0];
    uniformData[61] = highColor[1];
    uniformData[62] = highColor[2];
    uniformData[63] = highThreshold;

    // Bottom color (3 floats + 1 padding at offset 64)
    uniformData[64] = bottomColor[0];
    uniformData[65] = bottomColor[1];
    uniformData[66] = bottomColor[2];
    uniformData[67] = shadowsEnabled ? 1.0 : 0.0;

    // Light direction (3 floats + 1 padding at offset 68)
    uniformData[68] = lightDirection[0];
    uniformData[69] = lightDirection[1];
    uniformData[70] = lightDirection[2];
    uniformData[71] = shadowIntensity;

    this.gpuContext.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      uniformData
    );
  }

  /**
   * Update shadow map uniform buffer with model and light view-projection matrices
   */
  updateShadowUniforms(
    modelMatrix: mat4,
    lightViewProjMatrix: mat4,
    disableDisplacement: number
  ) {
    const shadowUniformData = new Float32Array(40); // 160 bytes / 4 = 40 floats
    shadowUniformData.set(modelMatrix, 0); // Offset 0-15
    shadowUniformData.set(lightViewProjMatrix, 16); // Offset 16-31
    shadowUniformData[32] = disableDisplacement; // Offset 32 (rest is padding)
    this.gpuContext.device.queue.writeBuffer(
      this.shadowUniformBuffer,
      0,
      shadowUniformData
    );
  }

  /**
   * Render the scene to the shadow map from the light's perspective
   */
  renderShadowMap(passEncoder: GPURenderPassEncoder) {
    passEncoder.setPipeline(this.shadowPipeline);
    passEncoder.setBindGroup(0, this.shadowBindGroup);
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.setVertexBuffer(1, this.normalBuffer);
    passEncoder.setVertexBuffer(2, this.uvBuffer);
    passEncoder.setIndexBuffer(this.indexBuffer, "uint32");
    passEncoder.drawIndexed(this.indexCount);
  }

  /**
   * Get the shadow map texture view for debugging
   */
  getShadowMapView(): GPUTextureView {
    return this.shadowMapView;
  }

  render(passEncoder: GPURenderPassEncoder) {
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.setVertexBuffer(1, this.normalBuffer);
    passEncoder.setVertexBuffer(2, this.uvBuffer);
    passEncoder.setIndexBuffer(this.indexBuffer, "uint32");
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
    this.layerBuffer.destroy();
    this.shadowMapTexture.destroy();
    this.shadowUniformBuffer.destroy();
  }

  /**
   * Set LayerCompute reference for height texture sampling
   */
  public setLayerCompute(layerCompute: LayerCompute): void {
    this.layerCompute = layerCompute;

    // Recreate bind groups to include height texture
    this.createBindGroups();
  }

  /**
   * Generate terrain height data using layer system (now direct procedural)
   */
  public async generateTerrainFromLayers(
    layerStack: LayerStack
  ): Promise<void> {
    // Update layer data in vertex shader buffer
    this.updateLayerBuffer(layerStack);
  }

  /**
   * Upload image data for use in image layers (placeholder for future implementation)
   */
  public uploadImageForLayer(imageData: ImageData, arrayIndex: number): void {
    // TODO: Implement image layer support in vertex shader
    console.warn("Image layers not yet supported in direct procedural mode");
  }
}
