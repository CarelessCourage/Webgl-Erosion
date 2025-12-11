import { GUI } from "lil-gui";
import { OrbitCamera } from "./Camera";
import { LayerStack, AlphaLayer } from "./LayerSystem";
import { ColorSystem, ColorGroup } from "./ColorSystem";
import { ErosionSimulationMultiPass as ErosionSimulation } from "../simulation/ErosionSimulation.multipass.js";

/**
 * Application settings with lil-gui control panel
 */
export class Settings {
  // Layer system for terrain generation
  public layerStack: LayerStack;
  
  // Color system for terrain coloration
  public colorSystem: ColorSystem;

  // Rendering settings
  public rendering = {
    wireframe: false,
    showNormals: false,
  };

  // Visualization settings
  public visualization = {
    mode: "terrain", // 'terrain' or 'heightmap'
    disableDisplacement: false,
    textureResolution: 2048, // Height texture resolution (512, 1024, 2048, 4096)
    meshResolution: 18, // Mesh detail level (4-25)
  };

  // Camera settings
  public camera = {
    damping: 0.2,
    rotateSpeed: 2.0,
    panSpeed: 2.0,
    zoomSpeed: 2.9,
    minDistance: 10.0,
    maxDistance: 25.0,
  };

  // Color settings
  public colors = {
    lowColor: "#3f5a30", // Green (66, 154, 66)
    midColor: "#565048", // Brown (140, 100, 50)
    highColor: "#fafafa", // Light gray (153, 153, 153)
    bottomColor: "#e5c29f", // Dark brown (40, 30, 20)
    lowThreshold: 0.0,
    highThreshold: 0.05,
    backgroundColor: "#87ceeb", // Sky blue (135, 206, 235)
  };

  // Erosion simulation settings
  public erosion = {
    enabled: false,
    rainRate: 0.01,
    evaporationRate: 0.002,
    sedimentCapacity: 4.0,
    dissolutionConstant: 0.3,
    depositionConstant: 0.3,
    isRunning: false,
    // Rain tools
    globalRain: false,
    mouseRainStrength: 0.1,
    mouseRainRadius: 20,
    // Control functions
    start: () => this.startErosion(),
    stop: () => this.stopErosion(),
    reset: () => this.resetErosion(),
    rainEverywhere: () => this.toggleGlobalRain(),
  };

  // Lighting settings
  public lighting = {
    shadowsEnabled: true,
    shadowIntensity: 0.5,
    lightDirection: {
      x: 0.5,
      y: 1.0,
      z: 0.3,
    },
  };

  // Depth of Field settings
  public depthOfField = {
    enabled: false,
    focalDepth: 17.5,       // Middle of camera range (10-25)
    focalRange: 3.0,        // Range that stays sharp
    blurStrength: 1.0,      // Far blur strength
    nearBlurStrength: 0.8,  // Near blur strength
  };

  private gui: GUI;
  private onRegenerateCallback?: () => Promise<void> | void;
  private onColorChangeCallback?: () => void;
  private onImageUploadCallback?: (
    imageData: ImageData,
    layerId: string
  ) => void;
  private colorFolder?: GUI;
  private cameraInstance?: OrbitCamera;
  public erosionSimulation?: ErosionSimulation; // Made public so it can be set after construction
  private layersFolder?: GUI;
  private layerFolders: Map<string, GUI> = new Map();
  private colorGroupsFolder?: GUI;
  private colorGroupFolders: Map<string, GUI> = new Map();

  constructor(camera?: OrbitCamera, erosionSimulation?: ErosionSimulation) {
    this.cameraInstance = camera;
    this.erosionSimulation = erosionSimulation;
    this.layerStack = new LayerStack();
    this.colorSystem = new ColorSystem();
    
    // Create GUI without localStorage persistence to always use code defaults
    this.gui = new GUI({ 
      title: "Terrain Controls", 
      width: 300
    });
    
    this.setupGUI();
    this.setupLayerCallbacks();
    this.setupColorCallbacks();
  }

