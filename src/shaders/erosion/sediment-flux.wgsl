// Step 4 (mass-conserving variant of Mei et al. 3.4): sediment travels with the
// water. Each cell sends the same fraction of its suspended sediment through each
// pipe as the fraction of its water that left through that pipe this step, so
// sediment is never created or destroyed in transit (the semi-Lagrangian
// advection in the paper loses most of it in narrow channels).

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;    // water depth after the flow update (g)
@group(0) @binding(2) var flux: texture_2d<f32>;       // water outflow flux this step
@group(0) @binding(3) var sediment: texture_2d<f32>;
@group(0) @binding(4) var sedimentFluxOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let area = P.pipeLen * P.pipeLen;
    let f = textureLoad(flux, c, 0);
    let outVolume = (f.x + f.y + f.z + f.w) * P.dt;
    let inVolume = (loadOrZero(flux, c + vec2i(-1, 0)).y
                  + loadOrZero(flux, c + vec2i(1, 0)).x
                  + loadOrZero(flux, c + vec2i(0, -1)).w
                  + loadOrZero(flux, c + vec2i(0, 1)).z) * P.dt;

    // Water volume at the start of the step (before in/outflow)
    let startVolume = textureLoad(terrain, c, 0).y * area + outVolume - inVolume;

    var out = vec4f(0.0);
    if (outVolume > 0.0 && startVolume > 1e-6) {
        let s = textureLoad(sediment, c, 0).x;
        let leaving = min(outVolume / startVolume, 1.0);
        out = f * (P.dt / outVolume) * leaving * s;
    }

    textureStore(sedimentFluxOut, c, out);
}
