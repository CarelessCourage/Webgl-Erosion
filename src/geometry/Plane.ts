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
 * Creates a subdivided plane geometry for terrain
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
    
    // Allocate arrays
    const positions = new Float32Array((width + 1) * (width + 1) * 4);
    const normals = new Float32Array((width + 1) * (width + 1) * 4);
    const uvs = new Float32Array((width + 1) * (width + 1) * 2);
    const indices = new Uint32Array(width * width * 6);
    
    // Generate vertex positions and normals
    let posIdx = 0;
    for (let x = 0; x <= width; ++x) {
        for (let z = 0; z <= width; ++z) {
            // Normal (pointing up)
            normals[posIdx] = 0;
            // Position X
            positions[posIdx++] = x * normalize * scale[0] + center[0] - scale[0] * 0.5;
            
            // Normal Y
            normals[posIdx] = 1;
            // Position Y
            positions[posIdx++] = 0 + center[1];
            
            // Normal Z
            normals[posIdx] = 0;
            // Position Z
            positions[posIdx++] = z * normalize * scale[1] + center[2] - scale[1] * 0.5;
            
            // Normal W
            normals[posIdx] = 0;
            // Position W
            positions[posIdx++] = 1;
        }
    }
    
    // Generate UVs
    let uvIdx = 0;
    for (let x = 0; x <= width; ++x) {
        for (let z = 0; z <= width; ++z) {
            uvs[uvIdx++] = x * normalize;
            uvs[uvIdx++] = z * normalize;
        }
    }
    
    // Generate indices (two triangles per quad)
    let indexIdx = 0;
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
    
    console.log(`Created plane: ${width + 1}x${width + 1} vertices, ${indices.length / 3} triangles`);
    console.log('First vertex:', positions[0], positions[1], positions[2], positions[3]);
    console.log('Last vertex:', positions[positions.length - 4], positions[positions.length - 3], positions[positions.length - 2], positions[positions.length - 1]);
    console.log('First triangle indices:', indices[0], indices[1], indices[2]);
    
    return {
        positions,
        normals,
        uvs,
        indices,
        vertexCount: (width + 1) * (width + 1),
        indexCount: indices.length,
    };
}
