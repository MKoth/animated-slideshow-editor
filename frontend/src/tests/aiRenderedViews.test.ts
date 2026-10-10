import { describe, expect, it } from 'vitest'
import {
  resolveRenderedViews,
  formatRenderedViewLabel,
  RENDERED_VIEW_LIMITS,
  type RenderedViewSnapshot,
} from '../ai/renderedViews'

function snapshot(): RenderedViewSnapshot {
  return {
    slideId: 's-1',
    slideName: 'Room',
    duration: 12,
    nodes: [
      { id: 'n-cat', name: 'Cat' },
      { id: 'n-sofa', name: 'Sofa' },
      { id: 'n-blackboard', name: 'Blackboard' },
    ],
  }
}

describe('resolveRenderedViews (read-only labelled views, issue #441)', () => {
  it('resolves a current-scene view labelled with Slide, time, and stable node ids', () => {
    const result = resolveRenderedViews([{ id: 'v-1', scope: 'current', time: 3.2 }], snapshot())
    expect(result.views).toHaveLength(1)
    const view = result.views[0]
    expect(view.status).toBe('ready')
    expect(view.slideId).toBe('s-1')
    expect(view.slideName).toBe('Room')
    expect(view.time).toBe(3.2)
    expect(view.nodeIds).toContain('n-cat')
    // Label carries Slide, time, and stable ids.
    expect(view.label).toMatch(/Room/)
    expect(view.label).toMatch(/s-1/)
    expect(view.label).toMatch(/3\.2/)
    expect(view.label).toMatch(/n-cat/)
  })

  it('resolves a focused view scoped to the requested stable ids at the selected time', () => {
    const result = resolveRenderedViews(
      [{ id: 'v-1', scope: 'focused', time: 5, nodeIds: ['n-cat', 'n-sofa'] }],
      snapshot(),
    )
    const view = result.views[0]
    expect(view.status).toBe('ready')
    expect(view.nodeIds).toEqual(['n-cat', 'n-sofa'])
    expect(view.time).toBe(5)
    expect(view.label).toMatch(/n-cat/)
    expect(view.label).toMatch(/n-sofa/)
  })

  it('clamps out-of-range times with an explicit warning instead of failing', () => {
    const result = resolveRenderedViews([{ id: 'v-1', scope: 'current', time: 99 }], snapshot())
    const view = result.views[0]
    expect(view.status).toBe('ready')
    expect(view.time).toBe(12)
    expect(view.warnings.join(' ').toLowerCase()).toMatch(/clamp/)
  })

  it('rejects unknown node ids with a precise fix instead of guessing', () => {
    const result = resolveRenderedViews(
      [{ id: 'v-1', scope: 'focused', time: 1, nodeIds: ['n-gone'] }],
      snapshot(),
    )
    const view = result.views[0]
    expect(view.status).toBe('invalid')
    expect(view.nodeIds).toEqual([])
    expect(view.actions.join(' ').toLowerCase()).toMatch(/n-gone|stable.*id|scene node/)
  })

  it('rejects empty focused scopes and unknown scopes without guessing', () => {
    const result = resolveRenderedViews(
      [
        { id: 'v-empty', scope: 'focused', time: 1, nodeIds: [] },
        { id: 'v-scope', scope: 'close-up' as never, time: 1 },
      ],
      snapshot(),
    )
    expect(result.views[0].status).toBe('invalid')
    expect(result.views[0].actions.length).toBeGreaterThan(0)
    expect(result.views[1].status).toBe('invalid')
    expect(result.views[1].actions.join(' ').toLowerCase()).toMatch(/scope|current|focused/)
  })

  it('rejects views for a different slide with the precise active slide to use', () => {
    const result = resolveRenderedViews(
      [{ id: 'v-1', scope: 'current', time: 1, slideId: 's-other' }],
      snapshot(),
    )
    const view = result.views[0]
    expect(view.status).toBe('invalid')
    expect(view.actions.join(' ')).toMatch(/s-1/)
  })

  it('keeps Slide and time on invalid results so the fix stays relatable', () => {
    const result = resolveRenderedViews(
      [{ id: 'v-1', scope: 'focused', time: 4, nodeIds: ['n-gone'] }],
      snapshot(),
    )
    const view = result.views[0]
    expect(view.status).toBe('invalid')
    expect(view.slideId).toBe('s-1')
    expect(view.time).toBe(4)
    expect(view.label).toMatch(/s-1/)
    expect(view.nodeIds).toEqual([])
  })

  it('bounds views and node ids, noting truncation', () => {
    const many = Array.from({ length: RENDERED_VIEW_LIMITS.maxViews + 3 }, (_, i) => ({
      id: `v-${i}`,
      scope: 'current' as const,
      time: i,
    }))
    const result = resolveRenderedViews(many, snapshot())
    expect(result.views.length).toBe(RENDERED_VIEW_LIMITS.maxViews)
    expect(result.truncated).toBe(true)
  })

  it('states on every ready view that visual evidence complements structured data', () => {
    const result = resolveRenderedViews([{ id: 'v-1', scope: 'current', time: 2 }], snapshot())
    const view = result.views[0]
    expect(view.status).toBe('ready')
    expect(`${view.note} ${view.warnings.join(' ')}`.toLowerCase()).toMatch(
      /complement|does not replace|structured/,
    )
  })

  it('never mutates the snapshot or the requests', () => {
    const snap = snapshot()
    const requests = [{ id: 'v-1', scope: 'current' as const, time: 2 }]
    const beforeSnap = JSON.stringify(snap)
    const beforeRequests = JSON.stringify(requests)
    resolveRenderedViews(requests, snap)
    expect(JSON.stringify(snap)).toBe(beforeSnap)
    expect(JSON.stringify(requests)).toBe(beforeRequests)
  })

  it('formats labels with Slide, time, and stable ids (pure helper)', () => {
    const label = formatRenderedViewLabel({
      slideName: 'Room',
      slideId: 's-1',
      time: 2.5,
      nodeIds: ['n-cat'],
      scope: 'focused',
    })
    expect(label).toMatch(/Room/)
    expect(label).toMatch(/s-1/)
    expect(label).toMatch(/2\.5/)
    expect(label).toMatch(/n-cat/)
  })
})
