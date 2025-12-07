// Water Flow Simulation for Hydraulic Erosion
// Based on "Fast Hydraulic Erosion Simulation and Visualization on GPU" by Xing Mei et al.
// Implements shallow water equations with heightfield representation

// Simulation parameters
struct SimParams {
    deltaTime: f32,
    rainRate: f32,
    evaporationRate: f32,
    gravity: f32,
    pipeCrossSection: f32,
    pipeLength: f32,
    sedimentCapacity: f32,
    dissolutionConstant: f32,
    depositionConstant: f32,
    thermalRate: f32,
    minSlope: f32,
    padding1: f32,
    // Rain controls
    globalRainEnabled: f32,
    mouseRainEnabled: f32,
    mouseRainStrength: f32,
    mouseRainRadius: f32,
    mouseRainActive: f32,
    mouseRainX: f32,
    mouseRainY: f32,
    padding2: f32,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var heightTexture: texture_2d<f32>;        // Current terrain height
@group(0) @binding(2) var waterTexture: texture_2d<f32>;         // Current water depth
@group(0) @binding(3) var velocityTexture: texture_2d<f32>;      // Current water velocity (read-only)
@group(0) @binding(4) var newHeightTexture: texture_storage_2d<rgba32float, write>;     // Updated terrain
@group(0) @binding(5) var newWaterTexture: texture_storage_2d<rgba32float, write>;      // Updated water
@group(0) @binding(6) var newVelocityTexture: texture_storage_2d<rgba32float, write>;   // Updated velocity

// Utility functions
fn getHeight(coord: vec2i) -> f32 {
    let texSize = vec2i(textureDimensions(heightTexture, 0));
    let clampedCoord = clamp(coord, vec2i(0), texSize - vec2i(1));
    return textureLoad(heightTexture, clampedCoord, 0).r;
}

fn getWater(coord: vec2i) -> f32 {
    let texSize = vec2i(textureDimensions(waterTexture, 0));
    let clampedCoord = clamp(coord, vec2i(0), texSize - vec2i(1));
    return textureLoad(waterTexture, clampedCoord, 0).r;
}

fn getVelocity(coord: vec2i) -> vec2f {
    let texSize = vec2i(textureDimensions(velocityTexture, 0));
    let clampedCoord = clamp(coord, vec2i(0), texSize - vec2i(1));
    return textureLoad(velocityTexture, clampedCoord, 0).rg; // texture_2d requires level parameter (0 = base level)
}

// Calculate total height (terrain + water)
fn getTotalHeight(coord: vec2i) -> f32 {
    return getHeight(coord) + getWater(coord);
}

// Calculate outflow flux using shallow water equations
fn calculateOutflow(coord: vec2i) -> vec4f {
    let currentHeight = getTotalHeight(coord);
    let currentWater = getWater(coord);
    
    // If no water, no outflow
    if (currentWater <= 0.001) {
        return vec4f(0.0);
    }
    
    // Get neighbor heights (left, right, top, bottom)
    let leftHeight = getTotalHeight(coord + vec2i(-1, 0));
    let rightHeight = getTotalHeight(coord + vec2i(1, 0));
    let topHeight = getTotalHeight(coord + vec2i(0, -1));
    let bottomHeight = getTotalHeight(coord + vec2i(0, 1));
    
    // Calculate height differences (positive means flow out)
    let heightDiff = vec4f(
        currentHeight - leftHeight,   // left
        currentHeight - rightHeight,  // right
        currentHeight - topHeight,    // top
        currentHeight - bottomHeight  // bottom
    );
    
    // Apply gravity and pipe cross-section to get flux
    // flux = cross_section * sqrt(2 * gravity * height_diff / pipe_length)
    let gravityFactor = params.pipeCrossSection * sqrt(2.0 * params.gravity / params.pipeLength);
    var outflow = gravityFactor * sqrt(max(heightDiff, vec4f(0.0)));
    
    // Limit outflow to available water to prevent negative water
    let totalOutflow = outflow.x + outflow.y + outflow.z + outflow.w;
    if (totalOutflow > currentWater / params.deltaTime) {
        let scale = (currentWater / params.deltaTime) / totalOutflow;
        outflow *= scale;
    }
    
    return outflow;
}

// Calculate water velocity from outflow
fn calculateVelocity(coord: vec2i, outflow: vec4f) -> vec2f {
    let currentWater = getWater(coord);
    
    if (currentWater <= 0.001) {
        return vec2f(0.0);
    }
    
    // Velocity = (outflow_right - outflow_left) / water_depth for X
    // Velocity = (outflow_bottom - outflow_top) / water_depth for Y
    let velocityX = (outflow.y - outflow.x) / currentWater;
    let velocityY = (outflow.w - outflow.z) / currentWater;
    
    return vec2f(velocityX, velocityY);
}

// Apply sediment transport and erosion
fn applySedimentTransport(coord: vec2i, velocity: vec2f) -> vec2f {
    let currentHeight = getHeight(coord);
    let currentWater = getWater(coord);
    let velocityMagnitude = length(velocity);
    
    if (currentWater <= 0.001 || velocityMagnitude <= 0.001) {
        return vec2f(currentHeight, 0.0); // height, sediment
    }
    
    // Sediment capacity based on water depth and velocity
    let sedimentCapacity = params.sedimentCapacity * currentWater * velocityMagnitude;
    
    // Current sediment (we'll track this in a separate texture later)
    // For now, assume zero initial sediment
    let currentSediment = 0.0;
    
    var newHeight = currentHeight;
    var newSediment = currentSediment;
    
    if (sedimentCapacity > currentSediment) {
        // Erode terrain (dissolve)
        let erosionAmount = params.dissolutionConstant * (sedimentCapacity - currentSediment);
        newHeight -= erosionAmount * params.deltaTime;
        newSediment += erosionAmount * params.deltaTime;
    } else {
        // Deposit sediment
        let depositionAmount = params.depositionConstant * (currentSediment - sedimentCapacity);
        newHeight += depositionAmount * params.deltaTime;
        newSediment -= depositionAmount * params.deltaTime;
    }
    
    return vec2f(newHeight, newSediment);
}

// Add thermal erosion for steep slopes
fn applyThermalErosion(coord: vec2i, currentHeight: f32) -> f32 {
    var heightChange = 0.0;
    
    // Check all 8 neighbors for thermal erosion
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) {
                continue;
            }
            
