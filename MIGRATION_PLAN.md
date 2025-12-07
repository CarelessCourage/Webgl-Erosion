# WebGPU Migration Plan

## Overview
Migrating from WebGL + Webpack + Three.js to WebGPU + Vite + Custom Camera Controls

## Goals
1. ✅ Fix macOS compatibility (WebGPU has native Metal support)
2. ✅ Better performance (compute shaders, lower overhead)
3. ✅ Smaller bundle size (remove Three.js 500KB+)
4. ✅ Modern build tooling (Vite for faster dev experience)
5. ✅ Future-proof technology stack

## Phase 1: Project Setup ⏳

### 1.1 Initialize Vite Project
- [x] Create new Vite + TypeScript config
- [ ] Set up development server
- [ ] Configure build output
- [ ] Update package.json scripts

### 1.2 Dependencies
**Remove:**
- webpack, webpack-dev-server, webpack-glsl-loader
- three, three-orbitcontrols
- @types/webgl2 (WebGPU has built-in types)

**Keep:**
- gl-matrix (math library)
- dat-gui (UI controls)
- stats-js (performance monitoring)

**Add:**
- @webgpu/types (TypeScript definitions)
- vite

### 1.3 Project Structure
```
src/
├── main.ts                  # Entry point
├── core/
│   ├── GPUContext.ts        # WebGPU device/context setup
│   ├── Camera.ts            # Custom orbit camera (no Three.js)
│   └── Controls.ts          # Mouse/keyboard input handling
├── rendering/
│   ├── TerrainRenderer.ts   # Terrain mesh rendering
│   ├── WaterRenderer.ts     # Water surface rendering
│   └── Pipeline.ts          # Render pipeline management
├── simulation/
│   ├── SimulationManager.ts # Orchestrates compute passes
│   ├── FlowSimulation.ts    # Water flow compute shader
│   ├── SedimentTransport.ts # Sediment compute shader
│   └── ThermalErosion.ts    # Thermal erosion compute shader
├── shaders/
│   ├── terrain.wgsl         # Terrain vertex + fragment
│   ├── water.wgsl           # Water rendering
│   ├── flow.wgsl            # Flow simulation (compute)
│   ├── sediment.wgsl        # Sediment transport (compute)
│   └── thermal.wgsl         # Thermal erosion (compute)
└── utils/
    ├── TextureManager.ts    # Texture creation/management
    └── BufferManager.ts     # Buffer utilities
```

## Phase 2: Core Systems 🔄

### 2.1 WebGPU Context Setup
**File:** `src/core/GPUContext.ts`

```typescript
export class GPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  
  async initialize(canvas: HTMLCanvasElement) {
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    // Configure context...
  }
}
```

**Key differences from WebGL:**
- Async initialization (must await device)
- No "context lost" issues like WebGL
- Explicit pipeline creation (more verbose but clearer)

### 2.2 Custom Camera (Replace Three.js)
**File:** `src/core/Camera.ts`

Replace ~50KB of Three.js with ~300 lines:
- Orbit rotation (spherical coordinates)
- Pan (screen-space translation)
- Zoom (distance to target)
- Smooth damping
- View matrix generation

**Key Features:**
```typescript
class OrbitCamera {
  position: vec3;
  target: vec3;
  up: vec3;
  distance: number;
  azimuth: number;    // horizontal angle
  elevation: number;  // vertical angle
  
  getViewMatrix(): mat4;
  handleMouseDown(e: MouseEvent);
  handleMouseMove(e: MouseEvent);
  handleWheel(e: WheelEvent);
  update(deltaTime: number); // apply damping
}
```

### 2.3 Input Controls
**File:** `src/core/Controls.ts`

Handle mouse/keyboard input independently:
- Mouse button tracking
- Keyboard state
- Event listeners
- Dispatch to camera and UI

## Phase 3: Shader Conversion 🎨

### 3.1 GLSL → WGSL Syntax Changes

| GLSL (WebGL)              | WGSL (WebGPU)                    |
|---------------------------|----------------------------------|
| `#version 300 es`         | (not needed)                     |
| `in vec2 fs_Pos;`         | `@location(0) fs_Pos: vec2f`    |
| `out vec4 fragColor;`     | `@location(0) -> vec4f`          |
| `uniform float u_Time;`   | `@group(0) @binding(0) var<uniform> u_Time: f32;` |
| `texture(sampler, uv)`    | `textureSample(tex, samp, uv)`   |
| `vec3(1.0)`               | `vec3f(1.0)`                     |
| `mat4`                    | `mat4x4f`                        |

### 3.2 Shader Migration Priority

