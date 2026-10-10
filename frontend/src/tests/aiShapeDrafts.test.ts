import { describe, expect, it } from 'vitest'
import {
  acceptShapeDraft,
  editShapeDraft,
  proposeShapeDrafts,
  rejectShapeDraft,
  resolveDraftSourceId,
  toDuplicateShapeJson,
  toShapeDraftSnapshot,
  type ShapeDraftSnapshotNode,
} from '../ai/shapeDrafts'
import type { BeatAnalysis } from '../ai/animationAnalysis'
import { createEngine } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { CommandDispatcher, DuplicateShapeCommand, UndoStack } from '../engine/commands'

function beat(overrides: Partial<BeatAnalysis> & { beatId: string }): BeatAnalysis {
  return {
    label: overrides.beatId,
    status: 'missing-motion',
    resolvedNodeIds: ['n-cat'],
    reusable: [],
    nameOnly: { collections: [], clips: [] },
    geometry: {
      state: 'missing-with-suggestion',
      matchedShapes: [],
      closestFit: 'Sit',
      note: 'missing',
    },
    prerequisites: [],
    warnings: [],
    question: null,
    actions: ['Author new motion or approve a draft.'],
    candidates: [],
    ...overrides,
  }
}

function nodes(): ShapeDraftSnapshotNode[] {
  return [
    { id: 'n-cat', name: 'Cat', hasMesh: true, shapeNames: ['Sit', 'Stretch'] },
    { id: 'n-sofa', name: 'Sofa', hasMesh: true, shapeNames: [] },
  ]
}

describe('proposeShapeDrafts (issue #444)', () => {
  it('proposes a separate closest-fit draft without mutating its inputs', () => {
    const beats = [beat({ beatId: 'b-sleep', label: 'Sleep on the sofa' })]
    const snapshot = nodes()
    const beforeBeats = JSON.stringify(beats)
    const beforeNodes = JSON.stringify(snapshot)

    const result = proposeShapeDrafts({ beats, nodes: snapshot })

    expect(result.drafts).toHaveLength(1)
    const draft = result.drafts[0]
    expect(draft.status).toBe('proposed')
    expect(draft.beatId).toBe('b-sleep')
    expect(draft.nodeId).toBe('n-cat')
    // Separate copy: the draft name differs from the source it was duplicated from.
    expect(draft.sourceShapeName).toBe('Sit')
    expect(draft.draftName).not.toBe(draft.sourceShapeName)
    // The source is never mutated by the proposal — duplication only.
    expect(draft.note).toMatch(/source.*unchanged|never.*mutat/i)
    expect(draft.note).toMatch(/topology/i)
    expect(JSON.stringify(beats)).toBe(beforeBeats)
    expect(JSON.stringify(snapshot)).toBe(beforeNodes)
  })

  it('reports inadequate topology as requiring artist-authored geometry', () => {
    const result = proposeShapeDrafts({
      beats: [
        beat({
          beatId: 'b-flat',
          label: 'Sleep on the sofa',
          resolvedNodeIds: ['n-sofa'],
          geometry: {
            state: 'no-shapes',
            matchedShapes: [],
            closestFit: null,
            note: 'no inventory',
          },
        }),
      ],
      nodes: nodes(),
    })

    expect(result.drafts).toHaveLength(1)
    const draft = result.drafts[0]
    expect(draft.status).toBe('needs-artist-geometry')
    expect(draft.sourceShapeName).toBeNull()
    // Nothing is inferred or substituted — the artist authors the geometry.
    expect(draft.actions.join(' ').toLowerCase()).toMatch(/artist-authored|author.*own/)
    expect(result.summary.needsArtistGeometry).toBe(1)
    expect(result.summary.proposed).toBe(0)
  })

  it('asks to re-run analysis when the closest-fit shape is stale instead of guessing', () => {
    const result = proposeShapeDrafts({
      beats: [
        beat({
          beatId: 'b-stale',
          label: 'Sleep',
          geometry: {
            state: 'missing-with-suggestion',
            matchedShapes: [],
            closestFit: 'Gone',
            note: 'stale',
          },
        }),
      ],
      nodes: nodes(),
    })

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].status).toBe('needs-artist-geometry')
    expect(result.drafts[0].warnings.join(' ')).toMatch(/re-run analysis|no longer exists/i)
  })

  it('proposes nothing when geometry is already available', () => {
    const result = proposeShapeDrafts({
      beats: [
        beat({
          beatId: 'b-ok',
          status: 'ready',
          geometry: { state: 'available', matchedShapes: ['Sleep'], closestFit: null, note: '' },
        }),
      ],
      nodes: nodes(),
    })
    expect(result.drafts).toEqual([])
    expect(result.summary.total).toBe(0)
  })

  it('caps drafts to a reviewable batch', () => {
    const beats = Array.from({ length: 30 }, (_, i) =>
      beat({ beatId: `b-${i}`, label: `Beat ${i}` }),
    )
    const result = proposeShapeDrafts({ beats, nodes: nodes() })
    expect(result.drafts.length).toBeLessThanOrEqual(12)
    expect(result.warnings.join(' ')).toMatch(/first 12|reviewable/i)
  })

  it('reports unresolved missing-geometry beats instead of dropping them', () => {
    const result = proposeShapeDrafts({
      beats: [
        beat({
          beatId: 'b-lost',
          label: 'Lost target',
          resolvedNodeIds: [],
          geometry: {
            state: 'missing-with-suggestion',
            matchedShapes: [],
            closestFit: 'Sit',
            note: 'stale',
          },
        }),
      ],
      nodes: nodes(),
    })
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].status).toBe('needs-artist-geometry')
    expect(result.drafts[0].warnings.join(' ')).toMatch(/re-run analysis/i)
    expect(result.summary.total).toBe(1)
  })
})

