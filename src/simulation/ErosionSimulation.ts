import { GPUContext } from "../core/GPUContext";
import { LayerCompute } from "../core/LayerCompute";
import flowSimulationShader from "../shaders/flow.wgsl?raw";

/**
 * Physics-based erosion simulation using WebGPU compute shaders
 * Implements hydraulic erosion with water flow, sediment transport, and terrain modification
 */
export class ErosionSimulation {
  private gpuContext: GPUContext;
  private layerCompute: LayerCompute;

  // Simulation textures (1024x1024 for high resolution)
  private heightTexture!: GPUTexture;
  private waterTexture!: GPUTexture;
  private velocityTexture!: GPUTexture; // RG = velocity X/Y, BA = unused
  private sedimentTexture!: GPUTexture; // R = suspended sediment, GBA = unused
  private newHeightTexture!: GPUTexture; // Double buffer for height updates
  private newWaterTexture!: GPUTexture; // Double buffer for water updates

  // Compute pipelines for simulation steps
  private flowPipeline!: GPUComputePipeline;
  private sedimentPipeline: GPUComputePipeline | null = null;
  private thermalPipeline: GPUComputePipeline | null = null;
  private evaporationPipeline: GPUComputePipeline | null = null;

  // Bind groups and buffers
  private flowBindGroup!: GPUBindGroup;
  private parameterBuffer!: GPUBuffer;

  // Simulation parameters
  private parameters = {
    deltaTime: 1.0 / 60.0, // 60 FPS simulation timestep
    rainRate: 0.01, // Water added per timestep
    evaporationRate: 0.002, // Water lost per timestep
    gravity: 9.81, // Gravitational acceleration
    pipeCrossSection: 1.0, // Cross-sectional area of virtual pipes
    pipeLength: 1.0, // Length of virtual pipes between cells
    sedimentCapacity: 4.0, // Maximum sediment a water cell can carry
    dissolutionConstant: 0.3, // How quickly terrain dissolves
    depositionConstant: 0.3, // How quickly sediment is deposited
    thermalRate: 0.1, // Thermal erosion strength
    minSlope: 0.05, // Minimum slope for thermal erosion
    // Rain input controls
    globalRainEnabled: false, // Whether to rain everywhere
    mouseRainEnabled: false, // Whether mouse rain tool is active
    mouseRainStrength: 0.1, // Strength of mouse rain
    mouseRainRadius: 20.0, // Radius of mouse rain in pixels
  };

  // Mouse interaction state
  private rainInputTexture!: GPUTexture;
  private rainInputBuffer!: GPUBuffer;
  private mouseRainActive = false;
  private mouseRainPosition = { x: 0, y: 0 };

  private readonly textureSize = 1024;
  private isRunning = false;

