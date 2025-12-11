/**
 * DOF System - Camera distance-based depth of field settings
 * Similar to color stops, but for DOF parameters based on camera distance
 */

export interface DOFStop {
  id: string;
  cameraDistance: number; // Camera distance threshold (e.g., 12.0, 18.0, 25.0)
  focalOffset: number;    // Focal offset at this distance
  focalRange: number;     // Focus range at this distance
  blurStrength: number;   // Far blur strength at this distance
  nearBlurStrength: number; // Near blur strength at this distance
  enabled: boolean;
}

export class DOFSystem {
  private stops: DOFStop[] = [];
  private nextId = 0;
  private changeCallback?: () => void;

  constructor() {
    // Create default stops for close and far camera distances
    this.addStop({
      cameraDistance: 14.0,
      focalOffset: -6.9,
      focalRange: 1.0,
      blurStrength: 3.0,
      nearBlurStrength: 2.0,
    });
    
    this.addStop({
      cameraDistance: 20.0,
      focalOffset: -9.9,
      focalRange: 2.1,
      blurStrength: 0.3,
      nearBlurStrength: 0.0,
    });
  }

  /**
   * Add a new DOF stop
   */
  public addStop(params: Partial<DOFStop>): DOFStop {
    const id = `dof_stop_${this.nextId++}`;
    const stop: DOFStop = {
      id,
      cameraDistance: params.cameraDistance ?? 15.0,
      focalOffset: params.focalOffset ?? 0.0,
      focalRange: params.focalRange ?? 2.0,
      blurStrength: params.blurStrength ?? 2.0,
      nearBlurStrength: params.nearBlurStrength ?? 2.0,
      enabled: params.enabled ?? true,
    };

    this.stops.push(stop);
    this.sortStops();
    this.triggerChange();
    return stop;
  }

  /**
   * Remove a DOF stop
   */
  public removeStop(id: string): boolean {
    const index = this.stops.findIndex((s) => s.id === id);
    if (index >= 0) {
      this.stops.splice(index, 1);
      this.triggerChange();
      return true;
    }
    return false;
  }

  /**
   * Update a DOF stop
   */
  public updateStop(id: string, updates: Partial<DOFStop>): boolean {
    const stop = this.stops.find((s) => s.id === id);
    if (stop) {
      Object.assign(stop, updates);
      // Only sort and trigger change if camera distance changed (affects ordering/folder names)
      if (updates.cameraDistance !== undefined) {
        this.sortStops();
        this.triggerChange();
      }
      return true;
    }
    return false;
  }

  /**
   * Get all stops
   */
  public getAllStops(): DOFStop[] {
    return [...this.stops];
  }

  /**
   * Get a specific stop
   */
  public getStop(id: string): DOFStop | undefined {
    return this.stops.find((s) => s.id === id);
  }

  /**
   * Sort stops by camera distance (ascending)
   */
  private sortStops(): void {
    this.stops.sort((a, b) => a.cameraDistance - b.cameraDistance);
  }

  /**
   * Interpolate DOF settings for a given camera distance
   */
  public interpolateSettings(cameraDistance: number): {
    focalOffset: number;
    focalRange: number;
    blurStrength: number;
    nearBlurStrength: number;
  } {
    const enabledStops = this.stops.filter((s) => s.enabled);
    
    if (enabledStops.length === 0) {
      // No stops - return defaults with no blur
      return {
        focalOffset: 0.0,
        focalRange: 100.0,   // Very large range = everything in focus
        blurStrength: 0.0,   // No blur
        nearBlurStrength: 0.0, // No blur
      };
    }

    if (enabledStops.length === 1) {
      // Only one stop - use its values
      const stop = enabledStops[0];
      return {
        focalOffset: stop.focalOffset,
        focalRange: stop.focalRange,
        blurStrength: stop.blurStrength,
        nearBlurStrength: stop.nearBlurStrength,
      };
    }

    // Find the two stops to interpolate between
    let lowerStop: DOFStop | null = null;
    let upperStop: DOFStop | null = null;

    for (let i = 0; i < enabledStops.length; i++) {
      if (enabledStops[i].cameraDistance <= cameraDistance) {
        lowerStop = enabledStops[i];
      }
      if (enabledStops[i].cameraDistance >= cameraDistance && !upperStop) {
        upperStop = enabledStops[i];
        break;
      }
    }

    // If camera distance is below all stops, use the first stop
    if (!lowerStop && upperStop) {
      return {
        focalOffset: upperStop.focalOffset,
        focalRange: upperStop.focalRange,
        blurStrength: upperStop.blurStrength,
        nearBlurStrength: upperStop.nearBlurStrength,
      };
    }

    // If camera distance is above all stops, use the last stop
    if (lowerStop && !upperStop) {
      return {
        focalOffset: lowerStop.focalOffset,
        focalRange: lowerStop.focalRange,
        blurStrength: lowerStop.blurStrength,
        nearBlurStrength: lowerStop.nearBlurStrength,
      };
    }

    // Interpolate between lower and upper stops
    if (lowerStop && upperStop) {
      const range = upperStop.cameraDistance - lowerStop.cameraDistance;
      const t = (cameraDistance - lowerStop.cameraDistance) / range;

      return {
        focalOffset: this.lerp(lowerStop.focalOffset, upperStop.focalOffset, t),
        focalRange: this.lerp(lowerStop.focalRange, upperStop.focalRange, t),
        blurStrength: this.lerp(lowerStop.blurStrength, upperStop.blurStrength, t),
        nearBlurStrength: this.lerp(lowerStop.nearBlurStrength, upperStop.nearBlurStrength, t),
      };
    }

    // Fallback (shouldn't reach here)
    return {
      focalOffset: 0.0,
      focalRange: 2.0,
      blurStrength: 2.0,
      nearBlurStrength: 2.0,
    };
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Register change callback
   */
  public onChange(callback: () => void): void {
    this.changeCallback = callback;
  }

  /**
   * Trigger change event
   */
  private triggerChange(): void {
    if (this.changeCallback) {
      this.changeCallback();
    }
  }
}
