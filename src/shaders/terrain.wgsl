// Terrain Vertex and Fragment Shader for WebGPU

struct Uniforms {
    modelMatrix: mat4x4f,
    viewProjMatrix: mat4x4f,
    lightViewProjMatrix: mat4x4f,
    cameraPosition: vec3f,
    visualizationMode: f32,        // 0.0 = terrain, 1.0 = heightmap
    lowColor: vec3f,
    disableDisplacement: f32,      // 0.0 = enabled, 1.0 = disabled
    midColor: vec3f,
    lowThreshold: f32,
    highColor: vec3f,
    highThreshold: f32,
    bottomColor: vec3f,
    shadowsEnabled: f32,           // 0.0 = off, 1.0 = on
    lightDirection: vec3f,
    shadowIntensity: f32,          // 0.0 to 1.0
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
    
    // Heightmap visualization mode (grayscale)
    if (uniforms.visualizationMode > 0.5) {
        let gray = vec3f(height);
        return vec4f(gray, 1.0);
    }
    
    // Calculate proper normal from heightmap for accurate lighting
    let texelSize = 1.0 / 512.0;
    let heightL = textureLoad(heightMap, texCoords + vec2i(-1, 0), 0).r;
    let heightR = textureLoad(heightMap, texCoords + vec2i(1, 0), 0).r;
    let heightD = textureLoad(heightMap, texCoords + vec2i(0, -1), 0).r;
    let heightU = textureLoad(heightMap, texCoords + vec2i(0, 1), 0).r;
    
    // Calculate tangent vectors scaled by displacement
    let scale = 5.0; // Match displacement scale
    let dx = vec3f(2.0 * texelSize * 10.0, (heightR - heightL) * scale, 0.0);
    let dy = vec3f(0.0, (heightU - heightD) * scale, 2.0 * texelSize * 10.0);
    
    // Cross product gives surface normal
    let calculatedNormal = normalize(cross(dx, dy));
    
    // Use calculated normal for top surface, mesh normal for sides/bottom
    let isTopSurface = input.normal.y > 0.5;
    let normal = select(normalize(input.normal), calculatedNormal, isTopSurface);
    
    // Terrain mode with lighting and color gradients
    // Negate light direction - GUI values represent where light comes FROM
    let lightDir = normalize(-uniforms.lightDirection);
    
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
        // Top surface gets normal diffuse lighting with ambient control
        // Use shadowIntensity to control ambient light (0 = bright, 1 = dark ambient)
        let ambientLevel = mix(0.4, 0.1, uniforms.shadowIntensity);
        diffuse = max(dot(normal, lightDir), ambientLevel);
        
        // Enhanced lighting: approximate AO from height variation
        if (uniforms.shadowsEnabled > 0.5) {
            // Sample nearby heights for simple AO approximation
            let avgHeight = (heightL + heightR + heightD + heightU) * 0.25;
            let heightVariation = abs(height - avgHeight);
            let ao = 1.0 - (heightVariation * 0.5); // Valleys get darker
            diffuse *= mix(1.0, ao, 0.3); // Subtle AO effect
        }
    } else {
        // Use solid bottom color for sides and bottom with higher ambient lighting
        color = uniforms.bottomColor / 255.0;
        // Sides/bottom get softer lighting with higher ambient (70% base + 30% diffuse)
        diffuse = max(dot(normal, lightDir), 0.0) * 0.3 + 0.7;
    }
    
    // Apply lighting
    var finalColor = color * diffuse;
    
    // Draw a sun sphere in the sky for visual reference
    // Calculate sun position in view space (light direction points FROM sun)
    let sunDistance = 100.0;
    let sunPos = uniforms.cameraPosition + uniforms.lightDirection * sunDistance;
    let sunDir = normalize(sunPos - input.worldPos);
    let sunAngle = dot(sunDir, normalize(uniforms.cameraPosition - input.worldPos));
    
    // Draw sun if looking in that direction (simple sphere approximation)
    if (sunAngle > 0.998) { // Very narrow cone
        let sunBrightness = smoothstep(0.998, 0.9995, sunAngle);
        let sunColor = vec3f(1.0, 0.95, 0.8); // Warm sun color
        finalColor = mix(finalColor, sunColor, sunBrightness * 0.8);
    }
    
    // Shadows disabled - causes acne on low-poly displaced mesh
    // Would need tessellation or higher mesh resolution for proper shadows
    
    return vec4f(finalColor, 1.0);
}
