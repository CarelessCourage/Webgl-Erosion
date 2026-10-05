// Applies thermal erosion flux (mass conserving) and evaporation (Mei et al. 3.5).

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;
@group(0) @binding(2) var thermalFlux: texture_2d<f32>;
@group(0) @binding(3) var terrainOut: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let f = textureLoad(thermalFlux, c, 0);
    let inflow = loadOrZero(thermalFlux, c + vec2i(-1, 0)).y
               + loadOrZero(thermalFlux, c + vec2i(1, 0)).x
               + loadOrZero(thermalFlux, c + vec2i(0, -1)).w
               + loadOrZero(thermalFlux, c + vec2i(0, 1)).z;
    let outflow = f.x + f.y + f.z + f.w;

    let t = textureLoad(terrain, c, 0);
    let height = t.x + inflow - outflow;
    let water = t.y * max(0.0, 1.0 - P.ke * P.dt);

    textureStore(terrainOut, c, vec4f(height, water, 0.0, 0.0));
}
