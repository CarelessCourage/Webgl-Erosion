// Step 1 (Mei et al. 3.1): water increment from global rain and the rain brush.
// Global rain can be weighted by altitude so it falls mostly on the peaks.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrainIn: texture_2d<f32>;
@group(0) @binding(2) var terrainOut: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = textureDimensions(terrainIn);
    if (id.x >= d.x || id.y >= d.y) {
        return;
    }
    let c = vec2i(id.xy);
    let t = textureLoad(terrainIn, c, 0);

    var rain = P.rainRate;
    if (P.rainOnPeaks > 0.0 && P.rainHeightMax > P.rainHeightMin) {
        let altitude = clamp((t.x - P.rainHeightMin) / (P.rainHeightMax - P.rainHeightMin), 0.0, 1.0);
        // Average weight stays ~1 so the total amount of rain is similar
        rain *= mix(1.0, 2.0 * altitude, P.rainOnPeaks);
    }
    var water = t.y + rain * P.dt;

    if (P.brushActive > 0.5 && P.brushRadius > 0.0) {
        let uv = (vec2f(c) + 0.5) / vec2f(d);
        let dist = distance(uv, vec2f(P.brushX, P.brushY));
        if (dist < P.brushRadius) {
            let falloff = 1.0 - smoothstep(0.0, P.brushRadius, dist);
            water += P.brushStrength * falloff * P.dt;
        }
    }

    textureStore(terrainOut, c, vec4f(t.x, water, 0.0, 0.0));
}
