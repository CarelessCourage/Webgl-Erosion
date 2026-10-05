import { GPUContext } from "../core/GPUContext";
import { LayerStack, serializeLayers, MAX_LAYERS, LAYER_FLOATS } from "../core/LayerSystem";
import layersShader from "../shaders/layers.wgsl?raw";
import layerComputeShaderRaw from "../shaders/layer-compute.wgsl?raw";

// Strip any "export default" wrapper if Vite added it
let layerComputeShader = layerComputeShaderRaw;
if (layerComputeShader.startsWith('export default "')) {
  const match = layerComputeShader.match(/^export default "(.*)"$/s);
  if (match) {
    layerComputeShader = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

/**
 * GPU-based layer combination using compute shaders
 */
export class LayerCompute {
  private gpuContext: GPUContext;
  private computePipeline: GPUComputePipeline;
  private layerBuffer: GPUBuffer;
  // Raw result of the layer stack. Never modified by erosion.
  private baseTexture: GPUTexture;
  // What gets rendered: the base, or the base with erosion applied on top.
  private outputTexture: GPUTexture;
  private imageTextureArray: GPUTexture;
  private imageSampler: GPUSampler;
  private bindGroup: GPUBindGroup;
  private textureSize: number = 2048; // Default high resolution
  private readonly maxImageLayers = 4; // Reserve some slots for image textures

  constructor(gpuContext: GPUContext, textureSize: number = 2048) {
    this.gpuContext = gpuContext;
    this.textureSize = textureSize;

    console.log("Creating LayerCompute pipeline...");

    // Create compute pipeline
    try {
      this.computePipeline = gpuContext.device.createComputePipeline({
        layout: "auto",
        compute: {
          module: gpuContext.device.createShaderModule({
            code: `${layersShader}\n${layerComputeShader}`,
          }),
          entryPoint: "computeMain",
        },
      });
      console.log("✓ LayerCompute pipeline created successfully");
    } catch (error) {
      console.error("Failed to create LayerCompute pipeline:", error);
      throw error;
    }

    // RGBA32Float for high precision erosion simulation
    this.baseTexture = gpuContext.device.createTexture({
      label: "layer-base-texture",
      size: [this.textureSize, this.textureSize],
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.outputTexture = gpuContext.device.createTexture({
      label: "layer-display-texture",
      size: [this.textureSize, this.textureSize],
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });

    // Create image texture array for image layers
    this.imageTextureArray = gpuContext.device.createTexture({
      size: [this.textureSize, this.textureSize, this.maxImageLayers],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Create image sampler
    this.imageSampler = gpuContext.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.layerBuffer = gpuContext.device.createBuffer({
      size: MAX_LAYERS * LAYER_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create bind group
    this.bindGroup = gpuContext.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.layerBuffer,
          },
        },
        {
          binding: 1,
          resource: this.baseTexture.createView(),
        },
        {
          binding: 2,
          resource: this.imageTextureArray.createView(),
        },
        {
          binding: 3,
          resource: this.imageSampler,
        },
      ],
    });
  }

  /**
   * Update layer data and run compute shader
   */
  public async computeLayers(layerStack: LayerStack): Promise<void> {
    const layers = layerStack.getAllLayers();

    // Update layer buffer
    const layerData = serializeLayers(layers);
    this.gpuContext.device.queue.writeBuffer(
      this.layerBuffer,
      0,
      layerData.buffer
    );

    // Dispatch compute shader
    const commandEncoder = this.gpuContext.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();

    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroup);

    // Dispatch with appropriate workgroup size (8x8 = 64 threads per workgroup)
    const workgroupsX = Math.ceil(this.textureSize / 8);
    const workgroupsY = Math.ceil(this.textureSize / 8);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);

    computePass.end();

    // Show the fresh base until an erosion simulation writes its result on top.
    commandEncoder.copyTextureToTexture(
      { texture: this.baseTexture },
      { texture: this.outputTexture },
      [this.textureSize, this.textureSize]
    );

    const commandBuffer = commandEncoder.finish();
    this.gpuContext.device.queue.submit([commandBuffer]);

    // Wait for completion
    await this.gpuContext.device.queue.onSubmittedWorkDone();
  }

  /**
   * Upload an image to the texture array for use by image layers
   */
  public uploadImageToArray(imageData: ImageData, arrayIndex: number): void {
    if (arrayIndex >= this.maxImageLayers) {
      throw new Error(
        `Image array index ${arrayIndex} exceeds maximum ${this.maxImageLayers}`
      );
    }

    // Create temporary canvas to resize image to texture size
    const canvas = document.createElement("canvas");
    canvas.width = this.textureSize;
    canvas.height = this.textureSize;
    const ctx = canvas.getContext("2d")!;

    // Create ImageData object and draw to canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(imageData, 0, 0);

    // Draw resized to target canvas
    ctx.drawImage(tempCanvas, 0, 0, this.textureSize, this.textureSize);
    const resizedImageData = ctx.getImageData(
      0,
      0,
      this.textureSize,
      this.textureSize
    );

    // Upload to specific array slice
    this.gpuContext.device.queue.writeTexture(
      {
        texture: this.imageTextureArray,
        origin: [0, 0, arrayIndex],
      },
      resizedImageData.data,
      {
        bytesPerRow: this.textureSize * 4,
        rowsPerImage: this.textureSize,
      },
      [this.textureSize, this.textureSize, 1]
    );
  }

  /**
   * Get the output texture for use by terrain renderer
   */
  public getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }

  /**
   * Get the un-eroded layer result (R = height)
   */
  public getBaseTexture(): GPUTexture {
    return this.baseTexture;
  }

  /**
   * Get the image texture array view for binding
   */
  public getImageTextureArrayView(): GPUTextureView {
    return this.imageTextureArray.createView();
  }

  /**
   * Get the image sampler for binding
   */
  public getImageSampler(): GPUSampler {
    return this.imageSampler;
  }

  /**
   * Get texture size
   */
  public getTextureSize(): number {
    return this.textureSize;
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.layerBuffer.destroy();
    this.baseTexture.destroy();
    this.outputTexture.destroy();
    this.imageTextureArray.destroy();
  }
}
