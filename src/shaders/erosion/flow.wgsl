// Step 2 (Mei et al. 3.2.1): outflow flux through virtual pipes to the 4 neighbours.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;
@group(0) @binding(2) var fluxIn: texture_2d<f32>;
@group(0) @binding(3) var fluxOut: texture_storage_2d<rgba32float, write>;

// Height difference to a neighbour. Outside the map the neighbour is the bare
// ground at our own height when draining (so only water leaves), otherwise a wall.
fn heightDiff(c: vec2i, d: vec2i, total: f32, ownWater: f32) -> f32 {
    if (inBounds(c, d)) {
        let n = textureLoad(terrain, c, 0);
        return total - (n.x + n.y);
    }
    if (P.drainEdges > 0.5) {
        return ownWater;
    }
    return -1e9;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let t = textureLoad(terrain, c, 0);
    let total = t.x + t.y;
    let f = textureLoad(fluxIn, c, 0);
    let k = P.dt * P.pipeArea * P.gravity / P.pipeLen;

    var out = vec4f(
        max(0.0, f.x + k * heightDiff(c + vec2i(-1, 0), d, total, t.y)),
        max(0.0, f.y + k * heightDiff(c + vec2i(1, 0), d, total, t.y)),
        max(0.0, f.z + k * heightDiff(c + vec2i(0, -1), d, total, t.y)),
        max(0.0, f.w + k * heightDiff(c + vec2i(0, 1), d, total, t.y))
    );

    // Scale so we never send away more water than the cell holds.
    let outVolume = (out.x + out.y + out.z + out.w) * P.dt;
    if (outVolume > 0.0) {
        out *= min(1.0, t.y * P.pipeLen * P.pipeLen / outVolume);
    }

    textureStore(fluxOut, c, out);
}