  private setupGUI(): void {
    // Layer management folder
    this.layersFolder = this.gui.addFolder("Terrain Layers");
    this.setupLayerControls();
    this.layersFolder.close();

    // Visualization folder
    const vizFolder = this.gui.addFolder("Visualization");
    vizFolder
      .add(this.visualization, "mode", ["terrain", "heightmap"])
      .name("Display Mode")
      .onChange(() => {
        this.updateColorFolderVisibility();
      });
    vizFolder.add(this.visualization, "disableDisplacement").name("Flat View");
    vizFolder
      .add(this.visualization, "meshResolution", 4, 25, 1)
      .name("Mesh Resolution")
      .onChange(() => this.triggerRegenerate());
    vizFolder
      .add(this.visualization, "textureResolution", [512, 1024, 2048, 4096])
      .name("Texture Resolution")
      .onChange(() => this.triggerRegenerate());
    vizFolder.close();

    // Camera controls folder
    if (this.cameraInstance) {
      const cameraFolder = this.gui.addFolder("Camera Controls");
      cameraFolder
        .add(this.camera, "damping", 0.0, 0.2, 0.01)
        .name("Damping (Smoothness)")
        .onChange((value: number) => {
          if (this.cameraInstance) this.cameraInstance.damping = value;
        });
      cameraFolder
        .add(this.camera, "rotateSpeed", 0.1, 2.0, 0.1)
        .name("Rotate Speed")
        .onChange((value: number) => {
          if (this.cameraInstance) this.cameraInstance.rotateSpeed = value;
        });
      cameraFolder
        .add(this.camera, "panSpeed", 0.1, 2.0, 0.1)
        .name("Pan Speed")
        .onChange((value: number) => {
          if (this.cameraInstance) this.cameraInstance.panSpeed = value;
        });
      cameraFolder
        .add(this.camera, "zoomSpeed", 0.1, 3.0, 0.1)
        .name("Zoom Speed")
        .onChange((value: number) => {
          if (this.cameraInstance) this.cameraInstance.zoomSpeed = value;
        });
      cameraFolder
        .add(this.camera, "minDistance", 0.5, 10.0, 0.5)
        .name("Min Distance")
        .onChange((value: number) => {
          if (this.cameraInstance) this.cameraInstance.minDistance = value;
        });
      cameraFolder
        .add(this.camera, "maxDistance", 10.0, 100.0, 5.0)
        .name("Max Distance")
        .onChange((value: number) => {
          if (this.cameraInstance) this.cameraInstance.maxDistance = value;
        });
      cameraFolder.close();
    }

    // Color settings folder
    this.colorFolder = this.gui.addFolder("Color Settings");
    this.colorFolder
      .addColor(this.colors, "lowColor")
      .name("Low Color (Valley)");
    this.colorFolder
      .addColor(this.colors, "midColor")
      .name("Mid Color (Slope)");
    this.colorFolder
      .addColor(this.colors, "highColor")
      .name("High Color (Peak)");
    this.colorFolder
      .addColor(this.colors, "bottomColor")
      .name("Bottom/Side Color");
    this.colorFolder
      .add(this.colors, "lowThreshold", 0.0, 1.0, 0.05)
      .name("Low → Mid Threshold");
    this.colorFolder
      .add(this.colors, "highThreshold", 0.0, 1.0, 0.05)
      .name("Mid → High Threshold");
    this.colorFolder
      .addColor(this.colors, "backgroundColor")
      .name("Background Color");
    this.updateColorFolderVisibility();
    this.colorFolder.close();

    // New color groups system
    this.setupColorGroupsGUI();

    // Lighting settings folder
    const lightingFolder = this.gui.addFolder("Lighting & Shadows");
    lightingFolder
      .add(this.lighting, "shadowsEnabled")
      .name("Enhanced Lighting");
    lightingFolder
      .add(this.lighting, "shadowIntensity", 0.0, 1.0, 0.05)
      .name("Ambient Darkness");
    lightingFolder
      .add(this.lighting.lightDirection, "x", -1.0, 1.0, 0.1)
      .name("Light X");
    lightingFolder
      .add(this.lighting.lightDirection, "y", 0.1, 2.0, 0.1)
      .name("Light Y (Height)");
    lightingFolder
      .add(this.lighting.lightDirection, "z", -1.0, 1.0, 0.1)
      .name("Light Z");
    lightingFolder.close();

    // Depth of Field settings
    const dofFolder = this.gui.addFolder("📷 Depth of Field");
    dofFolder
      .add(this.depthOfField, "enabled")
      .name("Enable DOF")
      .onChange(() => {
        // DOF will be applied in render loop
      });
    dofFolder
      .add(this.depthOfField, "focalDepth", 10.0, 25.0, 0.5)
      .name("Focal Distance")
      .onChange(() => {
        // Update in real-time
      });
    dofFolder
      .add(this.depthOfField, "focalRange", 0.5, 10.0, 0.5)
      .name("Focus Range")
      .onChange(() => {
        // Update in real-time
      });
    dofFolder
      .add(this.depthOfField, "blurStrength", 0.0, 3.0, 0.1)
      .name("Far Blur Strength")
      .onChange(() => {
        // Update in real-time
      });
    dofFolder
      .add(this.depthOfField, "nearBlurStrength", 0.0, 3.0, 0.1)
      .name("Near Blur Strength")
      .onChange(() => {
        // Update in real-time
      });
    dofFolder.close();

    // Erosion simulation controls
    if (this.erosionSimulation) {
      this.setupErosionControls();
    }
  }

