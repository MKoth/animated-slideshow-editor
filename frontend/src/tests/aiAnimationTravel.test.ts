import { describe, expect, it } from 'vitest'
import { composeSequence, type SequenceInput, type SequenceSnapshot } from '../ai/animationSequence'
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

function readyBeat(beatId: string, label: string, collectionName = 'Walk Cycle'): BeatAnalysis {
  return {
    beatId,
    label,
    status: 'ready',
    resolvedNodeIds: ['n-cat'],
    reusable: [
      {
        collectionId: `col-${beatId}`,
        collectionName,
        matchedSemantics: ['cat'],
        clipIds: ['clip-1'],
      },
    ],
    nameOnly: { collections: [], clips: [] },
    geometry: { state: 'available', matchedShapes: [], closestFit: null, note: '' },
    prerequisites: [],
    warnings: [],
    question: null,
    actions: [],
    candidates: [],
  }
}

function view(requestId: string): RenderedView {
  return {
    requestId,
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
  }
}

function input(partial: Partial<SequenceInput>): SequenceInput {
  return { beats: [], views: [], snapshot: snapshot(), ...partial }
}

describe('scene travel, transitions, and Frozen Poses (issue #443)', () => {
  it('keeps character-local motion separate from scene-level travel', () => {
    const draft = composeSequence(
      input({
        beats: [readyBeat('b-walk', 'Walk across the room')],
        views: [view('v-1')],
        travel: [{ beatId: 'b-walk', targetNodeId: 'n-cat', to: { x: 120, y: 40 }, duration: 2 }],
      }),
    )
    const beat = draft.beats[0]
    expect(beat.status).toBe('draftable')
    expect(beat.travel).toHaveLength(1)
    expect(beat.travel[0]).toMatchObject({ targetNodeId: 'n-cat', duration: 2 })
    // Character-local motion stays as a collection apply.
    expect(draft.scriptSource).toMatch(/\.apply\(/)
    expect(draft.scriptSource).toMatch(/Walk Cycle/)
    // Scene travel is separate raw timeline keyframes, never baked into the collection.
    expect(draft.scriptSource).toMatch(/\.tween\(\{[^}]*x:[^}]*y:[^}]*\}/)
    expect(draft.scriptSource.toLowerCase()).toMatch(
      /separate.*character-local|character-local.*separate|scene-level/,
    )
    expect(draft.scriptSource.toLowerCase()).toMatch(/never baked into reusable motion/)
    // Travel previews carry Slide, time, and stable node ids.
    const travelPreview = draft.previews.find((p) => p.kind === 'travel')
    expect(travelPreview).toBeDefined()
    expect(travelPreview!.slideId).toBe('s-1')
    expect(travelPreview!.label).toMatch(/Room/)
    expect(travelPreview!.label).toMatch(/s-1/)
    expect(travelPreview!.label).toMatch(/n-cat/)
    expect(travelPreview!.nodeIds).toContain('n-cat')
  })

  it('places beats sequentially without assuming crossfades', () => {
    const draft = composeSequence(
      input({
        beats: [
          readyBeat('b-walk', 'Walk across the room', 'Walk Cycle'),
          readyBeat('b-sit', 'Sit by the blackboard', 'Sit'),
        ],
      }),
    )
    // Implicit sequential transition between the pair — never a crossfade.
    expect(draft.transitions.length).toBeGreaterThanOrEqual(1)
    const implicit = draft.transitions.find(
      (t) => t.fromBeatId === 'b-walk' && t.toBeatId === 'b-sit',
    )
    expect(implicit).toBeDefined()
    expect(implicit!.explicit).toBe(false)
    expect(draft.scriptSource.toLowerCase()).toMatch(/sequential/)
    expect(draft.scriptSource.toLowerCase()).toMatch(
      /does not crossfade|no crossfade|never.*crossfade/,
    )
    expect(draft.scriptSource.toLowerCase()).not.toMatch(/crossfade\(|blend\(|xfade/)
    expect(draft.warnings.join(' ').toLowerCase() + draft.scriptSource.toLowerCase()).toMatch(
      /lane priority/,
    )
  })

  it('previews explicit transitions only when authored', () => {
    const draft = composeSequence(
      input({
        beats: [
          readyBeat('b-walk', 'Walk across the room', 'Walk Cycle'),
          readyBeat('b-sit', 'Sit by the blackboard', 'Sit'),
        ],
        transitions: [{ fromBeatId: 'b-walk', toBeatId: 'b-sit', kind: 'hold', duration: 1 }],
      }),
    )
    const beat = draft.beats[0]
    expect(beat.transitionAfter).toMatchObject({ kind: 'hold', explicit: true })
    expect(draft.scriptSource).toMatch(/wait\(1/)
    expect(draft.scriptSource.toLowerCase()).toMatch(/explicit.*hold|hold.*transition/)
    const preview = draft.previews.find((p) => p.kind === 'transition')
    expect(preview).toBeDefined()
    expect(preview!.slideId).toBe('s-1')
    expect(preview!.label).toMatch(/Room/)
    expect(preview!.label).toMatch(/n-cat/)
    expect(preview!.label.toLowerCase()).toMatch(/transition|hold/)
  })

  it('holds Frozen Poses with hold interpolation before, between, and after', () => {
    const draft = composeSequence(
      input({
        beats: [
          readyBeat('b-walk', 'Walk across the room'),
          readyBeat('b-sit', 'Sit by the blackboard', 'Sit'),
        ],
        frozenPoses: [
          { beatId: 'b-walk', edge: 'before' },
          { beatId: 'b-sit', edge: 'after' },
        ],
      }),
    )
    expect(draft.beats[0].frozenBefore).toBe(true)
    expect(draft.beats[1].frozenAfter).toBe(true)
    // Frozen holds use hold interpolation — pauses never reveal the default pose.
    expect(draft.scriptSource.toLowerCase()).toMatch(/frozen.*hold|hold.*frozen/)
    expect(draft.scriptSource.toLowerCase()).toMatch(/hold interpolation/)
    const frozenPreviews = draft.previews.filter((p) => p.kind === 'frozen')
    expect(frozenPreviews.length).toBeGreaterThanOrEqual(3)
    for (const preview of frozenPreviews) {
      expect(preview.slideId).toBe('s-1')
      expect(preview.label).toMatch(/s-1/)
      expect(preview.nodeIds).toContain('n-cat')
      expect(preview.label.toLowerCase()).toMatch(/frozen/)
    }
    expect(draft.frozen.length).toBeGreaterThanOrEqual(3)
  })

  it('identifies visible child-part jumps between placements with the responsible part', () => {
    const walk: BeatAnalysis = {
      ...readyBeat('b-walk', 'Walk across the room', 'Walk Cycle'),
      reusable: [
        {
          collectionId: 'col-walk',
          collectionName: 'Walk Cycle',
          matchedSemantics: ['paw'],
          clipIds: ['clip-walk'],
        },
      ],
    }
    const sit: BeatAnalysis = {
      ...readyBeat('b-sit', 'Sit by the blackboard', 'Sit'),
      reusable: [
        {
          collectionId: 'col-sit',
          collectionName: 'Sit',
          matchedSemantics: ['paw'],
          clipIds: ['clip-sit'],
        },
      ],
    }
    const draft = composeSequence(input({ beats: [walk, sit] }))
    // The incoming handoff names the responsible semantic part.
    expect(draft.beats[1].jumps.join(' ').toLowerCase()).toMatch(/paw/)
    expect(draft.beats[1].jumps.join(' ').toLowerCase()).toMatch(/jump/)
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(/jump/)
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(/paw/)
    expect(draft.scriptSource.toLowerCase()).toMatch(/jump/)
    // Jumps are previewed with Slide, time, and stable node ids — not just warned.
    const jumpPreview = draft.previews.find((p) => p.kind === 'jump')
    expect(jumpPreview).toBeDefined()
    expect(jumpPreview!.beatId).toBe('b-sit')
    expect(jumpPreview!.slideId).toBe('s-1')
    expect(jumpPreview!.label).toMatch(/n-cat/)
    expect(jumpPreview!.label.toLowerCase()).toMatch(/jump/)
    expect(jumpPreview!.label.toLowerCase()).toMatch(/paw/)
  })

  it('leaves explicit cuts without a hold while hold gaps keep one', () => {
    const draft = composeSequence(
      input({
        beats: [
          readyBeat('b-walk', 'Walk across the room', 'Walk Cycle'),
          readyBeat('b-sit', 'Sit by the blackboard', 'Sit'),
        ],
        transitions: [{ fromBeatId: 'b-walk', toBeatId: 'b-sit', kind: 'cut' }],
      }),
    )
    const cut = draft.transitions.find((t) => t.fromBeatId === 'b-walk' && t.toBeatId === 'b-sit')
    expect(cut).toMatchObject({ kind: 'cut', explicit: true, duration: 0 })
    // A hard cut carries no hold: no frozen entry and no wait for that gap.
    expect(draft.frozen).toEqual([])
    expect(draft.beats[0].frozenAfter).toBe(false)
    expect(draft.beats[1].frozenBefore).toBe(false)
    expect(draft.scriptSource).toMatch(/explicit cut/)
    expect(draft.scriptSource).not.toMatch(/wait\(/)
  })

  it('falls back to linear travel easing when hold is requested', () => {
    const draft = composeSequence(
      input({
        beats: [readyBeat('b-walk', 'Walk across the room')],
        travel: [{ beatId: 'b-walk', targetNodeId: 'n-cat', to: { x: 10, y: 10 }, ease: 'hold' }],
      }),
    )
    expect(draft.beats[0].travel[0].ease).toBe('linear')
    expect(draft.scriptSource).toMatch(/, linear\)/)
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(/hold.*frozen|frozen.*hold|linear/)
  })

  it('states alignment-offset shared scope and previews the effect across the collection', () => {
    const draft = composeSequence(
      input({
        beats: [readyBeat('b-walk', 'Walk across the room', 'Walk Cycle')],
        alignmentOffsets: [{ collectionName: 'Walk Cycle', semanticName: 'paw', x: 4, y: -2 }],
        collections: [{ name: 'Walk Cycle', bindings: { paw: 'clip-walk' }, placementCount: 2 }],
      }),
    )
    expect(draft.alignmentEffects).toHaveLength(1)
    const effect = draft.alignmentEffects[0]
    expect(effect).toMatchObject({ collectionName: 'Walk Cycle', semanticName: 'paw', x: 4, y: -2 })
    expect(effect.scope.toLowerCase()).toMatch(/shared/)
    expect(effect.scope.toLowerCase()).toMatch(/placement/)
    expect(effect.label).toMatch(/Walk Cycle/)
    expect(effect.label).toMatch(/paw/)
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(/alignment offset.*shared/)
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(/walk cycle/)
    // Previewed before approval — never silently mutated.
    expect(draft.scriptSource).toMatch(/Walk Cycle/)
    expect(draft.scriptSource.toLowerCase()).toMatch(/alignment offset/)
    expect(draft.scriptSource.toLowerCase()).toMatch(/shared/)
    expect(draft.beats[0].alignmentNotes.join(' ').toLowerCase()).toMatch(/shared/)
  })

  it('ignores invalid travel, transition, frozen, and offset requests with a precise warning', () => {
    const draft = composeSequence(
      input({
        beats: [readyBeat('b-walk', 'Walk across the room')],
        travel: [{ beatId: 'b-gone', targetNodeId: 'n-gone', to: { x: 1, y: 1 } }],
        transitions: [{ fromBeatId: 'b-walk', toBeatId: 'b-gone', kind: 'hold', duration: 1 }],
        frozenPoses: [{ beatId: 'b-gone', edge: 'before' }],
        alignmentOffsets: [
          { collectionName: 'No Such Collection', semanticName: 'paw', x: 1, y: 1 },
        ],
      }),
    )
    expect(draft.beats[0].travel).toEqual([])
    expect(draft.beats[0].frozenBefore).toBe(false)
    expect(draft.alignmentEffects).toEqual([])
    expect(draft.warnings.join(' ').toLowerCase()).toMatch(
      /no.*travel|unknown beat|no.*transition|no.*frozen|no.*collection|unknown collection/,
    )
  })

  it('never mutates travel, transition, frozen, offset, beat, view, or snapshot inputs', () => {
    const beats = [readyBeat('b-walk', 'Walk across the room')]
    const views = [view('v-1')]
    const snap = snapshot()
    const travel = [{ beatId: 'b-walk', targetNodeId: 'n-cat', to: { x: 5, y: 5 } }] as const
    const transitions = [{ fromBeatId: 'b-walk', toBeatId: 'b-walk', kind: 'cut' }] as const
    const frozenPoses = [{ beatId: 'b-walk', edge: 'before' }] as const
    const alignmentOffsets = [
      { collectionName: 'Walk Cycle', semanticName: 'paw', x: 1, y: 1 },
    ] as const
    const before = JSON.stringify({
      beats,
      views,
      snap,
      travel,
      transitions,
      frozenPoses,
      alignmentOffsets,
    })
    composeSequence({
      beats,
      views,
      snapshot: snap,
      travel: [...travel],
      transitions: [...transitions],
      frozenPoses: [...frozenPoses],
      alignmentOffsets: [...alignmentOffsets],
    })
    expect(
      JSON.stringify({ beats, views, snap, travel, transitions, frozenPoses, alignmentOffsets }),
    ).toBe(before)
  })
})
