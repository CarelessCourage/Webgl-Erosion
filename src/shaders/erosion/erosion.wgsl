// Step 3 (Mei et al. 3.3): erosion and deposition based on the sediment
// transport capacity C = Kc * sin(tilt) * |v|.

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var terrain: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var sedimentIn: texture_2d<f32>;
@group(0) @binding(4) var terrainOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var sedimentOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let d = vec2i(textureDimensions(terrain));
    let c = vec2i(id.xy);
    if (!inBounds(c, d)) {
        return;
    }

    let t = textureLoad(terrain, c, 0);
    let hl = loadClamped(terrain, c + vec2i(-1, 0)).x;
    let hr = loadClamped(terrain, c + vec2i(1, 0)).x;
    let hd = loadClamped(terrain, c + vec2i(0, -1)).x;
    let hu = loadClamped(terrain, c + vec2i(0, 1)).x;

    // Heights are in cell units, so neighbours are one unit apart.
    let grad = vec2f(hr - hl, hu - hd) * 0.5;
    let g2 = dot(grad, grad);
    let sinTilt = sqrt(g2 / (1.0 + g2));

    let speed = length(textureLoad(velocity, c, 0).xy);
    var capacity = P.kc * max(sinTilt, P.minSlope) * speed;

    // Deep (pooled) water barely erodes its bed, so lakes and slow rivers fill
    // with sediment instead of digging down; thin fast flow on slopes still cuts.
    if (P.maxErosionDepth > 0.0) {
        capacity *= clamp(1.0 - t.y / P.maxErosionDepth, 0.0, 1.0);
    }

    var height = t.x;
    var sediment = textureLoad(sedimentIn, c, 0).x;

    if (capacity > sediment) {
        let eroded = P.ks * (capacity - sediment);
        height -= eroded;
        sediment += eroded;
    } else {
        let deposited = P.kd * (sediment - capacity);
        height += deposited;
        sediment -= deposited;
    }

    textureStore(terrainOut, c, vec4f(height, t.y, 0.0, 0.0));
    textureStore(sedimentOut, c, vec4f(sediment, 0.0, 0.0, 0.0));
}
