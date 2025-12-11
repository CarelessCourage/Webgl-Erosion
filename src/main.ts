import { GPUContext } from "./core/GPUContext";
import { OrbitCamera } from "./core/Camera";
import { Settings } from "./core/Settings";
import { LayerCompute } from "./core/LayerCompute";
import { ErosionSimulationMultiPass as ErosionSimulation } from "./simulation/ErosionSimulation.multipass.js";
import { DepthOfFieldPass } from "./rendering/DepthOfFieldPass";
import { BlitPass } from "./rendering/BlitPass";
import { vec3, mat4 } from "gl-matrix";
import { createPlane } from "./geometry/Plane";
import { TerrainRenderer } from "./rendering/TerrainRenderer";

/**
 * Convert hex color string to RGB array
 */
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : [0, 0, 0];
}

/**
 * Main entry point for WebGPU Terrain Erosion
 */

// Get DOM elements
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const loadingDiv = document.getElementById("loading")!;
const errorDiv = document.getElementById("error")!;

// Resize canvas to fill window
function resizeCanvas() {
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  console.log(
    `Canvas resized: ${canvas.width}x${canvas.height} (display: ${window.innerWidth}x${window.innerHeight})`
  );
}

async function init() {
  console.log("🚨🚨🚨 INIT FUNCTION STARTING - VERSION 2 🚨🚨🚨");
  console.log("🚨🚨🚨 IF YOU SEE THIS LOG, THE CODE IS UPDATING 🚨🚨🚨");

  try {
    // Check WebGPU support
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported");
    }

    // Resize canvas
    console.log("About to resize canvas...");
    resizeCanvas();
    console.log("Canvas resized, adding event listener");
    window.addEventListener("resize", resizeCanvas);

    // Initialize WebGPU context
    const gpuContext = new GPUContext(canvas);
    const success = await gpuContext.initialize();

    if (!success) {
      throw new Error("Failed to initialize WebGPU");
    }

    // Initialize camera at midpoint of min/max distance (17.5)
    const initialDistance = 17.5;
    const camera = new OrbitCamera(
      vec3.fromValues(
        0,
        initialDistance * Math.sin(Math.PI / 4),
        initialDistance * Math.cos(Math.PI / 4)
      ),
      vec3.fromValues(0, 0, 0)
    );
    camera.setAspectRatio(canvas.width / canvas.height);

    // Set up mouse controls (modified for rain tool compatibility)
    let isMouseDown = false;

    // Prevent context menu on right click
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Mouse rain tool controls
    let rainToolActive = false;
    let continuousRainMode = false;

    // Keyboard controls for rain tool
    window.addEventListener("keydown", (e) => {
      if (e.key === "c" || e.key === "C") {
        if (!rainToolActive) {
          rainToolActive = true;
          erosionSimulation.setMouseRainTool(true);
          canvas.style.cursor = "crosshair";
          console.log("Rain tool activated - click to add water!");
        }
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.key === "c" || e.key === "C") {
        rainToolActive = false;
        continuousRainMode = false;
        erosionSimulation.setMouseRainTool(false);
        erosionSimulation.stopContinuousRain();
        canvas.style.cursor = "default";
        console.log("Rain tool deactivated");
      }
    });

    // Mouse click for rain placement
    canvas.addEventListener("click", (e) => {
      if (rainToolActive) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        // Convert to terrain coordinates (Y is flipped for texture coords)
        const terrainX = x;
        const terrainY = 1.0 - y;

        erosionSimulation.addRainAtPosition(terrainX, terrainY);
        console.log(
          `Rain added at terrain position: (${terrainX.toFixed(
            3
          )}, ${terrainY.toFixed(3)})`
        );
      }
    });

    // Continuous rain on mouse hold
    canvas.addEventListener("mousedown", (e) => {
      if (rainToolActive && e.button === 0) {
        // Left mouse button
        continuousRainMode = true;
        e.preventDefault(); // Prevent camera controls

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const terrainX = x;
        const terrainY = 1.0 - y;

        erosionSimulation.startContinuousRainAtPosition(terrainX, terrainY);
      } else {
        isMouseDown = true;
        camera.handleMouseDown(e, canvas);
      }
    });

    // Update rain position on mouse move
    canvas.addEventListener("mousemove", (e) => {
      if (continuousRainMode && rainToolActive) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const terrainX = x;
        const terrainY = 1.0 - y;

        erosionSimulation.startContinuousRainAtPosition(terrainX, terrainY);
      } else if (isMouseDown && !rainToolActive) {
        camera.handleMouseMove(e, canvas);
      }
    });

    // Stop continuous rain
    canvas.addEventListener("mouseup", (e) => {
      if (continuousRainMode) {
        continuousRainMode = false;
        erosionSimulation.stopContinuousRain();
      } else {
        isMouseDown = false;
        camera.handleMouseUp(e);
      }
    });

    // Wheel controls (always active)
    canvas.addEventListener("wheel", (e) => {
      camera.handleWheel(e);
    });

    // Hide loading screen
    loadingDiv.style.display = "none";

    console.log("✓ WebGPU initialization successful!");
    console.log("✓ Camera controls active");

    // Create terrain geometry
    const planeGeometry = createPlane(
      vec3.fromValues(0, 0, 0), // center
      [10, 10], // scale
      10 // subdivisions (2^(10/2) = 32x32 grid = 1024 vertices)
    );

    console.log("Plane bounds:", {
      minX: -5,
      maxX: 5,
      minZ: -5,
      maxZ: 5,
      vertices: planeGeometry.vertexCount,
      triangles: planeGeometry.indexCount / 3,
    });

    // Create terrain renderer
    const terrainRenderer = new TerrainRenderer(gpuContext, planeGeometry);

    // Create layer compute system for erosion simulation
    console.log("Initializing layer compute and erosion simulation...");
    console.log(
      "🔍 GPU Device Features:",
      Array.from(gpuContext.device.features)
    );
    console.log("🔍 GPU Device Limits:", gpuContext.device.limits);

    // Create settings panel first (with default values)
    const settings = new Settings(camera);
    
    // Now create LayerCompute with resolution from settings
    const layerCompute = new LayerCompute(gpuContext, settings.visualization.textureResolution);
    console.log("✅ LayerCompute created successfully");

    console.log("🚀 About to create ErosionSimulation...");
    const erosionSimulation = new ErosionSimulation(gpuContext, layerCompute);
    console.log("✓ Erosion simulation initialized");
    
    // Set erosion simulation reference in settings after it's created
    settings.erosionSimulation = erosionSimulation;

    // Connect erosion system to terrain renderer for height texture sampling
    terrainRenderer.setLayerCompute(layerCompute);
    console.log("🔗 Connected erosion system to terrain renderer");

    let currentMeshResolution = settings.terrain.meshResolution;
    let currentTextureResolution = settings.visualization.textureResolution;

    settings.onRegenerate(async () => {
      // Check if texture resolution changed - requires recreating LayerCompute
      if (settings.visualization.textureResolution !== currentTextureResolution) {
        currentTextureResolution = settings.visualization.textureResolution;
        console.log(`🔄 Recreating LayerCompute with resolution ${currentTextureResolution}x${currentTextureResolution}`);
        
        // Create new LayerCompute with new resolution
        const newLayerCompute = new LayerCompute(gpuContext, currentTextureResolution);
        
        // Update erosion simulation with new layer compute
        erosionSimulation.setLayerCompute(newLayerCompute);
        
        // Update terrain renderer
        terrainRenderer.setLayerCompute(newLayerCompute);
        
        console.log("✓ LayerCompute recreated with new resolution");
      }
      
      // Check if mesh resolution changed
      if (settings.terrain.meshResolution !== currentMeshResolution) {
        currentMeshResolution = settings.terrain.meshResolution;
        const newGeometry = createPlane(
          vec3.fromValues(0, 0, 0),
          [10, 10],
          settings.terrain.meshResolution
        );
        console.log("Mesh updated:", {
          resolution: settings.terrain.meshResolution,
          vertices: newGeometry.vertexCount,
          triangles: newGeometry.indexCount / 3,
        });
        terrainRenderer.updateGeometry(newGeometry);
      }

      // Generate terrain using layer system
      await terrainRenderer.generateTerrainFromLayers(settings.layerStack);
    });

    // Handle image uploads for image layers
    let imageLayerIndex = 0;
    settings.onImageUpload((imageData: ImageData, layerId: string) => {
      terrainRenderer.uploadImageForLayer(imageData, imageLayerIndex);
      // Update the layer to reference the correct texture array index
      settings.layerStack.updateLayer(layerId, {
        imageIndex: imageLayerIndex,
      } as any);
      imageLayerIndex = (imageLayerIndex + 1) % 4; // Cycle through available slots
    });

    // Generate initial terrain using layer system
    console.log("Generating initial terrain...");
    await terrainRenderer.generateTerrainFromLayers(settings.layerStack);
    console.log("✓ Initial terrain generated from layers");

    // Create depth of field pass
    const dofPass = new DepthOfFieldPass(gpuContext.device);
    dofPass.resize(canvas.width, canvas.height);
    console.log("✓ Depth of Field pass initialized");

    // Create blit pass for final texture copy (RGBA -> BGRA)
    const blitPass = new BlitPass(gpuContext.device, 'bgra8unorm');
    console.log("✓ Blit pass initialized");

    // Create depth texture
    let depthTexture = gpuContext.device.createTexture({
      size: { width: canvas.width, height: canvas.height },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Create offscreen color texture for DOF (bgra8unorm to match pipeline)
    let offscreenTexture = gpuContext.device.createTexture({
      size: { width: canvas.width, height: canvas.height },
      format: "bgra8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Create persistent DOF output texture (RGBA storage)
    let dofOutputTexture = gpuContext.device.createTexture({
      size: { width: canvas.width, height: canvas.height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Handle window resize
    const originalResize = resizeCanvas;
    const handleResize = () => {
      originalResize();
      // Recreate depth texture on resize
      depthTexture.destroy();
      depthTexture = gpuContext.device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      // Recreate offscreen texture on resize
      offscreenTexture.destroy();
      offscreenTexture = gpuContext.device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: "bgra8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      // Recreate DOF output texture on resize
      dofOutputTexture.destroy();
      dofOutputTexture = gpuContext.device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      // Resize DOF pass
      dofPass.resize(canvas.width, canvas.height);
      camera.setAspectRatio(canvas.width / canvas.height);
    };

    // Replace the resize event listener
    window.removeEventListener("resize", resizeCanvas);
    window.addEventListener("resize", handleResize);

    console.log("✓ Terrain initialized, starting render loop");

    // Render loop
    console.log("✓ Terrain initialized, starting render loop");

    // Render loop
    let lastTime = performance.now();
    let frameCount = 0;
    function render(currentTime: number) {
      const deltaTime = (currentTime - lastTime) * 0.001;
      lastTime = currentTime;

      // Update camera
      camera.update(deltaTime);

      // Step erosion simulation if running
      erosionSimulation.step();

      // Debug first frame
      if (frameCount === 0) {
        console.log("First frame render:");
        console.log("Camera position:", camera.position);
        console.log("Camera target:", camera.target);
        console.log("View matrix:", camera.viewMatrix);
        console.log("Projection matrix:", camera.projectionMatrix);
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
      mat4.lookAt(
        lightViewMatrix,
        lightPosition,
        lightTarget,
        vec3.fromValues(0, 1, 0)
      );

      // Orthographic projection for directional light
      // Terrain is 10x10 (-5 to 5), so we need enough coverage
      const lightProjMatrix = mat4.create();
      const halfSize = 8.0; // Cover the terrain with some margin
      // gl-matrix ortho: left, right, bottom, top, near, far
      mat4.ortho(
        lightProjMatrix,
        -halfSize,
        halfSize,
        -halfSize,
        halfSize,
        0.1,
        50.0
      );

      const lightViewProjMatrix = mat4.create();
      mat4.multiply(lightViewProjMatrix, lightProjMatrix, lightViewMatrix);

      if (frameCount === 1) {
        console.log("Model matrix:", modelMatrix);
        console.log("ViewProj matrix:", viewProjMatrix);
        console.log("Light position:", lightPosition);
        console.log("Light direction:", lightDirection);
        console.log("Light ViewProj matrix:", lightViewProjMatrix);
        console.log("Rendering", planeGeometry.indexCount, "indices");
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
        hexToRgb(settings.colors.lowColor),
        hexToRgb(settings.colors.midColor),
        hexToRgb(settings.colors.highColor),
        hexToRgb(settings.colors.bottomColor),
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

      // Determine render target based on DOF setting
      const finalTextureView = gpuContext.context.getCurrentTexture().createView();
      const renderTargetView = settings.depthOfField.enabled 
        ? offscreenTexture.createView() 
        : finalTextureView;

      // Main scene render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: renderTargetView,
            clearValue: {
              r: hexToRgb(settings.colors.backgroundColor)[0] / 255,
              g: hexToRgb(settings.colors.backgroundColor)[1] / 255,
              b: hexToRgb(settings.colors.backgroundColor)[2] / 255,
              a: 1.0,
            },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      // Render terrain
      terrainRenderer.render(renderPass);

      renderPass.end();

      // Apply depth of field if enabled
      if (settings.depthOfField.enabled) {
        dofPass.apply(
          commandEncoder,
          offscreenTexture,
          depthTexture,
          dofOutputTexture,
          settings.depthOfField
        );

        // Use blit pass to copy RGBA to BGRA canvas
        blitPass.blit(commandEncoder, dofOutputTexture, finalTextureView);
      }

      const commandBuffer = commandEncoder.finish();
      gpuContext.device.queue.submit([commandBuffer]);

      // Explicitly present (though this should happen automatically)
      // gpuContext.context.getCurrentTexture() already presents on next frame

      if (frameCount === 1) {
        console.log("First frame submitted to GPU");
        console.log("Context configured:", gpuContext.context);
      }

      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  } catch (error) {
    console.error("Initialization error:", error);
    loadingDiv.style.display = "none";
    errorDiv.style.display = "block";
    errorDiv.innerHTML = `
            <h2>Initialization Error</h2>
            <p>${error instanceof Error ? error.message : "Unknown error"}</p>
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
