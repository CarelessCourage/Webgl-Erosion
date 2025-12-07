import { GPUContext } from './core/GPUContext';
import { OrbitCamera } from './core/Camera';
import { Settings } from './core/Settings';
import { vec3, mat4 } from 'gl-matrix';
import { createPlane } from './geometry/Plane';
import { TerrainRenderer } from './rendering/TerrainRenderer';

/**
 * Main entry point for WebGPU Terrain Erosion
 */

// Get DOM elements
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const loadingDiv = document.getElementById('loading')!;
const errorDiv = document.getElementById('error')!;

// Resize canvas to fill window
function resizeCanvas() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    console.log(`Canvas resized: ${canvas.width}x${canvas.height} (display: ${window.innerWidth}x${window.innerHeight})`);
}

async function init() {
    try {
        // Check WebGPU support
        if (!navigator.gpu) {
            throw new Error('WebGPU not supported');
        }
        
        // Resize canvas
        console.log('About to resize canvas...');
        resizeCanvas();
        console.log('Canvas resized, adding event listener');
        window.addEventListener('resize', resizeCanvas);
        
        // Initialize WebGPU context
        const gpuContext = new GPUContext(canvas);
        const success = await gpuContext.initialize();
        
        if (!success) {
            throw new Error('Failed to initialize WebGPU');
        }
        
        // Initialize camera at midpoint of min/max distance (17.5)
        const initialDistance = 17.5;
        const camera = new OrbitCamera(
            vec3.fromValues(0, initialDistance * Math.sin(Math.PI / 4), initialDistance * Math.cos(Math.PI / 4)),
            vec3.fromValues(0, 0, 0)
        );
        camera.setAspectRatio(canvas.width / canvas.height);
        
        // Set up mouse controls
        let isMouseDown = false;
        canvas.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            camera.handleMouseDown(e, canvas);
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                camera.handleMouseMove(e, canvas);
            }
        });
        
        canvas.addEventListener('mouseup', (e) => {
            isMouseDown = false;
            camera.handleMouseUp(e);
        });
        
        canvas.addEventListener('wheel', (e) => {
            camera.handleWheel(e);
        });
        
        // Prevent context menu on right click
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        // Hide loading screen
        loadingDiv.style.display = 'none';
        
        console.log('✓ WebGPU initialization successful!');
        console.log('✓ Camera controls active');
        
        // Create terrain geometry
        const planeGeometry = createPlane(
            vec3.fromValues(0, 0, 0),  // center
            [10, 10],                   // scale
            8                           // subdivisions (2^(8/2) = 16x16 grid)
        );
        
        console.log('Plane bounds:', {
            minX: -5, maxX: 5,
            minZ: -5, maxZ: 5,
            vertices: planeGeometry.vertexCount,
            triangles: planeGeometry.indexCount / 3
        });
        
        // Create terrain renderer
        const terrainRenderer = new TerrainRenderer(gpuContext, planeGeometry);
        
        // Create settings panel with camera reference
        const settings = new Settings(camera);
        
        let currentMeshResolution = settings.terrain.meshResolution;
        
        settings.onRegenerate(() => {
            // Check if mesh resolution changed
            if (settings.terrain.meshResolution !== currentMeshResolution) {
                currentMeshResolution = settings.terrain.meshResolution;
                const newGeometry = createPlane(
                    vec3.fromValues(0, 0, 0),
                    [10, 10],
                    settings.terrain.meshResolution
                );
                console.log('Mesh updated:', {
                    resolution: settings.terrain.meshResolution,
                    vertices: newGeometry.vertexCount,
                    triangles: newGeometry.indexCount / 3
                });
                terrainRenderer.updateGeometry(newGeometry);
            }
            
            // Always regenerate terrain with current settings
            terrainRenderer.generateTerrain(
                settings.terrain.seed,
                settings.terrain.scale,
                settings.terrain.octaves,
                settings.terrain.persistence,
                settings.terrain.lacunarity,
                settings.terrain.amplitude,
                settings.terrain.baseHeight
            );
        });
        
        // Generate initial terrain with settings
        terrainRenderer.generateTerrain(
            settings.terrain.seed,
            settings.terrain.scale,
            settings.terrain.octaves,
            settings.terrain.persistence,
            settings.terrain.lacunarity,
            settings.terrain.amplitude,
            settings.terrain.baseHeight
        );
        
        // Create depth texture
        let depthTexture = gpuContext.device.createTexture({
            size: { width: canvas.width, height: canvas.height },
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        
        // Handle window resize
        const originalResize = resizeCanvas;
        resizeCanvas = () => {
            originalResize();
            // Recreate depth texture on resize
            depthTexture.destroy();
            depthTexture = gpuContext.device.createTexture({
                size: { width: canvas.width, height: canvas.height },
                format: 'depth24plus',
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
            camera.setAspectRatio(canvas.width / canvas.height);
        };
        
        console.log('✓ Terrain initialized, starting render loop');
        
        // Render loop
        console.log('✓ Terrain initialized, starting render loop');
        
        // Render loop
        let lastTime = performance.now();
        let frameCount = 0;
        function render(currentTime: number) {
            const deltaTime = (currentTime - lastTime) * 0.001;
            lastTime = currentTime;
            
            // Update camera
            camera.update(deltaTime);
            
            // Debug first frame
            if (frameCount === 0) {
                console.log('First frame render:');
                console.log('Camera position:', camera.position);
                console.log('Camera target:', camera.target);
                console.log('View matrix:', camera.viewMatrix);
                console.log('Projection matrix:', camera.projectionMatrix);
            }
            frameCount++;
            
            // Update terrain uniforms
            const modelMatrix = mat4.create();
            mat4.identity(modelMatrix);
            
            const viewProjMatrix = mat4.create();
            mat4.multiply(viewProjMatrix, camera.projectionMatrix, camera.viewMatrix);
            
            // Calculate light view-projection matrix for shadows
            const lightDirection = vec3.fromValues(
                settings.lighting.lightDirection.x,
                settings.lighting.lightDirection.y,
                settings.lighting.lightDirection.z
            );
            vec3.normalize(lightDirection, lightDirection);
            
            // Position light far from terrain, looking toward origin
            const lightDistance = 30.0;
            const lightPosition = vec3.create();
            vec3.scale(lightPosition, lightDirection, lightDistance);
            
            const lightTarget = vec3.fromValues(0, 0, 0);
            const lightViewMatrix = mat4.create();
            mat4.lookAt(lightViewMatrix, lightPosition, lightTarget, vec3.fromValues(0, 1, 0));
            
            // Orthographic projection for directional light
            // Terrain is 10x10 (-5 to 5), so we need enough coverage
            const lightProjMatrix = mat4.create();
            const halfSize = 8.0; // Cover the terrain with some margin
            // gl-matrix ortho: left, right, bottom, top, near, far
            mat4.ortho(lightProjMatrix, -halfSize, halfSize, -halfSize, halfSize, 0.1, 50.0);
            
            const lightViewProjMatrix = mat4.create();
            mat4.multiply(lightViewProjMatrix, lightProjMatrix, lightViewMatrix);
            
            if (frameCount === 1) {
                console.log('Model matrix:', modelMatrix);
                console.log('ViewProj matrix:', viewProjMatrix);
                console.log('Light position:', lightPosition);
                console.log('Light direction:', lightDirection);
                console.log('Light ViewProj matrix:', lightViewProjMatrix);
                console.log('Rendering', planeGeometry.indexCount, 'indices');
            }
            
            // Update shadow uniforms
            terrainRenderer.updateShadowUniforms(
                modelMatrix, 
                lightViewProjMatrix,
                settings.visualization.disableDisplacement ? 1.0 : 0.0
            );
            
            terrainRenderer.updateUniforms(
                modelMatrix,
                viewProjMatrix,
                lightViewProjMatrix,
                camera.position,
                settings.visualization.mode,
                settings.visualization.disableDisplacement,
                settings.colors.lowColor,
                settings.colors.midColor,
                settings.colors.highColor,
                settings.colors.bottomColor,
                settings.colors.lowThreshold,
                settings.colors.highThreshold,
                settings.lighting.shadowsEnabled,
                lightDirection,
                settings.lighting.shadowIntensity
            );
            
            // Begin rendering
            const commandEncoder = gpuContext.device.createCommandEncoder();
            
            // Shadow pass disabled - causes acne on low-poly displaced meshes
            // if (settings.lighting.shadowsEnabled) {
            //     const shadowPass = commandEncoder.beginRenderPass({
            //         colorAttachments: [],
            //         depthStencilAttachment: {
            //             view: terrainRenderer.getShadowMapView(),
            //             depthClearValue: 1.0,
            //             depthLoadOp: 'clear',
            //             depthStoreOp: 'store',
            //         },
            //     });
            //     
            //     terrainRenderer.renderShadowMap(shadowPass);
            //     shadowPass.end();
            // }
            
            // Second pass: Render main scene
            const textureView = gpuContext.context.getCurrentTexture().createView();
            
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: textureView,
                    clearValue: { 
                        r: settings.colors.backgroundColor[0] / 255, 
                        g: settings.colors.backgroundColor[1] / 255, 
                        b: settings.colors.backgroundColor[2] / 255, 
                        a: 1.0 
                    },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTexture.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            
            // Render terrain
            terrainRenderer.render(renderPass);
            
            renderPass.end();
            
            const commandBuffer = commandEncoder.finish();
            gpuContext.device.queue.submit([commandBuffer]);
            
            // Explicitly present (though this should happen automatically)
            // gpuContext.context.getCurrentTexture() already presents on next frame
            
            if (frameCount === 1) {
                console.log('First frame submitted to GPU');
                console.log('Context configured:', gpuContext.context);
            }
            
            requestAnimationFrame(render);
        }
        
        requestAnimationFrame(render);
        
    } catch (error) {
        console.error('Initialization error:', error);
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.innerHTML = `
            <h2>Initialization Error</h2>
            <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
            <p style="margin-top: 10px;">
                Make sure you're using:
                <ul style="list-style: none; margin-top: 5px;">
                    <li>• Chrome 113+</li>
                    <li>• Safari 17+ (macOS)</li>
                    <li>• Firefox 121+</li>
                </ul>
            </p>
        `;
    }
}

// Start application
init();
