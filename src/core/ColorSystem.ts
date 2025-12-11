/**
 * Color System for Terrain Rendering
 * Manages color groups with arbitrary color stops for flexible terrain coloration
 */

export interface ColorStop {
  id: string;
  threshold: number; // 0.0 to 1.0 - where this color appears in the gradient
  color: string; // Hex color like "#ff0000"
  enabled: boolean;
}

export interface ColorGroup {
  id: string;
  name: string;
  enabled: boolean;
  strength: number; // 0.0 to 1.0 - opacity/influence of this group
  sourceLayerId: string | null; // Which alpha layer to use as mask (null = master/combined)
  blendMode: "replace" | "multiply" | "add" | "overlay"; // How to blend with other groups
  colorStops: ColorStop[];
}

export class ColorSystem {
  private colorGroups: Map<string, ColorGroup> = new Map();
  private nextId = 0;
  private changeCallbacks: Array<() => void> = [];

  constructor() {
    // Create default base group with traditional 3-color setup
    this.addColorGroup({
      name: "Base Terrain",
      sourceLayerId: null, // Uses master alpha map
      colorStops: [
        { id: "stop_0", threshold: 0.0, color: "#429a42", enabled: true }, // Low (green valley)
        { id: "stop_1", threshold: 0.5, color: "#565048", enabled: true }, // Mid (brown slope)
        { id: "stop_2", threshold: 0.85, color: "#fafafa", enabled: true }, // High (white peak)
      ],
    });
  }

  /**
   * Add a new color group
   */
  public addColorGroup(
    params: Partial<ColorGroup> & { name: string }
  ): ColorGroup {
    const id = `group_${this.nextId++}`;
    const group: ColorGroup = {
      id,
      name: params.name,
      enabled: params.enabled ?? true,
      strength: params.strength ?? 1.0,
      sourceLayerId: params.sourceLayerId ?? null,
      blendMode: params.blendMode ?? "replace",
      colorStops: params.colorStops?.map((stop, i) => ({
        id: `${id}_stop_${i}`,
        threshold: stop.threshold,
        color: stop.color,
        enabled: stop.enabled ?? true,
      })) ?? [],
    };

    this.colorGroups.set(id, group);
    this.notifyChange();
    return group;
  }

  /**
   * Remove a color group
   */
  public removeColorGroup(groupId: string): boolean {
    // Don't allow removing the last group
    if (this.colorGroups.size <= 1) {
      console.warn("Cannot remove the last color group");
      return false;
    }

    const result = this.colorGroups.delete(groupId);
    if (result) {
      this.notifyChange();
    }
    return result;
  }

  /**
   * Update a color group
   */
  public updateColorGroup(
    groupId: string,
    updates: Partial<Omit<ColorGroup, "id" | "colorStops">>
  ): void {
    const group = this.colorGroups.get(groupId);
    if (!group) return;

    Object.assign(group, updates);
    this.notifyChange();
  }

  /**
   * Add a color stop to a group
   */
  public addColorStop(
    groupId: string,
    params: { threshold: number; color: string }
  ): ColorStop | null {
    const group = this.colorGroups.get(groupId);
    if (!group) return null;

    const stop: ColorStop = {
      id: `${groupId}_stop_${group.colorStops.length}`,
      threshold: params.threshold,
      color: params.color,
      enabled: true,
    };

    group.colorStops.push(stop);
    // Sort by threshold
    group.colorStops.sort((a, b) => a.threshold - b.threshold);
    this.notifyChange();
    return stop;
  }

  /**
   * Remove a color stop from a group
   */
  public removeColorStop(groupId: string, stopId: string): boolean {
    const group = this.colorGroups.get(groupId);
    if (!group) return false;

    // Don't allow removing if only 1 stop remains
    if (group.colorStops.length <= 1) {
      console.warn("Cannot remove the last color stop from a group");
      return false;
    }

    const index = group.colorStops.findIndex((s) => s.id === stopId);
    if (index === -1) return false;

    group.colorStops.splice(index, 1);
    this.notifyChange();
    return true;
  }

