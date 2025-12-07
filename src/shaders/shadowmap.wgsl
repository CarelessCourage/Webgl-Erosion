// Shadow Map Shader for WebGPU
// Renders the scene from the light's perspective to generate depth values

struct Uniforms {
    modelMatrix: mat4x4f,
    lightViewProjMatrix: mat4x4f,
    disableDisplacement: f32,
    padding: vec3f,  // Alignment padding
}

struct VertexInput {
    @location(0) position: vec4f,
    @location(1) normal: vec4f,
    @location(2) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> layers: array<Layer>;

// Layer types
const LAYER_TYPE_NOISE: f32 = 0.0;
const LAYER_TYPE_CIRCLE: f32 = 1.0;
const LAYER_TYPE_IMAGE: f32 = 2.0;

// Blend modes
const BLEND_ADD: f32 = 0.0;
const BLEND_MASK: f32 = 1.0;
const BLEND_MULTIPLY: f32 = 2.0;
const BLEND_SUBTRACT: f32 = 3.0;

struct Layer {
    layerType: f32,       // 0=noise, 1=circle, 2=image
    blendMode: f32,       // 0=add, 1=mask, 2=multiply, 3=subtract
    enabled: f32,         // 0.0=disabled, 1.0=enabled
    strength: f32,        // 0.0 to 1.0
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
}

// High quality hash function for procedural noise
fn hash22(p: vec2f) -> vec2f {
    let k = vec2f(0.3183099, 0.3678794);
    let scaled = p * k.x;
    let n = sin(scaled.x * k.y + scaled.y * k.x) * 12345.0;
    return fract(vec2f(n, n * 1.3979));
}

// Gradient noise function
fn gradientNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    
    // Calculate gradients at grid corners
    let a = hash22(i);
    let b = hash22(i + vec2f(1.0, 0.0));
    let c = hash22(i + vec2f(0.0, 1.0));
    let d = hash22(i + vec2f(1.0, 1.0));
    
    // Convert to gradients
    let ga = normalize(a * 2.0 - 1.0);
    let gb = normalize(b * 2.0 - 1.0);
    let gc = normalize(c * 2.0 - 1.0);
    let gd = normalize(d * 2.0 - 1.0);
    
    // Calculate dot products with distance vectors
    let va = dot(ga, f - vec2f(0.0, 0.0));
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));
    
    // Smooth interpolation
    let u = smoothstep(vec2f(0.0), vec2f(1.0), f);
    return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}

// Octave noise with fractal properties
fn octaveNoise(p: vec2f, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
    var total = 0.0;
    var frequency = 1.0;
    var amplitude = 1.0;
    var maxValue = 0.0;
    
    for (var i = 0; i < octaves && i < 8; i++) {
        total += gradientNoise(p * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return total / maxValue;
}

// Evaluate a single noise layer
fn evaluateNoiseLayer(layer: Layer, pos: vec2f) -> f32 {
    let offsetPos = pos + vec2f(layer.offsetX, layer.offsetY);
    let scaledPos = offsetPos * layer.scale;
    
    let noise = octaveNoise(
        scaledPos,
        i32(layer.octaves),
        layer.persistence,
        layer.lacunarity
    );
    
    return noise * layer.amplitude;
}

// Evaluate a single circle mask layer
fn evaluateCircleLayer(layer: Layer, pos: vec2f) -> f32 {
    let center = vec2f(layer.centerX, layer.centerY);
    let distance = length(pos - center);
    
    if (distance <= layer.radius) {
        if (layer.falloff > 0.0) {
            let falloffDistance = layer.radius * layer.falloff;
            let edgeStart = layer.radius - falloffDistance;
            if (distance > edgeStart) {
                return (layer.radius - distance) / falloffDistance;
            }
        }
        return 1.0;
    }
    
    return 0.0;
}

// Calculate final height from all layers
fn calculateHeight(uv: vec2f) -> f32 {
    var result = 0.0;
    var mask = 1.0;
    
    let layerCount = arrayLength(&layers);
    for (var i = 0u; i < layerCount && i < 5u; i++) {
        let layer = layers[i];
        
        if (layer.enabled < 0.5) {
            continue;
        }
        
        var layerValue = 0.0;
        
        if (layer.layerType == LAYER_TYPE_NOISE) {
            layerValue = evaluateNoiseLayer(layer, uv);
        } else if (layer.layerType == LAYER_TYPE_CIRCLE) {
            layerValue = evaluateCircleLayer(layer, uv);
        }
        // Note: Image layers not implemented in shadow shader
        
        layerValue *= layer.strength;
        
        if (layer.blendMode == BLEND_ADD) {
            result += layerValue * mask;
        } else if (layer.blendMode == BLEND_MASK) {
            mask *= layerValue;
        } else if (layer.blendMode == BLEND_MULTIPLY) {
            result *= layerValue;
        } else if (layer.blendMode == BLEND_SUBTRACT) {
            result -= layerValue * mask;
        }
    }
    
    return clamp(result, 0.0, 1.0);
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Calculate height procedurally from layers
    let height = calculateHeight(input.uv);
    
    // Apply displacement to vertices at Y >= 0 (same as main shader)
    let isAtTopHeight = input.position.y >= 0.0;
    let displacement = select(0.0, height * 5.0, isAtTopHeight && uniforms.disableDisplacement < 0.5);
    
    var worldPos = vec4f(
        input.position.x,
        input.position.y + displacement,
        input.position.z,
        1.0
    );
    
    // Apply model matrix to get world position
    worldPos = uniforms.modelMatrix * worldPos;
    
    // Transform to light's clip space
    output.position = uniforms.lightViewProjMatrix * worldPos;
    
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) {
    // Depth is automatically written to the depth buffer
    // No color output needed for depth-only pass
}
