import { GPUContext } from "../core/GPUContext";
import { LayerCompute } from "../core/LayerCompute";
import { LayerStack } from "../core/LayerSystem";
import flowComputeShader from "../shaders/flow-compute.wgsl?raw";
import sedimentComputeShader from "../shaders/sediment-compute.wgsl?raw";
import velocityComputeShader from "../shaders/velocity-compute.wgsl?raw";

export class ErosionSimulationMultiPass {
  private gpuContext: GPUContext;
  private layerCompute: LayerCompute;

  // Simulation textures (1024x1024 for high resolution)
  private heightTexture!: GPUTexture;
  private waterTexture!: GPUTexture;
  private velocityTexture!: GPUTexture;
  private sedimentTexture!: GPUTexture;
  private fluxTexture!: GPUTexture; // NEW: Water flow flux between cells
  
  // Double buffers for ping-pong updates
  private newHeightTexture!: GPUTexture;
  private newWaterTexture!: GPUTexture;
  private newVelocityTexture!: GPUTexture;
  private newSedimentTexture!: GPUTexture;
  private newFluxTexture!: GPUTexture; // NEW: Flux double buffer

  // Multi-pass compute pipelines
  private flowPipeline!: GPUComputePipeline; // Calculate flux from height differences
  private velocityPipeline!: GPUComputePipeline; // Calculate velocity from flux
  private sedimentPipeline!: GPUComputePipeline; // Handle erosion/deposition
  private waterUpdatePipeline!: GPUComputePipeline; // Update water levels

  // Bind groups for each pass
  private flowBindGroup!: GPUBindGroup;
  private velocityBindGroup!: GPUBindGroup;
  private sedimentBindGroup!: GPUBindGroup;
  private waterUpdateBindGroup!: GPUBindGroup;

  // Parameter buffers for each pass
  private flowParameterBuffer!: GPUBuffer;
  private velocityParameterBuffer!: GPUBuffer;
  private sedimentParameterBuffer!: GPUBuffer;

  // Rain input system
  private rainInputTexture!: GPUTexture;
  private rainInputBuffer!: GPUBuffer;

  // Simulation parameters (enhanced for multi-pass)
  private parameters = {
    deltaTime: 1.0 / 60.0,
    // Flow parameters
    gravity: 9.8, // Much stronger gravity for dramatic flow
    pipeLength: 1.0, // Length of virtual pipes between cells
    pipeArea: 2.0, // Larger pipe area for more flow
    // Sediment parameters
    sedimentCapacity: 25.0, // Much higher sediment capacity
    dissolutionConstant: 5.0, // Much stronger erosion rate
    depositionConstant: 3.0, // Stronger deposition
    evaporationRate: 0.001, // Ke - water evaporation
    thermalRate: 1.0, // Stronger thermal erosion
    // Rain controls
    globalRainEnabled: false,
    mouseRainEnabled: false,
    mouseRainStrength: 2.0, // Much stronger rain
    mouseRainRadius: 50.0, // Larger radius
  };

  private mouseRainActive = false;
  private mouseRainPosition = { x: 0, y: 0 };
  private copyCount = 0;
  private readonly textureSize = 1024;
  private isRunning = false;
  private terrainInitialized = false;

  constructor(gpuContext: GPUContext, layerCompute: LayerCompute) {
    console.log("🌊 Multi-Pass Erosion Simulation initializing...");
    this.gpuContext = gpuContext;
    this.layerCompute = layerCompute;

    this.initializeTextures();
    this.initializeBuffers();
    this.initializePipelines();
    console.log("✓ Multi-Pass ErosionSimulation initialized successfully");
  }

  private initializeTextures() {
    console.log("Initializing multi-pass erosion textures...");

    const textureDescriptor: GPUTextureDescriptor = {
      size: { width: this.textureSize, height: this.textureSize },
      format: "rgba32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    };

    // Main simulation textures
    this.heightTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-height-texture",
    });

