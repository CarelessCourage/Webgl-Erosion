import { GPUContext } from "../core/GPUContext";
import { LayerCompute } from "../core/LayerCompute";
import flowSimulationShader from "../shaders/flow.wgsl?raw";

export class ErosionSimulation {
  private gpuContext: GPUContext;
  private layerCompute: LayerCompute;

  // Simulation textures (1024x1024 for high resolution)
  private heightTexture!: GPUTexture;
  private waterTexture!: GPUTexture;
  private velocityTexture!: GPUTexture; // RG = velocity X/Y, BA = unused (READ texture)
  private sedimentTexture!: GPUTexture; // R = suspended sediment, GBA = unused
  private newHeightTexture!: GPUTexture; // Double buffer for height updates
  private newWaterTexture!: GPUTexture; // Double buffer for water updates
  private newVelocityTexture!: GPUTexture; // Double buffer for velocity updates (WRITE texture)

  // Compute pipelines for simulation steps
  private flowPipeline!: GPUComputePipeline;
  private sedimentPipeline: GPUComputePipeline | null = null;
  private thermalPipeline: GPUComputePipeline | null = null;
  private evaporationPipeline: GPUComputePipeline | null = null;

  // Bind groups and buffers
  private flowBindGroup!: GPUBindGroup;
  private parameterBuffer!: GPUBuffer;

  // Simulation parameters (increased for dramatic visible effects)
  private parameters = {
    deltaTime: 1.0 / 60.0, // Fixed timestep
    rainRate: 0.1, // Amount of water added per rain event (10x higher)
    evaporationRate: 0.001, // Water loss per frame
    sedimentCapacity: 10.0, // Max sediment carried by water (2.5x higher)
    dissolutionConstant: 2.0, // How quickly terrain dissolves (6x higher for dramatic effect)
    depositionConstant: 1.5, // How quickly sediment is deposited (5x higher)
    thermalRate: 0.5, // Thermal erosion strength (5x higher)
    minSlope: 0.02, // Minimum slope for thermal erosion (lower threshold)
    // Rain input controls
    globalRainEnabled: false, // Whether to rain everywhere
    mouseRainEnabled: false, // Whether mouse rain tool is active
    mouseRainStrength: 0.5, // Strength of mouse rain (5x higher)
    mouseRainRadius: 40.0, // Radius of mouse rain in pixels (2x larger)
  };

  // Mouse interaction state
  private rainInputTexture!: GPUTexture;
  private rainInputBuffer!: GPUBuffer;
  private mouseRainActive = false;
  private mouseRainPosition = { x: 0, y: 0 };
  private copyCount = 0; // Debug counter for height copying

  private readonly textureSize = 1024;
  private isRunning = false;

  constructor(gpuContext: GPUContext, layerCompute: LayerCompute) {
    console.log(
      "🚀🚀🚀 FINAL ATTEMPT - NEW EROSION SIMULATION LOADING! 🚀🚀🚀"
    );
    console.log(
      "⚡ If you see this, the REAL ErosionSimulation is finally working! ⚡"
    );
    this.gpuContext = gpuContext;
    this.layerCompute = layerCompute;

    this.initializeTextures();
    this.initializeBuffers();
    this.initializePipelines();
    console.log("✓ ErosionSimulation initialized successfully");
  }

  private initializeTextures() {
    console.log("Initializing erosion simulation textures...");

    // Read-only texture descriptor for textures that never swap (sediment)
    const readOnlyTextureDescriptor: GPUTextureDescriptor = {
      size: { width: this.textureSize, height: this.textureSize },
      format: "rgba32float",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    };

    // Ping-pong texture descriptor for textures that swap between read and write roles
    const pingPongTextureDescriptor: GPUTextureDescriptor = {
      size: { width: this.textureSize, height: this.textureSize },
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    };

    console.log(
      "🔧 Ping-pong texture usage flags:",
      pingPongTextureDescriptor.usage
    );
    console.log(
      "🔧 Expected usage includes STORAGE_BINDING:",
      (pingPongTextureDescriptor.usage & GPUTextureUsage.STORAGE_BINDING) !== 0
    );

    // Create simulation state textures that participate in ping-pong swapping
    this.heightTexture = this.gpuContext.device.createTexture({
      ...pingPongTextureDescriptor,
      label: "erosion-height-texture",
    });

    console.log(
      "✓ Height texture created with usage flags:",
      this.heightTexture.usage
    );

    this.waterTexture = this.gpuContext.device.createTexture({
      ...pingPongTextureDescriptor,
      label: "erosion-water-texture",
    });

    this.velocityTexture = this.gpuContext.device.createTexture({
      ...pingPongTextureDescriptor,
      label: "erosion-velocity-texture",
    });

    // Separate write texture for velocity updates (can't have read_write access reliably)
    this.newVelocityTexture = this.gpuContext.device.createTexture({
      ...pingPongTextureDescriptor,
      label: "erosion-new-velocity-texture",
    });

    this.sedimentTexture = this.gpuContext.device.createTexture({
      ...readOnlyTextureDescriptor,
      label: "erosion-sediment-texture",
    });

    // Double buffers for ping-pong updates (write-only in shader)
    this.newHeightTexture = this.gpuContext.device.createTexture({
      ...pingPongTextureDescriptor,
      label: "erosion-new-height-texture",
    });

    this.newWaterTexture = this.gpuContext.device.createTexture({
      ...pingPongTextureDescriptor,
      label: "erosion-new-water-texture",
    });

    // Create rain input texture for localized rain effects
    this.rainInputTexture = this.gpuContext.device.createTexture({
      size: { width: this.textureSize, height: this.textureSize },
      format: "r32float", // Single channel for rain intensity
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
      label: "erosion-rain-input-texture",
    });

    console.log("✓ Erosion textures created");
  }

