import { GPUContext } from "../core/GPUContext";
import { LayerCompute } from "../core/LayerCompute";
import commonShader from "../shaders/erosion/common.wgsl?raw";
import rainShader from "../shaders/erosion/rain.wgsl?raw";
import flowShader from "../shaders/erosion/flow.wgsl?raw";
import waterShader from "../shaders/erosion/water.wgsl?raw";
import erosionShader from "../shaders/erosion/erosion.wgsl?raw";
import advectShader from "../shaders/erosion/advect.wgsl?raw";
import macCormackShader from "../shaders/erosion/maccormack.wgsl?raw";
import smoothShader from "../shaders/erosion/smooth.wgsl?raw";
import thermalFluxShader from "../shaders/erosion/thermal-flux.wgsl?raw";
import thermalApplyShader from "../shaders/erosion/thermal-apply.wgsl?raw";
import rebaseShader from "../shaders/erosion/rebase.wgsl?raw";
import exportShader from "../shaders/erosion/export.wgsl?raw";

// Must match the terrain plane (createPlane scale) and the displacement in terrain.wgsl.
export const TERRAIN_WORLD_SIZE = 10.0;
export const TERRAIN_DISPLACEMENT_SCALE = 5.0;

export interface ErosionParameters {
  stepsPerFrame: number;
  timeStep: number;
  pipeLength: number;
  pipeArea: number;
  gravity: number;
  sedimentCapacity: number; // Kc
  dissolution: number; // Ks
  deposition: number; // Kd
  evaporation: number; // Ke
  minSlope: number;
  velocityAdvection: number;
  thermalRate: number;
  talusAngle: number; // degrees
  smoothThreshold: number; // spike smoothing, in cell units (0 = off)
  globalRain: boolean;
  rainRate: number;
  drainEdges: boolean;
  brushRadius: number; // fraction of the terrain width
  brushStrength: number;
}

// Physics constants follow the original WebGL implementation (src-old/main.ts);
// the sediment/water rates are tuned stronger so material visibly travels into
// the valleys (more water + higher capacity/pickup moves more sediment, while a
// moderate Kd keeps it in suspension long enough to form fans and deltas).
export const DEFAULT_EROSION_PARAMETERS: ErosionParameters = {
  stepsPerFrame: 3,
  timeStep: 0.05,
  pipeLength: 0.8,
  pipeArea: 0.6,
  gravity: 0.8,
  sedimentCapacity: 0.25,
  dissolution: 0.08,
  deposition: 0.015,
  evaporation: 0.03,
  minSlope: 0.1,
  velocityAdvection: 0.2,
  thermalRate: 0.5,
  talusAngle: 60,
  smoothThreshold: 0.1,
  globalRain: false,
  rainRate: 0.03,
  drainEdges: true,
  brushRadius: 0.04,
  brushStrength: 4.0,
};

const WORKGROUP = 8;

/**
 * GPU hydraulic + thermal erosion following Mei et al. 2007
 * ("Fast Hydraulic Erosion Simulation and Visualization on GPU").
 *
 * Per step: rain -> outflow flux -> water depth & velocity -> erosion/deposition
 * -> MacCormack sediment advection -> spike smoothing -> thermal erosion
 * -> evaporation.
 *
 * The simulation runs on its own grid and writes "layer base + erosion delta"
 * into the LayerCompute display texture, so it works with any texture resolution
 * and survives layer edits (the carved delta is re-applied to the new base).
 */
export class ErosionSimulation {
  private device: GPUDevice;
  private layerCompute: LayerCompute;
  private resolution: number;
  private heightScale: number;
  private stateHeightUnits: number;
  private parameters: ErosionParameters = { ...DEFAULT_EROSION_PARAMETERS };
  private running = false;
  private parity = 0;
  private time = 0;
  private brush: { u: number; v: number } | null = null;

