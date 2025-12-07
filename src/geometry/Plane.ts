import { vec2, vec3 } from 'gl-matrix';

export interface PlaneGeometry {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
    vertexCount: number;
    indexCount: number;
}

/**
 * Creates a subdivided plane geometry for terrain with thickness (sides and bottom)
 * @param center Center position of the plane
 * @param scale Size of the plane in X and Z
 * @param subdivs Subdivision level (2^subdivs squares)
 */
export function createPlane(
    center: vec3,
    scale: vec2,
    subdivs: number
): PlaneGeometry {
    // Ensure subdivs is even
    subdivs = subdivs + (subdivs % 2);
    
    const width = Math.pow(2, subdivs / 2);
    const normalize = 1.0 / width;
    
    // Top surface vertices
    const topVertexCount = (width + 1) * (width + 1);
    // Bottom vertices (same count)
    const bottomVertexCount = topVertexCount;
    // Side vertices (perimeter only, but we'll reuse top and bottom edge vertices)
    const totalVertexCount = topVertexCount + bottomVertexCount;
    
    // Allocate arrays with space for top, bottom, and connecting geometry
    const positions = new Float32Array(totalVertexCount * 4);
    const normals = new Float32Array(totalVertexCount * 4);
    const uvs = new Float32Array(totalVertexCount * 2);
    
    const bottomHeight = -2.0; // Height of the bottom surface
    
    // Generate TOP surface vertices
    let posIdx = 0;
    let uvIdx = 0;
    for (let x = 0; x <= width; ++x) {
        for (let z = 0; z <= width; ++z) {
            const xPos = x * normalize * scale[0] + center[0] - scale[0] * 0.5;
            const zPos = z * normalize * scale[1] + center[2] - scale[1] * 0.5;
            
            // Position
            positions[posIdx] = xPos;
            positions[posIdx + 1] = 0 + center[1];
            positions[posIdx + 2] = zPos;
            positions[posIdx + 3] = 1;
            
            // Normal (pointing up)
            normals[posIdx] = 0;
            normals[posIdx + 1] = 1;
            normals[posIdx + 2] = 0;
            normals[posIdx + 3] = 0;
            
            posIdx += 4;
            
            // UVs
            uvs[uvIdx++] = x * normalize;
            uvs[uvIdx++] = z * normalize;
        }
    }
    
    // Generate BOTTOM surface vertices
    for (let x = 0; x <= width; ++x) {
        for (let z = 0; z <= width; ++z) {
            const xPos = x * normalize * scale[0] + center[0] - scale[0] * 0.5;
            const zPos = z * normalize * scale[1] + center[2] - scale[1] * 0.5;
            
            // Position (at bottom height)
            positions[posIdx] = xPos;
            positions[posIdx + 1] = bottomHeight + center[1];
            positions[posIdx + 2] = zPos;
            positions[posIdx + 3] = 1;
            
            // Normal (pointing down)
            normals[posIdx] = 0;
            normals[posIdx + 1] = -1;
            normals[posIdx + 2] = 0;
            normals[posIdx + 3] = 0;
            
            posIdx += 4;
            
            // UVs (same as top)
            uvs[uvIdx++] = x * normalize;
            uvs[uvIdx++] = z * normalize;
        }
    }
    
    // Calculate indices for top, bottom, and sides
    const topTriangleCount = width * width * 2;
    const bottomTriangleCount = topTriangleCount;
    const sideTriangleCount = (width * 4) * 2; // 4 sides, 2 triangles per quad
    const totalTriangleCount = topTriangleCount + bottomTriangleCount + sideTriangleCount;
    
    const indices = new Uint32Array(totalTriangleCount * 3);
    let indexIdx = 0;
    
    // Generate TOP surface indices
    for (let i = 0; i < width; ++i) {
        for (let j = 0; j < width; ++j) {
            const topLeft = j + i * (width + 1);
            const topRight = j + 1 + i * (width + 1);
            const bottomLeft = j + (i + 1) * (width + 1);
            const bottomRight = j + 1 + (i + 1) * (width + 1);
            
            // First triangle
            indices[indexIdx++] = topLeft;
            indices[indexIdx++] = topRight;
            indices[indexIdx++] = bottomLeft;
            
            // Second triangle
            indices[indexIdx++] = topRight;
            indices[indexIdx++] = bottomLeft;
            indices[indexIdx++] = bottomRight;
        }
    }
    
    // Generate BOTTOM surface indices (reversed winding for correct normals)
    const bottomOffset = topVertexCount;
    for (let i = 0; i < width; ++i) {
        for (let j = 0; j < width; ++j) {
            const topLeft = bottomOffset + j + i * (width + 1);
            const topRight = bottomOffset + j + 1 + i * (width + 1);
            const bottomLeft = bottomOffset + j + (i + 1) * (width + 1);
            const bottomRight = bottomOffset + j + 1 + (i + 1) * (width + 1);
            
            // First triangle (reversed)
            indices[indexIdx++] = topLeft;
            indices[indexIdx++] = bottomLeft;
            indices[indexIdx++] = topRight;
            
            // Second triangle (reversed)
            indices[indexIdx++] = topRight;
            indices[indexIdx++] = bottomLeft;
            indices[indexIdx++] = bottomRight;
        }
    }
    
    // Generate SIDE surfaces
    // Front side (z = 0)
    for (let x = 0; x < width; ++x) {
        const topLeft = x * (width + 1);
        const topRight = (x + 1) * (width + 1);
        const bottomLeft = bottomOffset + x * (width + 1);
        const bottomRight = bottomOffset + (x + 1) * (width + 1);
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = bottomLeft;
        indices[indexIdx++] = topRight;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        indices[indexIdx++] = bottomRight;
    }
    
    // Back side (z = width)
    for (let x = 0; x < width; ++x) {
        const topLeft = x * (width + 1) + width;
        const topRight = (x + 1) * (width + 1) + width;
        const bottomLeft = bottomOffset + x * (width + 1) + width;
        const bottomRight = bottomOffset + (x + 1) * (width + 1) + width;
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomRight;
        indices[indexIdx++] = bottomLeft;
    }
    
    // Left side (x = 0)
    for (let z = 0; z < width; ++z) {
        const topLeft = z;
        const topRight = z + 1;
        const bottomLeft = bottomOffset + z;
        const bottomRight = bottomOffset + z + 1;
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomRight;
        indices[indexIdx++] = bottomLeft;
    }
    
    // Right side (x = width)
    for (let z = 0; z < width; ++z) {
        const topLeft = width * (width + 1) + z;
        const topRight = width * (width + 1) + z + 1;
        const bottomLeft = bottomOffset + width * (width + 1) + z;
        const bottomRight = bottomOffset + width * (width + 1) + z + 1;
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = bottomLeft;
        indices[indexIdx++] = topRight;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        indices[indexIdx++] = bottomRight;
    }
    
    console.log(`Created island: ${totalVertexCount} vertices, ${indices.length / 3} triangles (top: ${topTriangleCount}, bottom: ${bottomTriangleCount}, sides: ${sideTriangleCount})`);
    
    return {
        positions,
        normals,
        uvs,
        indices,
        vertexCount: totalVertexCount,
        indexCount: indices.length,
    };
}
