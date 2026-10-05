import { GUI } from "lil-gui";
import { OrbitCamera } from "./Camera";
import { LayerStack, AlphaLayer } from "./LayerSystem";
import { ColorSystem, ColorGroup, EROSION_ALPHA_SOURCES } from "./ColorSystem";
import { DOFSystem, DOFStop } from "./DOFSystem";
import { ErosionSimulation, DEFAULT_EROSION_PARAMETERS } from "../simulation/ErosionSimulation";

/**
 * Application settings with lil-gui control panel
 */
export class Settings {
  // Layer system for terrain generation
  public layerStack: LayerStack;
  
  // Color system for terrain coloration
  public colorSystem: ColorSystem;
  
  // DOF system for camera distance-based depth of field
  public dofSystem: DOFSystem;

  // Rendering settings
  public rendering = {
    wireframe: false,
    showNormals: false,
  };

  // Visualization settings
  public visualization = {
    mode: "terrain", // 'terrain', 'heightmap', or an erosion map ('erosion', 'deposition', 'flow', 'water')
    disableDisplacement: false,
    textureResolution: 2048, // Height texture resolution (512, 1024, 2048, 4096)
    meshResolution: 18, // Mesh detail level (4-25)
    heightScale: 0.1, // Layer height -> displayed height
    erosionMapRange: 0.3, // World-space carve/deposit depth that reads as ~63% in erosion maps
    flowMapRange: 15.0, // Water discharge that reads as ~63% in the flow paths map
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

  // Erosion simulation settings (see ErosionSimulation for the meaning of each parameter)
  public erosion = {
    ...DEFAULT_EROSION_PARAMETERS,
    running: false,
    resolution: 1024,
    showWater: true,
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
    enabled: true,
    aperture: 2.0,          // Background blur in % of screen height (bigger = shallower focus)
    autofocus: "center",    // 'center', 'mouse' or 'target' (orbit target)
    focusSpeed: 6.0,        // How quickly focus eases to a new distance (0 = instant)
  };

  private gui: GUI;
  private onRegenerateCallback?: () => Promise<void> | void;
  private onColorChangeCallback?: () => void;
  private onHeightScaleChangeCallback?: (heightScale: number) => void;
  private onImageUploadCallback?: (
    imageData: ImageData,
    layerId: string
  ) => void;
  private colorFolder?: GUI;
  private cameraInstance?: OrbitCamera;
  public erosionSimulation?: ErosionSimulation; // Set via attachErosionSimulation once created
  private layersFolder?: GUI;
  private layerFolders: Map<string, GUI> = new Map();
  private colorGroupsFolder?: GUI;
  private colorGroupFolders: Map<string, GUI> = new Map();
  private dofStopsFolder?: GUI;
  private dofStopFolders: Map<string, GUI> = new Map();

  constructor(camera?: OrbitCamera) {
    this.cameraInstance = camera;
    this.layerStack = new LayerStack();
    this.colorSystem = new ColorSystem();
    this.dofSystem = new DOFSystem();
    
    // Create GUI without localStorage persistence to always use code defaults
    this.gui = new GUI({ 
      title: "Terrain Controls", 
      width: 300
    });
    
    this.setupGUI();
    this.setupLayerCallbacks();
    this.setupColorCallbacks();
    this.setupDOFCallbacks();
  }

  private setupGUI(): void {
    // Layer management folder
    this.layersFolder = this.gui.addFolder("Terrain Layers");
    this.setupLayerControls();
    this.layersFolder.close();

    // Visualization folder
    const vizFolder = this.gui.addFolder("Visualization");
    vizFolder
      .add(this.visualization, "mode", {
        Terrain: "terrain",
        "Height Map": "heightmap",
        ...Object.fromEntries(
          Object.values(EROSION_ALPHA_SOURCES).map((source) => [source.label, source.mode])
        ),
      })
      .name("Display Mode")
      .onChange(() => {
        this.updateColorFolderVisibility();
      });
    vizFolder
      .add(this.visualization, "erosionMapRange", 0.005, 1.0, 0.005)
      .name("Erosion Map Range");
    vizFolder
      .add(this.visualization, "flowMapRange", 0.5, 50.0, 0.5)
      .name("Flow Map Range");
    vizFolder.add(this.visualization, "disableDisplacement").name("Flat View");
    vizFolder
      .add(this.visualization, "heightScale", 0.01, 0.5, 0.01)
      .name("Height Scale")
      .onChange((value: number) => this.onHeightScaleChangeCallback?.(value));
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

    // DOF Stops system
    this.setupDOFStopsGUI();
  }

  /** Connect the erosion simulation and build its controls. */
  public attachErosionSimulation(erosionSimulation: ErosionSimulation): void {
    const firstAttach = !this.erosionSimulation;
    this.erosionSimulation = erosionSimulation;
    erosionSimulation.setParameters(this.erosion);
    if (firstAttach) {
      this.setupErosionControls();
    }
  }

  public onHeightScaleChange(callback: (heightScale: number) => void): void {
    this.onHeightScaleChangeCallback = callback;
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
      if (this.visualization.mode !== "terrain") {
        this.colorFolder.close();
        this.colorFolder.domElement.style.display = "none";
      } else {
        this.colorFolder.domElement.style.display = "";
      }
    }
  }

