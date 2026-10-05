// Maps the layer-generated base terrain into the simulation grid.
// With keepState = 1 the erosion already carved into the old base is carried
// over onto the new base (so editing layers doesn't throw away erosion).
// With keepState = 0 the simulation restarts from the base terrain.

struct TransferParams {
    heightUnits: f32,     // cell units per texture height unit (current)
    prevHeightUnits: f32, // cell units per texture height unit when the state was produced
    keepState: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> T: TransferParams;
@group(0) @binding(1) var layerBase: texture_2d<f32>;
@group(0) @binding(2) var terrainIn: texture_2d<f32>;
@group(0) @binding(3) var simBaseIn: texture_2d<f32>;
@group(0) @binding(4) var terrainOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var simBaseOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrainIn));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let uv = (vec2f(c) + 0.5) / vec2f(d);
    let p = uv * vec2f(textureDimensions(layerBase)) - 0.5;
    let newBase = sampleBilinear(layerBase, p).x * T.heightUnits;

    var height = newBase;
    var water = 0.0;
    if (T.keepState > 0.5) {
        let t = textureLoad(terrainIn, c, 0);
        let oldBase = textureLoad(simBaseIn, c, 0).x;
        let scale = T.heightUnits / max(T.prevHeightUnits, 1e-6);
        height = newBase + (t.x - oldBase) * scale;
        water = t.y;
    }

    textureStore(terrainOut, c, vec4f(height, water, 0.0, 0.0));
    textureStore(simBaseOut, c, vec4f(newBase, 0.0, 0.0, 0.0));
}
