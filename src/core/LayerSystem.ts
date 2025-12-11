/**
 * Layer system for procedural terrain generation
 * Combines multiple alpha layers into a single displacement map
 */

export type LayerType = "noise" | "circle" | "image";
export type BlendMode = "add" | "mask" | "multiply" | "subtract";

export interface BaseLayer {
  id: string;
  type: LayerType;
  name: string;
  enabled: boolean;
  strength: number; // 0-1
  blendMode: BlendMode;
}

export interface NoiseLayer extends BaseLayer {
  type: "noise";
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  amplitude: number;
  seed: number;
}

export interface CircleLayer extends BaseLayer {
  type: "circle";
  centerX: number; // -5 to 5 (world coords)
  centerY: number; // -5 to 5 (world coords)
  radius: number;
  falloff: number; // 0-1, edge softness
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  imageData: ImageData | null;
  texture: GPUTexture | null;
  offsetX: number;
  offsetY: number;
  imageIndex: number; // Index in texture array
}

export type AlphaLayer = NoiseLayer | CircleLayer | ImageLayer;

// ============================================================================
// DEFAULT LAYER SETTINGS - Edit these to change initial terrain appearance
// ============================================================================
const DEFAULT_BASE_LAYER = {
  name: "Base Terrain",
  enabled: true,
  strength: 4.6,     // Layer opacity/influence (0-2)
  blendMode: "add" as BlendMode,
  scale: 4.6,        // Noise scale (higher = more detail)
  octaves: 7,        // Number of noise layers
  persistence: 0.45, // How much each octave contributes
  lacunarity: 2.0,   // Frequency multiplier between octaves
  amplitude: 1.9,    // Overall height multiplier
  seed: 14426,       // Random seed for reproducibility
};
// ============================================================================

export class LayerStack {
  private layers: AlphaLayer[] = [];
  private nextId = 0;
  private readonly maxLayers = 5;
  private onChangeCallback?: () => void;

  constructor() {
    // Initialize with default base layer
    this.addNoiseLayer(DEFAULT_BASE_LAYER);
    console.log("LayerStack initialized with", this.getLayerCount(), "layers");
    console.log("Base layer values:", this.layers[0]);
  }

  addNoiseLayer(params: Partial<NoiseLayer> = {}): NoiseLayer | null {
    if (this.layers.length >= this.maxLayers) {
      console.warn(`Maximum layer limit (${this.maxLayers}) reached`);
      return null;
    }

    const layer: NoiseLayer = {
      id: `layer_${this.nextId++}`,
      type: "noise",
      name: params.name || `Noise ${this.layers.length + 1}`,
      enabled: params.enabled ?? true,
      strength: params.strength ?? 1.0,
      blendMode: params.blendMode || "add",
      scale: params.scale ?? 8.0, // Increased from 4.0 for finer detail
      octaves: params.octaves ?? 4,
      persistence: params.persistence ?? 0.5,
      lacunarity: params.lacunarity ?? 2.0,
      amplitude: params.amplitude ?? 1.0, // Increased from 0.5 for more dramatic terrain
      seed: params.seed ?? Math.floor(Math.random() * 99999),
    };
    this.layers.push(layer);
    this.triggerChange();
    return layer;
  }

  addCircleLayer(params: Partial<CircleLayer> = {}): CircleLayer | null {
    if (this.layers.length >= this.maxLayers) {
      console.warn(`Maximum layer limit (${this.maxLayers}) reached`);
      return null;
    }

    const layer: CircleLayer = {
      id: `layer_${this.nextId++}`,
      type: "circle",
      name: params.name || `Circle ${this.layers.length + 1}`,
      enabled: params.enabled ?? true,
      strength: params.strength ?? 1.0,
      blendMode: params.blendMode || "add",
      centerX: params.centerX ?? 0,
      centerY: params.centerY ?? 0,
      radius: params.radius ?? 2.0,
      falloff: params.falloff ?? 0.5,
    };
    this.layers.push(layer);
    this.triggerChange();
    return layer;
  }

  addImageLayer(params: Partial<ImageLayer> = {}): ImageLayer | null {
    if (this.layers.length >= this.maxLayers) {
      console.warn(`Maximum layer limit (${this.maxLayers}) reached`);
      return null;
    }

    const layer: ImageLayer = {
      id: `layer_${this.nextId++}`,
      type: "image",
      name: params.name || `Image ${this.layers.length + 1}`,
      enabled: params.enabled ?? true,
      strength: params.strength ?? 1.0,
      blendMode: params.blendMode || "add",
      imageData: params.imageData || null,
      texture: params.texture || null,
      offsetX: params.offsetX ?? 0,
      offsetY: params.offsetY ?? 0,
      imageIndex: params.imageIndex ?? 0,
    };
    this.layers.push(layer);
    this.triggerChange();
    return layer;
  }

  removeLayer(id: string): boolean {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index >= 0) {
      this.layers.splice(index, 1);
      this.triggerChange();
      return true;
    }
    return false;
  }

  moveLayer(id: string, newIndex: number): boolean {
    const currentIndex = this.layers.findIndex((l) => l.id === id);
    if (currentIndex < 0 || newIndex < 0 || newIndex >= this.layers.length) {
      return false;
    }

    const [layer] = this.layers.splice(currentIndex, 1);
    this.layers.splice(newIndex, 0, layer);
    this.triggerChange();
    return true;
  }

  getLayer(id: string): AlphaLayer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  getAllLayers(): AlphaLayer[] {
    return [...this.layers];
  }

  getLayerCount(): number {
    return this.layers.length;
  }

  getMaxLayers(): number {
    return this.maxLayers;
  }

  canAddLayer(): boolean {
    return this.layers.length < this.maxLayers;
  }

  // Layer movement helpers for UI
  moveLayerUp(id: string): boolean {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index > 0) {
      return this.moveLayer(id, index - 1);
    }
    return false;
  }

  moveLayerDown(id: string): boolean {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index >= 0 && index < this.layers.length - 1) {
      return this.moveLayer(id, index + 1);
    }
    return false;
  }

  // UI callback system
  public onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  private triggerChange(): void {
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  // Layer enablement helpers
  public toggleLayer(id: string): boolean {
    const layer = this.getLayer(id);
    if (layer) {
      layer.enabled = !layer.enabled;
      this.triggerChange();
      return true;
    }
    return false;
  }

  public updateLayer(id: string, updates: Partial<AlphaLayer>): boolean {
    const layer = this.getLayer(id);
    if (layer) {
      Object.assign(layer, updates);
      this.triggerChange();
      return true;
    }
    return false;
  }
}
