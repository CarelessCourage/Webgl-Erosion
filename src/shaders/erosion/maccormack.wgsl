// Step 4 (cont.): MacCormack correction of the semi-Lagrangian result, clamped to
// the neighbourhood of the back-traced position to stay stable.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var velocity: texture_2d<f32>;
@group(0) @binding(2) var sediment: texture_2d<f32>;
@group(0) @binding(3) var forward: texture_2d<f32>;
@group(0) @binding(4) var backward: texture_2d<f32>;
@group(0) @binding(5) var sedimentOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(sediment));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let vel = textureLoad(velocity, c, 0).xy;
    let p = vec2f(c) - vel * P.dt / P.pipeLen;
    let base = vec2i(floor(p));
    let n0 = loadClamped(sediment, base).x;
    let n1 = loadClamped(sediment, base + vec2i(1, 0)).x;
    let n2 = loadClamped(sediment, base + vec2i(0, 1)).x;
    let n3 = loadClamped(sediment, base + vec2i(1, 1)).x;
    let lo = min(min(n0, n1), min(n2, n3));
    let hi = max(max(n0, n1), max(n2, n3));

    let current = textureLoad(sediment, c, 0).x;
    let corrected = textureLoad(forward, c, 0).x + 0.5 * (current - textureLoad(backward, c, 0).x);
    let result = max(clamp(corrected, lo, hi), 0.0);

    textureStore(sedimentOut, c, vec4f(result, 0.0, 0.0, 0.0));
}
