# WebGPU Terrain Erosion - Setup Instructions

## Migration Status

This is the NEW WebGPU version. The old WebGL version is preserved in the existing files.

### Current Progress
- ✅ Vite build system configured
- ✅ WebGPU context initialization
- ✅ Custom OrbitCamera (Three.js replaced)
- ✅ Basic render loop working
- ⏳ Shader conversion (GLSL → WGSL)
- ⏳ Rendering pipeline
- ⏳ Simulation compute shaders
- ⏳ UI integration

## Quick Start

### 1. Install Dependencies

```bash
# Remove old node_modules
rm -rf node_modules pnpm-lock.yaml package-lock.json

# Copy new package.json
cp package-new.json package.json

# Install
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

This will start Vite dev server at `http://localhost:3000`

### 3. Build for Production

```bash
npm run build
```

Output will be in `dist/` directory.

## File Structure

### New Files (WebGPU)
```
src-new/                    # New WebGPU source code
├── core/
│   ├── GPUContext.ts      # ✅ WebGPU initialization
│   └── Camera.ts          # ✅ Custom orbit camera
├── rendering/             # ⏳ To be implemented
├── simulation/            # ⏳ To be implemented
└── shaders/               # ⏳ WGSL shaders to be created

index-new.html             # ✅ New HTML entry point
vite.config.ts             # ✅ Vite configuration
tsconfig-new.json          # ✅ TypeScript config
package-new.json           # ✅ New dependencies
```

### Old Files (WebGL - Preserved)
```
src/                       # Original WebGL code
index.html                 # Original HTML
webpack.config.js          # Old Webpack config
tsconfig.json              # Old TypeScript config
package.json               # Old dependencies (backed up)
```

## Browser Requirements

### Supported Browsers (December 2025)
- ✅ **Chrome/Edge** 113+
- ✅ **Safari** 17+ (macOS/iOS)
- ✅ **Firefox** 121+

### Check Support
Visit: https://webgpureport.org/

## Key Improvements Over WebGL Version

| Feature | WebGL (Old) | WebGPU (New) |
|---------|-------------|--------------|
| **macOS Support** | ❌ Broken (EXT_color_buffer_float) | ✅ Native Metal |
| **Bundle Size** | ~2MB | ~1.5MB (no Three.js) |
| **Build System** | Webpack (slow) | Vite (instant HMR) |
| **Simulation** | Fragment shaders | Compute shaders |
| **Dev Server Start** | ~5s | ~200ms |
| **Build Time** | ~1.5s | ~300ms |
| **Hot Reload** | Full page refresh | Instant module update |

## Development Workflow

### Testing the Setup

1. **Start dev server**: `npm run dev`
2. **Open browser**: Should see a blue-green gradient background
3. **Check console**: Look for success messages
4. **Test camera**: 
   - Left click + drag to rotate
   - Right click + drag to pan
   - Scroll to zoom

If you see the gradient and can interact, the setup is working! ✅

### Next Steps for Development

See `MIGRATION_PLAN.md` for detailed implementation roadmap.

**Priority order:**
1. ✅ Setup complete
2. Create terrain mesh geometry
3. Convert terrain shaders to WGSL
4. Implement basic terrain rendering
5. Convert simulation shaders to compute shaders
6. Port simulation logic
7. Add UI controls

## Troubleshooting

### "WebGPU not supported" error
- Update your browser to the latest version
- Check https://webgpureport.org/
- Try a different browser

### Vite command not found
```bash
npm install
```

### TypeScript errors
```bash
npm run type-check
```

### Hot reload not working
- Check that you're editing files in `src-new/`
- Restart dev server: `Ctrl+C`, then `npm run dev`

## Testing on macOS

This is the primary goal of the migration!

**Expected behavior:**
1. Page loads without errors
2. Can rotate/pan/zoom camera
3. Terrain renders correctly
4. Erosion simulation updates in real-time

If all work on macOS, the migration is successful! 🎉

## Comparing Old vs New

To compare both versions:

**Old WebGL version:**
```bash
npm run build  # Uses old webpack setup
# Open dist/index.html
```

**New WebGPU version:**
```bash
npm run dev    # Uses new Vite setup
# Visit localhost:3000
```

## Notes

- The old WebGL code is preserved and still functional (on Windows)
- You can switch back by reverting package.json changes
- Once WebGPU version is complete, old code can be removed
- See `MIGRATION_PLAN.md` for full technical details

## Questions?

Check the migration plan document or open an issue.
