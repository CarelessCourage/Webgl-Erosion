// Thermal erosion (Št'ava et al. 2008): material on slopes steeper than the talus
// angle slides to lower neighbours. This pass computes the outgoing amounts.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;
@group(0) @binding(2) var thermalFluxOut: texture_storage_2d<rgba32float, write>;

fn excess(c: vec2i, d: vec2i, h: f32) -> f32 {
    if (!inBounds(c, d)) {
        return 0.0;
    }
    return max(0.0, h - textureLoad(terrain, c, 0).x - P.talusHeight);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let h = textureLoad(terrain, c, 0).x;
    let diffs = vec4f(
        excess(c + vec2i(-1, 0), d, h),
        excess(c + vec2i(1, 0), d, h),
        excess(c + vec2i(0, -1), d, h),
        excess(c + vec2i(0, 1), d, h)
    );

    let total = diffs.x + diffs.y + diffs.z + diffs.w;
    var out = vec4f(0.0);
    if (total > 0.0) {
        // Move at most half the largest excess so neighbours never overshoot.
        let maxDiff = max(max(diffs.x, diffs.y), max(diffs.z, diffs.w));
        let amount = min(1.0, P.thermalRate * P.dt) * 0.5 * maxDiff;
        out = diffs * (amount / total);
    }

    textureStore(thermalFluxOut, c, out);
}
