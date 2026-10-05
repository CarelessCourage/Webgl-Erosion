// Terrain Vertex and Fragment Shader for WebGPU

struct Uniforms {
    modelMatrix: mat4x4f,
    viewProjMatrix: mat4x4f,
    lightViewProjMatrix: mat4x4f,
    cameraPosition: vec3f,
    visualizationMode: f32,        // 0 = terrain, 1 = heightmap, 2+ = erosion map (see erosionMapValue)
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
    heightScale: f32,              // texture height -> displayed height
    showWater: f32,                // 0.0 = off, 1.0 = tint cells that hold water
    erosionMapRange: f32,          // world-space depth that reads as ~63% erosion/deposition
    flowMapRange: f32,             // discharge that reads as ~63% in the flow paths map
}


// Color system structures
struct ColorStop {
    threshold: f32,
    r: f32,
    g: f32,
    b: f32,
}

struct ColorGroup {
    enabled: f32,           // 0.0 = disabled, 1.0 = enabled
    strength: f32,          // 0.0 to 1.0
    blendMode: f32,         // 0=replace, 1=multiply, 2=add, 3=overlay
    stopCount: f32,         // Number of color stops
    sourceLayerIndex: f32,  // -1 = master alpha, >= 0 = layer index, <= -2 = erosion map
    maskByAlpha: f32,       // 1.0 = opacity ramps from the first to the last stop (see groupOpacity)
    padding2: f32,
    padding3: f32,
    stops: array<ColorStop, 16>,  // Max 16 stops per group
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
    @location(3) height: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> layers: array<Layer>;
@group(0) @binding(2) var heightTexture: texture_2d<f32>;
@group(0) @binding(3) var imageTextures: texture_2d_array<f32>;
@group(0) @binding(4) var imageSampler: sampler;
@group(0) @binding(5) var<storage, read> colorGroups: array<ColorGroup, 8>;


// Color System Functions

// Evaluate a single color group to get color based on alpha value
fn evaluateColorGroup(group: ColorGroup, alphaValue: f32) -> vec3f {
    let stopCount = i32(group.stopCount);
    
    // Handle edge cases
    if (stopCount == 0) {
        return vec3f(0.0);
    }
    if (stopCount == 1) {
        return vec3f(group.stops[0].r, group.stops[0].g, group.stops[0].b);
    }
    
    // Clamp alpha value to valid range
    let alpha = clamp(alphaValue, 0.0, 1.0);
    
    // Find which two stops to interpolate between
    var lowerStop = 0;
    var upperStop = 0;
    
    // Find the stops that bracket our alpha value
    for (var i = 0; i < stopCount - 1; i++) {
        if (alpha >= group.stops[i].threshold && alpha <= group.stops[i + 1].threshold) {
            lowerStop = i;
            upperStop = i + 1;
            break;
        }
    }
    
    // Handle if alpha is beyond last stop
    if (alpha > group.stops[stopCount - 1].threshold) {
        lowerStop = stopCount - 1;
        upperStop = stopCount - 1;
    }
    
    // Get the two colors to blend
    let color1 = vec3f(group.stops[lowerStop].r, group.stops[lowerStop].g, group.stops[lowerStop].b);
    let color2 = vec3f(group.stops[upperStop].r, group.stops[upperStop].g, group.stops[upperStop].b);
    
    // Calculate interpolation factor
    let t1 = group.stops[lowerStop].threshold;
    let t2 = group.stops[upperStop].threshold;
    let t = select(0.0, (alpha - t1) / (t2 - t1), t2 != t1);
    
    // Smooth interpolation between colors
    return mix(color1, color2, smoothstep(0.0, 1.0, t));
}

// Blend two colors based on blend mode
fn blendColors(base: vec3f, overlay: vec3f, blendMode: f32, strength: f32) -> vec3f {
    let mode = i32(blendMode);
    
    switch (mode) {
        case 0: { // Replace
            return mix(base, overlay, strength);
        }
        case 1: { // Multiply
            return mix(base, base * overlay, strength);
        }
        case 2: { // Add
            return mix(base, base + overlay, strength);
        }
        case 3: { // Overlay
            // Photoshop-style overlay
            var result: vec3f;
            for (var i = 0; i < 3; i++) {
                if (base[i] < 0.5) {
                    result[i] = 2.0 * base[i] * overlay[i];
                } else {
                    result[i] = 1.0 - 2.0 * (1.0 - base[i]) * (1.0 - overlay[i]);
                }
            }
            return mix(base, result, strength);
        }
        default: {
            return base;
        }
    }
}

// Calculate individual layer alpha values for color group masking
fn getLayerAlpha(layerIndex: i32, uv: vec2f) -> f32 {
    if (layerIndex < 0 || layerIndex >= 5) {
        return 0.0;
    }
    
    let layer = layers[layerIndex];
    if (layer.enabled < 0.5) {
        return 0.0;
    }
    
    let layerTypeInt = i32(layer.layerType);
    var layerValue = 0.0;
    
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
    
    return layerValue * layer.strength;
}

// With "Alpha as Opacity" the group is transparent below its first stop and
// fully applied at its last stop, so stops choose which part of the map gets painted.
fn groupOpacity(group: ColorGroup, alphaValue: f32) -> f32 {
    if (group.maskByAlpha < 0.5) {
        return group.strength;
    }
    let first = group.stops[0].threshold;
    let last = group.stops[max(i32(group.stopCount) - 1, 0)].threshold;
    var ramp = step(first, alphaValue);
    if (last > first) {
        ramp = clamp((alphaValue - first) / (last - first), 0.0, 1.0);
    }
    return group.strength * ramp;
}

// Evaluate all color groups and blend them together
fn evaluateAllColorGroups(masterAlpha: f32, uv: vec2f) -> vec3f {
    var finalColor = vec3f(0.0);
    var firstGroup = true;
    
    // Process each color group
    for (var i = 0; i < 8; i++) {
        let group = colorGroups[i];
        
        // Skip disabled groups
        if (group.enabled < 0.5 || group.stopCount < 1.0) {
            continue;
        }
        
        // Determine which alpha value to use for this group
        var alphaValue = masterAlpha;
        let sourceIndex = i32(group.sourceLayerIndex);
        
        if (sourceIndex >= 0) {
            // Use specific layer's alpha as mask
            alphaValue = getLayerAlpha(sourceIndex, uv);
        } else if (sourceIndex <= -2) {
            // Use an erosion simulation map (-2 eroded, -3 deposited, -4 flow, -5 water)
            alphaValue = erosionMapValue(-sourceIndex - 2, uv);
        }
        
        // Evaluate this group's color
        let groupColor = evaluateColorGroup(group, alphaValue);
        
        // Blend with accumulated color
        if (firstGroup) {
            finalColor = groupColor * group.strength;
            firstGroup = false;
        } else {
            finalColor = blendColors(finalColor, groupColor, group.blendMode, groupOpacity(group, alphaValue));
        }
    }
    
    // Fallback to legacy colors if no groups produced color
    if (firstGroup) {
        // Use old color system
        if (masterAlpha < uniforms.lowThreshold) {
            finalColor = uniforms.lowColor;
        } else if (masterAlpha < uniforms.highThreshold) {
            let t = (masterAlpha - uniforms.lowThreshold) / (uniforms.highThreshold - uniforms.lowThreshold);
            finalColor = mix(uniforms.lowColor, uniforms.midColor, t);
        } else {
            let t = (masterAlpha - uniforms.highThreshold) / (1.0 - uniforms.highThreshold);
            finalColor = mix(uniforms.midColor, uniforms.highColor, t);
        }
    }
    
    return finalColor;
}



// Bilinear sample of the height texture (rgba32float is not filterable).
// r = terrain height, g = water depth (erosion cell units), b = flow paths,
// a = erosion delta (see shaders/erosion/export.wgsl)
fn sampleTerrain(uv: vec2f) -> vec4f {
    let size = vec2i(textureDimensions(heightTexture));
    let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(size) - 0.5;
    let f = floor(p);
    let w = p - f;
    let c = vec2i(f);
    let maxC = size - 1;
    let a = textureLoad(heightTexture, clamp(c, vec2i(0), maxC), 0);
    let b = textureLoad(heightTexture, clamp(c + vec2i(1, 0), vec2i(0), maxC), 0);
    let d = textureLoad(heightTexture, clamp(c + vec2i(0, 1), vec2i(0), maxC), 0);
    let e = textureLoad(heightTexture, clamp(c + vec2i(1, 1), vec2i(0), maxC), 0);
    return mix(mix(a, b, w.x), mix(d, e, w.x), w.y);
}

fn terrainHeight(uv: vec2f) -> f32 {
    return sampleTerrain(uv).r * uniforms.heightScale;
}

// Erosion simulation maps as 0-1 alpha values:
// 0 = eroded (carved away), 1 = deposited, 2 = flow paths, 3 = water
fn erosionMapValue(kind: i32, uv: vec2f) -> f32 {
    let t = sampleTerrain(uv);
    // Erosion delta in world units, so the map follows the displayed relief
    let worldDelta = t.a * uniforms.heightScale * 5.0;
    let erosionRange = max(uniforms.erosionMapRange, 1e-5);
    let flowRange = max(uniforms.flowMapRange, 1e-5);
    switch (kind) {
        case 0: { return 1.0 - exp(-max(-worldDelta, 0.0) / erosionRange); }
        case 1: { return 1.0 - exp(-max(worldDelta, 0.0) / erosionRange); }
        case 2: { return 1.0 - exp(-t.b / flowRange); }
        case 3: { return smoothstep(0.05, 1.5, t.g); }
        default: { return 0.0; }
    }
}

@vertex
fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Height comes from the layer texture, which includes erosion when it has run
    let height = terrainHeight(input.uv);
    
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
    output.height = height;  // Pass height to fragment shader
    output.position = uniforms.viewProjMatrix * worldPos;
    
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // Get height value from vertex shader
    let height = input.height;
    
