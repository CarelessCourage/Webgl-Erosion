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

// Layer data structure (matching LayerCompute)
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
    sourceLayerIndex: f32,  // -1 = master alpha, >= 0 = specific layer index
    padding1: f32,
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

// High quality hash function for procedural noise
fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// High quality smooth interpolation
fn quintic(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
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

// Procedural gradient noise (keeping as backup)
fn gradientNoise(p: vec2f, seed: f32) -> f32 {
    let i = floor(p + seed * 137.1);
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
    
    return mix(mix(va, vb, u), mix(vc, vd, u), v);
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
        }
        
        // Evaluate this group's color
        let groupColor = evaluateColorGroup(group, alphaValue);
        
        // Blend with accumulated color
        if (firstGroup) {
            finalColor = groupColor * group.strength;
            firstGroup = false;
        } else {
            finalColor = blendColors(finalColor, groupColor, group.blendMode, group.strength);
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

@vertex
fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Calculate base height procedurally from layers
    let proceduralHeight = calculateHeight(input.uv);
    
    // Sample height texture from erosion simulation using textureLoad (vertex shader compatible)
    let textureSize = textureDimensions(heightTexture);
    let texelCoord = vec2<i32>(input.uv * vec2<f32>(textureSize));
    let textureHeight = textureLoad(heightTexture, texelCoord, 0).r;
    
    // Blend procedural and texture height (texture takes priority for erosion effects)
    let height = mix(proceduralHeight, textureHeight, 0.9);
    
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
    
    // Heightmap visualization mode (grayscale)
    if (uniforms.visualizationMode > 0.5) {
        let gray = vec3f(height);
        return vec4f(gray, 1.0);
    }
    
    // Calculate proper normal from combined heights (procedural + texture) for accurate lighting
    let texelSize = 1.0 / 512.0;
    
    // Sample heights from both procedural and texture sources for normals
    let proceduralL = calculateHeight(input.uv + vec2f(-texelSize, 0.0));
    let proceduralR = calculateHeight(input.uv + vec2f(texelSize, 0.0));
    let proceduralD = calculateHeight(input.uv + vec2f(0.0, -texelSize));
    let proceduralU = calculateHeight(input.uv + vec2f(0.0, texelSize));
    
    // Sample height texture using textureLoad (convert UV to texel coordinates)
    let textureSize = textureDimensions(heightTexture);
    let texelL = vec2<i32>((input.uv + vec2f(-texelSize, 0.0)) * vec2<f32>(textureSize));
    let texelR = vec2<i32>((input.uv + vec2f(texelSize, 0.0)) * vec2<f32>(textureSize));
    let texelD = vec2<i32>((input.uv + vec2f(0.0, -texelSize)) * vec2<f32>(textureSize));
    let texelU = vec2<i32>((input.uv + vec2f(0.0, texelSize)) * vec2<f32>(textureSize));
    
    let textureL = textureLoad(heightTexture, texelL, 0).r;
    let textureR = textureLoad(heightTexture, texelR, 0).r;
    let textureD = textureLoad(heightTexture, texelD, 0).r;
    let textureU = textureLoad(heightTexture, texelU, 0).r;
    
    // Blend procedural and texture heights for normal calculation
    let heightL = mix(proceduralL, textureL, 0.8);
    let heightR = mix(proceduralR, textureR, 0.8);
    let heightD = mix(proceduralD, textureD, 0.8);
    let heightU = mix(proceduralU, textureU, 0.8);
    
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