describe('shape draft review lifecycle (inspect, edit, accept, reject)', () => {
  function proposed() {
    const result = proposeShapeDrafts({ beats: [beat({ beatId: 'b-sleep' })], nodes: nodes() })
    return result.drafts[0]
  }

  it('inspects the draft against its source without touching the project', () => {
    const draft = proposed()
    // Inspectable: which beat, which node, which source, which draft copy.
    expect(draft).toMatchObject({
      beatId: 'b-sleep',
      nodeId: 'n-cat',
      nodeName: 'Cat',
      sourceShapeName: 'Sit',
    })
    expect(typeof draft.draftName).toBe('string')
    expect(draft.draftName.length).toBeGreaterThan(0)
  })

  it('edits the draft name while keeping the source reference', () => {
    const edited = editShapeDraft(proposed(), 'Sleep pose')
    expect(edited.status).toBe('edited')
    expect(edited.draftName).toBe('Sleep pose')
    expect(edited.sourceShapeName).toBe('Sit')
  })

  it('rejects empty draft names with a fixable message', () => {
    expect(() => editShapeDraft(proposed(), '   ')).toThrow(/non-empty/i)
  })

  it('accepts the draft and retains the chosen shape as project feedback', () => {
    const accepted = acceptShapeDraft(proposed())
    expect(accepted.status).toBe('accepted')
    expect(accepted.feedback).toMatch(/Sit/)
  })

  it('rejects the draft with the artist reason retained', () => {
    const rejected = rejectShapeDraft(proposed(), 'Ears cannot fold that far')
    expect(rejected.status).toBe('rejected')
    expect(rejected.feedback).toMatch(/Ears cannot fold/i)
  })

  it('rejects empty rejection reasons with a fixable message', () => {
    expect(() => rejectShapeDraft(proposed(), '  ')).toThrow(/reason/i)
  })

  it('keeps the retained choice when an accepted draft is renamed', () => {
    const accepted = acceptShapeDraft(proposed())
    const edited = editShapeDraft(accepted, 'Sleep pose v2')
    expect(edited.status).toBe('edited')
    expect(edited.draftName).toBe('Sleep pose v2')
    expect(edited.feedback).toMatch(/Accepted/)
  })

  it('refuses to reject geometry requests that have no review copy', () => {
    const geometry = proposeShapeDrafts({
      beats: [
        beat({
          beatId: 'b-flat',
          resolvedNodeIds: ['n-sofa'],
          geometry: { state: 'no-shapes', matchedShapes: [], closestFit: null, note: '' },
        }),
      ],
      nodes: nodes(),
    }).drafts[0]
    expect(() => rejectShapeDraft(geometry, 'nope')).toThrow(/artist-authored geometry/i)
  })

  it('never mutates the draft under review', () => {
    const draft = proposed()
    const before = JSON.stringify(draft)
    acceptShapeDraft(draft)
    rejectShapeDraft(draft, 'nope')
    editShapeDraft(draft, 'Other')
    expect(JSON.stringify(draft)).toBe(before)
  })
})

