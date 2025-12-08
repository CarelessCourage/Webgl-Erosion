// Flow computation shader - calculates water outflow flux between neighboring cells
// Based on original flow-frag.glsl, adapted for WebGPU compute shaders

struct FlowParams {
    time: f32,
    timestep: f32,
    gravity: f32,
    pipe_len: f32,
    pipe_area: f32,
    globalRainEnabled: f32,
    mouseRainEnabled: f32,
    mouseRainActive: f32,
    mouseRainX: f32,
    mouseRainY: f32,
    mouseRainStrength: f32,
    mouseRainRadius: f32
}

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var terrain_texture: texture_2d<f32>;
@group(0) @binding(2) var water_texture: texture_2d<f32>;
@group(0) @binding(3) var flux_read_texture: texture_2d<f32>;
@group(0) @binding(4) var water_write_texture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var flux_write_texture: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coord = vec2<i32>(global_id.xy);
    let dimensions = textureDimensions(terrain_texture);
    
    if (coord.x >= i32(dimensions.x) || coord.y >= i32(dimensions.y)) {
        return;
    }
    
    let uv = vec2<f32>(coord) / vec2<f32>(dimensions);
    let div = 1.0 / f32(max(dimensions.x, dimensions.y));
    
    // Sample current terrain, water, and flux
    let cur_terrain = textureLoad(terrain_texture, coord, 0);
    let cur_water = textureLoad(water_texture, coord, 0);
    let cur_flux = textureLoad(flux_read_texture, coord, 0);
    
    // Calculate rain input
    var water_amount = cur_water.x;
    
    // Global rain
    if (params.globalRainEnabled > 0.5) {
        water_amount += 0.01 * params.timestep; // Add global rain
    }
    
    // Mouse rain
    if (params.mouseRainEnabled > 0.5 && params.mouseRainActive > 0.5) {
        let mouse_pos = vec2<f32>(params.mouseRainX, params.mouseRainY);
        let pixel_pos = uv * vec2<f32>(dimensions);
        let distance = length(pixel_pos - mouse_pos);
        
        if (distance < params.mouseRainRadius) {
            let strength = 1.0 - (distance / params.mouseRainRadius);
            water_amount += params.mouseRainStrength * strength * params.timestep;
        }
    }
    
    // Sample neighboring cells (with bounds checking)
    let top_coord = coord + vec2<i32>(0, 1);
    let right_coord = coord + vec2<i32>(1, 0);
    let bottom_coord = coord + vec2<i32>(0, -1);
    let left_coord = coord + vec2<i32>(-1, 0);
    
    var top_terrain = vec4<f32>(0.0);
    var right_terrain = vec4<f32>(0.0);
    var bottom_terrain = vec4<f32>(0.0);
    var left_terrain = vec4<f32>(0.0);
    
    // Sample with bounds checking
    if (top_coord.y < i32(dimensions.y)) {
        top_terrain = textureLoad(terrain_texture, top_coord, 0);
    }
    if (right_coord.x < i32(dimensions.x)) {
        right_terrain = textureLoad(terrain_texture, right_coord, 0);
    }
    if (bottom_coord.y >= 0) {
        bottom_terrain = textureLoad(terrain_texture, bottom_coord, 0);
    }
    if (left_coord.x >= 0) {
        left_terrain = textureLoad(terrain_texture, left_coord, 0);
    }
    
    // Calculate height differences (use terrain height + current water)
    let cur_total_height = cur_terrain.x + water_amount;
    let h_top_out = cur_total_height - (top_terrain.x + 0.0); // Assume neighbors have no water for now
    let h_right_out = cur_total_height - (right_terrain.x + 0.0);
    let h_bottom_out = cur_total_height - (bottom_terrain.x + 0.0);
    let h_left_out = cur_total_height - (left_terrain.x + 0.0);
    
    // Calculate outflow flux based on height differences and current flux
    // f_out = max(0, f_prev + timestep * g * pipe_area * h_diff / pipe_len)
    let gravity_term = params.timestep * params.gravity * params.pipe_area / params.pipe_len;
    
    var f_top_out = max(0.0, cur_flux.x + gravity_term * h_top_out);
    var f_right_out = max(0.0, cur_flux.y + gravity_term * h_right_out);
    var f_bottom_out = max(0.0, cur_flux.z + gravity_term * h_bottom_out);
    var f_left_out = max(0.0, cur_flux.w + gravity_term * h_left_out);
    
    // Calculate total outflow
    let water_out = params.timestep * (f_top_out + f_right_out + f_bottom_out + f_left_out);
    
    // Scale outflow to not exceed available water volume
    let k = min(1.0, (water_amount * params.pipe_len * params.pipe_len) / max(water_out, 0.001));
    
    f_top_out *= k;
    f_right_out *= k;
    f_bottom_out *= k;
    f_left_out *= k;
    
    // Apply boundary conditions - no outflow at edges
    if (coord.x <= 0) { f_left_out = 0.0; }
    if (coord.x >= i32(dimensions.x) - 1) { f_right_out = 0.0; }
    if (coord.y <= 0) { f_bottom_out = 0.0; }
    if (coord.y >= i32(dimensions.y) - 1) { f_top_out = 0.0; }
    
    // Additional boundary safety - zero all flux at edges
    if (coord.x <= 0 || coord.x >= i32(dimensions.x) - 1 || 
        coord.y <= 0 || coord.y >= i32(dimensions.y) - 1) {
        f_top_out = 0.0;
        f_right_out = 0.0;
        f_bottom_out = 0.0;
        f_left_out = 0.0;
    }
    
    // Write flux values (top, right, bottom, left)
    textureStore(flux_write_texture, coord, vec4<f32>(f_top_out, f_right_out, f_bottom_out, f_left_out));
    
    // Write updated water amount
    textureStore(water_write_texture, coord, vec4<f32>(water_amount, 0.0, 0.0, 1.0));
}