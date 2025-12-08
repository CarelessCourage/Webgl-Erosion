// Sediment transport shader - handles erosion and deposition based on velocity and sediment capacity
// Based on original sediment-frag.glsl, adapted for WebGPU compute shaders

struct SedimentParams {
    time: f32,
    kc: f32,        // Sediment capacity constant
    ks: f32,        // Dissolution constant (erosion)
    kd: f32,        // Deposition constant
    ke: f32,        // Evaporation rate
    kt: f32,        // Thermal erosion rate
    _padding: vec2<f32>
}

@group(0) @binding(0) var<uniform> params: SedimentParams;
@group(0) @binding(1) var terrain_read_texture: texture_2d<f32>;
@group(0) @binding(2) var sediment_read_texture: texture_2d<f32>;
@group(0) @binding(3) var velocity_texture: texture_2d<f32>;
@group(0) @binding(4) var terrain_write_texture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var sediment_write_texture: texture_storage_2d<rgba32float, write>;

fn calculateSlope(coord: vec2<i32>, dimensions: vec2<u32>) -> f32 {
    let center = textureLoad(terrain_read_texture, coord, 0);
    
    var height_sum = 0.0;
    var count = 0.0;
    
    // Sample neighboring heights
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) { continue; }
            
            let neighbor_coord = coord + vec2<i32>(dx, dy);
            if (neighbor_coord.x >= 0 && neighbor_coord.x < i32(dimensions.x) &&
                neighbor_coord.y >= 0 && neighbor_coord.y < i32(dimensions.y)) {
                let neighbor = textureLoad(terrain_read_texture, neighbor_coord, 0);
                height_sum += neighbor.x + neighbor.y; // terrain height + water height
                count += 1.0;
            }
        }
    }
    
    if (count > 0.0) {
        let avg_neighbor_height = height_sum / count;
        let cur_height = center.x + center.y;
        return abs(cur_height - avg_neighbor_height);
    }
    
    return 0.1; // Default slope
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coord = vec2<i32>(global_id.xy);
    let dimensions = textureDimensions(terrain_read_texture);
    
    if (coord.x >= i32(dimensions.x) || coord.y >= i32(dimensions.y)) {
        return;
    }
    
    // Sample current values
    let cur_terrain = textureLoad(terrain_read_texture, coord, 0);
    let cur_sediment = textureLoad(sediment_read_texture, coord, 0);
    let cur_velocity = textureLoad(velocity_texture, coord, 0);
    
    // Calculate slope
    let slope = max(0.1, calculateSlope(coord, dimensions));
    let slope_sin = slope; // Simplified - in original this would be more complex
    
    // Calculate velocity magnitude
    let velocity_magnitude = length(cur_velocity.xy);
    
    // Calculate sediment capacity based on velocity and slope
    // Original: sedicap = Kc * pow(slope, 1.0) * pow(velo, 1.0)
    let slope_multi = 5.0 * pow(abs(slope_sin), 4.0);
    let sediment_capacity = params.kc * pow(slope, 1.0) * pow(velocity_magnitude, 1.0);
    
    // Current values
    var height = cur_terrain.x;
    var water = cur_terrain.y;
    var sediment_amount = cur_sediment.x;
    
    // Erosion/Deposition based on sediment capacity
    if (sediment_capacity > sediment_amount) {
        // Erosion - dissolve terrain
        let change_sediment = (sediment_capacity - sediment_amount) * params.ks;
        height = height - change_sediment;
        sediment_amount = sediment_amount + change_sediment;
    } else {
        // Deposition - sediment settles
        let change_sediment = (sediment_amount - sediment_capacity) * params.kd;
        height = height + change_sediment;
        sediment_amount = sediment_amount - change_sediment;
    }
    
    // Thermal erosion - smooth steep slopes
    if (slope > 0.3) { // Only apply thermal erosion on steep slopes
        let thermal_change = slope * params.kt * 0.01;
        height = height - thermal_change;
        sediment_amount = sediment_amount + thermal_change * 0.5;
    }
    
    // Water evaporation
    water = water * (1.0 - params.ke);
    
    // Ensure non-negative values
    height = max(height, 0.0);
    water = max(water, 0.0);
    sediment_amount = max(sediment_amount, 0.0);
    
    // Write results
    textureStore(terrain_write_texture, coord, 
                vec4<f32>(height, water, cur_terrain.z, cur_terrain.w));
    textureStore(sediment_write_texture, coord, 
                vec4<f32>(sediment_amount, 0.0, 0.0, 1.0));
}