  /**
   * Update a color stop
   */
  public updateColorStop(
    groupId: string,
    stopId: string,
    updates: Partial<Omit<ColorStop, "id">>
  ): void {
    const group = this.colorGroups.get(groupId);
    if (!group) return;

    const stop = group.colorStops.find((s) => s.id === stopId);
    if (!stop) return;

    Object.assign(stop, updates);

    // Re-sort if threshold changed
    if (updates.threshold !== undefined) {
      group.colorStops.sort((a, b) => a.threshold - b.threshold);
    }

    this.notifyChange();
  }

  /**
   * Get all color groups
   */
  public getAllGroups(): ColorGroup[] {
    return Array.from(this.colorGroups.values());
  }

  /**
   * Get a specific color group
   */
  public getGroup(groupId: string): ColorGroup | undefined {
    return this.colorGroups.get(groupId);
  }

  /**
   * Register a callback for when colors change
   */
  public onChange(callback: () => void): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Notify all listeners that colors changed
   */
  private notifyChange(): void {
    this.changeCallbacks.forEach((cb) => cb());
  }

  /**
   * Convert hex color to RGB array [0-1 range]
   */
  public static hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [0, 0, 0];
    return [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255,
    ];
  }

  /**
   * Serialize color groups for GPU (flat array format)
   * Format per group: enabled(f32), strength(f32), blendMode(f32), stopCount(f32),
   *                   sourceLayerIndex(f32), padding(f32 x 3)
   * Then per stop: threshold(f32), r(f32), g(f32), b(f32)
   */
  public serializeForGPU(layerIdToIndex: Map<string, number>): Float32Array {
    const groups = this.getAllGroups().filter((g) => g.enabled);
    
    // Calculate buffer size
    // Per group: 8 floats (header) + (4 floats per stop * max 16 stops)
    const maxStopsPerGroup = 16;
    const floatsPerGroup = 8 + maxStopsPerGroup * 4;
    const maxGroups = 8;
    const totalFloats = maxGroups * floatsPerGroup;
    
    const data = new Float32Array(totalFloats);
    let offset = 0;

    for (let i = 0; i < maxGroups; i++) {
      if (i < groups.length) {
        const group = groups[i];
        const enabledStops = group.colorStops.filter((s) => s.enabled);
        const stopCount = Math.min(enabledStops.length, maxStopsPerGroup);

        // Group header
        data[offset++] = group.enabled ? 1.0 : 0.0;
        data[offset++] = group.strength;
        data[offset++] = this.blendModeToFloat(group.blendMode);
        data[offset++] = stopCount;
        
        // Source layer index (-1 = master/combined alpha)
        const sourceIndex = group.sourceLayerId 
          ? (layerIdToIndex.get(group.sourceLayerId) ?? -1)
          : -1;
        data[offset++] = sourceIndex;
        
        // Padding (align to 8 floats)
        data[offset++] = 0.0;
        data[offset++] = 0.0;
        data[offset++] = 0.0;

        // Color stops
        for (let j = 0; j < maxStopsPerGroup; j++) {
          if (j < stopCount) {
            const stop = enabledStops[j];
            const rgb = ColorSystem.hexToRgb(stop.color);
            data[offset++] = stop.threshold;
            data[offset++] = rgb[0];
            data[offset++] = rgb[1];
            data[offset++] = rgb[2];
          } else {
            // Padding for unused stops
            offset += 4;
          }
        }
      } else {
        // Empty group (disabled)
        offset += floatsPerGroup;
      }
    }

    return data;
  }

  private blendModeToFloat(mode: ColorGroup["blendMode"]): number {
    switch (mode) {
      case "replace": return 0.0;
      case "multiply": return 1.0;
      case "add": return 2.0;
      case "overlay": return 3.0;
      default: return 0.0;
    }
  }
}