  private setupErosionControls(): void {
    const erosionFolder = this.gui.addFolder("🌊 Erosion Simulation");
    const apply = () => this.erosionSimulation?.setParameters(this.erosion);

    erosionFolder
      .add(this.erosion, "running")
      .name("▶ Running")
      .listen()
      .onChange((running: boolean) => (running ? this.startErosion() : this.stopErosion()));
    erosionFolder.add({ reset: () => this.resetErosion() }, "reset").name("🔄 Reset Erosion");
    erosionFolder.add(this.erosion, "stepsPerFrame", 1, 10, 1).name("Steps per Frame").onChange(apply);
    erosionFolder
      .add(this.erosion, "resolution", [256, 512, 1024, 2048])
      .name("Sim Resolution")
      .onChange((value: number) => this.erosionSimulation?.setResolution(Number(value)));

    const rainFolder = erosionFolder.addFolder("Rain");
    rainFolder.add(this.erosion, "globalRain").name("🌧 Rain Everywhere").onChange(apply);
    rainFolder.add(this.erosion, "rainRate", 0.0, 1.0, 0.01).name("Rain Rate").onChange(apply);
    rainFolder.add(this.erosion, "rainOnPeaks", 0.0, 1.0, 0.05).name("Rain on Peaks").onChange(apply);
    rainFolder.add(this.erosion, "brushRadius", 0.005, 0.2, 0.005).name("Brush Radius").onChange(apply);
    rainFolder.add(this.erosion, "brushStrength", 0.5, 20, 0.5).name("Brush Strength").onChange(apply);
    rainFolder.add(this.erosion, "drainEdges").name("Drain at Edges").onChange(apply);
    rainFolder.add(this.erosion, "showWater").name("Show Water");
    rainFolder
      .add({ info: "Hold C and drag on the terrain" }, "info")
      .name("💧 Rain Brush")
      .disable();

    const hydraulicFolder = erosionFolder.addFolder("Hydraulic Erosion");
    hydraulicFolder.add(this.erosion, "sedimentCapacity", 0.005, 0.5, 0.005).name("Sediment Capacity (Kc)").onChange(apply);
    hydraulicFolder.add(this.erosion, "dissolution", 0.001, 0.2, 0.001).name("Erosion Rate (Ks)").onChange(apply);
    hydraulicFolder.add(this.erosion, "deposition", 0.001, 0.1, 0.001).name("Deposition Rate (Kd)").onChange(apply);
    hydraulicFolder.add(this.erosion, "evaporation", 0.0, 0.5, 0.005).name("Evaporation (Ke)").onChange(apply);
    hydraulicFolder.add(this.erosion, "maxErosionDepth", 0.0, 10.0, 0.1).name("Max Erosion Depth").onChange(apply);
    hydraulicFolder.add(this.erosion, "minSlope", 0.0, 0.5, 0.01).name("Min Slope").onChange(apply);
    hydraulicFolder.add(this.erosion, "velocityAdvection", 0.0, 0.5, 0.01).name("Flow Momentum").onChange(apply);
    hydraulicFolder.add(this.erosion, "timeStep", 0.01, 0.1, 0.005).name("Time Step").onChange(apply);

    const thermalFolder = erosionFolder.addFolder("Thermal Erosion");
    thermalFolder.add(this.erosion, "thermalRate", 0.0, 5.0, 0.1).name("Rate").onChange(apply);
    thermalFolder.add(this.erosion, "talusAngle", 10, 80, 1).name("Talus Angle (°)").onChange(apply);
    hydraulicFolder.add(this.erosion, "smoothThreshold", 0.0, 1.0, 0.01).name("Spike Smoothing").onChange(apply);

    erosionFolder.close();
    rainFolder.close();
    hydraulicFolder.close();
    thermalFolder.close();
  }

  public startErosion(): void {
    if (!this.erosionSimulation) return;
    this.erosion.running = true;
    this.erosionSimulation.start();
  }

  public stopErosion(): void {
    if (!this.erosionSimulation) return;
    this.erosion.running = false;
    this.erosionSimulation.stop();
  }

