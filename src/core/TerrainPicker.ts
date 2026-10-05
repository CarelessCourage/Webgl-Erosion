import { mat4, vec3, vec4 } from "gl-matrix";
import { GPUContext } from "./GPUContext";
import { LayerCompute } from "./LayerCompute";
import { OrbitCamera } from "./Camera";
import commonShader from "../shaders/erosion/common.wgsl?raw";
import pickerShader from "../shaders/erosion/picker.wgsl?raw";
import {
  TERRAIN_DISPLACEMENT_SCALE,
  TERRAIN_WORLD_SIZE,
} from "../simulation/ErosionSimulation";

const PICK_SIZE = 256;

/**
 * Finds the terrain point under the mouse by ray marching a small CPU copy of
 * the displayed height texture (refreshed asynchronously from the GPU).
 */
export class TerrainPicker {
  private device: GPUDevice;
  private layerCompute: LayerCompute;
  private pipeline: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;
  private storageBuffer: GPUBuffer;
  private readBuffer: GPUBuffer;
  private heights: Float32Array | null = null;
  private minHeight = 0;
  private maxHeight = 0;
  private pending = false;

  constructor(gpuContext: GPUContext, layerCompute: LayerCompute) {
    this.device = gpuContext.device;
    this.layerCompute = layerCompute;
    const size = PICK_SIZE * PICK_SIZE * 4;
    this.storageBuffer = this.device.createBuffer({
      label: "terrain-picker-storage",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = this.device.createBuffer({
      label: "terrain-picker-read",
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.pipeline = this.device.createComputePipeline({
      label: "terrain-picker",
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({
          label: "terrain-picker",
          code: `${commonShader}\n${pickerShader}`,
        }),
        entryPoint: "main",
        constants: { PICK_SIZE },
      },
    });
    this.createBindGroup();
  }

  public setLayerCompute(layerCompute: LayerCompute): void {
    this.layerCompute = layerCompute;
    this.createBindGroup();
  }

  /** Schedule a read-back of the current terrain heights (skipped if one is in flight). */
  public refresh(): void {
    if (this.pending) return;
    this.pending = true;

    const encoder = this.device.createCommandEncoder({ label: "terrain-picker" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(PICK_SIZE / 8, PICK_SIZE / 8);
    pass.end();
    encoder.copyBufferToBuffer(this.storageBuffer, 0, this.readBuffer, 0, this.readBuffer.size);
    this.device.queue.submit([encoder.finish()]);

    this.readBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const heights = new Float32Array(this.readBuffer.getMappedRange().slice(0));
        this.readBuffer.unmap();
        let min = Infinity;
        let max = 0;
        for (const h of heights) {
          min = Math.min(min, h);
          max = Math.max(max, h);
        }
        this.heights = heights;
        this.minHeight = min;
        this.maxHeight = max;
      })
      .catch((error) => console.warn("Terrain picker read-back failed:", error))
      .finally(() => {
        this.pending = false;
      });
  }

  /**
   * Returns the terrain UV under the given canvas position (normalized device
   * coordinates, y up) or null when the ray misses the terrain.
   */
  public pick(
    camera: OrbitCamera,
    ndcX: number,
    ndcY: number,
    heightScale: number
  ): { u: number; v: number } | null {
    const viewProj = mat4.multiply(mat4.create(), camera.projectionMatrix, camera.viewMatrix);
    const inverse = mat4.invert(mat4.create(), viewProj);
    if (!inverse) return null;

    const point = vec4.transformMat4(vec4.create(), [ndcX, ndcY, 0.5, 1], inverse);
    const target = vec3.fromValues(point[0] / point[3], point[1] / point[3], point[2] / point[3]);
    const origin = vec3.clone(camera.position);
    const dir = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), target, origin));

    const worldScale = heightScale * TERRAIN_DISPLACEMENT_SCALE;
    const half = TERRAIN_WORLD_SIZE / 2;
    const top = this.maxHeight * worldScale + 0.01;

    // Clip the ray against the terrain's bounding box.
    let tMin = 0;
    let tMax = Infinity;
    const lo = [-half, -0.01, -half];
    const hi = [half, top, half];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(dir[axis]) < 1e-8) {
        if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return null;
        continue;
      }
      let t0 = (lo[axis] - origin[axis]) / dir[axis];
      let t1 = (hi[axis] - origin[axis]) / dir[axis];
      if (t0 > t1) [t0, t1] = [t1, t0];
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
      if (tMin > tMax) return null;
    }

    const above = (t: number) => {
      const x = origin[0] + dir[0] * t;
      const y = origin[1] + dir[1] * t;
      const z = origin[2] + dir[2] * t;
      return y - this.sampleHeight((x + half) / TERRAIN_WORLD_SIZE, (z + half) / TERRAIN_WORLD_SIZE) * worldScale;
    };

    const stepSize = TERRAIN_WORLD_SIZE / 1000;
    let prev = tMin;
    let hit: number | null = null;
    for (let t = tMin; t <= tMax; t += stepSize) {
      if (above(t) <= 0) {
        hit = t;
        break;
      }
      prev = t;
    }
    if (hit === null) {
      // Ray reached the ground plane level without hitting raised terrain.
      if (above(tMax) > 0) return null;
      hit = tMax;
    }

    let a = prev;
    let b = hit;
    for (let i = 0; i < 12; i++) {
      const mid = 0.5 * (a + b);
      if (above(mid) > 0) a = mid;
      else b = mid;
    }

    const x = origin[0] + dir[0] * b;
    const z = origin[2] + dir[2] * b;
    return {
      u: Math.min(1, Math.max(0, (x + half) / TERRAIN_WORLD_SIZE)),
      v: Math.min(1, Math.max(0, (z + half) / TERRAIN_WORLD_SIZE)),
    };
  }

  /** Displayed terrain height range (texture units), once a read-back has completed. */
  public getHeightRange(): { min: number; max: number } | null {
    return this.heights ? { min: this.minHeight, max: this.maxHeight } : null;
  }

  public destroy(): void {
    this.storageBuffer.destroy();
    this.readBuffer.destroy();
  }

  private createBindGroup(): void {
    this.bindGroup = this.device.createBindGroup({
      label: "terrain-picker",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.layerCompute.getOutputTexture().createView() },
        { binding: 1, resource: { buffer: this.storageBuffer } },
      ],
    });
  }

  private sampleHeight(u: number, v: number): number {
    if (!this.heights) return 0;
    const px = Math.min(PICK_SIZE - 1, Math.max(0, u * PICK_SIZE - 0.5));
    const py = Math.min(PICK_SIZE - 1, Math.max(0, v * PICK_SIZE - 0.5));
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(PICK_SIZE - 1, x0 + 1);
    const y1 = Math.min(PICK_SIZE - 1, y0 + 1);
    const fx = px - x0;
    const fy = py - y0;
    const h = this.heights;
    const top = h[y0 * PICK_SIZE + x0] * (1 - fx) + h[y0 * PICK_SIZE + x1] * fx;
    const bottom = h[y1 * PICK_SIZE + x0] * (1 - fx) + h[y1 * PICK_SIZE + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  }
}