describe('shape draft commands (existing DuplicateShape, topology preserved)', () => {
  function liveEngine() {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.getActiveSlide()!
    const mesh = createDefaultRectangleMesh(10, 10)
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat', {
      components: { mesh: { kind: 'mesh', mesh } },
    })
    const source = engine.createShape(node.id, 'Sit')
    return { engine, nodeId: node.id, sourceId: source.id }
  }

  it('duplicates the closest-fit shape without changing its source or mesh topology', () => {
    const { engine, nodeId, sourceId } = liveEngine()
    const meshBefore = JSON.parse(JSON.stringify(engine.getNode(nodeId).components.mesh!.mesh))
    const sourceBefore = JSON.parse(JSON.stringify(engine.getShapes(nodeId)[0]))

    const draft = proposeShapeDrafts({
      beats: [beat({ beatId: 'b-sleep', resolvedNodeIds: [nodeId] })],
      nodes: [{ id: nodeId, name: 'Cat', hasMesh: true, shapeNames: ['Sit'] }],
    }).drafts[0]
    const resolved = resolveDraftSourceId(draft, engine.getShapes(nodeId))
    expect(resolved).toBe(sourceId)

    const json = toDuplicateShapeJson(draft, sourceId)
    expect(json).toMatchObject({ type: 'DuplicateShape', nodeId, shapeId: sourceId })
    const dispatcher = new CommandDispatcher(engine, new UndoStack(), () => {})
    const result = dispatcher.dispatch(new DuplicateShapeCommand({ nodeId, shapeId: sourceId }))
    expect(result.ok).toBe(true)

    const shapes = engine.getShapes(nodeId)
    expect(shapes).toHaveLength(2)
    // Source unchanged: same id, name, and vertices.
    expect(shapes[0]).toEqual(sourceBefore)
    // Topology preserved: the copy carries the same vertex count as the mesh.
    const meshAfter = engine.getNode(nodeId).components.mesh!.mesh
    expect(shapes[1].vertices).toHaveLength(meshAfter.vertices.length)
    expect(meshAfter.vertices).toEqual(meshBefore.vertices)
    expect(meshAfter.faces).toEqual(meshBefore.faces)
    expect(shapes[1].id).not.toBe(sourceId)
  })

  it('resolves no source id when the closest fit is missing live', () => {
    const draft = proposeShapeDrafts({
      beats: [beat({ beatId: 'b-sleep' })],
      nodes: nodes(),
    }).drafts[0]
    expect(resolveDraftSourceId(draft, [{ id: 'other', name: 'Other' }])).toBeNull()
    expect(() => toDuplicateShapeJson(draft, null)).toThrow(/stable|resolve/i)
  })
})

describe('toShapeDraftSnapshot (live context adapter)', () => {
  it('reads node names, mesh presence, and shape names without mutating context', () => {
    const context = {
      animation: {
        nodes: [
          { id: 'n-cat', name: 'Cat', components: ['mesh'] },
          { id: 'n-text', name: 'Title', components: ['text'] },
        ],
        rig: {
          shapeInventory: [{ nodeId: 'n-cat', shapeCount: 1, shapeNames: ['Sit'] }],
        },
      },
    }
    const before = JSON.stringify(context)
    const snapshot = toShapeDraftSnapshot(context.animation)
    expect(snapshot).toEqual([
      { id: 'n-cat', name: 'Cat', hasMesh: true, shapeNames: ['Sit'] },
      { id: 'n-text', name: 'Title', hasMesh: false, shapeNames: [] },
    ])
    expect(JSON.stringify(context)).toBe(before)
  })
})
