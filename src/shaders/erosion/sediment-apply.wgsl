// Step 4 (cont.): apply the sediment fluxes. Whatever leaves a cell arrives in
// its neighbour; sediment leaving the map border (with draining water) is removed.

@group(0) @binding(0) var sediment: texture_2d<f32>;
@group(0) @binding(1) var sedimentFlux: texture_2d<f32>;
@group(0) @binding(2) var sedimentOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(sediment));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let f = textureLoad(sedimentFlux, c, 0);
    let inflow = loadOrZero(sedimentFlux, c + vec2i(-1, 0)).y
               + loadOrZero(sedimentFlux, c + vec2i(1, 0)).x
               + loadOrZero(sedimentFlux, c + vec2i(0, -1)).w
               + loadOrZero(sedimentFlux, c + vec2i(0, 1)).z;
    let outflow = f.x + f.y + f.z + f.w;

    let s = max(textureLoad(sediment, c, 0).x - outflow + inflow, 0.0);
    textureStore(sedimentOut, c, vec4f(s, 0.0, 0.0, 0.0));
}
