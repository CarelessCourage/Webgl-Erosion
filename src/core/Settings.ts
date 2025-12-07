import * as dat from 'dat.gui';
import { OrbitCamera } from './Camera';

/**
 * Application settings with dat.gui control panel
 */
export class Settings {
    // Terrain generation settings
    public terrain = {
        seed: 12345,
        scale: 4.0,
        octaves: 4,
        persistence: 0.5,
        lacunarity: 2.0,
        amplitude: 0.5,
        baseHeight: 0.3,
        meshResolution: 8,
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
        lowColor: [23, 82, 23] as [number, number, number],    // Green
        midColor: [140, 100, 50] as [number, number, number],   // Brown
        highColor: [153, 153, 153] as [number, number, number], // White
        lowThreshold: 0.0,
        highThreshold: 0.35,
        backgroundColor: [135, 206, 235] as [number, number, number], // Sky blue
    };

    private gui: dat.GUI;
    private onRegenerateCallback?: () => void;
    private colorFolder?: dat.GUI;
    private cameraInstance?: OrbitCamera;

    constructor(camera?: OrbitCamera) {
        this.cameraInstance = camera;
        this.gui = new dat.GUI();
        this.setupGUI();
    }

    private setupGUI(): void {
        // Terrain folder
        const terrainFolder = this.gui.addFolder('Terrain Generation');
        terrainFolder.add(this.terrain, 'seed', 0, 99999, 1).name('Seed').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'scale', 0.5, 10.0, 0.1).name('Scale').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'octaves', 1, 8, 1).name('Octaves').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'persistence', 0.1, 1.0, 0.05).name('Persistence').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'lacunarity', 1.0, 4.0, 0.1).name('Lacunarity').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'amplitude', 0.0, 2.0, 0.1).name('Amplitude').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'baseHeight', 0.0, 1.0, 0.1).name('Base Height').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'meshResolution', 4, 15, 1).name('Mesh Resolution').onChange(() => this.triggerRegenerate());
        terrainFolder.add(this.terrain, 'randomizeSeed').name('Randomize Seed');
        terrainFolder.open();

        // Visualization folder
        const vizFolder = this.gui.addFolder('Visualization');
        vizFolder.add(this.visualization, 'mode', ['terrain', 'heightmap']).name('Display Mode').onChange(() => {
            this.updateColorFolderVisibility();
        });
        vizFolder.add(this.visualization, 'disableDisplacement').name('Flat View');
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
        this.colorFolder.add(this.colors, 'lowThreshold', 0.0, 1.0, 0.05).name('Low → Mid Threshold');
        this.colorFolder.add(this.colors, 'highThreshold', 0.0, 1.0, 0.05).name('Mid → High Threshold');
        this.colorFolder.addColor(this.colors, 'backgroundColor').name('Background Color');
        this.updateColorFolderVisibility();

        // Rendering folder
        const renderingFolder = this.gui.addFolder('Rendering');
        // renderingFolder.add(this.rendering, 'wireframe').name('Wireframe (TODO)');
        renderingFolder.add(this.rendering, 'showNormals').name('Show Normals (TODO)');
    }

    public onRegenerate(callback: () => void): void {
        this.onRegenerateCallback = callback;
    }

    private triggerRegenerate(): void {
        if (this.onRegenerateCallback) {
            this.onRegenerateCallback();
        }
    }

    private randomizeSeed(): void {
        this.terrain.seed = Math.floor(Math.random() * 99999);
        this.gui.updateDisplay();
        this.triggerRegenerate();
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
