import { GPUContext } from "../core/GPUContext";
import { LayerCompute } from "../core/LayerCompute";
import { LayerStack } from "../core/LayerSystem";
import simpleErosionShader from "../shaders/simple-erosion.wgsl?raw";

export class ErosionSimulationSimple {
  private gpuContext: GPUContext;
  private layerCompute: LayerCompute;

  // Simple single-pass simulation textures
  private heightTexture!: GPUTexture;
  private newHeightTexture!: GPUTexture;

  // Single compute pipeline
  private erosionPipeline!: GPUComputePipeline;
  private erosionBindGroup!: GPUBindGroup;
  private parameterBuffer!: GPUBuffer;

  // Simulation parameters  
  private parameters = {
    deltaTime: 1.0 / 60.0,
    gravity: 9.8,
    dissolveRate: 2.0, // Stronger erosion to make visible effects
    globalRainEnabled: false,
    mouseRainEnabled: false,
    mouseRainStrength: 2.0, // Strong for dramatic effect
    mouseRainRadius: 50.0,
  };

  private mouseRainActive = false;
  private mouseRainPosition = { x: 0, y: 0 };
  private copyCount = 0;
  private readonly textureSize = 1024;
  private isRunning = false;
  private terrainInitialized = false;

  constructor(gpuContext: GPUContext, layerCompute: LayerCompute) {
    console.log("🔧 Simple Erosion Simulation initializing...");
    this.gpuContext = gpuContext;
    this.layerCompute = layerCompute;

    this.initializeTextures();
    this.initializeBuffers();
    this.initializePipeline();
    console.log("✓ Simple ErosionSimulation initialized successfully");
  }

