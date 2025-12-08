// Flow computation shader - first pass of multi-pass erosion system
struct FlowParams {
    time: f32,
    timestep: f32,
    gravity: f32,
    dissolve_rate: f32,
    globalRainEnabled: f32,
    mouseRainEnabled: f32,
    mouseRainActive: f32,
    mouseRainX: f32,
    mouseRainY: f32,
    mouseRainStrength: f32,
    mouseRainRadius: f32,
    padding: f32
}

@group(0) @binding(0) var<uniform> params: FlowParams;
@group(0) @binding(1) var terrain_read_texture: texture_2d<f32>;
@group(0) @binding(2) var terrain_write_texture: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coord = vec2<i32>(global_id.xy);
    let dimensions = textureDimensions(terrain_read_texture);
    
    if (coord.x >= i32(dimensions.x) || coord.y >= i32(dimensions.y)) {
        return;
    }
    
    let cur_terrain = textureLoad(terrain_read_texture, coord, 0);
    var height = cur_terrain.x;      // R = height
    var water = cur_terrain.y;       // G = water
    var sediment = cur_terrain.z;    // B = suspended sediment
    
    // Add rain water (like original rain-frag.glsl)
    if (params.globalRainEnabled > 0.5) {
        water += 0.005; // Add water gradually
    }
    
    // Mouse rain
    if (params.mouseRainEnabled > 0.5 && params.mouseRainActive > 0.5) {
        let uv = vec2<f32>(coord) / vec2<f32>(dimensions);
        let mouse_pos = vec2<f32>(params.mouseRainX, params.mouseRainY);
        let pixel_pos = uv * vec2<f32>(dimensions);
        let distance = length(pixel_pos - mouse_pos);
        
        if (distance < params.mouseRainRadius) {
            let strength = 1.0 - (distance / params.mouseRainRadius);
            water += strength * 0.02;
        }
    }
    
    // Simple water flow and erosion (simplified from original multi-pass system)
    if (water > 0.001) {
        // Get neighbors for slope calculation
        let left_coord = coord + vec2<i32>(-1, 0);
        let right_coord = coord + vec2<i32>(1, 0);
        let top_coord = coord + vec2<i32>(0, 1);
        let bottom_coord = coord + vec2<i32>(0, -1);
        
        var left_height = height;
        var right_height = height;
        var top_height = height;
        var bottom_height = height;
        
        if (left_coord.x >= 0) {
            left_height = textureLoad(terrain_read_texture, left_coord, 0).x;
        }
        if (right_coord.x < i32(dimensions.x)) {
            right_height = textureLoad(terrain_read_texture, right_coord, 0).x;
        }
        if (top_coord.y < i32(dimensions.y)) {
            top_height = textureLoad(terrain_read_texture, top_coord, 0).x;
        }
        if (bottom_coord.y >= 0) {
            bottom_height = textureLoad(terrain_read_texture, bottom_coord, 0).x;
        }
        
        // Calculate slope (like original calnor function)
        let slope_x = left_height - right_height;
        let slope_z = top_height - bottom_height;
        let slope_magnitude = sqrt(slope_x * slope_x + slope_z * slope_z + 4.0) / 2.0;
        let slope_sin = sqrt(1.0 - (2.0 / slope_magnitude) * (2.0 / slope_magnitude));
        
        // Simulate velocity from water amount and slope
        let velocity = water * slope_sin * 0.5;
        
        // Sediment capacity (like original sediment-frag.glsl)
        let Kc = 0.1; // Sediment capacity constant
        let sediment_capacity = Kc * slope_sin * velocity;
        
        // Erosion/deposition (like original algorithm)
        let Ks = 0.02; // Dissolution constant 
        let Kd = 0.01; // Deposition constant
        
        if (sediment_capacity > sediment) {
            // Can carry more sediment - erode
            let change = (sediment_capacity - sediment) * Ks;
            height -= change;
            sediment += change;
        } else {
            // Over capacity - deposit  
            let change = (sediment - sediment_capacity) * Kd;
            height += change;
            sediment -= change;
        }
        
        // Water evaporation
        water *= 0.998;
    }
    
    textureStore(terrain_write_texture, coord, vec4<f32>(height, water, sediment, cur_terrain.w));
}