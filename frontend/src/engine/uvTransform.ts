export type FitMode = 'stretch' | 'cover' | 'contain'

export const DEFAULT_FIT_MODE: FitMode = 'stretch'
export const FIT_MODES: readonly FitMode[] = ['stretch', 'cover', 'contain'] as const

export interface UVScale {
  readonly u: number
  readonly v: number
}

export interface UVOffset {
  readonly u: number
  readonly v: number
}

export interface UVTransform {
  readonly uvScale: UVScale
  readonly uvOffset: UVOffset
  readonly fitMode: FitMode
}

export const DEFAULT_UV_SCALE: UVScale = { u: 1, v: 1 }
export const DEFAULT_UV_OFFSET: UVOffset = { u: 0, v: 0 }

export function defaultUVTransform(): UVTransform {
  return {
    uvScale: { ...DEFAULT_UV_SCALE },
    uvOffset: { ...DEFAULT_UV_OFFSET },
    fitMode: DEFAULT_FIT_MODE,
  }
}

export function isFitMode(value: unknown): value is FitMode {
  return typeof value === 'string' && (FIT_MODES as readonly string[]).includes(value)
}

export function requireFitMode(value: unknown, what = 'Fit mode'): FitMode {
  if (!isFitMode(value)) {
    throw new Error(`${what} must be one of ${FIT_MODES.join(', ')}`)
  }
  return value
}

export function requireUVScale(value: unknown, what = 'uvScale'): UVScale {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${what} must be an object with u and v numbers`)
  }
  const r = value as Record<string, unknown>
  if (typeof r.u !== 'number' || !Number.isFinite(r.u) || r.u <= 0) {
    throw new Error(`${what}.u must be a positive finite number`)
  }
  if (typeof r.v !== 'number' || !Number.isFinite(r.v) || r.v <= 0) {
    throw new Error(`${what}.v must be a positive finite number`)
  }
  return { u: r.u, v: r.v }
}

export function requireUVOffset(value: unknown, what = 'uvOffset'): UVOffset {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${what} must be an object with u and v numbers`)
  }
  const r = value as Record<string, unknown>
  if (typeof r.u !== 'number' || !Number.isFinite(r.u)) {
    throw new Error(`${what}.u must be a finite number`)
  }
  if (typeof r.v !== 'number' || !Number.isFinite(r.v)) {
    throw new Error(`${what}.v must be a finite number`)
  }
  return { u: r.u, v: r.v }
}

export function cloneUVTransform(transform: UVTransform): UVTransform {
  return {
    uvScale: { ...transform.uvScale },
    uvOffset: { ...transform.uvOffset },
    fitMode: transform.fitMode,
  }
}

export function uvTransformsEqual(a: UVTransform | undefined, b: UVTransform | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.uvScale.u === b.uvScale.u &&
    a.uvScale.v === b.uvScale.v &&
    a.uvOffset.u === b.uvOffset.u &&
    a.uvOffset.v === b.uvOffset.v &&
    a.fitMode === b.fitMode
  )
}

/**
 * Apply UV transform to a single UV coordinate.
 * Order: base UV (0..1) → fitMode adjustment (cover/contain centered) → scale → offset
 */
export function applyUVTransformToSingle(
  uv: { readonly u: number; readonly v: number },
  transform: UVTransform,
  geometrySize?: { readonly width: number; readonly height: number },
  textureSize?: { readonly width: number; readonly height: number },
): { u: number; v: number } {
  let u = uv.u
  let v = uv.v

  // Fit mode adjustment — computes fit scale/offset so texture covers/contain geometry
  if (transform.fitMode !== 'stretch') {
    const geoW = geometrySize?.width ?? 1
    const geoH = geometrySize?.height ?? 1
    const texW = textureSize?.width ?? 1
    const texH = textureSize?.height ?? 1
    const geoAspect = geoW / Math.max(geoH, 1e-9)
    const texAspect = texW / Math.max(texH, 1e-9)

    let fitScaleU = 1
    let fitScaleV = 1
    let fitOffsetU = 0
    let fitOffsetV = 0

    if (transform.fitMode === 'cover') {
      if (geoAspect > texAspect) {
        // wider geometry → crop vertical
        fitScaleU = 1
        fitScaleV = texAspect / geoAspect
      } else {
        // taller geometry → crop horizontal
        fitScaleU = geoAspect / texAspect
        fitScaleV = 1
      }
      fitOffsetU = (1 - fitScaleU) / 2
      fitOffsetV = (1 - fitScaleV) / 2
      u = u * fitScaleU + fitOffsetU
      v = v * fitScaleV + fitOffsetV
    } else if (transform.fitMode === 'contain') {
      if (geoAspect > texAspect) {
        // wider geometry → letterbox horizontal (scale >1)
        fitScaleU = geoAspect / texAspect
        fitScaleV = 1
      } else {
        fitScaleU = 1
        fitScaleV = texAspect / geoAspect
      }
      fitOffsetU = (1 - fitScaleU) / 2
      fitOffsetV = (1 - fitScaleV) / 2
      u = u * fitScaleU + fitOffsetU
      v = v * fitScaleV + fitOffsetV
    }
  }

  // User scale/offset (applied after fit)
  u = u * transform.uvScale.u + transform.uvOffset.u
  v = v * transform.uvScale.v + transform.uvOffset.v
  return { u, v }
}

export function applyUVTransformToUVs(
  uvs: readonly { readonly u: number; readonly v: number }[],
  transform: UVTransform,
  geometrySize?: { readonly width: number; readonly height: number },
  textureSize?: { readonly width: number; readonly height: number },
): { u: number; v: number }[] {
  return uvs.map((uv) => applyUVTransformToSingle(uv, transform, geometrySize, textureSize))
}

export function uvTransformToJSON(transform: UVTransform): Record<string, unknown> {
  return {
    uvScale: { ...transform.uvScale },
    uvOffset: { ...transform.uvOffset },
    fitMode: transform.fitMode,
  }
}

export function uvTransformFromJSON(value: unknown, nodeId: string): UVTransform | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'object') {
    throw new Error(`Node "${nodeId}" uvTransform must be an object`)
  }
  const r = value as Record<string, unknown>
  // Allow flat fields or nested: support both {uvScale, uvOffset, fitMode} object and legacy?
  // Expect shape { uvScale: {u,v}, uvOffset:{u,v}, fitMode }
  const uvScale =
    r.uvScale !== undefined
      ? requireUVScale(r.uvScale, `Node "${nodeId}" uvScale`)
      : { ...DEFAULT_UV_SCALE }
  const uvOffset =
    r.uvOffset !== undefined
      ? requireUVOffset(r.uvOffset, `Node "${nodeId}" uvOffset`)
      : { ...DEFAULT_UV_OFFSET }
  const fitMode =
    r.fitMode !== undefined
      ? requireFitMode(r.fitMode, `Node "${nodeId}" fitMode`)
      : DEFAULT_FIT_MODE
  return { uvScale, uvOffset, fitMode }
}