  private initializeBuffers() {
    // Create parameter buffer for simulation constants (expanded for rain controls)
    this.parameterBuffer = this.gpuContext.device.createBuffer({
      size: 20 * 4, // 20 floats * 4 bytes each (expanded from 12)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "erosion-parameters",
    });

    // Create rain input buffer for mouse position data
    this.rainInputBuffer = this.gpuContext.device.createBuffer({
      size: 4 * 4, // 4 floats: x, y, strength, radius
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "erosion-rain-input",
    });

    // Initialize parameter buffer with default values
    this.updateParameterBuffer();

    console.log("✓ Erosion buffers created");
  }

  private updateParameterBuffer() {
    const data = new Float32Array([
      this.parameters.deltaTime,
      this.parameters.rainRate,
      this.parameters.evaporationRate,
      this.parameters.sedimentCapacity,
      this.parameters.dissolutionConstant,
      this.parameters.depositionConstant,
      this.parameters.thermalRate,
      this.parameters.minSlope,
      0.0, // Padding
      // New rain controls
      this.parameters.globalRainEnabled ? 1.0 : 0.0,
      this.parameters.mouseRainEnabled ? 1.0 : 0.0,
      this.parameters.mouseRainStrength,
      this.parameters.mouseRainRadius,
      this.mouseRainActive ? 1.0 : 0.0,
      this.mouseRainPosition.x,
      this.mouseRainPosition.y,
      0.0, // Padding
    ]);

    this.gpuContext.device.queue.writeBuffer(this.parameterBuffer, 0, data);
  }

