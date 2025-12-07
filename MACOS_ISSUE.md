# WebGL Erosion macOS Compatibility Issue - Analysis & Solution

## Problem Summary

The WebGL Erosion simulation renders the terrain plane on macOS but the erosion simulation does not update/work. The terrain remains static.

## Root Cause

The simulation uses **Multiple Render Targets (MRT) with floating-point textures** (RGBA32F) for the hydraulic erosion computations. This requires the `EXT_color_buffer_float` WebGL extension, which allows rendering to floating-point framebuffer attachments.

**On macOS**, this extension has known compatibility issues:
- Safari/WebKit: Limited or buggy support
- Chrome/Firefox on macOS: Better but still inconsistent depending on GPU
- Intel integrated GPUs: Often fail silently
- Older AMD/NVIDIA drivers: May report support but fail to render

The simulation performs these operations every frame:
1. Render water flow simulation to float texture
2. Render sediment transport to float texture  
3. Render terrain height updates to float texture
4. Multiple compute passes with MRT (4 color attachments)

When `EXT_color_buffer_float` fails, the framebuffer operations complete without errors but **don't actually update the textures**, causing the simulation to appear frozen.

## Changes Made

### 1. Enhanced Extension Checking (`src/main.ts`)

Added better error detection with user-friendly alerts:

```typescript
const colorBufferFloatExt = gl_context.getExtension('EXT_color_buffer_float');
if(!colorBufferFloatExt) {
    console.error("CRITICAL: EXT_color_buffer_float not supported");
    alert("Your browser/GPU does not support rendering to float textures...");
}
```

### 2. Improved Framebuffer Status Reporting (`src/main.ts`)

Added helper function to decode framebuffer status codes:

```typescript
function getFramebufferStatusString(gl: WebGL2RenderingContext, status: number): string {
    // Returns human-readable status like "FRAMEBUFFER_UNSUPPORTED"
}
```

Updated all framebuffer checks to use proper error logging instead of just console.log.

### 3. Updated Documentation (`README.md`)

Added clear explanation of the macOS issue and workarounds.

### 4. Created Diagnostic Tool (`webgl-test.html`)

A standalone HTML page that tests:
- WebGL 2.0 support
- Required extensions
- Float texture creation
- **Most importantly**: Framebuffer completeness with float textures

## How to Diagnose

1. **Open the diagnostic tool:**
   - Open `webgl-test.html` in your browser
   - It will show which features are supported/unsupported
   - Green = pass, Red = fail

2. **Check browser console:**
   - Open the main project
   - Look for errors mentioning "EXT_color_buffer_float" or "FRAMEBUFFER_UNSUPPORTED"
   - These confirm the float texture issue

3. **Try different browsers:**
   - Safari: Usually fails on macOS
   - Chrome: Better support but still GPU-dependent
   - Firefox: Sometimes works better than Chrome on macOS

## Workarounds for macOS Users

### Option 1: Use Windows (Recommended)
- Boot Camp or VM with GPU passthrough
- Full compatibility guaranteed

### Option 2: Try Different Browsers
- Chrome > Firefox > Safari (in order of likelihood to work)
- Update to latest browser version
- Enable hardware acceleration in browser settings

### Option 3: External GPU (eGPU)
- If you have an eGPU, it may have better driver support
- Still browser-dependent

### Option 4: Remote Desktop
- Access a Windows machine remotely
- Use cloud GPU services

## Why This Can't Be Easily "Fixed"

The issue is at the driver/OS level:

1. **Apple's Metal Graphics Layer**: macOS translates WebGL to Metal, and this translation layer has limitations with certain WebGL 2.0 features

2. **GPU Driver Limitations**: Even if the extension reports as "supported", the underlying implementation may be incomplete

3. **No Fallback Possible**: The simulation fundamentally requires float textures for precision. Using lower-precision textures (RGBA8) would break the physics calculations

## Technical Details

The simulation uses these framebuffer configurations:
- Single attachment: 1 RGBA32F texture (simple cases)
- Multiple attachments: Up to 4 RGBA32F textures (MRT for sediment simulation)

Each frame involves ~10-15 render-to-texture operations with different shader programs, creating a pipeline of image-space computations.

The shader `sediment-frag.glsl` outputs to 4 targets simultaneously:
```glsl
layout (location = 0) out vec4 writeTerrain;
layout (location = 1) out vec4 writeSediment;
layout (location = 2) out vec4 writeTerrainNormal;
layout (location = 3) out vec4 writeVelocity;
```

When framebuffer operations fail, these writes don't occur, leaving the simulation state unchanged.

## Verification Steps

After making changes:
1. Rebuild the project: `npm run build`
2. Open in browser and check console for new error messages
3. Run `webgl-test.html` to verify capabilities
4. If extension is missing, the issue is confirmed

## References

- [WebGL EXT_color_buffer_float](https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float)
- [WebGL Compatibility](https://webglreport.com/) - Check your browser's WebGL capabilities
- [Khronos WebGL Extensions Registry](https://www.khronos.org/registry/webgl/extensions/)