    this.waterTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-water-texture",
    });

    this.velocityTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-velocity-texture",
    });

    this.sedimentTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-sediment-texture",
    });

    this.fluxTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-flux-texture",
    });

    // Double buffers
    this.newHeightTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-new-height-texture",
    });

    this.newWaterTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-new-water-texture",
    });

    this.newVelocityTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-new-velocity-texture",
    });

    this.newSedimentTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-new-sediment-texture",
    });

    this.newFluxTexture = this.gpuContext.device.createTexture({
      ...textureDescriptor,
      label: "erosion-new-flux-texture",
    });

    // Rain input texture
    this.rainInputTexture = this.gpuContext.device.createTexture({
      size: { width: this.textureSize, height: this.textureSize },
      format: "r32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
      label: "erosion-rain-input-texture",
    });

    console.log("✓ Multi-pass erosion textures created");
  }

  private initializeBuffers() {
    // Flow computation parameters
    this.flowParameterBuffer = this.gpuContext.device.createBuffer({
      size: 12 * 4, // 12 floats to match WebGPU alignment requirements (48 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "flow-parameters",
    });

    // Velocity computation parameters  
    this.velocityParameterBuffer = this.gpuContext.device.createBuffer({
      size: 4 * 4, // 4 floats: time, timestep, pipe_len, padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "velocity-parameters",
    });

    // Sediment computation parameters
    this.sedimentParameterBuffer = this.gpuContext.device.createBuffer({
      size: 8 * 4, // 8 floats: time, kc, ks, kd, ke, kt, padding[2]
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "sediment-parameters",
    });

    // Rain input buffer
    this.rainInputBuffer = this.gpuContext.device.createBuffer({
      size: 4 * 4, // 4 floats: x, y, strength, radius
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "erosion-rain-input",
    });

    this.updateParameterBuffers();
    console.log("✓ Multi-pass erosion buffers created");
  }

  private updateParameterBuffers() {
    // Update flow parameters
    const flowData = new Float32Array([
      performance.now() / 1000.0,           // time
      this.parameters.deltaTime,             // timestep
      this.parameters.gravity,               // gravity
      this.parameters.pipeLength,            // pipe_len
      this.parameters.pipeArea,              // pipe_area
      this.parameters.globalRainEnabled ? 1.0 : 0.0,  // globalRainEnabled
      this.parameters.mouseRainEnabled ? 1.0 : 0.0,   // mouseRainEnabled
      this.mouseRainActive ? 1.0 : 0.0,      // mouseRainActive
      this.mouseRainPosition.x,              // mouseRainX
      this.mouseRainPosition.y,              // mouseRainY
      this.parameters.mouseRainStrength,     // mouseRainStrength
      this.parameters.mouseRainRadius        // mouseRainRadius
    ]);
    this.gpuContext.device.queue.writeBuffer(this.flowParameterBuffer, 0, flowData);

    // Update velocity parameters
    const velocityData = new Float32Array([
      performance.now() / 1000.0, // time
      this.parameters.deltaTime,   // timestep
      this.parameters.pipeLength,  // pipe_len
      0.0                         // padding
    ]);
    this.gpuContext.device.queue.writeBuffer(this.velocityParameterBuffer, 0, velocityData);

    // Update sediment parameters
    const sedimentData = new Float32Array([
      performance.now() / 1000.0,           // time
      this.parameters.sedimentCapacity,     // kc
      this.parameters.dissolutionConstant,  // ks
      this.parameters.depositionConstant,   // kd
      this.parameters.evaporationRate,      // ke
      this.parameters.thermalRate,          // kt
      0.0, 0.0                             // padding
    ]);
    this.gpuContext.device.queue.writeBuffer(this.sedimentParameterBuffer, 0, sedimentData);
  }

  private initializePipelines() {
    console.log("Initializing multi-pass compute pipelines...");

    // Flow computation pipeline
    this.flowPipeline = this.gpuContext.device.createComputePipeline({
      label: "flow-compute-pipeline",
      layout: "auto",
      compute: {
        module: this.gpuContext.device.createShaderModule({
          label: "flow-compute-shader",
          code: flowComputeShader,
        }),
        entryPoint: "main",
      },
    });

    // Velocity computation pipeline
    this.velocityPipeline = this.gpuContext.device.createComputePipeline({
      label: "velocity-compute-pipeline", 
      layout: "auto",
      compute: {
        module: this.gpuContext.device.createShaderModule({
          label: "velocity-compute-shader",
          code: velocityComputeShader,
        }),
        entryPoint: "main",
      },
    });

    // Sediment computation pipeline
    this.sedimentPipeline = this.gpuContext.device.createComputePipeline({
      label: "sediment-compute-pipeline",
      layout: "auto", 
      compute: {
        module: this.gpuContext.device.createShaderModule({
          label: "sediment-compute-shader",
          code: sedimentComputeShader,
        }),
        entryPoint: "main",
      },
    });

    this.createBindGroups();
    console.log("✓ Multi-pass compute pipelines created");
  }

  private createBindGroups() {
    // Flow computation bind group
    this.flowBindGroup = this.gpuContext.device.createBindGroup({
      label: "flow-bind-group",
      layout: this.flowPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.flowParameterBuffer } },
        { binding: 1, resource: this.heightTexture.createView() },
        { binding: 2, resource: this.waterTexture.createView() },
        { binding: 3, resource: this.fluxTexture.createView() },
        { binding: 4, resource: this.newWaterTexture.createView() },
        { binding: 5, resource: this.newFluxTexture.createView() },
      ],
    });

    // Velocity computation bind group
    this.velocityBindGroup = this.gpuContext.device.createBindGroup({
      label: "velocity-bind-group",
      layout: this.velocityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.velocityParameterBuffer } },
        { binding: 1, resource: this.heightTexture.createView() },
        { binding: 2, resource: this.fluxTexture.createView() },
        { binding: 3, resource: this.newVelocityTexture.createView() },
      ],
    });

    // Sediment computation bind group
    this.sedimentBindGroup = this.gpuContext.device.createBindGroup({
      label: "sediment-bind-group", 
      layout: this.sedimentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sedimentParameterBuffer } },
        { binding: 1, resource: this.heightTexture.createView() },
        { binding: 2, resource: this.sedimentTexture.createView() },
        { binding: 3, resource: this.velocityTexture.createView() },
        { binding: 4, resource: this.newHeightTexture.createView() },
        { binding: 5, resource: this.newSedimentTexture.createView() },
      ],
    });
  }

  // Public methods for simulation control (same interface as original)
  public start() {
    console.log("🌊 Starting multi-pass erosion simulation");
    this.isRunning = true;
  }

  public stop() {
    console.log("⏹️ Stopping multi-pass erosion simulation");
    this.isRunning = false;
  }

  public step() {
    if (!this.isRunning) return;

    console.log("🌊 Multi-pass erosion step executing...");
    this.updateParameterBuffers();

    const commandEncoder = this.gpuContext.device.createCommandEncoder({
      label: "erosion-multi-pass-commands",
    });

    const computePass = commandEncoder.beginComputePass({
      label: "erosion-multi-pass-compute",
    });

    // Pass 1: Flow computation - calculate flux from height differences
    console.log("🔄 Pass 1: Flow computation");
    computePass.setPipeline(this.flowPipeline);
    computePass.setBindGroup(0, this.flowBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.textureSize / 8),
      Math.ceil(this.textureSize / 8)
    );

    // Pass 2: Velocity computation - calculate velocity from flux
    console.log("🔄 Pass 2: Velocity computation");
    computePass.setPipeline(this.velocityPipeline);
    computePass.setBindGroup(0, this.velocityBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.textureSize / 8),
      Math.ceil(this.textureSize / 8)
    );

    // Pass 3: Sediment transport - handle erosion/deposition
    console.log("🔄 Pass 3: Sediment transport");
    computePass.setPipeline(this.sedimentPipeline);
    computePass.setBindGroup(0, this.sedimentBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.textureSize / 8),
      Math.ceil(this.textureSize / 8)
    );

    computePass.end();
    this.gpuContext.device.queue.submit([commandEncoder.finish()]);

    // Swap textures for next frame
    this.swapTextures();

    // Copy height data to LayerCompute for rendering
    this.copyHeightToLayerCompute();
  }

  private swapTextures() {
    // Swap flux textures
    [this.fluxTexture, this.newFluxTexture] = [this.newFluxTexture, this.fluxTexture];
    
    // Swap water textures  
    [this.waterTexture, this.newWaterTexture] = [this.newWaterTexture, this.waterTexture];
    
    // Swap velocity textures
    [this.velocityTexture, this.newVelocityTexture] = [this.newVelocityTexture, this.velocityTexture];
    
    // Swap height and sediment textures
    [this.heightTexture, this.newHeightTexture] = [this.newHeightTexture, this.heightTexture];
    [this.sedimentTexture, this.newSedimentTexture] = [this.newSedimentTexture, this.sedimentTexture];

    // Recreate bind groups with swapped textures
    this.createBindGroups();
  }

  private copyHeightToLayerCompute() {
    // Implementation from original - copy height texture to LayerCompute
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

    if (this.copyCount % 120 === 0) { // Log every 2 seconds
      console.log(`📋 Multi-pass: Height copies to LayerCompute: ${this.copyCount}`);
    }
  }

  // Mouse interaction methods (same as original)
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
    this.parameters.evaporationRate = value;
  }

  public setSedimentCapacity(value: number) {
    this.parameters.sedimentCapacity = value;
  }

  public setDissolutionConstant(value: number) {
    this.parameters.dissolutionConstant = value;
  }

  public setDepositionConstant(value: number) {
    this.parameters.depositionConstant = value;
  }

  public setLayerCompute(layerCompute: LayerCompute) {
    console.log("🔄 Updating LayerCompute reference");
    this.layerCompute = layerCompute;
    // Reinitialize terrain with new layer compute if simulation is running
    if (this.terrainInitialized) {
      console.log("⚠️ Terrain was previously initialized - you may need to reset the simulation");
    }
  }

  // Additional methods required by Settings interface
  public async initializeTerrain(layerStack: LayerStack) {
    console.log("Multi-pass: Baking procedural layers into height texture for erosion...");

    // Use LayerCompute to generate the initial height texture
    if (layerStack) {
      await this.layerCompute.computeLayers(layerStack);
    } else {
      console.warn("No layerStack provided to initializeTerrain, erosion may not work properly");
      return;
    }

    // Copy LayerCompute output to our height texture
    const commandEncoder = this.gpuContext.device.createCommandEncoder();

    // Check format compatibility before copying
    const layerOutput = this.layerCompute.getOutputTexture();
    console.log("Multi-pass: Height texture format:", this.heightTexture.format);
    console.log("Multi-pass: LayerCompute output texture format:", layerOutput.format);

    if (this.heightTexture.format === layerOutput.format) {
      commandEncoder.copyTextureToTexture(
        { texture: layerOutput },
        { texture: this.heightTexture },
        { width: this.textureSize, height: this.textureSize }
      );
      console.log("✓ Multi-pass: Height texture copied from layer compute");
    } else {
      console.warn("Multi-pass: Format mismatch between LayerCompute output and height texture");
    }

    this.gpuContext.device.queue.submit([commandEncoder.finish()]);
    this.terrainInitialized = true;
    console.log("✓ Multi-pass: Terrain baked into erosion simulation");
  }

  public isTerrainInitialized(): boolean {
    return this.terrainInitialized;
  }

  public async reset(layerStack?: LayerStack) {
    console.log("Multi-pass: Resetting erosion simulation");
    this.stop();
    this.mouseRainActive = false;
    this.parameters.globalRainEnabled = false;
    this.parameters.mouseRainEnabled = false;
    this.terrainInitialized = false;
    
    if (layerStack) {
      await this.initializeTerrain(layerStack);
    }
  }

  public cleanup() {
    // Cleanup resources
    this.heightTexture?.destroy();
    this.waterTexture?.destroy();
    this.velocityTexture?.destroy();
    this.sedimentTexture?.destroy();
    this.fluxTexture?.destroy();
    this.newHeightTexture?.destroy();
    this.newWaterTexture?.destroy();
    this.newVelocityTexture?.destroy();
    this.newSedimentTexture?.destroy();
    this.newFluxTexture?.destroy();
    this.rainInputTexture?.destroy();
    this.flowParameterBuffer?.destroy();
    this.velocityParameterBuffer?.destroy();
    this.sedimentParameterBuffer?.destroy();
    this.rainInputBuffer?.destroy();
  }
}