// Shared definitions for the hydraulic/thermal erosion passes.
// Based on Mei, Decaudin & Hu, "Fast Hydraulic Erosion Simulation and Visualization on GPU" (2007)
// and Št'ava et al., "Interactive Terrain Modeling Using Hydraulic Erosion" (2008).
//
// All heights and water depths are in "cell units": one unit equals the horizontal
// distance between two simulation cells, so slopes are physically consistent with
// what is rendered.
//
// Flux channels: x = left (-x), y = right (+x), z = down (-y), w = up (+y)

struct SimParams {
    dt: f32,
    pipeLen: f32,
    pipeArea: f32,
    gravity: f32,
    kc: f32,            // sediment capacity
    ks: f32,            // dissolving (erosion) rate
    kd: f32,            // deposition rate
    ke: f32,            // evaporation rate
    minSlope: f32,      // lower bound of sin(tilt) used for capacity
    velAdvection: f32,  // how much velocity is carried along with the flow
    thermalRate: f32,
    talusHeight: f32,   // max stable height difference between neighbours
    rainRate: f32,      // global rain (water units per time unit)
    drainEdges: f32,    // 1 = water can leave the map at its border
    brushX: f32,        // rain brush centre in UV space
    brushY: f32,
    brushRadius: f32,   // rain brush radius in UV space
    brushStrength: f32, // water added per time unit at the brush centre
    brushActive: f32,
    time: f32,
    smoothThreshold: f32, // spike smoothing threshold in cell units (0 = off)
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
}

const MIN_FLOW_DEPTH: f32 = 0.01;

fn inBounds(c: vec2i, d: vec2i) -> bool {
    return c.x >= 0 && c.y >= 0 && c.x < d.x && c.y < d.y;
}

fn loadClamped(t: texture_2d<f32>, c: vec2i) -> vec4f {
    let d = vec2i(textureDimensions(t));
    return textureLoad(t, clamp(c, vec2i(0), d - 1), 0);
}

fn loadOrZero(t: texture_2d<f32>, c: vec2i) -> vec4f {
    let d = vec2i(textureDimensions(t));
    if (!inBounds(c, d)) {
        return vec4f(0.0);
    }
    return textureLoad(t, c, 0);
}

// Bilinear sample at texel-space position p (texel centres at integer coordinates).
// Float32 textures are not filterable by default, so this is done manually.
fn sampleBilinear(t: texture_2d<f32>, p: vec2f) -> vec4f {
    let f = floor(p);
    let w = p - f;
    let c = vec2i(f);
    let a = loadClamped(t, c);
    let b = loadClamped(t, c + vec2i(1, 0));
    let e = loadClamped(t, c + vec2i(0, 1));
    let g = loadClamped(t, c + vec2i(1, 1));
    return mix(mix(a, b, w.x), mix(e, g, w.x), w.y);
}
