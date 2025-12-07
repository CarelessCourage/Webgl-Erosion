import { GUI } from 'lil-gui';
import { OrbitCamera } from './Camera';
import { LayerStack, AlphaLayer } from './LayerSystem';

/**
 * Application settings with lil-gui control panel
 */
export class Settings {
    // Layer system for terrain generation
    public layerStack: LayerStack;
    
    // Legacy terrain settings (will be removed after migration)
    public terrain = {
        seed: 12345,
        scale: 4.0,
        octaves: 4,
        persistence: 0.5,
        lacunarity: 2.0,
        amplitude: 0.5,
        baseHeight: 0.3,
        meshResolution: 10,  // Higher resolution for smoother terrain (32x32 grid)
        randomizeSeed: () => this.randomizeSeed(),
    };

    // Rendering settings
    public rendering = {
        wireframe: false,
        showNormals: false,
    };

    // Visualization settings
    public visualization = {
        mode: 'terrain', // 'terrain' or 'heightmap'
        disableDisplacement: false,
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
        lowColor: "#177517",      // Green (23, 82, 23)
        midColor: "#8c6432",      // Brown (140, 100, 50) 
        highColor: "#999999",     // Light gray (153, 153, 153)
        bottomColor: "#281e14",   // Dark brown (40, 30, 20)
        lowThreshold: 0.0,
        highThreshold: 0.35,
        backgroundColor: "#87ceeb", // Sky blue (135, 206, 235)
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

    private gui: GUI;
    private onRegenerateCallback?: () => Promise<void> | void;
    private onImageUploadCallback?: (imageData: ImageData, layerId: string) => void;
    private colorFolder?: GUI;
    private cameraInstance?: OrbitCamera;
    private layersFolder?: GUI;
    private layerFolders: Map<string, GUI> = new Map();

    constructor(camera?: OrbitCamera) {
        this.cameraInstance = camera;
        this.layerStack = new LayerStack();
        this.gui = new GUI({ title: 'Terrain Controls', width: 300 });
        this.setupGUI();
        this.setupLayerCallbacks();
    }

    private setupGUI(): void {
        // Layer management folder
        this.layersFolder = this.gui.addFolder('Terrain Layers');
        this.setupLayerControls();

        // Visualization folder
        const vizFolder = this.gui.addFolder('Visualization');
        vizFolder.add(this.visualization, 'mode', ['terrain', 'heightmap']).name('Display Mode').onChange(() => {
            this.updateColorFolderVisibility();
        });
        vizFolder.add(this.visualization, 'disableDisplacement').name('Flat View');
        vizFolder.add(this.terrain, 'meshResolution', 4, 15, 1).name('Mesh Resolution').onChange(() => this.triggerRegenerate());
        vizFolder.open();
        vizFolder.open();

        // Camera controls folder
        if (this.cameraInstance) {
            const cameraFolder = this.gui.addFolder('Camera Controls');
            cameraFolder.add(this.camera, 'damping', 0.0, 0.2, 0.01)
                .name('Damping (Smoothness)')
                .onChange((value: number) => {
                    if (this.cameraInstance) this.cameraInstance.damping = value;
                });
            cameraFolder.add(this.camera, 'rotateSpeed', 0.1, 2.0, 0.1)
                .name('Rotate Speed')
                .onChange((value: number) => {
                    if (this.cameraInstance) this.cameraInstance.rotateSpeed = value;
                });
            cameraFolder.add(this.camera, 'panSpeed', 0.1, 2.0, 0.1)
                .name('Pan Speed')
                .onChange((value: number) => {
                    if (this.cameraInstance) this.cameraInstance.panSpeed = value;
                });
            cameraFolder.add(this.camera, 'zoomSpeed', 0.1, 3.0, 0.1)
                .name('Zoom Speed')
                .onChange((value: number) => {
                    if (this.cameraInstance) this.cameraInstance.zoomSpeed = value;
                });
            cameraFolder.add(this.camera, 'minDistance', 0.5, 10.0, 0.5)
                .name('Min Distance')
                .onChange((value: number) => {
                    if (this.cameraInstance) this.cameraInstance.minDistance = value;
                });
            cameraFolder.add(this.camera, 'maxDistance', 10.0, 100.0, 5.0)
                .name('Max Distance')
                .onChange((value: number) => {
                    if (this.cameraInstance) this.cameraInstance.maxDistance = value;
                });
        }

        // Color settings folder
        this.colorFolder = this.gui.addFolder('Color Settings');
        this.colorFolder.addColor(this.colors, 'lowColor').name('Low Color (Valley)');
        this.colorFolder.addColor(this.colors, 'midColor').name('Mid Color (Slope)');
        this.colorFolder.addColor(this.colors, 'highColor').name('High Color (Peak)');
        this.colorFolder.addColor(this.colors, 'bottomColor').name('Bottom/Side Color');
        this.colorFolder.add(this.colors, 'lowThreshold', 0.0, 1.0, 0.05).name('Low → Mid Threshold');
        this.colorFolder.add(this.colors, 'highThreshold', 0.0, 1.0, 0.05).name('Mid → High Threshold');
        this.colorFolder.addColor(this.colors, 'backgroundColor').name('Background Color');
        this.updateColorFolderVisibility();
        
        // Lighting settings folder
        const lightingFolder = this.gui.addFolder('Lighting & Shadows');
        lightingFolder.add(this.lighting, 'shadowsEnabled').name('Enhanced Lighting');
        lightingFolder.add(this.lighting, 'shadowIntensity', 0.0, 1.0, 0.05).name('Ambient Darkness');
        lightingFolder.add(this.lighting.lightDirection, 'x', -1.0, 1.0, 0.1).name('Light X');
        lightingFolder.add(this.lighting.lightDirection, 'y', 0.1, 2.0, 0.1).name('Light Y (Height)');
        lightingFolder.add(this.lighting.lightDirection, 'z', -1.0, 1.0, 0.1).name('Light Z');
        lightingFolder.open();
    }

    public onRegenerate(callback: () => Promise<void> | void): void {
        this.onRegenerateCallback = callback;
    }

    public onImageUpload(callback: (imageData: ImageData, layerId: string) => void): void {
        this.onImageUploadCallback = callback;
    }

    private triggerRegenerate(): void {
        if (this.onRegenerateCallback) {
            const result = this.onRegenerateCallback();
            if (result instanceof Promise) {
                result.catch(console.error);
            }
        }
    }

    private randomizeSeed(): void {
        this.terrain.seed = Math.floor(Math.random() * 99999);
        // Force refresh of all GUI controllers
        this.refreshGUI();
        this.triggerRegenerate();
    }

    private refreshGUI(): void {
        // lil-gui doesn't have updateDisplay, we need to manually refresh controllers
        this.gui.controllersRecursive().forEach(controller => {
            if ('updateDisplay' in controller) {
                (controller as any).updateDisplay();
            }
        });
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

        this.layersFolder.add(addControls, 'addNoise').name('➕ Add Noise Layer');
        this.layersFolder.add(addControls, 'addCircle').name('➕ Add Circle Layer'); 
        this.layersFolder.add(addControls, 'addImage').name('➕ Add Image Layer');

        // Initial layer setup
        this.refreshLayerGUI();
        this.layersFolder.open();
    }

    private addNoiseLayer(): void {
        if (!this.layerStack.canAddLayer()) {
            alert(`Maximum layer limit (${this.layerStack.getMaxLayers()}) reached`);
            return;
        }
        
        const layer = this.layerStack.addNoiseLayer({
            name: `Noise ${this.layerStack.getLayerCount()}`
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
            name: `Circle ${this.layerStack.getLayerCount()}`
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
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
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
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d')!;
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                
                const layer = this.layerStack.addImageLayer({
                    name: `Image ${this.layerStack.getLayerCount()}`,
                    imageData: imageData
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
        this.layerFolders.forEach((folder, layerId) => {
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
        folder.add(controls, 'enabled').name('Enabled').onChange((value: boolean) => {
            this.layerStack.updateLayer(layer.id, { enabled: value });
            this.triggerRegenerate();
        });

        folder.add(controls, 'strength', 0, 2, 0.1).name('Strength').onChange((value: number) => {
            this.layerStack.updateLayer(layer.id, { strength: value });
            this.triggerRegenerate();
        });

        folder.add(controls, 'blendMode', ['add', 'mask', 'multiply', 'subtract']).name('Blend Mode').onChange((value: string) => {
            this.layerStack.updateLayer(layer.id, { blendMode: value as any });
            this.triggerRegenerate();
        });

        // Layer-specific controls
        if (layer.type === 'noise') {
            folder.add(layer, 'scale', 0.5, 10.0, 0.1).name('Scale').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'octaves', 1, 8, 1).name('Octaves').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'persistence', 0.1, 1.0, 0.05).name('Persistence').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'lacunarity', 1.0, 4.0, 0.1).name('Lacunarity').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'amplitude', 0.0, 2.0, 0.1).name('Amplitude').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'seed', 0, 99999, 1).name('Seed').onChange(() => this.triggerRegenerate());
        } else if (layer.type === 'circle') {
            folder.add(layer, 'centerX', -5, 5, 0.1).name('Center X').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'centerY', -5, 5, 0.1).name('Center Y').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'radius', 0.1, 8.0, 0.1).name('Radius').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'falloff', 0, 1, 0.05).name('Falloff').onChange(() => this.triggerRegenerate());
        } else if (layer.type === 'image') {
            folder.add(layer, 'offsetX', -1, 1, 0.05).name('Offset X').onChange(() => this.triggerRegenerate());
            folder.add(layer, 'offsetY', -1, 1, 0.05).name('Offset Y').onChange(() => this.triggerRegenerate());
        }

        // Management buttons
        folder.add(controls, 'moveUp').name('⬆️ Move Up');
        folder.add(controls, 'moveDown').name('⬇️ Move Down');
        folder.add(controls, 'remove').name('🗑️ Remove Layer');

        folder.open();
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
            if (this.visualization.mode === 'heightmap') {
                this.colorFolder.close();
                this.colorFolder.domElement.style.display = 'none';
            } else {
                this.colorFolder.domElement.style.display = '';
                this.colorFolder.open();
            }
        }
    }

    public destroy(): void {
        this.gui.destroy();
    }
}