            let neighborCoord = coord + vec2i(dx, dy);
            let neighborHeight = getHeight(neighborCoord);
            let heightDiff = currentHeight - neighborHeight;
            let distance = length(vec2f(f32(dx), f32(dy)));
            let slope = heightDiff / distance;
            
            if (slope > params.minSlope) {
                let erosionAmount = params.thermalRate * (slope - params.minSlope) * params.deltaTime;
                heightChange -= erosionAmount;
            }
        }
    }
    
    return currentHeight + heightChange;
}

// Calculate rain input at current position
fn calculateRainInput(coord: vec2i) -> f32 {
    var rainAmount = 0.0;
    
    // Global rain (uniform across terrain)
    if (params.globalRainEnabled > 0.5) {
        rainAmount += params.rainRate;
    }
    
    // Mouse-based localized rain
    if (params.mouseRainEnabled > 0.5 && params.mouseRainActive > 0.5) {
        let pixelPos = vec2f(f32(coord.x), f32(coord.y));
        let mousePos = vec2f(params.mouseRainX, params.mouseRainY);
        let distance = length(pixelPos - mousePos);
        
        // Apply rain within radius with smooth falloff
        if (distance <= params.mouseRainRadius) {
            let falloff = 1.0 - smoothstep(0.0, params.mouseRainRadius, distance);
            rainAmount += params.mouseRainStrength * falloff;
        }
    }
    
    return rainAmount;
}

@compute @workgroup_size(8, 8, 1)
fn flowMain(@builtin(global_invocation_id) id: vec3u) {
    let coord = vec2i(i32(id.x), i32(id.y));
    let texSize = vec2i(textureDimensions(heightTexture, 0));
    
    // Early exit if out of bounds (explicit type safety)
    let coordX = coord.x;
    let coordY = coord.y;
    let texSizeX = texSize.x;
    let texSizeY = texSize.y;
    
    if (coordX >= texSizeX || coordY >= texSizeY) {
        return;
    }
    
    // Get current state
    let currentHeight = getHeight(coord);
    let currentWater = getWater(coord);
    let currentVelocity = getVelocity(coord);
    
    // Step 1: Add rain (global + mouse-based)
    let rainInput = calculateRainInput(coord);
    var newWater = currentWater + rainInput * params.deltaTime;
    
    // Step 2: Calculate water outflow
    let outflow = calculateOutflow(coord);
    
    // Step 3: Update water based on inflow/outflow conservation
    // Inflow from neighbors
    let leftInflow = calculateOutflow(coord + vec2i(-1, 0)).y;  // neighbor's right outflow
    let rightInflow = calculateOutflow(coord + vec2i(1, 0)).x;  // neighbor's left outflow  
    let topInflow = calculateOutflow(coord + vec2i(0, -1)).w;   // neighbor's bottom outflow
    let bottomInflow = calculateOutflow(coord + vec2i(0, 1)).z; // neighbor's top outflow
    
    let totalInflow = leftInflow + rightInflow + topInflow + bottomInflow;
    let totalOutflow = outflow.x + outflow.y + outflow.z + outflow.w;
    
    newWater += (totalInflow - totalOutflow) * params.deltaTime;
    
    // Step 4: Calculate new velocity
    let newVelocity = calculateVelocity(coord, outflow);
    
    // Step 5: Apply sediment transport and erosion
    let erosionResult = applySedimentTransport(coord, newVelocity);
    var newHeight = erosionResult.x;
    let sediment = erosionResult.y;
    
    // Step 6: Apply thermal erosion
    newHeight = applyThermalErosion(coord, newHeight);
    
    // Step 7: Apply evaporation
    newWater -= params.evaporationRate * params.deltaTime;
    newWater = max(newWater, 0.0);
    
    // Clamp values to reasonable ranges
    newHeight = clamp(newHeight, 0.0, 10.0);
    newWater = clamp(newWater, 0.0, 5.0);
    
    // Write results
    textureStore(newHeightTexture, coord, vec4f(newHeight, 0.0, 0.0, 1.0));
    textureStore(newWaterTexture, coord, vec4f(newWater, 0.0, 0.0, 1.0));
    textureStore(newVelocityTexture, coord, vec4f(newVelocity.x, newVelocity.y, 0.0, 0.0)); // Write to separate velocity texture
}