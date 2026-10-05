// Layer Combination Compute Shader for WebGPU
// Bakes the layer stack into the height texture (R = height).
// Layer evaluation lives in layers.wgsl, which is prepended at load time.

@group(0) @binding(0) var<storage, read> layers: array<Layer>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var imageTextures: texture_2d_array<f32>;
@group(0) @binding(3) var imageSampler: sampler;

@compute @workgroup_size(8, 8, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
    let texSize = textureDimensions(outputTexture);
    if (id.x >= texSize.x || id.y >= texSize.y) {
        return;
    }

    // Texel centres, matching how the terrain shader samples the texture
    let uv = (vec2f(id.xy) + 0.5) / vec2f(texSize);
    let height = calculateHeight(uv);

    // g/b/a are written by the erosion simulation (water, flow paths, erosion delta)
    textureStore(outputTexture, vec2i(id.xy), vec4f(height, 0.0, 0.0, 0.0));
}
