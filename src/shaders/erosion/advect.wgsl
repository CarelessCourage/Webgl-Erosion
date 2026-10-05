// Step 4 (Mei et al. 3.4): semi-Lagrangian sediment transport.
// Used twice per step for MacCormack advection: forward (sign = +1) and
// backward (sign = -1) through the same velocity field.

override ADVECT_SIGN: f32 = 1.0;

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var velocity: texture_2d<f32>;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var destination: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(source));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let vel = textureLoad(velocity, c, 0).xy;
    let p = vec2f(c) - ADVECT_SIGN * vel * P.dt / P.pipeLen;
    let value = sampleBilinear(source, p).x;

    textureStore(destination, c, vec4f(value, 0.0, 0.0, 0.0));
}
