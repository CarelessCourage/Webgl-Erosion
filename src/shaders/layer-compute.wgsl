// Layer Combination Compute Shader for WebGPU
// Combines multiple alpha layers into a single height texture in real-time

// Layer data structure (32-byte aligned for storage buffer)
struct Layer {
    // Common properties (16 bytes)
    layerType: u32,        // 0=noise, 1=circle, 2=image
    blendMode: u32,        // 0=add, 1=mask, 2=multiply, 3=subtract
    enabled: f32,          // 0.0=disabled, 1.0=enabled
    strength: f32,         // 0.0 to 1.0
    
    // Noise parameters (24 bytes)
    scale: f32,
    octaves: f32,
    persistence: f32,
    lacunarity: f32,
    amplitude: f32,
    seed: f32,
    
    // Circle parameters (16 bytes) 
    centerX: f32,          // -5.0 to 5.0 world coords
    centerY: f32,          // -5.0 to 5.0 world coords
    radius: f32,
    falloff: f32,          // 0.0 to 1.0 edge softness
    
    // Image parameters (16 bytes)
    offsetX: f32,          // -1.0 to 1.0 UV offset
    offsetY: f32,          // -1.0 to 1.0 UV offset
    imageIndex: f32,       // Which texture array slice
    padding: f32,          // Align to 16 bytes
}

// Compute shader bindings
@group(0) @binding(0) var<storage, read> layers: array<Layer>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var imageTextures: texture_2d_array<f32>; 
@group(0) @binding(3) var imageSampler: sampler;

// High quality hash function for better noise
fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// High quality smooth interpolation
fn quintic(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Improved gradient noise with better quality
fn gradientNoise(p: vec2f, seed: f32) -> f32 {
    let i = floor(p + seed * 137.1); // Better seed distribution
    let f = fract(p + seed * 137.1);
    
    // Get gradient vectors for each corner
    let ga = hash22(i) * 2.0 - 1.0;
    let gb = hash22(i + vec2f(1.0, 0.0)) * 2.0 - 1.0;
    let gc = hash22(i + vec2f(0.0, 1.0)) * 2.0 - 1.0;
    let gd = hash22(i + vec2f(1.0, 1.0)) * 2.0 - 1.0;
    
    // Calculate dot products with distance vectors
    let va = dot(ga, f);
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));
    
    // Smooth interpolation
    let u = quintic(f.x);
    let v = quintic(f.y);
    
    // Bilinear interpolation
    return mix(mix(va, vb, u), mix(vc, vd, u), v);
}

fn octaveNoise(x: f32, y: f32, octaves: f32, persistence: f32, lacunarity: f32, seed: f32) -> f32 {
    var total = 0.0;
    var frequency = 1.0;
    var amplitude = 1.0;
    var maxValue = 0.0;
    
    let iOctaves = i32(octaves);
    for (var i = 0; i < iOctaves; i++) {
        total += gradientNoise(vec2f(x * frequency, y * frequency), seed + f32(i) * 100.0) * amplitude;
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
    
    // Match the original terrain generation exactly:
    // height = baseHeight + (noiseValue * amplitude)
    // Original uses baseHeight of 0.3, noise range [-1,1]
    let baseHeight = 0.3;
    let height = baseHeight + (noise * layer.amplitude);
    
    return clamp(height, 0.0, 1.0);
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
fn blendLayers(base: f32, overlay: f32, blendMode: u32, strength: f32) -> f32 {
    let weightedOverlay = overlay * strength;
    
    switch (blendMode) {
        case 0u: { // Add
            return clamp(base + weightedOverlay, 0.0, 1.0);
        }
        case 1u: { // Mask (multiply base by overlay)
            return base * (weightedOverlay);
        }
        case 2u: { // Multiply
            return base * mix(1.0, weightedOverlay, strength);
        }
        case 3u: { // Subtract
            return clamp(base - weightedOverlay, 0.0, 1.0);
        }
        default: {
            return base;
        }
    }
}

// Main compute function
@compute @workgroup_size(8, 8, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
    let texCoord = vec2u(id.xy);
    let texSize = textureDimensions(outputTexture);
    
    // Early exit if out of bounds
    if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
        return;
    }
    
    // Convert to UV coordinates (0-1)
    let uv = vec2f(f32(texCoord.x) / f32(texSize.x), f32(texCoord.y) / f32(texSize.y));
    
    // Always start with a clean base (clear any previous data)
    var result = 0.0;
    let layerCount = arrayLength(&layers);
    
    // Process each layer in order
    for (var i = 0u; i < layerCount; i++) {
        let layer = layers[i];
        
        // Skip disabled layers
        if (layer.enabled < 0.5) {
            continue;
        }
        
        var layerValue = 0.0;
        
        // Evaluate layer based on type
        switch (layer.layerType) {
            case 0u: { // Noise
                layerValue = evaluateNoiseLayer(layer, uv);
            }
            case 1u: { // Circle
                layerValue = evaluateCircleLayer(layer, uv);
            }
            case 2u: { // Image
                layerValue = evaluateImageLayer(layer, uv);
            }
            default: {
                layerValue = 0.0;
            }
        }
        
        // Blend with accumulated result
        if (i == 0u) {
            // First layer is the base
            result = layerValue * layer.strength;
        } else {
            result = blendLayers(result, layerValue, layer.blendMode, layer.strength);
        }
    }
    
    // Clamp final result and write to output texture
    result = clamp(result, 0.0, 1.0);
    
    // Store height in R channel, leave others for future use
    let outputColor = vec4f(result, 0.0, 0.0, 1.0);
    textureStore(outputTexture, texCoord, outputColor);
}