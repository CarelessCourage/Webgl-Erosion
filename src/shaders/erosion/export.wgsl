// Writes the displayed terrain: layer base + erosion delta (upsampled from the
// simulation grid to the layer texture resolution).
// Output channels (read by terrain.wgsl for display, erosion maps and color groups):
//   r = height (texture units)
//   g = water depth (cell units)
//   b = flow paths: peak water discharge seen so far (cell units)
//   a = erosion delta (texture units): negative = carved away, positive = deposited

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
@group(0) @binding(4) var flowHistory: texture_2d<f32>;
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
    let flow = sampleBilinear(flowHistory, p).x;

    let base = textureLoad(layerBase, c, 0).x;
    let delta = (t.x - b) / T.heightUnits;

    textureStore(display, c, vec4f(base + delta, t.y, flow, delta));
}