  // Simulation state (index 0 holds the state between steps, index 1 is scratch)
  private terrain!: GPUTexture[]; // rg32float: height, water (index 2 is extra scratch)
  private flux!: GPUTexture[]; // rgba32float: left, right, down, up
  private velocity!: GPUTexture[]; // rg32float
  private sediment!: GPUTexture[]; // r32float
  private simBase!: GPUTexture[]; // r32float: base height the delta is relative to
  private flowHistory!: GPUTexture[]; // r32float: peak discharge per cell (flow paths map)
  private advectA!: GPUTexture;
  private advectB!: GPUTexture;
  private thermalFlux!: GPUTexture;

  private simParamsBuffer: GPUBuffer;
  private transferParamsBuffer: GPUBuffer;

  private rainPipeline: GPUComputePipeline;
  private flowPipeline: GPUComputePipeline;
  private waterPipeline: GPUComputePipeline;
  private erosionPipeline: GPUComputePipeline;
  private advectForwardPipeline: GPUComputePipeline;
  private advectBackwardPipeline: GPUComputePipeline;
  private macCormackPipeline: GPUComputePipeline;
  private smoothPipeline: GPUComputePipeline;
  private thermalFluxPipeline: GPUComputePipeline;
  private thermalApplyPipeline: GPUComputePipeline;
  private rebasePipeline: GPUComputePipeline;
  private exportPipeline: GPUComputePipeline;

  private rainBindGroup!: GPUBindGroup;
  private smoothBindGroup!: GPUBindGroup;
  private thermalFluxBindGroup!: GPUBindGroup;
  private thermalApplyBindGroup!: GPUBindGroup;
  private flowBindGroups!: GPUBindGroup[];
  private waterBindGroups!: GPUBindGroup[];
  private erosionBindGroups!: GPUBindGroup[];
  private advectForwardBindGroups!: GPUBindGroup[];
  private advectBackwardBindGroups!: GPUBindGroup[];
  private macCormackBindGroups!: GPUBindGroup[];
  private rebaseBindGroup!: GPUBindGroup;
  private exportBindGroups!: GPUBindGroup[];

