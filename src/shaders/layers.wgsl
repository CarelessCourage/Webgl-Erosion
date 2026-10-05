// Shared terrain layer evaluation, used by both the terrain renderer
// (color groups) and the layer compute pass (height texture), so the two can
// never drift apart. The including shader must declare:
//   var<storage, read> layers: array<Layer>;
//   var imageTextures: texture_2d_array<f32>;
//   var imageSampler: sampler;
// Layer buffers are written by serializeLayers() in core/LayerSystem.ts.

// 18 floats per layer
struct Layer {
    layerType: f32,        // 0=noise, 1=circle, 2=image
    blendMode: f32,        // 0=add, 1=mask, 2=multiply, 3=subtract
    enabled: f32,          // 0.0=disabled, 1.0=enabled
    strength: f32,         // 0.0 to 1.0
    scale: f32,
    octaves: f32,
    persistence: f32,
    lacunarity: f32,
    amplitude: f32,
    seed: f32,
    centerX: f32,
    centerY: f32,
    radius: f32,
    falloff: f32,
    offsetX: f32,
    offsetY: f32,
    imageIndex: f32,
    padding: f32,
}

// High quality hash function for procedural noise
fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// High-quality 2D noise function
fn noise2D(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    
    // Four corner random values
    let a = hash22(i).x;
    let b = hash22(i + vec2f(1.0, 0.0)).x;
    let c = hash22(i + vec2f(0.0, 1.0)).x;
    let d = hash22(i + vec2f(1.0, 1.0)).x;
    
    // Smooth interpolation (using smoothstep instead of quintic)
    let u = smoothstep(vec2f(0.0), vec2f(1.0), f);
    
    // Bilinear interpolation
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

fn octaveNoise(x: f32, y: f32, octaves: f32, persistence: f32, lacunarity: f32, seed: f32) -> f32 {
    var total = 0.0;
    var frequency = 1.0;
    var amplitude = 1.0;
    var maxValue = 0.0;
    
    let iOctaves = i32(octaves);
    for (var i = 0; i < iOctaves; i++) {
        // Use the simpler, higher-quality noise function
        let noiseValue = noise2D(vec2f(x * frequency, y * frequency) + vec2f(seed + f32(i) * 100.0));
        total += noiseValue * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return total / maxValue;
}

// Layer evaluation functions
fn evaluateNoiseLayer(layer: Layer, uv: vec2f) -> f32 {
    let noise = octaveNoise(
        uv.x * layer.scale, 
        uv.y * layer.scale, 
        layer.octaves, 
        layer.persistence, 
        layer.lacunarity, 
        layer.seed
    );
    
    // Normalize noise from [-1, 1] to [0, 1] range
    // Then scale by amplitude to control intensity
    let normalizedNoise = (noise + 1.0) * 0.5; // Convert [-1,1] to [0,1]
    let height = normalizedNoise * layer.amplitude;
    
    // Don't clamp here - allow values to accumulate beyond 1.0
    return height;
}

fn evaluateCircleLayer(layer: Layer, uv: vec2f) -> f32 {
    // Convert UV (0-1) to world coordinates (-5 to 5)
    let worldPos = (uv - 0.5) * 10.0;
    let center = vec2f(layer.centerX, layer.centerY);
    let dist = distance(worldPos, center);
    
    let outerRadius = layer.radius;
    let innerRadius = outerRadius * (1.0 - layer.falloff);
    
    if (dist <= innerRadius) {
        return 1.0;
    } else if (dist <= outerRadius) {
        return 1.0 - smoothstep(innerRadius, outerRadius, dist);
    } else {
        return 0.0;
    }
}

fn evaluateImageLayer(layer: Layer, uv: vec2f) -> f32 {
    let offsetUV = uv + vec2f(layer.offsetX, layer.offsetY);
    let clampedUV = clamp(offsetUV, vec2f(0.0), vec2f(1.0));
    let imageIndex = i32(layer.imageIndex);
    return textureSampleLevel(imageTextures, imageSampler, clampedUV, imageIndex, 0.0).r;
}

// Blend mode functions
fn blendLayers(base: f32, overlay: f32, blendMode: f32, strength: f32) -> f32 {
    let weightedOverlay = overlay * strength;
    
    let blendModeInt = i32(blendMode);
    switch (blendModeInt) {
        case 0: { // Add
            return base + weightedOverlay;
        }
        case 1: { // Mask - overlay controls visibility of base
            return base * clamp(weightedOverlay, 0.0, 1.0);
        }
        case 2: { // Multiply - base and overlay multiply together
            return base * overlay * strength;
        }
        case 3: { // Subtract
            return max(base - weightedOverlay, 0.0);
        }
        default: {
            return base;
        }
    }
}

// Calculate height from layers at given UV position
fn calculateHeight(uv: vec2f) -> f32 {
    var result = 0.0;
    let layerCount = arrayLength(&layers);
    var processedLayers = 0u;
    
    // Process each layer in order
    for (var i = 0u; i < layerCount && i < 5u; i++) {
        let layer = layers[i];
        
        // Skip disabled layers
        if (layer.enabled < 0.5) {
            continue;
        }
        
        processedLayers += 1u;
        
        var layerValue = 0.0;
        let layerTypeInt = i32(layer.layerType);
        
        // Evaluate layer based on type
        switch (layerTypeInt) {
            case 0: { // Noise
                layerValue = evaluateNoiseLayer(layer, uv);
            }
            case 1: { // Circle
                layerValue = evaluateCircleLayer(layer, uv);
            }
            case 2: { // Image
                layerValue = evaluateImageLayer(layer, uv);
            }
            default: {
                layerValue = 0.0;
            }
        }
        
        // Blend with accumulated result
        if (processedLayers == 1u) {
            // First layer is the base
            result = layerValue * layer.strength;
        } else {
            result = blendLayers(result, layerValue, layer.blendMode, layer.strength);
        }
    }
    
    // Don't clamp final result - allow accumulated heights beyond 1.0
    return max(result, 0.0);
}
