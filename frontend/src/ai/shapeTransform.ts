/**
 * Deterministic vertex math for Shapes-assistant drafts. Every transform
 * preserves the vertex count by construction (one output per input vertex),
 * so results always satisfy mesh-topology validation. Pure: no engine access.
 */

export interface ShapeVertex {
  readonly x: number
  readonly y: number
}

export type ShapeTransform =
  | { readonly type: 'rotate'; readonly degrees: number; readonly cx: number; readonly cy: number }
  | {
      readonly type: 'scale'
      readonly sx: number
      readonly sy: number
      readonly cx: number
      readonly cy: number
    }
  | { readonly type: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly type: 'mirror'; readonly axis: 'x' | 'y'; readonly cx: number; readonly cy: number }
  | { readonly type: 'blend'; readonly t: number }

export function shapeCentroid(vertices: readonly ShapeVertex[]): {
  readonly cx: number
  readonly cy: number
} {
  let sx = 0
  let sy = 0
  for (const vertex of vertices) {
    sx += vertex.x
    sy += vertex.y
  }
  const count = vertices.length || 1
  return { cx: sx / count, cy: sy / count }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Applies a transform to every vertex. Blend additionally needs the donor-B
 * vertices (same mesh, same count). Returns an error string instead of
 * partial output when inputs are unusable.
 */
export function applyShapeTransform(
  vertices: readonly ShapeVertex[],
  transform: ShapeTransform,
  donorVertices?: readonly ShapeVertex[],
): { readonly vertices: ShapeVertex[] } | { readonly error: string } {
  if (vertices.length === 0) return { error: 'The source Shape has no vertices to transform.' }
  if (!vertices.every((v) => isFiniteNumber(v.x) && isFiniteNumber(v.y))) {
    return { error: 'The source Shape has non-finite vertex positions — cannot transform.' }
  }
  switch (transform.type) {
    case 'rotate': {
      const radians = (transform.degrees * Math.PI) / 180
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)
      return {
        vertices: vertices.map(({ x, y }) => {
          const dx = x - transform.cx
          const dy = y - transform.cy
          return { x: transform.cx + dx * cos - dy * sin, y: transform.cy + dx * sin + dy * cos }
        }),
      }
    }
    case 'scale': {
      return {
        vertices: vertices.map(({ x, y }) => ({
          x: transform.cx + (x - transform.cx) * transform.sx,
          y: transform.cy + (y - transform.cy) * transform.sy,
        })),
      }
    }
    case 'translate': {
      return {
        vertices: vertices.map(({ x, y }) => ({ x: x + transform.dx, y: y + transform.dy })),
      }
    }
    case 'mirror': {
      return {
        vertices: vertices.map(({ x, y }) =>
          transform.axis === 'x' ? { x: 2 * transform.cx - x, y } : { x, y: 2 * transform.cy - y },
        ),
      }
    }
    case 'blend': {
      if (!donorVertices) return { error: 'Blend needs a second donor Shape from the same mesh.' }
      if (donorVertices.length !== vertices.length) {
        return {
          error: `Blend donors have different vertex counts (${vertices.length} vs ${donorVertices.length}) — both Shapes must come from the same mesh.`,
        }
      }
      if (!donorVertices.every((v) => isFiniteNumber(v.x) && isFiniteNumber(v.y))) {
        return { error: 'The blend donor has non-finite vertex positions — cannot transform.' }
      }
      const t = transform.t
      return {
        vertices: vertices.map(({ x, y }, index) => {
          const donor = donorVertices[index]!
          return { x: x + (donor.x - x) * t, y: y + (donor.y - y) * t }
        }),
      }
    }
  }
}

/** One-line human summary for proposal titles and review text. */
export function describeShapeTransform(transform: ShapeTransform): string {
  switch (transform.type) {
    case 'rotate':
      return `rotate ${transform.degrees}°`
    case 'scale':
      return transform.sx === transform.sy
        ? `scale ${transform.sx}×`
        : `scale ${transform.sx}×${transform.sy}`
    case 'translate':
      return `shift ${transform.dx}, ${transform.dy}`
    case 'mirror':
      return transform.axis === 'x' ? 'mirror left-right' : 'mirror top-bottom'
    case 'blend':
      return `blend ${Math.round(transform.t * 100)}%`
  }
}
