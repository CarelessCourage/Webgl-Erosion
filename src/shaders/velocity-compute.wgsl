// Velocity computation shader - calculates water velocity from flux values
// Based on original velocity computation, adapted for WebGPU compute shaders

struct VelocityParams {
    time: f32,
    timestep: f32,
    pipe_len: f32,
    _padding: f32
}

@group(0) @binding(0) var<uniform> params: VelocityParams;
@group(0) @binding(1) var terrain_texture: texture_2d<f32>;
@group(0) @binding(2) var flux_texture: texture_2d<f32>;
@group(0) @binding(3) var velocity_write_texture: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coord = vec2<i32>(global_id.xy);
    let dimensions = textureDimensions(terrain_texture);
    
    if (coord.x >= i32(dimensions.x) || coord.y >= i32(dimensions.y)) {
        return;
    }
    
    let cur_terrain = textureLoad(terrain_texture, coord, 0);
    let cur_flux = textureLoad(flux_texture, coord, 0);
    
    // Sample neighboring flux values to calculate inflow
    let top_coord = coord + vec2<i32>(0, 1);
    let right_coord = coord + vec2<i32>(1, 0);
    let bottom_coord = coord + vec2<i32>(0, -1);
    let left_coord = coord + vec2<i32>(-1, 0);
    
    var inflow_top = 0.0;
    var inflow_right = 0.0;
    var inflow_bottom = 0.0;
    var inflow_left = 0.0;
    
    // Calculate inflow from neighbors (their outflow becomes our inflow)
    if (top_coord.y < i32(dimensions.y)) {
        let top_flux = textureLoad(flux_texture, top_coord, 0);
        inflow_bottom = top_flux.z; // Neighbor's bottom outflow is our inflow from top
    }
    if (right_coord.x < i32(dimensions.x)) {
        let right_flux = textureLoad(flux_texture, right_coord, 0);
        inflow_left = right_flux.w; // Neighbor's left outflow is our inflow from right
    }
    if (bottom_coord.y >= 0) {
        let bottom_flux = textureLoad(flux_texture, bottom_coord, 0);
        inflow_top = bottom_flux.x; // Neighbor's top outflow is our inflow from bottom
    }
    if (left_coord.x >= 0) {
        let left_flux = textureLoad(flux_texture, left_coord, 0);
        inflow_right = left_flux.y; // Neighbor's right outflow is our inflow from left
    }
    
    // Calculate net flow in each direction
    let net_flow_x = (inflow_right - cur_flux.y) - (inflow_left - cur_flux.w);
    let net_flow_y = (inflow_top - cur_flux.x) - (inflow_bottom - cur_flux.z);
    
    // Calculate water depth change
    let water_depth = cur_terrain.y;
    let delta_water = params.timestep * (inflow_top + inflow_right + inflow_bottom + inflow_left - 
                                        (cur_flux.x + cur_flux.y + cur_flux.z + cur_flux.w));
    
    let new_water_depth = max(0.0, water_depth + delta_water);
    
    // Calculate velocity based on flux and water depth
    var velocity_x = 0.0;
    var velocity_y = 0.0;
    
    if (new_water_depth > 0.001) {
        // Average velocity calculation from flux
        velocity_x = (cur_flux.y - cur_flux.w) / (new_water_depth * params.pipe_len);
        velocity_y = (cur_flux.x - cur_flux.z) / (new_water_depth * params.pipe_len);
    }
    
    // Limit velocity magnitude to prevent instability
    let velocity_mag = length(vec2<f32>(velocity_x, velocity_y));
    if (velocity_mag > 1.0) {
        velocity_x = velocity_x / velocity_mag;
        velocity_y = velocity_y / velocity_mag;
    }
    
    textureStore(velocity_write_texture, coord, vec4<f32>(velocity_x, velocity_y, 0.0, 1.0));
}