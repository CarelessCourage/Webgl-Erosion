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
    // Side vertices (4 sides, each with (width+1)*2 vertices for proper normals)
    const sideVertexCount = (width + 1) * 2 * 4;
    const totalVertexCount = topVertexCount + bottomVertexCount + sideVertexCount;
    
    // Allocate arrays
    const positions = new Float32Array(totalVertexCount * 4);
    const normals = new Float32Array(totalVertexCount * 4);
    const uvs = new Float32Array(totalVertexCount * 2);
    
    const bottomHeight = -2.0; // Height of the bottom surface
    
    let posIdx = 0;
    let uvIdx = 0;
    
    // Generate TOP surface vertices
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
    
    const sideVertexStart = topVertexCount + bottomVertexCount;
    
    // Generate SIDE vertices with proper normals
    // Front side (z = 0, normal pointing -Z)
    for (let x = 0; x <= width; ++x) {
        const xPos = x * normalize * scale[0] + center[0] - scale[0] * 0.5;
        const zPos = 0 * normalize * scale[1] + center[2] - scale[1] * 0.5;
        
        // Top vertex - UV must match top surface at z=0
        positions[posIdx] = xPos;
        positions[posIdx + 1] = 0 + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = 0;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = -1;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = x * normalize;
        uvs[uvIdx++] = 0 * normalize; // Match top surface UVs
        
        // Bottom vertex
        positions[posIdx] = xPos;
        positions[posIdx + 1] = bottomHeight + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = 0;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = -1;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = x * normalize;
        uvs[uvIdx++] = 0 * normalize; // Same UV for consistent texture sampling
    }
    
    // Back side (z = width, normal pointing +Z)
    for (let x = 0; x <= width; ++x) {
        const xPos = x * normalize * scale[0] + center[0] - scale[0] * 0.5;
        const zPos = width * normalize * scale[1] + center[2] - scale[1] * 0.5;
        
        // Top vertex - UV must match top surface at z=width
        positions[posIdx] = xPos;
        positions[posIdx + 1] = 0 + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = 0;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = 1;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = x * normalize;
        uvs[uvIdx++] = width * normalize; // Match top surface UVs
        
        // Bottom vertex
        positions[posIdx] = xPos;
        positions[posIdx + 1] = bottomHeight + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = 0;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = 1;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = x * normalize;
        uvs[uvIdx++] = width * normalize; // Same UV for consistent texture sampling
    }
    
    // Left side (x = 0, normal pointing -X)
    for (let z = 0; z <= width; ++z) {
        const xPos = 0 * normalize * scale[0] + center[0] - scale[0] * 0.5;
        const zPos = z * normalize * scale[1] + center[2] - scale[1] * 0.5;
        
        // Top vertex - UV must match top surface at x=0
        positions[posIdx] = xPos;
        positions[posIdx + 1] = 0 + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = -1;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = 0;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = 0 * normalize; // Match top surface UVs
        uvs[uvIdx++] = z * normalize;
        
        // Bottom vertex
        positions[posIdx] = xPos;
        positions[posIdx + 1] = bottomHeight + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = -1;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = 0;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = 0 * normalize; // Same UV for consistent texture sampling
        uvs[uvIdx++] = z * normalize;
    }
    
    // Right side (x = width, normal pointing +X)
    for (let z = 0; z <= width; ++z) {
        const xPos = width * normalize * scale[0] + center[0] - scale[0] * 0.5;
        const zPos = z * normalize * scale[1] + center[2] - scale[1] * 0.5;
        
        // Top vertex - UV must match top surface at x=width
        positions[posIdx] = xPos;
        positions[posIdx + 1] = 0 + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = 1;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = 0;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = width * normalize; // Match top surface UVs
        uvs[uvIdx++] = z * normalize;
        
        // Bottom vertex
        positions[posIdx] = xPos;
        positions[posIdx + 1] = bottomHeight + center[1];
        positions[posIdx + 2] = zPos;
        positions[posIdx + 3] = 1;
        normals[posIdx] = 1;
        normals[posIdx + 1] = 0;
        normals[posIdx + 2] = 0;
        normals[posIdx + 3] = 0;
        posIdx += 4;
        uvs[uvIdx++] = width * normalize; // Same UV for consistent texture sampling
        uvs[uvIdx++] = z * normalize;
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
    
    // Generate SIDE surface indices using dedicated side vertices
    let sideVertexIdx = sideVertexStart;
    
    // Front side
    for (let i = 0; i < width; ++i) {
        const topLeft = sideVertexIdx + i * 2;
        const bottomLeft = sideVertexIdx + i * 2 + 1;
        const topRight = sideVertexIdx + (i + 1) * 2;
        const bottomRight = sideVertexIdx + (i + 1) * 2 + 1;
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = bottomLeft;
        indices[indexIdx++] = topRight;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        indices[indexIdx++] = bottomRight;
    }
    sideVertexIdx += (width + 1) * 2;
    
    // Back side
    for (let i = 0; i < width; ++i) {
        const topLeft = sideVertexIdx + i * 2;
        const bottomLeft = sideVertexIdx + i * 2 + 1;
        const topRight = sideVertexIdx + (i + 1) * 2;
        const bottomRight = sideVertexIdx + (i + 1) * 2 + 1;
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomRight;
        indices[indexIdx++] = bottomLeft;
    }
    sideVertexIdx += (width + 1) * 2;
    
    // Left side
    for (let i = 0; i < width; ++i) {
        const topLeft = sideVertexIdx + i * 2;
        const bottomLeft = sideVertexIdx + i * 2 + 1;
        const topRight = sideVertexIdx + (i + 1) * 2;
        const bottomRight = sideVertexIdx + (i + 1) * 2 + 1;
        
        indices[indexIdx++] = topLeft;
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomLeft;
        
        indices[indexIdx++] = topRight;
        indices[indexIdx++] = bottomRight;
        indices[indexIdx++] = bottomLeft;
    }
    sideVertexIdx += (width + 1) * 2;
    
    // Right side
    for (let i = 0; i < width; ++i) {
        const topLeft = sideVertexIdx + i * 2;
        const bottomLeft = sideVertexIdx + i * 2 + 1;
        const topRight = sideVertexIdx + (i + 1) * 2;
        const bottomRight = sideVertexIdx + (i + 1) * 2 + 1;
        
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
