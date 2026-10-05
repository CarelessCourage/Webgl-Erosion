// Step 2 (Mei et al. 3.2.2 / 3.2.3): update water depth from the net flux and
// derive the velocity field. Also records the peak water discharge per cell,
// which persists as a "flow paths" map for visualization and coloring.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;
@group(0) @binding(2) var flux: texture_2d<f32>;
@group(0) @binding(3) var velIn: texture_2d<f32>;
@group(0) @binding(4) var terrainOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var velOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var flowIn: texture_2d<f32>;
@group(0) @binding(7) var flowOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let f = textureLoad(flux, c, 0);
    let fl = loadOrZero(flux, c + vec2i(-1, 0));
    let fr = loadOrZero(flux, c + vec2i(1, 0));
    let fd = loadOrZero(flux, c + vec2i(0, -1));
    let fu = loadOrZero(flux, c + vec2i(0, 1));

    let inflow = fl.y + fr.x + fd.w + fu.z;
    let outflow = f.x + f.y + f.z + f.w;

    let t = textureLoad(terrain, c, 0);
    let d1 = t.y;
    let d2 = max(0.0, d1 + P.dt * (inflow - outflow) / (P.pipeLen * P.pipeLen));
    let avgDepth = 0.5 * (d1 + d2);

    // Average water passing through the cell in x and y.
    var vel = vec2f(
        0.5 * (fl.y - f.x + f.y - fr.x),
        0.5 * (fd.w - f.z + f.w - fu.z)
    );
    if (avgDepth > 1e-4) {
        vel /= avgDepth * P.pipeLen;
    } else {
        vel = vec2f(0.0);
    }

    // Carry some momentum along the flow so rivers meander instead of
    // strictly following the steepest descent.
    if (P.velAdvection > 0.0) {
        let oldVel = textureLoad(velIn, c, 0).xy;
        let back = vec2f(c) - oldVel * P.dt / P.pipeLen;
        vel += P.velAdvection * sampleBilinear(velIn, back).xy;
    }

    // Very shallow water makes sediment advection chaotic; treat it as still.
    if (d2 < MIN_FLOW_DEPTH) {
        vel = vec2f(0.0);
    }

    // Keep advection within one cell per step for stability.
    let maxSpeed = P.pipeLen / P.dt;
    let speed = length(vel);
    if (speed > maxSpeed) {
        vel *= maxSpeed / speed;
    }

    let discharge = length(vel) * d2;
    let flow = max(textureLoad(flowIn, c, 0).x, discharge);

    textureStore(terrainOut, c, vec4f(t.x, d2, 0.0, 0.0));
    textureStore(velOut, c, vec4f(vel, 0.0, 0.0));
    textureStore(flowOut, c, vec4f(flow, 0.0, 0.0, 0.0));
}