  constructor(
    gpuContext: GPUContext,
    layerCompute: LayerCompute,
    resolution = 1024,
    heightScale = 0.1
  ) {
    this.device = gpuContext.device;
    this.layerCompute = layerCompute;
    this.resolution = resolution;
    this.heightScale = heightScale;
    this.stateHeightUnits = this.heightUnits();

    this.simParamsBuffer = this.device.createBuffer({
      label: "erosion-sim-params",
      size: 24 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.transferParamsBuffer = this.device.createBuffer({
      label: "erosion-transfer-params",
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.rainPipeline = this.createPipeline("rain", rainShader);
    this.flowPipeline = this.createPipeline("flow", flowShader);
    this.waterPipeline = this.createPipeline("water", waterShader);
    this.erosionPipeline = this.createPipeline("erosion", erosionShader);
    this.advectForwardPipeline = this.createPipeline("advect-forward", advectShader, { ADVECT_SIGN: 1 });
    this.advectBackwardPipeline = this.createPipeline("advect-backward", advectShader, { ADVECT_SIGN: -1 });
    this.macCormackPipeline = this.createPipeline("maccormack", macCormackShader);
    this.smoothPipeline = this.createPipeline("smooth", smoothShader);
    this.thermalFluxPipeline = this.createPipeline("thermal-flux", thermalFluxShader);
    this.thermalApplyPipeline = this.createPipeline("thermal-apply", thermalApplyShader);
    this.rebasePipeline = this.createPipeline("rebase", rebaseShader);
    this.exportPipeline = this.createPipeline("export", exportShader);

    this.createTextures();
    this.createSimulationBindGroups();
    this.createTransferBindGroups();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public start(): void {
    this.running = true;
  }

  public stop(): void {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getResolution(): number {
    return this.resolution;
  }

  public getParameters(): Readonly<ErosionParameters> {
    return this.parameters;
  }

  public setParameters(parameters: Partial<ErosionParameters>): void {
    const target = this.parameters as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_EROSION_PARAMETERS)) {
      const value = (parameters as Record<string, unknown>)[key];
      if (value !== undefined) target[key] = value;
    }
  }

  /** Rain brush position in terrain UV space, or null when not painting. */
  public setBrush(uv: { u: number; v: number } | null): void {
    this.brush = uv;
  }

  /** Advance the simulation (if running) and update the displayed terrain. */
  public step(): void {
    if (!this.running) return;

    const steps = Math.max(1, Math.round(this.parameters.stepsPerFrame));
    this.time += steps * this.parameters.timeStep;
    this.writeSimParams();

    const encoder = this.device.createCommandEncoder({ label: "erosion-step" });
    const pass = encoder.beginComputePass({ label: "erosion-step" });
    const groups = Math.ceil(this.resolution / WORKGROUP);

    for (let i = 0; i < steps; i++) {
      const p = this.parity;
      this.dispatch(pass, this.rainPipeline, this.rainBindGroup, groups);
      this.dispatch(pass, this.flowPipeline, this.flowBindGroups[p], groups);
      this.dispatch(pass, this.waterPipeline, this.waterBindGroups[p], groups);
      this.dispatch(pass, this.erosionPipeline, this.erosionBindGroups[p], groups);
      this.dispatch(pass, this.advectForwardPipeline, this.advectForwardBindGroups[p], groups);
      this.dispatch(pass, this.advectBackwardPipeline, this.advectBackwardBindGroups[p], groups);
      this.dispatch(pass, this.macCormackPipeline, this.macCormackBindGroups[p], groups);
      this.dispatch(pass, this.smoothPipeline, this.smoothBindGroup, groups);
      this.dispatch(pass, this.thermalFluxPipeline, this.thermalFluxBindGroup, groups);
      this.dispatch(pass, this.thermalApplyPipeline, this.thermalApplyBindGroup, groups);
      this.parity = 1 - p;
    }

    pass.end();
    this.encodeExport(encoder);
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Call after the layer stack was recomputed. Re-applies the erosion carved so
   * far onto the new base terrain and refreshes the displayed texture.
   */
  public syncWithBase(): void {
    this.rebase(true);
  }

  /** Remove all water, sediment and erosion, returning to the layer terrain. */
  public reset(): void {
    this.stop();
    const encoder = this.device.createCommandEncoder({ label: "erosion-reset" });
    for (const texture of [
      ...this.flux,
      ...this.velocity,
      ...this.sediment,
      ...this.flowHistory,
      this.advectA,
      this.advectB,
      this.thermalFlux,
    ]) {
      encoder
        .beginRenderPass({
          colorAttachments: [
            { view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
          ],
        })
        .end();
    }
    this.device.queue.submit([encoder.finish()]);
    this.rebase(false);
  }

  /** Switch to a new LayerCompute (e.g. after a texture resolution change). */
  public setLayerCompute(layerCompute: LayerCompute): void {
    this.layerCompute = layerCompute;
    this.createTransferBindGroups();
  }

  /** The displayed height scale changed; keep erosion depth proportional. */
  public setHeightScale(heightScale: number): void {
    if (heightScale === this.heightScale) return;
    this.heightScale = heightScale;
    this.rebase(true);
  }

  /** Change the simulation grid size. This discards erosion done so far. */
  public setResolution(resolution: number): void {
    if (resolution === this.resolution) return;
    this.destroyTextures();
    this.resolution = resolution;
    this.parity = 0;
    this.createTextures();
    this.createSimulationBindGroups();
    this.createTransferBindGroups();
    this.rebase(false);
  }

  public destroy(): void {
    this.destroyTextures();
    this.simParamsBuffer.destroy();
    this.transferParamsBuffer.destroy();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Cell units per texture height unit: keeps simulated slopes equal to rendered ones. */
  private heightUnits(): number {
    const cellSize = TERRAIN_WORLD_SIZE / this.resolution;
    return (this.heightScale * TERRAIN_DISPLACEMENT_SCALE) / cellSize;
  }

  private createPipeline(
    label: string,
    code: string,
    constants?: Record<string, number>
  ): GPUComputePipeline {
    return this.device.createComputePipeline({
      label: `erosion-${label}`,
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({
          label: `erosion-${label}`,
          code: `${commonShader}\n${code}`,
        }),
        entryPoint: "main",
        constants,
      },
    });
  }

  private createTexture(label: string, format: GPUTextureFormat): GPUTexture {
    return this.device.createTexture({
      label: `erosion-${label}`,
      size: [this.resolution, this.resolution],
      format,
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createTextures(): void {
    const pair = (label: string, format: GPUTextureFormat) => [
      this.createTexture(`${label}-0`, format),
      this.createTexture(`${label}-1`, format),
    ];
    this.terrain = [...pair("terrain", "rg32float"), this.createTexture("terrain-2", "rg32float")];
    this.flux = pair("flux", "rgba32float");
    this.velocity = pair("velocity", "rg32float");
    this.sediment = pair("sediment", "r32float");
    this.simBase = pair("base", "r32float");
    this.flowHistory = pair("flow-history", "r32float");
    this.advectA = this.createTexture("advect-a", "r32float");
    this.advectB = this.createTexture("advect-b", "r32float");
    this.thermalFlux = this.createTexture("thermal-flux", "rgba32float");
  }

  private destroyTextures(): void {
    for (const texture of [
      ...this.terrain,
      ...this.flux,
      ...this.velocity,
      ...this.sediment,
      ...this.simBase,
      ...this.flowHistory,
      this.advectA,
      this.advectB,
      this.thermalFlux,
    ]) {
      texture.destroy();
    }
  }

  private bindGroup(
    pipeline: GPUComputePipeline,
    label: string,
    resources: (GPUTexture | GPUBuffer)[]
  ): GPUBindGroup {
    return this.device.createBindGroup({
      label: `erosion-${label}`,
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({
        binding,
        resource:
          resource instanceof GPUBuffer
            ? { buffer: resource }
            : resource.createView(),
      })),
    });
  }

  /**
   * Texture flow for one step (p = parity, q = 1 - p):
   *   rain       terrain0                    -> terrain1
   *   flow       terrain1, flux[p]           -> flux[q]
   *   water      terrain1, flux[q], vel[p], flow[p] -> terrain0, vel[q], flow[q]
   *   erosion    terrain0, vel[q], sed0      -> terrain1, sed1
   *   advect     vel[q], sed1 -> A, A -> B; maccormack -> sed0
   *   smooth     terrain1                    -> terrain2
   *   thermal    terrain2 -> thermalFlux; terrain2 + thermalFlux -> terrain0
   */
  private createSimulationBindGroups(): void {
    const P = this.simParamsBuffer;
    const [t0, t1, t2] = this.terrain;
    const [s0, s1] = this.sediment;

    this.rainBindGroup = this.bindGroup(this.rainPipeline, "rain", [P, t0, t1]);
    this.smoothBindGroup = this.bindGroup(this.smoothPipeline, "smooth", [P, t1, t2]);
    this.thermalFluxBindGroup = this.bindGroup(this.thermalFluxPipeline, "thermal-flux", [P, t2, this.thermalFlux]);
    this.thermalApplyBindGroup = this.bindGroup(this.thermalApplyPipeline, "thermal-apply", [P, t2, this.thermalFlux, t0]);

    this.flowBindGroups = [];
    this.waterBindGroups = [];
    this.erosionBindGroups = [];
    this.advectForwardBindGroups = [];
    this.advectBackwardBindGroups = [];
    this.macCormackBindGroups = [];

    for (const p of [0, 1]) {
      const q = 1 - p;
      const velOut = this.velocity[q];
      this.flowBindGroups.push(this.bindGroup(this.flowPipeline, `flow-${p}`, [P, t1, this.flux[p], this.flux[q]]));
      this.waterBindGroups.push(
        this.bindGroup(this.waterPipeline, `water-${p}`, [
          P,
          t1,
          this.flux[q],
          this.velocity[p],
          t0,
          velOut,
          this.flowHistory[p],
          this.flowHistory[q],
        ])
      );
      this.erosionBindGroups.push(this.bindGroup(this.erosionPipeline, `erosion-${p}`, [P, t0, velOut, s0, t1, s1]));
      this.advectForwardBindGroups.push(
        this.bindGroup(this.advectForwardPipeline, `advect-forward-${p}`, [P, velOut, s1, this.advectA])
      );
      this.advectBackwardBindGroups.push(
        this.bindGroup(this.advectBackwardPipeline, `advect-backward-${p}`, [P, velOut, this.advectA, this.advectB])
      );
      this.macCormackBindGroups.push(
        this.bindGroup(this.macCormackPipeline, `maccormack-${p}`, [P, velOut, s1, this.advectA, this.advectB, s0])
      );
    }
  }

  private createTransferBindGroups(): void {
    const T = this.transferParamsBuffer;
    const base = this.layerCompute.getBaseTexture();
    this.rebaseBindGroup = this.bindGroup(this.rebasePipeline, "rebase", [
      T,
      base,
      this.terrain[0],
      this.simBase[0],
      this.terrain[1],
      this.simBase[1],
    ]);
    // The latest flow history is flowHistory[parity] (written by the last step).
    this.exportBindGroups = [0, 1].map((p) =>
      this.bindGroup(this.exportPipeline, `export-${p}`, [
        T,
        base,
        this.terrain[0],
        this.simBase[0],
        this.flowHistory[p],
        this.layerCompute.getOutputTexture(),
      ])
    );
  }

  private dispatch(
    pass: GPUComputePassEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    groups: number
  ): void {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(groups, groups);
  }

  private writeSimParams(): void {
    const p = this.parameters;
    // Heights are in cell units, so the stable neighbour difference is tan(angle).
    const talusHeight = Math.tan((p.talusAngle * Math.PI) / 180);
    this.device.queue.writeBuffer(
      this.simParamsBuffer,
      0,
      new Float32Array([
        p.timeStep,
        p.pipeLength,
        p.pipeArea,
        p.gravity,
        p.sedimentCapacity,
        p.dissolution,
        p.deposition,
        p.evaporation,
        p.minSlope,
        p.velocityAdvection,
        p.thermalRate,
        talusHeight,
        p.globalRain ? p.rainRate : 0,
        p.drainEdges ? 1 : 0,
        this.brush?.u ?? 0,
        this.brush?.v ?? 0,
        p.brushRadius,
        p.brushStrength,
        this.brush ? 1 : 0,
        this.time,
        p.smoothThreshold,
        0,
        0,
        0,
      ])
    );
  }

  private writeTransferParams(keepState: boolean): void {
    this.device.queue.writeBuffer(
      this.transferParamsBuffer,
      0,
      new Float32Array([this.heightUnits(), this.stateHeightUnits, keepState ? 1 : 0, 0])
    );
  }

  private rebase(keepState: boolean): void {
    this.writeTransferParams(keepState);
    const encoder = this.device.createCommandEncoder({ label: "erosion-rebase" });
    const pass = encoder.beginComputePass({ label: "erosion-rebase" });
    this.dispatch(pass, this.rebasePipeline, this.rebaseBindGroup, Math.ceil(this.resolution / WORKGROUP));
    pass.end();
    const size = [this.resolution, this.resolution];
    encoder.copyTextureToTexture({ texture: this.terrain[1] }, { texture: this.terrain[0] }, size);
    encoder.copyTextureToTexture({ texture: this.simBase[1] }, { texture: this.simBase[0] }, size);
    this.stateHeightUnits = this.heightUnits();
    this.encodeExport(encoder);
    this.device.queue.submit([encoder.finish()]);
  }

  private encodeExport(encoder: GPUCommandEncoder): void {
    const size = this.layerCompute.getTextureSize();
    const pass = encoder.beginComputePass({ label: "erosion-export" });
    this.dispatch(pass, this.exportPipeline, this.exportBindGroups[this.parity], Math.ceil(size / WORKGROUP));
    pass.end();
  }
}
