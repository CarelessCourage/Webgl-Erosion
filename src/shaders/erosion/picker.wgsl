// Downsamples the displayed height texture into a small buffer that is read back
// to the CPU for mouse picking (ray marching against the terrain).

@group(0) @binding(0) var display: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;

override PICK_SIZE: u32 = 256u;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= PICK_SIZE || id.y >= PICK_SIZE) {
        return;
    }
    let uv = (vec2f(id.xy) + 0.5) / f32(PICK_SIZE);
    let p = uv * vec2f(textureDimensions(display)) - 0.5;
    heights[id.y * PICK_SIZE + id.x] = sampleBilinear(display, p).x;
}