  public onRegenerate(callback: () => Promise<void> | void): void {
    this.onRegenerateCallback = callback;
  }

  public onImageUpload(
    callback: (imageData: ImageData, layerId: string) => void
  ): void {
    this.onImageUploadCallback = callback;
  }

  public onColorChange(callback: () => void): void {
    this.onColorChangeCallback = callback;
  }

  private triggerRegenerate(): void {
    if (this.onRegenerateCallback) {
      const result = this.onRegenerateCallback();
      if (result instanceof Promise) {
        result.catch(console.error);
      }
    }
  }

  private setupLayerCallbacks(): void {
    this.layerStack.onChange(() => {
      this.triggerRegenerate();
    });
  }

  private setupLayerControls(): void {
    if (!this.layersFolder) return;

    // Add layer buttons
    const addControls = {
      addNoise: () => this.addNoiseLayer(),
      addCircle: () => this.addCircleLayer(),
      addImage: () => this.addImageLayer(),
    };

    this.layersFolder.add(addControls, "addNoise").name("➕ Add Noise Layer");
    this.layersFolder.add(addControls, "addCircle").name("➕ Add Circle Layer");
    this.layersFolder.add(addControls, "addImage").name("➕ Add Image Layer");

    // Initial layer setup
    this.refreshLayerGUI();
  }

  private addNoiseLayer(): void {
    if (!this.layerStack.canAddLayer()) {
      alert(`Maximum layer limit (${this.layerStack.getMaxLayers()}) reached`);
      return;
    }

    const layer = this.layerStack.addNoiseLayer({
      name: `Noise ${this.layerStack.getLayerCount()}`,
    });

    if (layer) {
      this.refreshLayerGUI();
      // Trigger terrain regeneration after adding layer
      if (this.onRegenerateCallback) {
        this.onRegenerateCallback();
      }
    }
  }

  private addCircleLayer(): void {
    if (!this.layerStack.canAddLayer()) {
      alert(`Maximum layer limit (${this.layerStack.getMaxLayers()}) reached`);
      return;
    }

    const layer = this.layerStack.addCircleLayer({
      name: `Circle ${this.layerStack.getLayerCount()}`,
    });

    if (layer) {
      this.refreshLayerGUI();
      // Trigger terrain regeneration after adding layer
      if (this.onRegenerateCallback) {
        this.onRegenerateCallback();
      }
    }
  }

