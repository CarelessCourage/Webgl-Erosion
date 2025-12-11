import dofBlurShader from '../shaders/dof-blur.wgsl?raw';

export interface DOFSettings {
    enabled: boolean;
    focalDepth: number;      // Distance from camera (10-25 range)
    focalRange: number;      // Range around focal depth that stays sharp
    blurStrength: number;    // Maximum blur for far objects
    nearBlurStrength: number; // Blur strength for near objects
    cameraNear?: number;     // Camera near plane (default: 0.01)
    cameraFar?: number;      // Camera far plane (default: 500)
}

export class DepthOfFieldPass {
    private device: GPUDevice;
    private pipeline: GPUComputePipeline;
    private uniformBuffer: GPUBuffer;
    
    // Intermediate textures for two-pass blur
    private horizontalBlurTexture?: GPUTexture;
    private verticalBlurTexture?: GPUTexture;
    
    // Bind groups for each pass
    private horizontalBindGroup?: GPUBindGroup;
    private verticalBindGroup?: GPUBindGroup;
    
    private width: number = 0;
    private height: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
        
        // Create uniform buffer for DOF parameters
        // Layout: focalDepth(4) + focalRange(4) + blurStrength(4) + nearBlurStrength(4) + 
        //         enabled(4) + cameraNear(4) + cameraFar(4) + padding(4) + direction(8) = 40 bytes
        this.uniformBuffer = device.createBuffer({
            size: 48, // Increased from 32 to 48 for camera params
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create compute pipeline
        const shaderModule = device.createShaderModule({
            code: dofBlurShader,
        });
        
        this.pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'main',
            },
        });
    }
    
    /**
     * Initialize or resize textures when canvas size changes
     */
    public resize(width: number, height: number): void {
        if (this.width === width && this.height === height) {
            return; // No resize needed
        }
        
        this.width = width;
        this.height = height;
        
        // Clean up old textures
        this.horizontalBlurTexture?.destroy();
        this.verticalBlurTexture?.destroy();
        
        // Create intermediate blur textures (rgba8unorm supports storage)
        const textureDescriptor: GPUTextureDescriptor = {
            size: { width, height },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        };
        
        this.horizontalBlurTexture = this.device.createTexture(textureDescriptor);
        this.verticalBlurTexture = this.device.createTexture(textureDescriptor);
        
        // Bind groups will be recreated when apply() is called
        this.horizontalBindGroup = undefined;
        this.verticalBindGroup = undefined;
    }
    
    /**
     * Update DOF uniform parameters
     */
    public updateSettings(settings: DOFSettings): void {
        const data = new Float32Array(12); // Increased from 8 to 12
        data[0] = settings.focalDepth;
        data[1] = settings.focalRange;
        data[2] = settings.blurStrength;
        data[3] = settings.nearBlurStrength;
        data[4] = settings.enabled ? 1.0 : 0.0;
        data[5] = settings.cameraNear ?? 0.01; // Camera near plane
        data[6] = settings.cameraFar ?? 500;    // Camera far plane
        // data[7] is padding
        // data[8-9] will be direction (set per-pass)
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Apply DOF effect using two-pass separable Gaussian blur
     * @param commandEncoder Current command encoder
     * @param inputTexture Scene color texture
     * @param depthTexture Scene depth texture
     * @param outputTexture Final output texture (canvas)
     * @param settings DOF settings
     */
    public apply(
        commandEncoder: GPUCommandEncoder,
        inputTexture: GPUTexture,
        depthTexture: GPUTexture,
        outputTexture: GPUTexture,
        settings: DOFSettings
    ): void {
        if (!this.horizontalBlurTexture || !this.verticalBlurTexture) {
            console.warn('DOF textures not initialized. Call resize() first.');
            return;
        }
        
        // Update settings
        this.updateSettings(settings);
        
        // Create bind groups if needed
        if (!this.horizontalBindGroup || !this.verticalBindGroup) {
            this.createBindGroups(inputTexture, depthTexture, outputTexture);
        }
        
        // Pass 1: Horizontal blur (input -> horizontal)
        this.updateDirection(0, 1.0, 0.0); // Horizontal
        const horizontalPass = commandEncoder.beginComputePass();
        horizontalPass.setPipeline(this.pipeline);
        horizontalPass.setBindGroup(0, this.horizontalBindGroup!);
        const dispatchX = Math.ceil(this.width / 8);
        const dispatchY = Math.ceil(this.height / 8);
        horizontalPass.dispatchWorkgroups(dispatchX, dispatchY);
        horizontalPass.end();
        
        // Pass 2: Vertical blur (horizontal -> output)
        this.updateDirection(1, 0.0, 1.0); // Vertical
        const verticalPass = commandEncoder.beginComputePass();
        verticalPass.setPipeline(this.pipeline);
        verticalPass.setBindGroup(0, this.verticalBindGroup!);
        verticalPass.dispatchWorkgroups(dispatchX, dispatchY);
        verticalPass.end();
    }
    
    /**
     * Create bind groups for both blur passes
     */
    private createBindGroups(
        inputTexture: GPUTexture,
        depthTexture: GPUTexture,
        outputTexture: GPUTexture
    ): void {
        // Horizontal pass: input -> horizontal blur texture
        this.horizontalBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: inputTexture.createView() },
                { binding: 1, resource: depthTexture.createView() },
                { binding: 2, resource: this.horizontalBlurTexture!.createView() },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
            ],
        });
        
        // Vertical pass: horizontal blur texture -> output
        this.verticalBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.horizontalBlurTexture!.createView() },
                { binding: 1, resource: depthTexture.createView() },
                { binding: 2, resource: outputTexture.createView() },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
            ],
        });
    }
    
    /**
     * Update blur direction in uniform buffer (offset 32 bytes, after 8 floats)
     */
    private updateDirection(passIndex: number, x: number, y: number): void {
        const data = new Float32Array([x, y]);
        this.device.queue.writeBuffer(this.uniformBuffer, 32, data); // Changed from 24 to 32
    }
    
    /**
     * Clean up resources
     */
    public destroy(): void {
        this.uniformBuffer.destroy();
        this.horizontalBlurTexture?.destroy();
        this.verticalBlurTexture?.destroy();
    }
}