  private initializeTextures() {
    const textureDescriptor: GPUTextureDescriptor = {
      size: { width: this.textureSize, height: this.textureSize },
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    };

    this.heightTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "simple-erosion-height-texture",
    });

    this.newHeightTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "simple-erosion-new-height-texture",
    });

    console.log("✓ Simple erosion textures created");
  }

  private initializeBuffers() {
    this.parameterBuffer = this.gpuContext.device.createBuffer({
      size: 12 * 4, // 12 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "simple-erosion-parameters",
    });

    this.updateParameterBuffer();
    console.log("✓ Simple erosion buffers created");
  }

  private updateParameterBuffer() {
    const data = new Float32Array([
      performance.now() / 1000.0,           // time
      this.parameters.deltaTime,             // timestep
      this.parameters.gravity,               // gravity
      this.parameters.dissolveRate,          // dissolve_rate
      this.parameters.globalRainEnabled ? 1.0 : 0.0,  // globalRainEnabled
      this.parameters.mouseRainEnabled ? 1.0 : 0.0,   // mouseRainEnabled
      this.mouseRainActive ? 1.0 : 0.0,      // mouseRainActive
      this.mouseRainPosition.x,              // mouseRainX
      this.mouseRainPosition.y,              // mouseRainY
      this.parameters.mouseRainStrength,     // mouseRainStrength
      this.parameters.mouseRainRadius,       // mouseRainRadius
      0.0                                    // padding
    ]);
    this.gpuContext.device.queue.writeBuffer(this.parameterBuffer, 0, data);
  }

  private initializePipeline() {
    console.log("Initializing simple erosion compute pipeline...");

    this.erosionPipeline = this.gpuContext.device.createComputePipeline({
      label: "simple-erosion-compute-pipeline",
      layout: "auto",
      compute: {
        module: this.gpuContext.device.createShaderModule({
          label: "simple-erosion-compute-shader",
          code: simpleErosionShader,
        }),
        entryPoint: "main",
      },
    });

    this.createBindGroup();
    console.log("✓ Simple erosion compute pipeline created");
  }

  private createBindGroup() {
    this.erosionBindGroup = this.gpuContext.device.createBindGroup({
      label: "simple-erosion-bind-group",
      layout: this.erosionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.parameterBuffer } },
        { binding: 1, resource: this.heightTexture.createView() },
        { binding: 2, resource: this.newHeightTexture.createView() },
      ],
    });
  }

  public start() {
    console.log("🔧 Starting simple erosion simulation");
    this.isRunning = true;
  }

  public stop() {
    console.log("⏹️ Stopping simple erosion simulation");
    this.isRunning = false;
  }

  public step() {
    if (!this.isRunning) return;

    console.log("🔧 Simple erosion step executing...");
    this.updateParameterBuffer();

    const commandEncoder = this.gpuContext.device.createCommandEncoder({
      label: "simple-erosion-commands",
    });

    const computePass = commandEncoder.beginComputePass({
      label: "simple-erosion-compute",
    });

    computePass.setPipeline(this.erosionPipeline);
    computePass.setBindGroup(0, this.erosionBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.textureSize / 8),
      Math.ceil(this.textureSize / 8)
    );

    computePass.end();
    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    // Swap textures
    [this.heightTexture, this.newHeightTexture] = [this.newHeightTexture, this.heightTexture];
    this.createBindGroup();

    // Copy height data to LayerCompute for rendering
    this.copyHeightToLayerCompute();
  }

  private copyHeightToLayerCompute() {
    this.copyCount++;
    const commandEncoder = this.gpuContext.device.createCommandEncoder({
      label: "copy-height-to-layer-compute",
    });

    commandEncoder.copyTextureToTexture(
      { texture: this.heightTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      { texture: this.layerCompute.getOutputTexture(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      { width: this.textureSize, height: this.textureSize, depthOrArrayLayers: 1 }
    );

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    if (this.copyCount % 60 === 0) {
      console.log(`📋 Simple: Height copies to LayerCompute: ${this.copyCount}`);
    }
  }

  // Interface compatibility methods
  public async initializeTerrain(layerStack: LayerStack) {
    console.log("🔧 Simple: Baking procedural layers into height texture for erosion...");

    if (layerStack) {
      await this.layerCompute.computeLayers(layerStack);
    } else {
      console.warn("No layerStack provided to initializeTerrain");
      return;
    }

    const commandEncoder = this.gpuContext.device.createCommandEncoder();
    const layerOutput = this.layerCompute.getOutputTexture();

    if (this.heightTexture.format === layerOutput.format) {
      commandEncoder.copyTextureToTexture(
        { texture: layerOutput },
        { texture: this.heightTexture },
        { width: this.textureSize, height: this.textureSize }
      );
      console.log("✓ Simple: Height texture copied from layer compute");
    } else {
      console.warn("Simple: Format mismatch between LayerCompute output and height texture");
    }

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);
    this.terrainInitialized = true;
    console.log("✓ Simple: Terrain baked into erosion simulation");
  }

  public isTerrainInitialized(): boolean {
    return this.terrainInitialized;
  }

  public async reset(layerStack?: LayerStack) {
    console.log("🔧 Simple: Resetting erosion simulation");
    this.stop();
    this.mouseRainActive = false;
    this.parameters.globalRainEnabled = false;
    this.parameters.mouseRainEnabled = false;
    this.terrainInitialized = false; // Allow re-initialization
    
    if (layerStack) {
      await this.initializeTerrain(layerStack);
    }
  }

  // Mouse interaction methods
  public setMouseRain(x: number, y: number, active: boolean) {
    this.mouseRainActive = active;
    this.mouseRainPosition.x = x;
    this.mouseRainPosition.y = y;
    this.parameters.mouseRainEnabled = active;
  }

  public setMouseRainTool(active: boolean) {
    this.parameters.mouseRainEnabled = active;
  }

  public addRainAtPosition(x: number, y: number) {
    this.setMouseRain(x, y, true);
  }

  public startContinuousRainAtPosition(x: number, y: number) {
    this.setMouseRain(x, y, true);
  }

  public stopContinuousRain() {
    this.setMouseRain(0, 0, false);
  }

  public setGlobalRain(enabled: boolean) {
    console.log(`🌧️ Simple: Setting global rain to ${enabled}`);
    this.parameters.globalRainEnabled = enabled;
  }

  // Settings interface methods
  public setMouseRainStrength(value: number) {
    this.parameters.mouseRainStrength = value;
  }

  public setMouseRainRadius(value: number) {
    this.parameters.mouseRainRadius = value;
  }

  public setRainRate(value: number) {
    this.parameters.globalRainEnabled = value > 0;
  }

  public setEvaporationRate(value: number) {
    // Not implemented in simple version
  }

  public setSedimentCapacity(value: number) {
    // Not implemented in simple version
  }

  public setDissolutionConstant(value: number) {
    this.parameters.dissolveRate = value;
  }

  public setDepositionConstant(value: number) {
    // Not implemented in simple version
  }

  public cleanup() {
    this.heightTexture?.destroy();
    this.newHeightTexture?.destroy();
    this.parameterBuffer?.destroy();
  }
}