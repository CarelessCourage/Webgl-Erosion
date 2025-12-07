// Simplified terrain shader for debugging

struct VertexInput {
    @location(0) position: vec4f,
    @location(1) normal: vec4f,
    @location(2) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Use actual vertex positions, scale them down to fit in NDC
    // Plane is 10x10 centered at origin in XZ plane (Y=0)
    // Map X to screen X, Z to screen Y (looking down from above)
    output.position = vec4f(
        input.position.x * 0.1,  // X: -5 to 5 -> -0.5 to 0.5
        input.position.z * 0.1,  // Y (screen): -5 to 5 -> -0.5 to 0.5  
        0.0,                      // Z: constant depth
        1.0
    );
    
    // Color based on position for debugging
    output.color = vec3f(
        (input.position.x + 5.0) / 10.0,  // Red varies across X
        (input.position.z + 5.0) / 10.0,  // Green varies across Z
        0.5                                // Blue constant
    );
    
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return vec4f(input.color, 1.0);
}
