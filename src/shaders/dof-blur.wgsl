// Depth of Field: thin-lens circle of confusion + separable Gaussian blur, with
// autofocus. Entry points:
//   focusMain - 1 thread: measures the focus distance and eases towards it
//   blurMain  - separable blur pass (run horizontally, then vertically)

struct DOFUniforms {
    focalOffset: f32,     // World units added to the focus distance
    focalRange: f32,      // World units around the focus distance that stay sharp
    farStrength: f32,     // Multiplier for blur behind the focus plane
    nearStrength: f32,    // Multiplier for blur in front of the focus plane
    aperture: f32,        // Background blur in % of screen height (at the reference distance)
    cameraNear: f32,
    cameraFar: f32,
    targetDistance: f32,  // Camera distance to the orbit target (fallback focus)
    direction: vec2f,     // (1,0) horizontal or (0,1) vertical
    focusPoint: vec2f,    // Pixel to autofocus on
    autofocus: f32,       // 1 = focus on the depth at focusPoint, 0 = orbit target
    focusBlend: f32,      // 0-1 easing towards the measured focus this frame
    maxRadius: f32,       // Blur radius limit in pixels
    _pad: f32,
}

struct FocusState {
    distance: f32,
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_depth_2d;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> uniforms: DOFUniforms;
@group(0) @binding(4) var<storage, read_write> focus: FocusState;

// Focus distance where the aperture setting gives exactly its nominal blur
const REFERENCE_DISTANCE: f32 = 15.0;
const MAX_TAPS: i32 = 16;

// The camera uses gl-matrix's OpenGL-style projection (NDC z in [-1, 1]);
// WebGPU stores that NDC z directly in the depth buffer.
fn linearizeDepth(depth: f32) -> f32 {
    let n = uniforms.cameraNear;
    let f = uniforms.cameraFar;
    return (2.0 * n * f) / ((f + n) - depth * (f - n));
}

// Circle of confusion radius in pixels (thin lens: proportional to
// |z - zf| / z, and larger when focusing closer, like a macro lens).
fn cocRadius(depth: f32, screenHeight: f32) -> f32 {
    let z = linearizeDepth(depth);
    let zf = max(focus.distance + uniforms.focalOffset, uniforms.cameraNear * 10.0);
    let dz = z - zf;
    let outside = max(abs(dz) - uniforms.focalRange, 0.0);
    let strength = select(uniforms.nearStrength, uniforms.farStrength, dz > 0.0);
    let coc = uniforms.aperture * strength * (REFERENCE_DISTANCE / zf) * outside / z;
    return min(coc * 0.01 * screenHeight, uniforms.maxRadius);
}

@compute @workgroup_size(1)
fn focusMain() {
    var measured = uniforms.targetDistance;

    if (uniforms.autofocus > 0.5) {
        // Average a few samples around the focus point; ignore the sky
        let size = vec2i(textureDimensions(depthTexture));
        let center = vec2i(uniforms.focusPoint);
        let spread = max(size.y / 100, 1);
        var total = 0.0;
        var count = 0.0;
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let p = clamp(center + vec2i(x, y) * spread, vec2i(0), size - 1);
                let d = textureLoad(depthTexture, p, 0);
                if (d < 1.0) {
                    total += linearizeDepth(d);
                    count += 1.0;
                }
            }
        }
        if (count > 0.0) {
            measured = total / count;
        }
    }

    if (focus.distance <= 0.0) {
        focus.distance = measured;
    } else {
        focus.distance = mix(focus.distance, measured, uniforms.focusBlend);
    }
}

@compute @workgroup_size(8, 8)
fn blurMain(@builtin(global_invocation_id) global_id: vec3u) {
    let texSize = textureDimensions(inputTexture);
    if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
        return;
    }
    let coord = vec2i(global_id.xy);
    let maxCoord = vec2i(texSize) - 1;

    let radius = cocRadius(textureLoad(depthTexture, coord, 0), f32(texSize.y));
    if (radius < 0.5) {
        textureStore(outputTexture, coord, textureLoad(inputTexture, coord, 0));
        return;
    }

    // Gaussian covering +-2 sigma of the radius, with enough taps to avoid gaps
    let taps = min(i32(ceil(radius)), MAX_TAPS);
    let stepSize = radius / f32(taps);
    let sigma = radius * 0.5;

    var result = vec4f(0.0);
    var totalWeight = 0.0;
    for (var i = -taps; i <= taps; i++) {
        let offset = f32(i) * stepSize;
        let samplePos = clamp(coord + vec2i(round(uniforms.direction * offset)), vec2i(0), maxCoord);
        let weight = exp(-0.5 * (offset * offset) / (sigma * sigma));
        result += textureLoad(inputTexture, samplePos, 0) * weight;
        totalWeight += weight;
    }

    textureStore(outputTexture, coord, result / totalWeight);
}