**Phase 1 - Rendering (fragment + vertex):**
1. `terrain.wgsl` - terrain mesh rendering (from terrain-vert.glsl + terrain-frag.glsl)
2. `water.wgsl` - water surface (from water-vert.glsl + water-frag.glsl)
3. `quad.wgsl` - fullscreen quad (from quad-vert.glsl + flat-frag.glsl)

**Phase 2 - Simulation (compute):**
4. `flow.wgsl` - water flow (from flow-frag.glsl)
5. `sediment.wgsl` - sediment transport (from sediment-frag.glsl)
6. `thermal.wgsl` - thermal erosion (from thermalapply-frag.glsl)
7. `evaporation.wgsl` - water evaporation (from eva-frag.glsl)

### 3.3 Compute Shader Benefits

WebGL approach (fragment shader):
```glsl
// Must render to texture using a fullscreen quad
layout(location = 0) out vec4 output;
void main() {
  vec2 uv = fs_Pos * 0.5 + 0.5;
  // compute...
  output = result;
}
```

WebGPU approach (compute shader):
```wgsl
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let pos = id.xy;
  // Direct buffer/texture writes, no quad needed!
  textureStore(output, pos, result);
}
```

**Advantages:**
- No geometry overhead (no quad)
- Better thread utilization
- More natural for simulation workloads
- Can use storage buffers (easier than textures sometimes)

## Phase 4: Rendering System 🖼️

### 4.1 Terrain Renderer
**File:** `src/rendering/TerrainRenderer.ts`

```typescript
class TerrainRenderer {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  
  async initialize(device: GPUDevice) {
    // Create pipeline with terrain.wgsl
    // Set up vertex/index buffers
    // Create bind groups for uniforms/textures
  }
  
  render(encoder: GPUCommandEncoder, heightTexture: GPUTexture) {
    const pass = encoder.beginRenderPass({...});
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(indexCount);
    pass.end();
  }
}
```

### 4.2 Multiple Render Targets (MRT)

WebGL way:
```typescript
gl.drawBuffers([
  gl.COLOR_ATTACHMENT0,
  gl.COLOR_ATTACHMENT1,
  gl.COLOR_ATTACHMENT2
]);
```

WebGPU way:
```typescript
const renderPassDescriptor: GPURenderPassDescriptor = {
  colorAttachments: [
    { view: texture0.createView(), loadOp: 'clear', storeOp: 'store' },
    { view: texture1.createView(), loadOp: 'clear', storeOp: 'store' },
    { view: texture2.createView(), loadOp: 'clear', storeOp: 'store' },
  ]
};
```

WGSL shader:
```wgsl
struct FragmentOutput {
  @location(0) terrain: vec4f,
  @location(1) sediment: vec4f,
  @location(2) normal: vec4f
}

@fragment
fn main() -> FragmentOutput {
  var output: FragmentOutput;
  output.terrain = ...;
  output.sediment = ...;
  output.normal = ...;
  return output;
}
```

## Phase 5: Simulation System ⚙️

### 5.1 Compute Pipeline Architecture

Instead of multiple render passes with quads, use compute shaders:

```typescript
class SimulationManager {
  flowPipeline: GPUComputePipeline;
  sedimentPipeline: GPUComputePipeline;
  thermalPipeline: GPUComputePipeline;
  
  // Textures for simulation state
  heightTexture: GPUTexture;
  waterTexture: GPUTexture;
  velocityTexture: GPUTexture;
  sedimentTexture: GPUTexture;
  
  step(encoder: GPUCommandEncoder) {
    // 1. Water flow simulation
    const flowPass = encoder.beginComputePass();
    flowPass.setPipeline(this.flowPipeline);
    flowPass.setBindGroup(0, this.flowBindGroup);
    flowPass.dispatchWorkgroups(simWidth/8, simHeight/8);
    flowPass.end();
    
    // 2. Sediment transport
    const sedPass = encoder.beginComputePass();
    // ...
    
    // 3. Thermal erosion
    const thermalPass = encoder.beginComputePass();
    // ...
  }
}
```

### 5.2 Texture Ping-Pong

Many simulation steps need to read from one texture and write to another:

```typescript
class PingPongTexture {
  read: GPUTexture;
  write: GPUTexture;
  
  swap() {
    [this.read, this.write] = [this.write, this.read];
  }
}
```

### 5.3 Storage Buffers vs Textures

WebGPU allows both:
- **Textures:** Good for spatial data with filtering
- **Storage Buffers:** Better for raw data, easier indexing