  private clearRainInput() {
    // Clear rain input texture to zero
    const commandEncoder = this.gpuContext.device.createCommandEncoder();

    // We'll implement this when we add the rain clear shader
    // For now, just update the mouse rain state
    this.mouseRainActive = false;
    this.updateParameterBuffer();

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);
  }

  private initializePipelines() {
    console.log("Creating erosion compute pipelines...");

    try {
      // Create flow simulation pipeline with auto layout
      this.flowPipeline = this.gpuContext.device.createComputePipeline({
        layout: "auto",
        compute: {
          module: this.gpuContext.device.createShaderModule({
            code: flowSimulationShader,
            label: "erosion-flow-shader-module",
          }),
          entryPoint: "flowMain",
        },
        label: "erosion-flow-pipeline",
      });

      console.log("✓ Flow pipeline created successfully");

      // Create bind group AFTER pipeline is successfully created
      this.createBindGroup();
    } catch (error) {
      console.error("Failed to create erosion pipeline:", error);
      throw error;
    }
  }

  private createBindGroup() {
    try {
      this.flowBindGroup = this.gpuContext.device.createBindGroup({
        layout: this.flowPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.parameterBuffer } },
          { binding: 1, resource: this.heightTexture.createView() },
          { binding: 2, resource: this.waterTexture.createView() },
          { binding: 3, resource: this.velocityTexture.createView() },
          { binding: 4, resource: this.newHeightTexture.createView() },
          { binding: 5, resource: this.newWaterTexture.createView() },
          { binding: 6, resource: this.newVelocityTexture.createView() },
        ],
        label: "erosion-flow-bind-group",
      });

      console.log("✓ Flow bind group created successfully");
    } catch (error) {
      console.error("Failed to create flow bind group:", error);
      throw error;
    }
  }

  /**
   * Initialize simulation with terrain data from LayerCompute
   */
  async initializeTerrain(layerStack?: any) {
    console.log("Baking procedural layers into height texture for erosion...");

    // Use LayerCompute to generate the initial height texture
    if (layerStack) {
      await this.layerCompute.computeLayers(layerStack);
    } else {
      console.warn(
        "No layerStack provided to initializeTerrain, erosion may not work properly"
      );
      return;
    }

    // Copy LayerCompute output to our height texture
    const commandEncoder = this.gpuContext.device.createCommandEncoder();

    // Check format compatibility before copying
    const layerOutput = this.layerCompute.getOutputTexture();
    console.log(
      "ErosionSimulation height texture format:",
      this.heightTexture.format
    );
    console.log("LayerCompute output texture format:", layerOutput.format);

    if (this.heightTexture.format === layerOutput.format) {
      commandEncoder.copyTextureToTexture(
        { texture: layerOutput },
        { texture: this.heightTexture },
        { width: this.textureSize, height: this.textureSize }
      );
      console.log("✓ Height texture copied from layer compute");
    } else {
      console.warn(
        "Format mismatch between LayerCompute output and height texture"
      );
    }

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);
    console.log("✓ Terrain baked into erosion simulation");
  }

  /**
   * Execute one simulation step
   */
  step() {
    if (!this.isRunning) return;

    // Update parameters if needed
    this.updateParameterBuffer();

    // Execute flow simulation
    const commandEncoder = this.gpuContext.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();

    computePass.setPipeline(this.flowPipeline);
    computePass.setBindGroup(0, this.flowBindGroup);

    // Dispatch threads (32x32 workgroups for 1024x1024 texture)
    const workgroupsX = Math.ceil(this.textureSize / 32);
    const workgroupsY = Math.ceil(this.textureSize / 32);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

    computePass.end();
    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    // Swap buffers for ping-pong updates
    this.swapBuffers();

    // Copy eroded height data back to LayerCompute for rendering
    this.copyHeightToLayerCompute();
  }

  private swapBuffers() {
    // Swap height textures
    const tempHeight = this.heightTexture;
    this.heightTexture = this.newHeightTexture;
    this.newHeightTexture = tempHeight;

    // Swap water textures
    const tempWater = this.waterTexture;
    this.waterTexture = this.newWaterTexture;
    this.newWaterTexture = tempWater;

    // Swap velocity textures
    const tempVelocity = this.velocityTexture;
    this.velocityTexture = this.newVelocityTexture;
    this.newVelocityTexture = tempVelocity;

    // Recreate bind group with swapped textures
    this.createBindGroup();
  }

  // Public interface methods
  start() {
    this.isRunning = true;
    console.log("✓ Erosion simulation started");
  }

  stop() {
    this.isRunning = false;
    console.log("✓ Erosion simulation stopped");
  }

  async reset(layerStack?: any) {
    this.stop();
    await this.initializeTerrain(layerStack);
  }

  // Mouse rain tool interface
  setMouseRainTool(active: boolean) {
    this.parameters.mouseRainEnabled = active;
    this.updateParameterBuffer();
  }

  addRainAtPosition(x: number, y: number) {
    this.mouseRainPosition = { x, y };
    this.mouseRainActive = true;
    this.updateParameterBuffer();
  }

  startContinuousRainAtPosition(x: number, y: number) {
    this.mouseRainPosition = { x, y };
    this.mouseRainActive = true;
    this.updateParameterBuffer();
  }

  stopContinuousRain() {
    this.mouseRainActive = false;
    this.updateParameterBuffer();
  }

  setGlobalRain(enabled: boolean) {
    this.parameters.globalRainEnabled = enabled;
    this.updateParameterBuffer();
  }

  // Parameter setters
  setRainRate(value: number) {
    this.parameters.rainRate = value;
    this.updateParameterBuffer();
  }

  setEvaporationRate(value: number) {
    this.parameters.evaporationRate = value;
    this.updateParameterBuffer();
  }

  setSedimentCapacity(value: number) {
    this.parameters.sedimentCapacity = value;
    this.updateParameterBuffer();
  }

  setDissolutionConstant(value: number) {
    this.parameters.dissolutionConstant = value;
    this.updateParameterBuffer();
  }

  setDepositionConstant(value: number) {
    this.parameters.depositionConstant = value;
    this.updateParameterBuffer();
  }

  setMouseRainStrength(value: number) {
    this.parameters.mouseRainStrength = value;
    this.updateParameterBuffer();
  }

  setMouseRainRadius(value: number) {
    this.parameters.mouseRainRadius = value;
    this.updateParameterBuffer();
  }

  /**
   * Copy eroded height data back to LayerCompute output for rendering
   */
  copyHeightToLayerCompute() {
    const commandEncoder = this.gpuContext.device.createCommandEncoder();

    commandEncoder.copyTextureToTexture(
      { texture: this.heightTexture },
      { texture: this.layerCompute.getOutputTexture() },
      { width: this.textureSize, height: this.textureSize }
    );

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    // Debug: Log every 120 frames (2 seconds) to verify copying is happening
    this.copyCount = (this.copyCount || 0) + 1;
    if (this.copyCount % 120 === 0) {
      console.log(
        `🔄 Erosion height data copied to LayerCompute (${this.copyCount} times)`
      );
    }
  }

  // Getters for debugging
  getHeightTexture() {
    return this.heightTexture;
  }
  getWaterTexture() {
    return this.waterTexture;
  }
  getVelocityTexture() {
    return this.velocityTexture;
  }
}
