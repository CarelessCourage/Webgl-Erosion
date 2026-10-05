// Removes single-cell spikes and pits that the pipe model tends to create
// (ported from the original WebGL implementation's "average" pass). A cell is
// smoothed when it sticks out above or below both neighbours along any axis.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;
@group(0) @binding(2) var terrainOut: texture_storage_2d<rg32float, write>;

const DIAGONAL_WEIGHT: f32 = 0.707;
const CENTER_WEIGHT: f32 = 8.0;

fn isSpike(a: f32, b: f32, threshold: f32) -> bool {
    return abs(a) > threshold && abs(b) > threshold && a * b > 0.0;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let t = textureLoad(terrain, c, 0);
    var height = t.x;

    if (P.smoothThreshold > 0.0) {
        let l = loadClamped(terrain, c + vec2i(-1, 0)).x;
        let r = loadClamped(terrain, c + vec2i(1, 0)).x;
        let b = loadClamped(terrain, c + vec2i(0, -1)).x;
        let u = loadClamped(terrain, c + vec2i(0, 1)).x;
        let bl = loadClamped(terrain, c + vec2i(-1, -1)).x;
        let br = loadClamped(terrain, c + vec2i(1, -1)).x;
        let ul = loadClamped(terrain, c + vec2i(-1, 1)).x;
        let ur = loadClamped(terrain, c + vec2i(1, 1)).x;

        let h = t.x;
        let threshold = P.smoothThreshold;
        if (isSpike(h - l, h - r, threshold) || isSpike(h - b, h - u, threshold) ||
            isSpike(h - bl, h - ur, threshold) || isSpike(h - ul, h - br, threshold)) {
            let sum = h * CENTER_WEIGHT + l + r + b + u + (bl + br + ul + ur) * DIAGONAL_WEIGHT;
            height = sum / (CENTER_WEIGHT + 4.0 * (1.0 + DIAGONAL_WEIGHT));
        }
    }

    textureStore(terrainOut, c, vec4f(height, t.y, 0.0, 0.0));
}