  constructor(gpuContext: GPUContext, layerCompute: LayerCompute) {
    console.log(
      "🔥 FULL ErosionSimulation constructor starting - WITH COMPUTE PIPELINES! 🔥"
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

    // Read-only texture descriptor for textures accessed as texture_2d<f32> in shader
    const readOnlyTextureDescriptor: GPUTextureDescriptor = {
      size: { width: this.textureSize, height: this.textureSize },
      format: "rgba32float",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    };

    // Write-only texture descriptor for textures accessed as texture_storage_2d<rgba32float, write>
    const writeOnlyTextureDescriptor: GPUTextureDescriptor = {
      size: { width: this.textureSize, height: this.textureSize },
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    };

    // Create simulation state textures (read-only in shader)
    this.heightTexture = this.gpuContext.device.createTexture({
      ...readOnlyTextureDescriptor,
      label: "erosion-height-texture",
    });

    this.waterTexture = this.gpuContext.device.createTexture({
      ...readOnlyTextureDescriptor,
      label: "erosion-water-texture",
    });

    this.velocityTexture = this.gpuContext.device.createTexture({
      size: { width: this.textureSize, height: this.textureSize },
      format: "rg32float", // RG32Float supports read_write access
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
      label: "erosion-velocity-texture",
    });

    this.sedimentTexture = this.gpuContext.device.createTexture({
      ...readOnlyTextureDescriptor,
      label: "erosion-sediment-texture",
    });

    // Double buffers for ping-pong updates (write-only in shader)
    this.newHeightTexture = this.gpuContext.device.createTexture({
      ...writeOnlyTextureDescriptor,
      label: "erosion-new-height-texture",
    });

    this.newWaterTexture = this.gpuContext.device.createTexture({
      ...writeOnlyTextureDescriptor,
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
      size: 4 * 4, // 4 floats: mouseX, mouseY, radius, strength
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "erosion-rain-input",
    });

    this.updateParameterBuffer();
    this.clearRainInput();
  }

  private updateParameterBuffer() {
    const data = new Float32Array([
      this.parameters.deltaTime,
      this.parameters.rainRate,
      this.parameters.evaporationRate,
      this.parameters.gravity,
      this.parameters.pipeCrossSection,
      this.parameters.pipeLength,
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

    // Force LayerCompute to regenerate with current layers if provided
    if (layerStack) {
      await this.layerCompute.computeLayers(layerStack);
    }

    // Use LayerCompute to generate the initial height texture
    const computedTexture = this.layerCompute.getOutputTexture();

    // Verify texture formats match
    console.log("LayerCompute output texture format:", computedTexture.format);
    console.log(
      "ErosionSimulation height texture format:",
      this.heightTexture.format
    );

    if (computedTexture.format !== this.heightTexture.format) {
      console.error(
        "TEXTURE FORMAT MISMATCH! Cannot copy textures with different formats."
      );
      console.error(
        "Source:",
        computedTexture.format,
        "Destination:",
        this.heightTexture.format
      );
      return;
    }

    // Copy the computed height data to our erosion height texture
    const commandEncoder = this.gpuContext.device.createCommandEncoder();

    commandEncoder.copyTextureToTexture(
      { texture: computedTexture },
      { texture: this.heightTexture },
      { width: this.textureSize, height: this.textureSize }
    );

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    // Clear water, velocity, and sediment textures
    this.clearSimulationState();

    console.log("✓ Terrain initialized for erosion simulation");
  }

  private clearSimulationState() {
    // Clear water, velocity, and sediment to zero
    const commandEncoder = this.gpuContext.device.createCommandEncoder();

    // We'll implement texture clearing here when we add the clear shaders
    // For now, they'll start with undefined data which is acceptable for testing

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Run a single simulation timestep
   */
  step() {
    if (!this.isRunning) return;

    const commandEncoder = this.gpuContext.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();

    // 1. Water flow simulation
    computePass.setPipeline(this.flowPipeline);
    computePass.setBindGroup(0, this.flowBindGroup);

    // Dispatch compute threads (8x8 workgroup size)
    const dispatchX = Math.ceil(this.textureSize / 8);
    const dispatchY = Math.ceil(this.textureSize / 8);
    computePass.dispatchWorkgroups(dispatchX, dispatchY);

    computePass.end();
    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    // Swap buffers (ping-pong)
    this.swapBuffers();
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

    // Update bind group with swapped textures
    this.updateBindGroup();
  }

  private updateBindGroup() {
    // Recreate bind group with swapped textures
    this.createBindGroup();
  }

  // Public control methods
  start() {
    console.log("Starting erosion simulation...");
    this.isRunning = true;
  }

  stop() {
    console.log("Stopping erosion simulation...");
    this.isRunning = false;
  }

  reset(layerStack?: any) {
    console.log("Resetting erosion simulation...");
    this.stop();
    this.initializeTerrain(layerStack);
  }

  // Parameter getters and setters for GUI integration
  setRainRate(rate: number) {
    this.parameters.rainRate = rate;
    this.updateParameterBuffer();
  }

  setEvaporationRate(rate: number) {
    this.parameters.evaporationRate = rate;
    this.updateParameterBuffer();
  }

  setSedimentCapacity(capacity: number) {
    this.parameters.sedimentCapacity = capacity;
    this.updateParameterBuffer();
  }

  setDissolutionConstant(constant: number) {
    this.parameters.dissolutionConstant = constant;
    this.updateParameterBuffer();
  }

  setDepositionConstant(constant: number) {
    this.parameters.depositionConstant = constant;
    this.updateParameterBuffer();
  }

  // Rain control methods
  setGlobalRain(enabled: boolean) {
    this.parameters.globalRainEnabled = enabled;
    this.updateParameterBuffer();
  }

  setMouseRainTool(enabled: boolean) {
    this.parameters.mouseRainEnabled = enabled;
    this.updateParameterBuffer();
  }

  setMouseRainStrength(strength: number) {
    this.parameters.mouseRainStrength = strength;
    this.updateParameterBuffer();
  }

  setMouseRainRadius(radius: number) {
    this.parameters.mouseRainRadius = radius;
    this.updateParameterBuffer();
  }

  // Mouse interaction methods
  addRainAtPosition(normalizedX: number, normalizedY: number) {
    // Convert normalized coordinates (0-1) to texture coordinates
    this.mouseRainPosition.x = normalizedX * this.textureSize;
    this.mouseRainPosition.y = normalizedY * this.textureSize;
    this.mouseRainActive = true;

    console.log(
      `Adding rain at: (${normalizedX.toFixed(3)}, ${normalizedY.toFixed(
        3
      )}) -> texture (${this.mouseRainPosition.x}, ${this.mouseRainPosition.y})`
    );

    this.updateParameterBuffer();

    // Rain will be applied for one frame, then cleared
    setTimeout(() => {
      this.mouseRainActive = false;
      this.updateParameterBuffer();
    }, 16); // Clear after ~1 frame at 60fps
  }

  startContinuousRainAtPosition(normalizedX: number, normalizedY: number) {
    this.mouseRainPosition.x = normalizedX * this.textureSize;
    this.mouseRainPosition.y = normalizedY * this.textureSize;
    this.mouseRainActive = true;
    this.updateParameterBuffer();
  }

  stopContinuousRain() {
    this.mouseRainActive = false;
    this.updateParameterBuffer();
  }

  // Getters for rendering integration
  getHeightTexture(): GPUTexture {
    return this.heightTexture;
  }

  getWaterTexture(): GPUTexture {
    return this.waterTexture;
  }

  getVelocityTexture(): GPUTexture {
    return this.velocityTexture;
  }

  getSedimentTexture(): GPUTexture {
    return this.sedimentTexture;
  }

  isSimulationRunning(): boolean {
    return this.isRunning;
  }
}
