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
    bottomColor: vec3f,
    wireframeMode: f32,            // 0.0 = off, 1.0 = on
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
    
    // Displace all vertices at Y >= 0 (top surface and side top edges)
    // Only bottom vertices (Y < 0) and side bottom edges remain at their original positions
    let isAtTopHeight = input.position.y >= 0.0;
    let displacement = select(0.0, height * 5.0, isAtTopHeight && uniforms.disableDisplacement < 0.5);
    
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
    
    // Detect surface type by normal direction:
    // - Top surface: normal.y close to 1.0
    // - Bottom surface: normal.y close to -1.0
    // - Side surfaces: normal.y close to 0.0
    let isTopSurface = normal.y > 0.5;
    
    var color: vec3f;
    var diffuse: f32;
    
    if (isTopSurface) {
        // Height-based coloring for top surface using height texture value (0-1)
        color = uniforms.lowColor / 255.0; // Convert from 0-255 to 0-1
        
        if (height > uniforms.lowThreshold) {
            let t = (height - uniforms.lowThreshold) / (uniforms.highThreshold - uniforms.lowThreshold);
            color = mix(uniforms.lowColor / 255.0, uniforms.midColor / 255.0, clamp(t, 0.0, 1.0));
        }
        if (height > uniforms.highThreshold) {
            let t = (height - uniforms.highThreshold) / 0.3;
            color = mix(uniforms.midColor / 255.0, uniforms.highColor / 255.0, clamp(t, 0.0, 1.0));
        }
        // Top surface gets normal diffuse lighting with low ambient
        diffuse = max(dot(normal, lightDir), 0.2);
    } else {
        // Use solid bottom color for sides and bottom with higher ambient lighting
        color = uniforms.bottomColor / 255.0;
        // Sides/bottom get softer lighting with higher ambient (70% base + 30% diffuse)
        diffuse = max(dot(normal, lightDir), 0.0) * 0.3 + 0.7;
    }
    
    return vec4f(color * diffuse, 1.0);
}
