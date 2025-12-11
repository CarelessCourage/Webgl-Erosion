import { GPUContext } from "../core/GPUContext";
import { LayerStack, AlphaLayer } from "../core/LayerSystem";
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
  private outputTexture: GPUTexture;
  private imageTextureArray: GPUTexture;
  private imageSampler: GPUSampler;
  private bindGroup: GPUBindGroup;
  private textureSize: number = 2048; // Default high resolution
  private readonly maxLayers = 5;
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
            code: layerComputeShader,
          }),
          entryPoint: "computeMain",
        },
      });
      console.log("✓ LayerCompute pipeline created successfully");
    } catch (error) {
      console.error("Failed to create LayerCompute pipeline:", error);
      throw error;
    }

    // Create output texture (RGBA32Float for high precision erosion simulation)
    this.outputTexture = gpuContext.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST, // Added for erosion simulation copying
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

    // Create layer storage buffer (aligned to 32 bytes per layer)
    this.layerBuffer = gpuContext.device.createBuffer({
      size: this.maxLayers * 32 * 4, // 32 floats * 4 bytes per layer
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
          resource: this.outputTexture.createView(),
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
   * Convert layer stack to GPU buffer format
   */
  private serializeLayersToBuffer(layers: AlphaLayer[]): Float32Array {
    const buffer = new Float32Array(this.maxLayers * 32); // 32 floats per layer

    for (let i = 0; i < Math.min(layers.length, this.maxLayers); i++) {
      const layer = layers[i];
      const offset = i * 32;

      // Common properties (4 floats)
      buffer[offset + 0] = this.getLayerTypeId(layer.type);
      buffer[offset + 1] = this.getBlendModeId(layer.blendMode);
      buffer[offset + 2] = layer.enabled ? 1.0 : 0.0;
      buffer[offset + 3] = layer.strength;

      if (layer.type === "noise") {
        // Noise parameters (6 floats)
        buffer[offset + 4] = layer.scale;
        buffer[offset + 5] = layer.octaves;
        buffer[offset + 6] = layer.persistence;
        buffer[offset + 7] = layer.lacunarity;
        buffer[offset + 8] = layer.amplitude;
        buffer[offset + 9] = layer.seed;

        // Zero out other sections
        for (let j = 10; j < 32; j++) {
          buffer[offset + j] = 0.0;
        }
      } else if (layer.type === "circle") {
        // Zero noise section (6 floats)
        for (let j = 4; j < 10; j++) {
          buffer[offset + j] = 0.0;
        }

        // Circle parameters (4 floats)
        buffer[offset + 10] = layer.centerX;
        buffer[offset + 11] = layer.centerY;
        buffer[offset + 12] = layer.radius;
        buffer[offset + 13] = layer.falloff;

        // Zero out image section
        for (let j = 14; j < 32; j++) {
          buffer[offset + j] = 0.0;
        }
      } else if (layer.type === "image") {
        // Zero noise and circle sections (10 floats)
        for (let j = 4; j < 14; j++) {
          buffer[offset + j] = 0.0;
        }

        // Image parameters (4 floats)
        buffer[offset + 14] = layer.offsetX;
        buffer[offset + 15] = layer.offsetY;
        buffer[offset + 16] = 0.0; // imageIndex - will be set when uploading images
        buffer[offset + 17] = 0.0; // padding

        // Zero out remaining
        for (let j = 18; j < 32; j++) {
          buffer[offset + j] = 0.0;
        }
      }
    }

    return buffer;
  }

  private getLayerTypeId(type: string): number {
    switch (type) {
      case "noise":
        return 0;
      case "circle":
        return 1;
      case "image":
        return 2;
      default:
        return 0;
    }
  }

  private getBlendModeId(blendMode: string): number {
    switch (blendMode) {
      case "add":
        return 0;
      case "mask":
        return 1;
      case "multiply":
        return 2;
      case "subtract":
        return 3;
      default:
        return 0;
    }
  }

  /**
   * Update layer data and run compute shader
   */
  public async computeLayers(layerStack: LayerStack): Promise<void> {
    const layers = layerStack.getAllLayers();

    // Update layer buffer
    const layerData = this.serializeLayersToBuffer(layers);
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
    this.outputTexture.destroy();
    this.imageTextureArray.destroy();
  }
}
