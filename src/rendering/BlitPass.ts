import blitShader from '../shaders/blit.wgsl?raw';

export class BlitPass {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline;
    private sampler: GPUSampler;

    constructor(device: GPUDevice, targetFormat: GPUTextureFormat) {
        this.device = device;
        
        // Create sampler
        this.sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        
        // Create pipeline
        const shaderModule = device.createShaderModule({
            code: blitShader,
        });
        
        this.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: targetFormat,
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });
    }
    
    public blit(
        commandEncoder: GPUCommandEncoder,
        sourceTexture: GPUTexture,
        targetView: GPUTextureView
    ): void {
        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sourceTexture.createView() },
                { binding: 1, resource: this.sampler },
            ],
        });
        
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3, 1, 0, 0); // Full-screen triangle
        renderPass.end();
    }
}