    // Map visualization modes (grayscale): height map or an erosion map
    let mode = i32(uniforms.visualizationMode + 0.5);
    if (mode == 1) {
        return vec4f(vec3f(height), 1.0);
    }
    if (mode >= 2) {
        // Sides/bottom would only show stretched edge texels, so keep them neutral
        if (input.normal.y < 0.5) {
            return vec4f(vec3f(0.12), 1.0);
        }
        return vec4f(vec3f(erosionMapValue(mode - 2, input.uv)), 1.0);
    }
    
    // Normals from neighbouring texels of the height texture
    let texelSize = 1.0 / f32(textureDimensions(heightTexture).x);
    let heightL = terrainHeight(input.uv + vec2f(-texelSize, 0.0));
    let heightR = terrainHeight(input.uv + vec2f(texelSize, 0.0));
    let heightD = terrainHeight(input.uv + vec2f(0.0, -texelSize));
    let heightU = terrainHeight(input.uv + vec2f(0.0, texelSize));
    
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
        // Use new color group system for top surface
        // Height is used as the master alpha value
        color = evaluateAllColorGroups(height, input.uv);
        
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
        var normalizedBottomColor = uniforms.bottomColor;
        if (uniforms.bottomColor.x > 1.0 || uniforms.bottomColor.y > 1.0 || uniforms.bottomColor.z > 1.0) {
            normalizedBottomColor = uniforms.bottomColor / 255.0;
        }
        color = normalizedBottomColor;
        // Sides/bottom get softer lighting with higher ambient (70% base + 30% diffuse)
        diffuse = max(dot(normal, lightDir), 0.0) * 0.3 + 0.7;
    }
    
    // Apply lighting
    var finalColor = color * diffuse;

    // Water from the erosion simulation
    if (isTopSurface && uniforms.showWater > 0.5) {
        // Fade in from a thin film to fully covered so rain sheets stay subtle
        let coverage = erosionMapValue(3, input.uv);
        let waterColor = vec3f(0.12, 0.32, 0.55) * max(lightDir.y, 0.5);
        finalColor = mix(finalColor, waterColor, coverage * 0.9);
    }
    
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
