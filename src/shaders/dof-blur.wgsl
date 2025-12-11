// Depth of Field - Separable Gaussian Blur (Horizontal or Vertical)
struct DOFUniforms {
    focalDepth: f32,        // Relative offset from camera distance
    focalRange: f32,        // Range around focal depth that stays sharp
    blurStrength: f32,      // Maximum blur radius
    nearBlurStrength: f32,  // Blur strength for near objects
    enabled: f32,           // 1.0 = enabled, 0.0 = disabled
    cameraNear: f32,        // Camera near clipping plane
    cameraFar: f32,         // Camera far clipping plane
    cameraDistance: f32,    // Current camera distance from target
    direction: vec2<f32>,   // (1,0) for horizontal, (0,1) for vertical
}

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_depth_2d;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> uniforms: DOFUniforms;

// Gaussian kernel weights for 9-tap blur
const KERNEL_SIZE = 9;
const KERNEL_WEIGHTS = array<f32, 9>(
    0.0625, 0.125, 0.0625,
    0.125,  0.25,  0.125,
    0.0625, 0.125, 0.0625
);

// Linearize depth from 0-1 range to world space distance
fn linearizeDepth(depth: f32, near: f32, far: f32) -> f32 {
    // Standard depth buffer (0 = near, 1 = far)
    let ndc = depth * 2.0 - 1.0; // Convert to NDC [-1, 1]
    return (2.0 * near * far) / (far + near - ndc * (far - near));
}

// Calculate circle of confusion (blur amount) based on depth
fn calculateCoC(depth: f32) -> f32 {
    // Use camera near/far planes from uniforms
    let near = uniforms.cameraNear;
    let far = uniforms.cameraFar;
    
    // Convert depth buffer value to linear view-space distance from camera
    let linearDepth = linearizeDepth(depth, near, far);
    
    // The focal depth is now: camera distance to target + relative offset
    // When focalDepth is 0, we focus at the camera's target point (terrain center)
    // When focalDepth is positive, we focus behind the target
    // When focalDepth is negative, we focus in front of the target
    let absoluteFocalDepth = uniforms.cameraDistance + uniforms.focalDepth;
    
    // Distance from focal plane
    let distanceFromFocus = abs(linearDepth - absoluteFocalDepth);
    
    // If within focus range, no blur
    if (distanceFromFocus < uniforms.focalRange) {
        return 0.0;
    }
    
    // Calculate blur amount based on distance from focus range
    let blurDistance = distanceFromFocus - uniforms.focalRange;
    
    // Determine which blur strength to use
    var blur = 0.0;
    if (linearDepth < absoluteFocalDepth) {
        // Near blur (closer to camera than focal plane)
        blur = min(blurDistance / 2.0, 1.0) * uniforms.nearBlurStrength;
    } else {
        // Far blur (farther from camera than focal plane) 
        blur = min(blurDistance / 2.0, 1.0) * uniforms.blurStrength;
    }
    
    return blur;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let texSize = textureDimensions(inputTexture);
    let coord = vec2<i32>(i32(global_id.x), i32(global_id.y));
    
    if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
        return;
    }
    
    // If DOF is disabled, just copy input to output
    if (uniforms.enabled < 0.5) {
        let color = textureLoad(inputTexture, coord, 0);
        textureStore(outputTexture, coord, color);
        return;
    }
    
    // Sample depth at current pixel and calculate CoC
    let depth = textureLoad(depthTexture, coord, 0);
    let coc = calculateCoC(depth);
    
    // Separable Gaussian blur - always apply, but strength varies by CoC
    var result = vec4<f32>(0.0);
    var totalWeight = 0.0;
    
    // Scale blur radius based on CoC (0 = sharp, 1+ = blurry)
    let blurRadius = coc * 10.0; // Maximum 10 pixel radius
    
    if (blurRadius < 0.5) {
        // If barely any blur, just copy the pixel
        let color = textureLoad(inputTexture, coord, 0);
        textureStore(outputTexture, coord, color);
        return;
    }
    
    let stepSize = max(1.0, blurRadius / 4.0); // Adaptive step size
    
    for (var i = -4; i <= 4; i++) {
        let offset = vec2<f32>(f32(i)) * uniforms.direction * stepSize;
        let sampleCoord = vec2<f32>(coord) + offset;
        
        // Bounds check
        if (sampleCoord.x < 0.0 || sampleCoord.x >= f32(texSize.x) ||
            sampleCoord.y < 0.0 || sampleCoord.y >= f32(texSize.y)) {
            continue;
        }
        
        let samplePos = vec2<i32>(i32(sampleCoord.x), i32(sampleCoord.y));
        let sampleColor = textureLoad(inputTexture, samplePos, 0);
        let weight = KERNEL_WEIGHTS[i + 4];
        
        result += sampleColor * weight;
        totalWeight += weight;
    }
    
    if (totalWeight > 0.0) {
        result /= totalWeight;
    }
    
    textureStore(outputTexture, coord, result);
}
