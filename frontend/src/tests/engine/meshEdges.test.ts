import { describe, expect, it } from 'vitest'
import { extractEdges, edgeKey } from '../../engine/mesh'
import type { MeshData } from '../../engine/mesh'

describe('extractEdges', () => {
  it('returns no edges for empty faces', () => {
    const mesh: MeshData = { vertices: [], faces: [], uvs: [] }
    expect(extractEdges(mesh)).toEqual([])
  })

  it('extracts unique edges from a single triangle', () => {
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [],
    }
    const edges = extractEdges(mesh)
    expect(edges).toHaveLength(3)
    expect(edges).toContainEqual({ v0: 0, v1: 1 })
    expect(edges).toContainEqual({ v0: 1, v1: 2 })
    expect(edges).toContainEqual({ v0: 0, v1: 2 })
  })

  it('deduplicates shared edges between two triangles', () => {
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      faces: [
        { v0: 0, v1: 1, v2: 2 },
        { v0: 0, v1: 2, v2: 3 },
      ],
      uvs: [],
    }
    const edges = extractEdges(mesh)
    // Triangle 1: (0,1), (1,2), (0,2)
    // Triangle 2: (0,2), (2,3), (0,3)
    // Shared: (0,2) — so 5 unique edges
    expect(edges).toHaveLength(5)
  })

  it('normalizes edge ordering so smaller index is first', () => {
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      faces: [{ v0: 2, v1: 0, v2: 1 }],
      uvs: [],
    }
    const edges = extractEdges(mesh)
    // Face (2,0,1) produces edges (2,0), (0,1), (1,2)
    // Normalized: (0,2), (0,1), (1,2)
    expect(edges).toContainEqual({ v0: 0, v1: 2 })
    expect(edges).toContainEqual({ v0: 0, v1: 1 })
    expect(edges).toContainEqual({ v0: 1, v1: 2 })
  })
})

describe('edgeKey', () => {
  it('returns same key regardless of vertex order', () => {
    expect(edgeKey(2, 5)).toBe(edgeKey(5, 2))
  })

  it('returns different keys for different edges', () => {
    expect(edgeKey(0, 1)).not.toBe(edgeKey(0, 2))
  })
})
