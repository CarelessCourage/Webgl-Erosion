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
@group(0) @binding(1) var heightMap: texture_2d<f32>;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Sample height from texture
    let texCoords = vec2i(input.uv * 512.0);
    let height = textureLoad(heightMap, texCoords, 0).r;
    
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
