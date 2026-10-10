import { describe, expect, it } from 'vitest'
import { composeSequence, type SequenceSnapshot, type SequenceInput } from '../ai/animationSequence'
import type { BeatAnalysis } from '../ai/animationAnalysis'
import type { RenderedView } from '../ai/renderedViews'

function snapshot(): SequenceSnapshot {
  return {
    slideId: 's-1',
    slideName: 'Room',
    duration: 12,
    nodes: [
      { id: 'n-cat', name: 'Cat' },
      { id: 'n-sofa', name: 'Sofa' },
    ],
  }
}

function readyBeat(overrides: Partial<BeatAnalysis> & { beatId: string }): BeatAnalysis {
  return {
    label: overrides.beatId,
    status: 'ready',
    resolvedNodeIds: ['n-cat'],
    reusable: [
      {
        collectionId: 'col-walk',
        collectionName: 'Walk Cycle',
        matchedSemantics: ['cat'],
        clipIds: ['clip-walk'],
      },
    ],
    nameOnly: { collections: [], clips: [] },
    geometry: { state: 'available', matchedShapes: [], closestFit: null, note: '' },
    prerequisites: [],
    warnings: [],
    question: null,
    actions: [],
    candidates: [],
    ...overrides,
  }
}

function blockedBeat(overrides: Partial<BeatAnalysis> & { beatId: string }): BeatAnalysis {
  return {
    label: overrides.beatId,
    status: 'missing-motion',
    resolvedNodeIds: ['n-cat'],
    reusable: [],
    nameOnly: { collections: [{ id: 'col-sleep', name: 'Sleep Walk' }], clips: [] },
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

function view(overrides: Partial<RenderedView> & { requestId: string }): RenderedView {
  return {
    scope: 'focused',
    slideId: 's-1',
    slideName: 'Room',
    time: 0,
    nodeIds: ['n-cat'],
    nodeNames: { 'n-cat': 'Cat' },
    label: 'Slide "Room" [s-1] @ 0s — focused view (nodes: Cat [n-cat])',
    status: 'ready',
    warnings: [],
    actions: [],
    note: 'Visual evidence complements structured project data.',
    ...overrides,
  }
}

function input(beats: BeatAnalysis[], views: RenderedView[] = []): SequenceInput {
  return { beats, views, snapshot: snapshot() }
}

describe('composeSequence (issue #442)', () => {
  it('drafts ordered beats from binding-compatible collections only', () => {
    const draft = composeSequence(
      input([
        readyBeat({ beatId: 'b-walk', label: 'Walk across the room' }),
        readyBeat({
          beatId: 'b-sit',
          label: 'Sit by the blackboard',
          reusable: [
            {
              collectionId: 'col-sit',
              collectionName: 'Sit',
              matchedSemantics: ['cat'],
              clipIds: ['clip-sit'],
            },
          ],
        }),
      ]),
    )
    expect(draft.beats.map((b) => b.beatId)).toEqual(['b-walk', 'b-sit'])
    expect(draft.beats.map((b) => b.order)).toEqual([0, 1])
    expect(draft.beats.every((b) => b.status === 'draftable')).toBe(true)
    expect(draft.summary.draftable).toBe(2)
    // Script keeps beat order: walk before sit.
    expect(draft.scriptSource.indexOf('Walk Cycle')).toBeLessThan(
      draft.scriptSource.indexOf('"Sit"'),
    )
  })

  it('never drafts name-only matches without binding overlap', () => {
    const draft = composeSequence(
      input([
        blockedBeat({
          beatId: 'b-sleep',
          label: 'Sleep on the sofa',
          status: 'missing-motion',
          reusable: [],
          nameOnly: { collections: [{ id: 'col-dog', name: 'Dog Sleep' }], clips: [] },
        }),
      ]),
    )
    expect(draft.beats[0].status).toBe('blocked')
    expect(draft.scriptSource).not.toMatch(/Dog Sleep/)
    expect(draft.scriptSource).toMatch(/omitted [-—] blocked/)
    expect(draft.beats[0].blockers.join(' ').toLowerCase()).toMatch(/no compatible reusable motion/)
  })

  it('keeps blocked beats undrafted while independent beats proceed', () => {
    const draft = composeSequence(
      input([
        blockedBeat({ beatId: 'b-sleep', label: 'Sleep on the sofa' }),
        readyBeat({ beatId: 'b-walk', label: 'Walk across the room' }),
      ]),
    )
    expect(draft.beats).toHaveLength(2)
    expect(draft.beats[0].status).toBe('blocked')
    expect(draft.beats[1].status).toBe('draftable')
    expect(draft.summary.draftable).toBe(1)
    expect(draft.summary.blocked).toBe(1)
    // Only the draftable beat contributes an apply placement.
    expect(draft.scriptSource).toMatch(/Walk Cycle/)
    expect(draft.scriptSource).toMatch(/Sleep on the sofa.*omitted [-—] blocked/s)
  })

  it('provides labelled beat and full-sequence previews before application', () => {
    const draft = composeSequence(
      input([readyBeat({ beatId: 'b-walk', label: 'Walk across the room' })]),
    )
    expect(draft.previews.length).toBeGreaterThanOrEqual(2)
    const beatPreview = draft.previews.find((p) => p.beatId === 'b-walk')
    const sequencePreview = draft.previews.find((p) => p.beatId === null)
    expect(beatPreview).toBeDefined()
    expect(sequencePreview).toBeDefined()
    for (const preview of [beatPreview!, sequencePreview!]) {
      expect(preview.slideId).toBe('s-1')
      expect(preview.slideName).toBe('Room')
      expect(preview.label).toMatch(/Room/)
      expect(preview.label).toMatch(/s-1/)
      expect(preview.label).toMatch(/n-cat/)
      expect(preview.nodeIds).toContain('n-cat')
    }
    expect(beatPreview!.label).toMatch(/Walk across the room/)
    expect(sequencePreview!.label).toMatch(/sequence/i)
  })

  it('marks unverified beats as needing a labelled preview, and links covering views', () => {
    const unverified = composeSequence(input([readyBeat({ beatId: 'b-walk' })]))
    expect(unverified.beats[0].previewViewIds).toEqual([])
    expect(unverified.beats[0].warnings.join(' ').toLowerCase()).toMatch(
      /focused view|rendered preview/,
    )

    const verified = composeSequence(
      input([readyBeat({ beatId: 'b-walk' })], [view({ requestId: 'v-1', nodeIds: ['n-cat'] })]),
    )
    expect(verified.beats[0].previewViewIds).toEqual(['v-1'])
    // Verified beats keep the binding reminder but drop the missing-preview warning.
    expect(verified.beats[0].warnings.join(' ').toLowerCase()).not.toMatch(
      /no labelled rendered view yet/,
    )
  })

  it('retains an ordinary Animation Script recipe, not a runtime player', () => {
    const draft = composeSequence(
      input([readyBeat({ beatId: 'b-walk', label: 'Walk across the room' })]),
    )
    expect(draft.scriptSource).toMatch(/^script ".*" from 0/m)
    expect(draft.scriptSource).toMatch(/bind .* = node\(/)
    expect(draft.scriptSource).toMatch(/bind .* = collection\(/)
    expect(draft.scriptSource).toMatch(/\.apply\(/)
    expect(draft.scriptSource).not.toMatch(/player|runtime/i)
    // Sequential placement is explicit; priority never crossfades.
    expect(draft.scriptSource.toLowerCase()).toMatch(/sequential/)
    // Frozen holds use hold interpolation between beats.
    expect(draft.scriptSource.toLowerCase()).toMatch(/frozen hold|hold interpolation/)
    // Character-local motion stays separate from scene travel.
    expect(draft.scriptSource.toLowerCase()).toMatch(/travel.*separate|scene-level/)
    // Alignment-offset scope is stated, never silently mutated.
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(/alignment offset.*shared/)
  })

  it('blocks stale targets with a precise re-run action', () => {
    const draft = composeSequence(
      input([readyBeat({ beatId: 'b-walk', resolvedNodeIds: ['n-gone'] })]),
    )
    expect(draft.beats[0].status).toBe('blocked')
    expect(draft.beats[0].blockers.join(' ').toLowerCase()).toMatch(/stale|no longer/)
    expect(draft.beats[0].actions.join(' ').toLowerCase()).toMatch(/re-run analysis/)
    expect(draft.scriptSource).not.toMatch(/\.apply\(/)
  })

  it('surfaces per-beat dependencies, assumptions, warnings, and blockers', () => {
    const draft = composeSequence(
      input([
        {
          ...readyBeat({ beatId: 'b-walk', label: 'Walk' }),
          prerequisites: ['Missing camera: toward-camera beat needs setup.'],
          warnings: ['Reusable candidates are binding-compatible, not proven visually.'],
        },
      ]),
    )
    const beat = draft.beats[0]
    expect(beat.dependencies).toBeDefined()
    expect(beat.assumptions.length).toBeGreaterThan(0)
    expect(beat.warnings.length).toBeGreaterThan(0)
  })

  it('never mutates the beats, views, or snapshot', () => {
    const beats = [readyBeat({ beatId: 'b-walk' })]
    const views = [view({ requestId: 'v-1' })]
    const snap = snapshot()
    const before = JSON.stringify({ beats, views, snap })
    composeSequence({ beats, views, snapshot: snap })
    expect(JSON.stringify({ beats, views, snap })).toBe(before)
  })

  it('produces an empty draft with a precise next step when no beats were requested', () => {
    const draft = composeSequence(input([]))
    expect(draft.beats).toEqual([])
    expect(draft.previews).toEqual([])
    expect(draft.scriptSource).toMatch(/no beats/i)
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(
      /describe.*performance|requested actions/,
    )
  })
})
