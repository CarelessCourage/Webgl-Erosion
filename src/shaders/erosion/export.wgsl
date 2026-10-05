// Writes the displayed terrain: layer base + erosion delta (upsampled from the
// simulation grid to the layer texture resolution).
// Output channels: r = height (texture units), g = water depth (cell units),
// b = suspended sediment, a = 1.

struct TransferParams {
    heightUnits: f32,
    prevHeightUnits: f32,
    keepState: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> T: TransferParams;
@group(0) @binding(1) var layerBase: texture_2d<f32>;
@group(0) @binding(2) var terrain: texture_2d<f32>;
@group(0) @binding(3) var simBase: texture_2d<f32>;
@group(0) @binding(4) var sediment: texture_2d<f32>;
@group(0) @binding(5) var display: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(layerBase));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let uv = (vec2f(c) + 0.5) / vec2f(d);
    let p = uv * vec2f(textureDimensions(terrain)) - 0.5;
    let t = sampleBilinear(terrain, p);
    let b = sampleBilinear(simBase, p).x;
    let s = sampleBilinear(sediment, p).x;

    let base = textureLoad(layerBase, c, 0).x;
    let height = base + (t.x - b) / T.heightUnits;

    textureStore(display, c, vec4f(height, t.y, s, 1.0));
}
