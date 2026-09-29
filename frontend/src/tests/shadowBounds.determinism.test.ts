import { describe, it, expect } from 'vitest'
import {
  shadowRenderScale,
  tightCasterUnion,
  tightBoundsSize,
  isSilhouetteCaster,
} from '../engine/shadowBounds'
import { deriveShadowProjection } from '../engine/shadowEffect'

function caster(
  id: string,
  kind: 'mesh' | 'circle' | 'assetInstance' | 'text',
  x: number,
  y: number,
  w = 100,
  h = 50,
) {
  const components: Record<string, unknown> =
    kind === 'mesh'
      ? { mesh: {} }
      : kind === 'circle'
        ? { circle: {} }
        : kind === 'assetInstance'
          ? { assetInstance: {} }
          : { text: {} }
  return { id, visible: true, opacity: 1, components, x, y, w, h }
}

function depsOf(list: ReturnType<typeof caster>[], hostId = 'g') {
  const sizes = new Map(list.map((c) => [c.id, { width: c.w, height: c.h }]))
  const worlds = new Map(
    list.map((c) => [c.id, { x: c.x, y: c.y, rotation: 0, scaleX: 1, scaleY: 1 }]),
  )
  return {
    casters: list,
    hostId,
    time: 0,
    sizeOf: (id: string) => sizes.get(id) ?? null,
    worldOf: (id: string) => worlds.get(id) ?? null,
    evaluatedOf: () => ({ visible: true, opacity: 1 }),
  }
}

describe('shadow tight bounds determinism', () => {
  it('same light params + same tight union give identical projection regardless of history', () => {
    const list = [caster('a', 'mesh', 0, 0), caster('b', 'circle', 120, 10)]
    const union = tightCasterUnion(depsOf(list))
    expect(union).not.toBeNull()
    const size = tightBoundsSize(union)
    expect(size).toBeDefined()
    const p1 = deriveShadowProjection(size!, 'bottom', 135, 45, 28)
    // Simulate a stale envelope twice as large (old grow-only bug input)
    const stale = { w: size!.w * 2, h: size!.h * 2 }
    const pStale = deriveShadowProjection(stale, 'bottom', 135, 45, 28)
    // Documents the bug class: stale bounds MUST NOT be used — offsets differ.
    expect(pStale.offsetX).not.toBeCloseTo(p1.offsetX, 6)
    // Live recompute from same casters is stable across calls.
    const union2 = tightCasterUnion(depsOf(list))
    const p2 = deriveShadowProjection(tightBoundsSize(union2)!, 'bottom', 135, 45, 28)
    expect(p2).toEqual(p1)
  })

  it('moving the group moves the union origin exactly (shadow follows)', () => {
    const mk = (dx: number) => [caster('a', 'mesh', dx, 0), caster('b', 'circle', 120 + dx, 10)]
    const u1 = tightCasterUnion(depsOf(mk(0)))
    const u2 = tightCasterUnion(depsOf(mk(50)))
    expect(u1 && u2).toBeTruthy()
    expect(u2!.minX - u1!.minX).toBeCloseTo(50, 9)
    expect(u2!.maxX - u1!.maxX).toBeCloseTo(50, 9)
    // Size unchanged by pure translation → projection scale/rotation stable.
    const s1 = tightBoundsSize(u1)!
    const s2 = tightBoundsSize(u2)!
    expect(s2.w).toBeCloseTo(s1.w, 9)
    expect(s2.h).toBeCloseTo(s1.h, 9)
  })

  it('text/table/chart casters contribute no union (bounds agree with silhouette pixels)', () => {
    expect(isSilhouetteCaster({ components: { text: {} } })).toBe(false)
    expect(isSilhouetteCaster({ components: { mesh: {} } })).toBe(true)
    const textOnly = [caster('t', 'text', 0, 0)]
    expect(tightCasterUnion(depsOf(textOnly))).toBeNull()
    expect(tightBoundsSize(null)).toBeUndefined()
  })

  it('localPivot shifts the union exactly like the silhouette vertex math', () => {
    // Drawing maps local point p as R((p - pivotOff) * s) + t with
    // pivotOff = pivot * size. The union must cover the same span or the
    // tight render target clips the drawn silhouette to a fragment.
    const pivot = { x: 0.5, y: 0 }
    const withPivot = [{ ...caster('a', 'mesh', 100, 100), transform: { localPivot: pivot } }]
    const without = [caster('a', 'mesh', 100, 100)]
    const uP = tightCasterUnion(depsOf(withPivot))
    const u0 = tightCasterUnion(depsOf(without))
    expect(uP && u0).toBeTruthy()
    // pivot.x=0.5 on a 100-wide box shifts the span by half the width
    expect(uP!.minX - u0!.minX).toBeCloseTo(-50, 9)
    expect(uP!.maxX - u0!.maxX).toBeCloseTo(-50, 9)
    // size is unchanged — only the frame moves
    expect(uP!.maxX - uP!.minX).toBeCloseTo(u0!.maxX - u0!.minX, 9)
  })

  it('reduces geometry scale together with a capped render texture', () => {
    expect(shadowRenderScale(2, 500, 400, 2048)).toBe(2)
    expect(shadowRenderScale(2, 2000, 1000, 2048)).toBeCloseTo(1.024, 9)
    // The effective scale makes the largest texture dimension exactly fit.
    expect(2000 * shadowRenderScale(2, 2000, 1000, 2048)).toBeCloseTo(2048, 9)
  })
})
