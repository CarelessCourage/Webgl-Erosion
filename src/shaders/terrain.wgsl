// Terrain Vertex and Fragment Shader for WebGPU

struct Uniforms {
    modelMatrix: mat4x4f,
    viewProjMatrix: mat4x4f,
    cameraPosition: vec3f,
    visualizationMode: f32,        // 0.0 = terrain, 1.0 = heightmap
    lowColor: vec3f,
    disableDisplacement: f32,      // 0.0 = enabled, 1.0 = disabled
    midColor: vec3f,
    lowThreshold: f32,
    highColor: vec3f,
    highThreshold: f32,
    wireframeMode: f32,            // 0.0 = off, 1.0 = on
    _padding: f32,
}

struct VertexInput {
    @location(0) position: vec4f,
    @location(1) normal: vec4f,
    @location(2) uv: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) worldPos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var heightMap: texture_2d<f32>;

@vertex
fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Sample height from texture (convert UV to pixel coords)
    let texCoords = vec2i(input.uv * 512.0);
    let height = textureLoad(heightMap, texCoords, 0).r;
    
    // Only displace vertices on the top surface (Y >= 0)
    // Bottom and side vertices (Y < 0) remain at their original positions
    let isTopSurface = input.position.y >= 0.0;
    let displacement = select(0.0, height * 5.0, isTopSurface && uniforms.disableDisplacement < 0.5);
    
    var worldPos = vec4f(
        input.position.x,
        input.position.y + displacement,
        input.position.z,
        1.0
    );
    
    worldPos = uniforms.modelMatrix * worldPos;
    output.worldPos = worldPos.xyz;
    output.normal = input.normal.xyz;
    output.uv = input.uv;
    output.position = uniforms.viewProjMatrix * worldPos;
    
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // Get height value for this pixel
    let texCoords = vec2i(input.uv * 512.0);
    let height = textureLoad(heightMap, texCoords, 0).r;
    
    // Wireframe rendering - this shouldn't be reached in normal rendering
    // Wireframe is handled by a separate render pass with line-list topology
    if (uniforms.wireframeMode > 0.5) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    
    // Heightmap visualization mode (grayscale)
    if (uniforms.visualizationMode > 0.5) {
        let gray = vec3f(height);
        return vec4f(gray, 1.0);
    }
    
    // Terrain mode with lighting and color gradients
    let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
    let normal = normalize(input.normal);
    let diffuse = max(dot(normal, lightDir), 0.2);
    
    // Height-based coloring using height texture value (0-1) instead of world position
    // This way colors work even in flat view mode
    var color = uniforms.lowColor / 255.0; // Convert from 0-255 to 0-1
    
    if (height > uniforms.lowThreshold) {
        let t = (height - uniforms.lowThreshold) / (uniforms.highThreshold - uniforms.lowThreshold);
        color = mix(uniforms.lowColor / 255.0, uniforms.midColor / 255.0, clamp(t, 0.0, 1.0));
    }
    if (height > uniforms.highThreshold) {
        let t = (height - uniforms.highThreshold) / 0.3;
        color = mix(uniforms.midColor / 255.0, uniforms.highColor / 255.0, clamp(t, 0.0, 1.0));
    }
    
    return vec4f(color * diffuse, 1.0);
}
