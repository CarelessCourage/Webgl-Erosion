import dofBlurShader from '../shaders/dof-blur.wgsl?raw';

export interface DOFSettings {
    aperture: number;         // Background blur in % of screen height at the reference distance
    focalOffset: number;      // World units added to the focus distance
    focalRange: number;       // World units around the focus distance that stay sharp
    farStrength: number;      // Multiplier for blur behind the focus plane
    nearStrength: number;     // Multiplier for blur in front of the focus plane
    cameraNear: number;
    cameraFar: number;
    targetDistance: number;   // Camera distance to the orbit target
    focusPoint: [number, number] | null; // Pixel to autofocus on, or null to focus on the orbit target
    focusSpeed: number;       // How fast focus eases to a new distance (1/s, 0 = instant)
    deltaTime: number;        // Seconds since the last frame
}

const UNIFORM_FLOATS = 16;
// Blur radius limit as a fraction of screen height
const MAX_RADIUS_FRACTION = 0.03;

/**
 * Depth of field: autofocus pass + two-pass (horizontal/vertical) separable blur
 * with a thin-lens circle of confusion.
 */
export class DepthOfFieldPass {
    private device: GPUDevice;
    private focusPipeline: GPUComputePipeline;
    private blurPipeline: GPUComputePipeline;
    // Separate uniform buffers per direction: queue.writeBuffer calls all land
    // before the command buffer runs, so a shared buffer would end up vertical twice.
    private horizontalUniforms: GPUBuffer;
    private verticalUniforms: GPUBuffer;
    private focusBuffer: GPUBuffer;

    private horizontalBlurTexture?: GPUTexture;
    private focusBindGroup?: GPUBindGroup;
    private horizontalBindGroup?: GPUBindGroup;
    private verticalBindGroup?: GPUBindGroup;
    private boundTextures: GPUTexture[] = [];

    private width = 0;
    private height = 0;

    constructor(device: GPUDevice) {
        this.device = device;

        const createUniforms = (label: string) =>
            device.createBuffer({
                label,
                size: UNIFORM_FLOATS * 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        this.horizontalUniforms = createUniforms('dof-uniforms-horizontal');
        this.verticalUniforms = createUniforms('dof-uniforms-vertical');

        // Holds the eased focus distance between frames (0 = not initialised)
        this.focusBuffer = device.createBuffer({
            label: 'dof-focus-state',
            size: 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const module = device.createShaderModule({ label: 'dof', code: dofBlurShader });
        this.focusPipeline = device.createComputePipeline({
            label: 'dof-focus',
            layout: 'auto',
            compute: { module, entryPoint: 'focusMain' },
        });
        this.blurPipeline = device.createComputePipeline({
            label: 'dof-blur',
            layout: 'auto',
            compute: { module, entryPoint: 'blurMain' },
        });
    }

    /**
     * Initialize or resize textures when canvas size changes
     */
    public resize(width: number, height: number): void {
        if (this.width === width && this.height === height) {
            return;
        }
        this.width = width;
        this.height = height;

        this.horizontalBlurTexture?.destroy();
        this.horizontalBlurTexture = this.device.createTexture({
            label: 'dof-horizontal-blur',
            size: { width, height },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.boundTextures = [];
    }

    /**
     * Apply DOF: measure focus, then blur horizontally and vertically
     */
    public apply(
        commandEncoder: GPUCommandEncoder,
        inputTexture: GPUTexture,
        depthTexture: GPUTexture,
        outputTexture: GPUTexture,
        settings: DOFSettings
    ): void {
        if (!this.horizontalBlurTexture) {
            console.warn('DOF textures not initialized. Call resize() first.');
            return;
        }

        this.writeUniforms(this.horizontalUniforms, settings, [1, 0]);
        this.writeUniforms(this.verticalUniforms, settings, [0, 1]);
        this.ensureBindGroups(inputTexture, depthTexture, outputTexture);

        const focusPass = commandEncoder.beginComputePass({ label: 'dof-focus' });
        focusPass.setPipeline(this.focusPipeline);
        focusPass.setBindGroup(0, this.focusBindGroup!);
        focusPass.dispatchWorkgroups(1);
        focusPass.end();

        const groupsX = Math.ceil(this.width / 8);
        const groupsY = Math.ceil(this.height / 8);
        for (const bindGroup of [this.horizontalBindGroup!, this.verticalBindGroup!]) {
            const pass = commandEncoder.beginComputePass({ label: 'dof-blur' });
            pass.setPipeline(this.blurPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(groupsX, groupsY);
            pass.end();
        }
    }

    private writeUniforms(buffer: GPUBuffer, s: DOFSettings, direction: [number, number]): void {
        const focusBlend = s.focusSpeed > 0 ? 1 - Math.exp(-s.deltaTime * s.focusSpeed) : 1;
        const point = s.focusPoint ?? [this.width / 2, this.height / 2];
        this.device.queue.writeBuffer(
            buffer,
            0,
            new Float32Array([
                s.focalOffset,
                s.focalRange,
                s.farStrength,
                s.nearStrength,
                s.aperture,
                s.cameraNear,
                s.cameraFar,
                s.targetDistance,
                direction[0],
                direction[1],
                point[0],
                point[1],
                s.focusPoint ? 1 : 0,
                Math.min(1, Math.max(0, focusBlend)),
                this.height * MAX_RADIUS_FRACTION,
                0,
            ])
        );
    }

    private ensureBindGroups(input: GPUTexture, depth: GPUTexture, output: GPUTexture): void {
        const textures = [input, depth, output];
        if (
            this.focusBindGroup &&
            textures.every((texture, i) => texture === this.boundTextures[i])
        ) {
            return;
        }
        this.boundTextures = textures;

        this.focusBindGroup = this.device.createBindGroup({
            label: 'dof-focus',
            layout: this.focusPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 1, resource: depth.createView() },
                { binding: 3, resource: { buffer: this.horizontalUniforms } },
                { binding: 4, resource: { buffer: this.focusBuffer } },
            ],
        });

        const blurGroup = (label: string, src: GPUTexture, dst: GPUTexture, uniforms: GPUBuffer) =>
            this.device.createBindGroup({
                label,
                layout: this.blurPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: src.createView() },
                    { binding: 1, resource: depth.createView() },
                    { binding: 2, resource: dst.createView() },
                    { binding: 3, resource: { buffer: uniforms } },
                    { binding: 4, resource: { buffer: this.focusBuffer } },
                ],
            });
        this.horizontalBindGroup = blurGroup('dof-blur-horizontal', input, this.horizontalBlurTexture!, this.horizontalUniforms);
        this.verticalBindGroup = blurGroup('dof-blur-vertical', this.horizontalBlurTexture!, output, this.verticalUniforms);
    }

    /**
     * Clean up resources
     */
    public destroy(): void {
        this.horizontalUniforms.destroy();
        this.verticalUniforms.destroy();
        this.focusBuffer.destroy();
        this.horizontalBlurTexture?.destroy();
    }
}