  private addImageLayer(): void {
    if (!this.layerStack.canAddLayer()) {
      alert(`Maximum layer limit (${this.layerStack.getMaxLayers()}) reached`);
      return;
    }

    // Create file input for image upload
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.loadImageFile(file);
      }
    };
    input.click();
  }

  private loadImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas to get ImageData
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);

        const layer = this.layerStack.addImageLayer({
          name: `Image ${this.layerStack.getLayerCount()}`,
          imageData: imageData,
        });

        if (layer && this.onImageUploadCallback) {
          this.onImageUploadCallback(imageData, layer.id);
          this.refreshLayerGUI();
          // Trigger terrain regeneration after adding image layer
          if (this.onRegenerateCallback) {
            this.onRegenerateCallback();
          }
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  private refreshLayerGUI(): void {
    if (!this.layersFolder) return;

    // Remove all existing layer folders
    this.layerFolders.forEach((folder) => {
      folder.destroy();
    });
    this.layerFolders.clear();

    // Add folders for all current layers
    const layers = this.layerStack.getAllLayers();
    layers.forEach((layer, index) => {
      this.createLayerFolder(layer, index);
    });
  }

  private createLayerFolder(layer: AlphaLayer, index: number): void {
    if (!this.layersFolder) return;

    const folder = this.layersFolder.addFolder(`${index + 1}. ${layer.name}`);
    this.layerFolders.set(layer.id, folder);

    // Layer controls
    const controls = {
      enabled: layer.enabled,
      strength: layer.strength,
      blendMode: layer.blendMode,
      remove: () => this.removeLayer(layer.id),
      moveUp: () => this.moveLayerUp(layer.id),
      moveDown: () => this.moveLayerDown(layer.id),
    };

    // Common controls
    folder
      .add(controls, "enabled")
      .name("Enabled")
      .onChange((value: boolean) => {
        this.layerStack.updateLayer(layer.id, { enabled: value });
        this.triggerRegenerate();
      });

    folder
      .add(controls, "strength", 0, 5, 0.1)
      .name("Strength")
      .onChange((value: number) => {
        this.layerStack.updateLayer(layer.id, { strength: value });
        this.triggerRegenerate();
      });

    folder
      .add(controls, "blendMode", ["add", "mask", "multiply", "subtract"])
      .name("Blend Mode")
      .onChange((value: string) => {
        this.layerStack.updateLayer(layer.id, { blendMode: value as any });
        this.triggerRegenerate();
      });

    // Layer-specific controls
    if (layer.type === "noise") {
      folder
        .add(layer, "scale", 0.5, 10.0, 0.1)
        .name("Scale")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "octaves", 1, 8, 1)
        .name("Octaves")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "persistence", 0.1, 1.0, 0.05)
        .name("Persistence")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "lacunarity", 1.0, 4.0, 0.1)
        .name("Lacunarity")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "amplitude", 0.0, 2.0, 0.1)
        .name("Amplitude")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "seed", 0, 99999, 1)
        .name("Seed")
        .onChange(() => this.triggerRegenerate());
    } else if (layer.type === "circle") {
      folder
        .add(layer, "centerX", -5, 5, 0.1)
        .name("Center X")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "centerY", -5, 5, 0.1)
        .name("Center Y")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "radius", 0.1, 8.0, 0.1)
        .name("Radius")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "falloff", 0, 1, 0.05)
        .name("Falloff")
        .onChange(() => this.triggerRegenerate());
    } else if (layer.type === "image") {
      folder
        .add(layer, "offsetX", -1, 1, 0.05)
        .name("Offset X")
        .onChange(() => this.triggerRegenerate());
      folder
        .add(layer, "offsetY", -1, 1, 0.05)
        .name("Offset Y")
        .onChange(() => this.triggerRegenerate());
    }

    // Management buttons
    folder.add(controls, "moveUp").name("⬆️ Move Up");
    folder.add(controls, "moveDown").name("⬇️ Move Down");
    folder.add(controls, "remove").name("🗑️ Remove Layer");
    folder.close();
  }

  private removeLayer(layerId: string): void {
    if (this.layerStack.removeLayer(layerId)) {
      this.refreshLayerGUI();
      // Trigger terrain regeneration after layer removal
      if (this.onRegenerateCallback) {
        this.onRegenerateCallback();
      }
    }
  }

  private moveLayerUp(layerId: string): void {
    if (this.layerStack.moveLayerUp(layerId)) {
      this.refreshLayerGUI();
      // Trigger terrain regeneration after layer reordering
      if (this.onRegenerateCallback) {
        this.onRegenerateCallback();
      }
    }
  }

  private moveLayerDown(layerId: string): void {
    if (this.layerStack.moveLayerDown(layerId)) {
      this.refreshLayerGUI();
      // Trigger terrain regeneration after layer reordering
      if (this.onRegenerateCallback) {
        this.onRegenerateCallback();
      }
    }
  }

  private updateColorFolderVisibility(): void {
    if (this.colorFolder) {
      if (this.visualization.mode === "heightmap") {
        this.colorFolder.close();
        this.colorFolder.domElement.style.display = "none";
      } else {
        this.colorFolder.domElement.style.display = "";
      }
    }
  }

  private setupErosionControls(): void {
    const erosionFolder = this.gui.addFolder("🌊 Erosion Simulation");

    // Simulation controls
    const controlsFolder = erosionFolder.addFolder("Simulation");
    controlsFolder.add(this.erosion, "start").name("▶ Start Simulation");
    controlsFolder.add(this.erosion, "stop").name("⏸ Stop Simulation");
    controlsFolder.add(this.erosion, "reset").name("🔄 Reset Simulation");

    // Rain tools
    const rainFolder = erosionFolder.addFolder("Rain Tools");
    rainFolder.add(this.erosion, "rainEverywhere").name("🌧 Rain Everywhere");

    // Instructions with better formatting
    const instructions = rainFolder.addFolder("Instructions");
    instructions
      .add({ info: "1. Press 'C' key to activate rain tool" }, "info")
      .name("🎯 Mouse Tool");
    instructions
      .add({ info: "2. Click or drag to add water" }, "info")
      .name("💧 Add Water");
    instructions
      .add({ info: "3. Release 'C' key to deactivate" }, "info")
      .name("🔧 Deactivate");

    rainFolder
      .add(this.erosion, "mouseRainStrength", 0.01, 0.5, 0.01)
      .name("Mouse Rain Strength")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setMouseRainStrength(value);
        }
      });

    rainFolder
      .add(this.erosion, "mouseRainRadius", 5, 50, 1)
      .name("Mouse Rain Radius")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setMouseRainRadius(value);
        }
      });

    // Simulation parameters
    const paramsFolder = erosionFolder.addFolder("Parameters");
    paramsFolder
      .add(this.erosion, "rainRate", 0.0, 0.05, 0.001)
      .name("Base Rain Rate")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setRainRate(value);
        }
      });
    paramsFolder
      .add(this.erosion, "evaporationRate", 0.0, 0.01, 0.0001)
      .name("Evaporation Rate")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setEvaporationRate(value);
        }
      });
    paramsFolder
      .add(this.erosion, "sedimentCapacity", 1.0, 10.0, 0.1)
      .name("Sediment Capacity")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setSedimentCapacity(value);
        }
      });
    paramsFolder
      .add(this.erosion, "dissolutionConstant", 0.1, 1.0, 0.05)
      .name("Erosion Strength")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setDissolutionConstant(value);
        }
      });
    paramsFolder
      .add(this.erosion, "depositionConstant", 0.1, 1.0, 0.05)
      .name("Deposition Strength")
      .onChange((value: number) => {
        if (this.erosionSimulation) {
          this.erosionSimulation.setDepositionConstant(value);
        }
      });
    
    erosionFolder.close();
    controlsFolder.close();
    rainFolder.close();
    instructions.close();
    paramsFolder.close();
  }

  private startErosion(): void {
    if (!this.erosionSimulation) return;

    console.log("Starting erosion simulation...");
    this.erosion.isRunning = true;

    // Only initialize terrain if not already initialized (first start)
    // This prevents overwriting existing erosion when resuming
    if (!this.erosionSimulation.isTerrainInitialized()) {
      console.log("🔧 First start - initializing terrain from layers");
      this.erosionSimulation.initializeTerrain(this.layerStack);
    } else {
      console.log("🔧 Resuming existing simulation - preserving erosion data");
    }
    
    this.erosionSimulation.start();
  }

  private stopErosion(): void {
    if (!this.erosionSimulation) return;

    console.log("Stopping erosion simulation...");
    this.erosion.isRunning = false;
    this.erosionSimulation.stop();
  }

  private resetErosion(): void {
    if (!this.erosionSimulation) return;

    console.log("Resetting erosion simulation...");
    this.erosion.isRunning = false;
    this.erosion.globalRain = false;
    this.erosionSimulation.setGlobalRain(false);
    this.erosionSimulation.reset(this.layerStack);
  }

  private toggleGlobalRain(): void {
    if (!this.erosionSimulation) return;

    this.erosion.globalRain = !this.erosion.globalRain;
    this.erosionSimulation.setGlobalRain(this.erosion.globalRain);

    console.log(
      `Global rain ${this.erosion.globalRain ? "enabled" : "disabled"}`
    );
  }

  // Color System Management
  private setupColorCallbacks(): void {
    this.colorSystem.onChange(() => {
      if (this.onColorChangeCallback) {
        this.onColorChangeCallback();
      }
      this.triggerRegenerate();
    });
  }

  private setupColorGroupsGUI(): void {
    this.colorGroupsFolder = this.gui.addFolder("🎨 Color Groups");
    
    // Add button for new color group
    const controls = {
      addGroup: () => this.addColorGroup(),
    };
    this.colorGroupsFolder.add(controls, "addGroup").name("➕ Add Color Group");
    
    this.refreshColorGroupsGUI();
    this.colorGroupsFolder.close();
  }

  private addColorGroup(): void {
    const groupCount = this.colorSystem.getAllGroups().length;
    this.colorSystem.addColorGroup({
      name: `Color Group ${groupCount + 1}`,
      colorStops: [
        { id: "stop_0", threshold: 0.0, color: "#000000", enabled: true },
        { id: "stop_1", threshold: 1.0, color: "#ffffff", enabled: true },
      ],
    });
    
    this.refreshColorGroupsGUI();
  }

  private refreshColorGroupsGUI(): void {
    if (!this.colorGroupsFolder) return;

    // Remove all existing folders
    this.colorGroupFolders.forEach((folder) => folder.destroy());
    this.colorGroupFolders.clear();

    // Add folders for all current groups
    const groups = this.colorSystem.getAllGroups();
    groups.forEach((group) => {
      this.createColorGroupFolder(group);
    });
  }

  private createColorGroupFolder(group: ColorGroup): void {
    if (!this.colorGroupsFolder) return;

    const folder = this.colorGroupsFolder.addFolder(`${group.name}`);
    this.colorGroupFolders.set(group.id, folder);

    // Group controls
    folder
      .add(group, "enabled")
      .name("Enabled")
      .onChange(() => {
        this.colorSystem.updateColorGroup(group.id, { enabled: group.enabled });
      });

    folder
      .add(group, "strength", 0.0, 1.0, 0.05)
      .name("Strength")
      .onChange(() => {
        this.colorSystem.updateColorGroup(group.id, { strength: group.strength });
      });

    folder
      .add(group, "blendMode", ["replace", "multiply", "add", "overlay"])
      .name("Blend Mode")
      .onChange(() => {
        this.colorSystem.updateColorGroup(group.id, { blendMode: group.blendMode });
      });

    // Source layer selection
    const layerOptions: { [key: string]: string | null } = {
      "Master (Combined)": null,
    };
    this.layerStack.getAllLayers().forEach((layer) => {
      layerOptions[layer.name] = layer.id;
    });

    const sourceControls = {
      sourceLayer: group.sourceLayerId || "Master (Combined)",
    };

    folder
      .add(sourceControls, "sourceLayer", layerOptions)
      .name("Alpha Source")
      .onChange((value: string | null) => {
        this.colorSystem.updateColorGroup(group.id, { 
          sourceLayerId: value === "Master (Combined)" ? null : value 
        });
      });

    // Color stops section
    const stopsFolder = folder.addFolder("Color Stops");
    
    const stopControls = {
      addStop: () => {
        const newThreshold = group.colorStops.length > 0
          ? (group.colorStops[group.colorStops.length - 1].threshold + 0.1)
          : 0.5;
        this.colorSystem.addColorStop(group.id, {
          threshold: Math.min(newThreshold, 1.0),
          color: "#808080",
        });
        this.refreshColorGroupsGUI();
      },
    };

    stopsFolder.add(stopControls, "addStop").name("➕ Add Color Stop");

    // Display existing stops
    group.colorStops.forEach((stop, index) => {
      const stopFolder = stopsFolder.addFolder(`Stop ${index + 1} (${(stop.threshold * 100).toFixed(0)}%)`);
      
      stopFolder
        .add(stop, "enabled")
        .name("Enabled")
        .onChange(() => {
          this.colorSystem.updateColorStop(group.id, stop.id, { enabled: stop.enabled });
        });

      stopFolder
        .add(stop, "threshold", 0.0, 1.0, 0.01)
        .name("Threshold")
        .onChange(() => {
          this.colorSystem.updateColorStop(group.id, stop.id, { threshold: stop.threshold });
          // Note: Folder names won't update in real-time to avoid closing folders during interaction
        });

      stopFolder
        .addColor(stop, "color")
        .name("Color")
        .onChange(() => {
          this.colorSystem.updateColorStop(group.id, stop.id, { color: stop.color });
        });

      const removeControl = {
        remove: () => {
          this.colorSystem.removeColorStop(group.id, stop.id);
          this.refreshColorGroupsGUI();
        },
      };
      stopFolder.add(removeControl, "remove").name("🗑️ Remove");
      stopFolder.close();
    });

    stopsFolder.close();

    // Group actions
    const groupControls = {
      remove: () => {
        if (confirm(`Remove color group "${group.name}"?`)) {
          this.colorSystem.removeColorGroup(group.id);
          this.refreshColorGroupsGUI();
        }
      },
    };
    folder.add(groupControls, "remove").name("🗑️ Remove Group");

    folder.close();
  }

  public destroy(): void {
    this.gui.destroy();
  }
}