Example - height map could be either:
```wgsl
// Texture approach
@group(0) @binding(0) var heightMap: texture_storage_2d<rgba32float, read>;
let height = textureLoad(heightMap, pos).r;

// Buffer approach
@group(0) @binding(0) var<storage, read> heights: array<f32>;
let height = heights[pos.y * width + pos.x];
```

For this project, textures probably make more sense (spatial coherence, filtering).

## Phase 6: Build Configuration ⚡

### 6.1 Vite Configuration
**File:** `vite.config.ts`

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
  // WGSL shader loading
  assetsInclude: ['**/*.wgsl'],
});
```

### 6.2 WGSL Module Loading

Option 1 - Import as string:
```typescript
import terrainShader from './shaders/terrain.wgsl?raw';
```

Option 2 - Fetch dynamically:
```typescript
const shader = await fetch('./shaders/terrain.wgsl').then(r => r.text());
```

### 6.3 Package.json Updates

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "@webgpu/types": "^0.1.40"
  },
  "dependencies": {
    "gl-matrix": "^3.4.3",
    "dat.gui": "^0.7.9",
    "stats-js": "^1.0.1"
  }
}
```

## Phase 7: Migration Steps 📋

### Step-by-step execution plan:

**Week 1: Foundation**
- [ ] Day 1-2: Set up Vite + WebGPU project structure
- [ ] Day 3-4: Implement GPUContext and custom OrbitCamera
- [ ] Day 5: Create basic triangle rendering test

**Week 2: Rendering**
- [ ] Day 1-2: Convert terrain shaders to WGSL
- [ ] Day 3-4: Implement TerrainRenderer with heightmap
- [ ] Day 5: Add water surface rendering

**Week 3: Simulation**
- [ ] Day 1-2: Convert flow simulation to compute shader
- [ ] Day 3-4: Implement sediment transport
- [ ] Day 5: Add thermal erosion

**Week 4: Polish & Testing**
- [ ] Day 1-2: UI integration (dat.gui)
- [ ] Day 3: Performance optimization
- [ ] Day 4-5: Testing on macOS, Windows, Linux

## Phase 8: Testing & Validation ✅

### 8.1 Compatibility Testing
- [ ] macOS Safari (primary target!)
- [ ] macOS Chrome
- [ ] macOS Firefox
- [ ] Windows Chrome
- [ ] Linux Firefox

### 8.2 Performance Targets
- 60 FPS at 1024x1024 simulation resolution
- < 100ms initialization time
- < 5MB bundle size (vs current ~2MB but with Three.js removed should be similar)

### 8.3 Feature Parity Checklist
- [ ] Terrain generation (noise, FBM)
- [ ] Water flow simulation
- [ ] Sediment transport
- [ ] Thermal erosion
- [ ] Rain simulation
- [ ] Evaporation
- [ ] User brush editing
- [ ] Permanent water sources
- [ ] Debug views
- [ ] Camera controls (orbit, pan, zoom)
- [ ] UI controls (sliders, buttons)

## Phase 9: Deployment 🚀

### 9.1 Build Output
```bash
npm run build
# Outputs to dist/
# - index.html
# - assets/*.js (code-split)
# - assets/*.wgsl (shaders)
```

### 9.2 GitHub Pages
Update deployment to use Vite build output.

## Key Improvements Summary

| Aspect | Before (WebGL) | After (WebGPU) |
|--------|----------------|----------------|
| **macOS Support** | ❌ Broken | ✅ Native Metal |
| **Bundle Size** | ~2MB (with Three.js) | ~1.5MB (no Three.js) |
| **Dev Server** | Webpack (slow) | Vite (instant HMR) |
| **Simulation** | Fragment shaders | Compute shaders |
| **Build Time** | ~1.5s | ~200ms |
| **Performance** | Baseline | +30-50% faster |

## Risk Mitigation

### Browser Support
- WebGPU available in Chrome 113+, Safari 17+, Firefox 121+
- Add feature detection on page load
- Show clear error message if unsupported

### Development Complexity
- Larger initial learning curve (WebGPU is more verbose)
- Better structure and separation of concerns
- More explicit = easier to debug

### Migration Risks
- Shader conversion bugs (careful testing needed)
- Compute shader workgroup size optimization
- Different texture coordinate systems (top-left vs bottom-left)

## Resources

- [WebGPU Fundamentals](https://webgpufundamentals.org/)
- [WGSL Spec](https://www.w3.org/TR/WGSL/)
- [WebGPU Best Practices](https://toji.dev/webgpu-best-practices/)
- [Vite Documentation](https://vitejs.dev/)

---

**Next Steps:** Create initial Vite setup and WebGPU context scaffolding.