  private resetErosion(): void {
    if (!this.erosionSimulation) return;
    this.erosion.running = false;
    this.erosionSimulation.reset();
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

    folder
      .add(group, "maskByAlpha")
      .name("Alpha as Opacity")
      .onChange(() => {
        this.colorSystem.updateColorGroup(group.id, { maskByAlpha: group.maskByAlpha });
      });

    // Source layer selection
    const layerOptions: { [key: string]: string | null } = {
      "Master (Combined)": null,
    };
    this.layerStack.getAllLayers().forEach((layer) => {
      layerOptions[layer.name] = layer.id;
    });
    for (const [id, source] of Object.entries(EROSION_ALPHA_SOURCES)) {
      layerOptions[source.label] = id;
    }

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

  // DOF Stop System Management
  private setupDOFCallbacks(): void {
    this.dofSystem.onChange(() => {
      // DOF changes don't require terrain regeneration, just visual update
    });
  }

  private setupDOFStopsGUI(): void {
    this.dofStopsFolder = this.gui.addFolder("📷 Depth of Field");
    
    this.dofStopsFolder.add(this.depthOfField, "enabled").name("Enable DOF");
    this.dofStopsFolder.add(this.depthOfField, "aperture", 0.0, 6.0, 0.1).name("Aperture");
    this.dofStopsFolder
      .add(this.depthOfField, "autofocus", {
        "Screen Center": "center",
        "Mouse": "mouse",
        "Orbit Target": "target",
      })
      .name("Autofocus");
    this.dofStopsFolder.add(this.depthOfField, "focusSpeed", 0.0, 20.0, 0.5).name("Focus Speed");
    
    // Add button for new DOF stop
    const controls = {
      addStop: () => this.addDOFStop(),
    };
    this.dofStopsFolder.add(controls, "addStop").name("➕ Add DOF Stop");
    
    this.refreshDOFStopsGUI();
    this.dofStopsFolder.close();
  }

  private addDOFStop(): void {
    const stops = this.dofSystem.getAllStops();
    const newDistance = stops.length > 0 
      ? Math.min(stops[stops.length - 1].cameraDistance + 3.0, 25.0)
      : 15.0;
      
    this.dofSystem.addStop({
      cameraDistance: newDistance,
      focalOffset: 0.0,
      focalRange: 0.5,
      blurStrength: 1.0,
      nearBlurStrength: 1.0,
    });
    
    this.refreshDOFStopsGUI();
  }

  private refreshDOFStopsGUI(): void {
    if (!this.dofStopsFolder) return;

    // Remove all existing folders
    this.dofStopFolders.forEach((folder) => folder.destroy());
    this.dofStopFolders.clear();

    // Add folders for all current stops
    const stops = this.dofSystem.getAllStops();
    stops.forEach((stop, index) => {
      this.createDOFStopFolder(stop, index);
    });
  }

  private createDOFStopFolder(stop: DOFStop, index: number): void {
    if (!this.dofStopsFolder) return;

    const folder = this.dofStopsFolder.addFolder(
      `Stop ${index + 1} @ ${stop.cameraDistance.toFixed(1)}m`
    );
    this.dofStopFolders.set(stop.id, folder);

    // Stop controls
    folder
      .add(stop, "enabled")
      .name("Enabled")
      .onChange(() => {
        this.dofSystem.updateStop(stop.id, { enabled: stop.enabled });
      });

    folder
      .add(stop, "cameraDistance", 10.0, 25.0, 0.1)
      .name("Camera Distance")
      .onChange(() => {
        this.dofSystem.updateStop(stop.id, { cameraDistance: stop.cameraDistance });
      });

    folder
      .add(stop, "focalOffset", -5.0, 5.0, 0.05)
      .name("Focal Offset")
      .onChange(() => {
        this.dofSystem.updateStop(stop.id, { focalOffset: stop.focalOffset });
      });

    folder
      .add(stop, "focalRange", 0.0, 5.0, 0.05)
      .name("Focus Range")
      .onChange(() => {
        this.dofSystem.updateStop(stop.id, { focalRange: stop.focalRange });
      });

    folder
      .add(stop, "blurStrength", 0.0, 3.0, 0.05)
      .name("Far Blur ×")
      .onChange(() => {
        this.dofSystem.updateStop(stop.id, { blurStrength: stop.blurStrength });
      });

    folder
      .add(stop, "nearBlurStrength", 0.0, 3.0, 0.05)
      .name("Near Blur ×")
      .onChange(() => {
        this.dofSystem.updateStop(stop.id, { nearBlurStrength: stop.nearBlurStrength });
      });

    const removeControl = {
      remove: () => {
        if (confirm(`Remove DOF stop at ${stop.cameraDistance.toFixed(1)}m?`)) {
          this.dofSystem.removeStop(stop.id);
          this.refreshDOFStopsGUI();
        }
      },
    };
    folder.add(removeControl, "remove").name("🗑️ Remove");
    folder.close();
  }

  public destroy(): void {
    this.gui.destroy();
  }
}
