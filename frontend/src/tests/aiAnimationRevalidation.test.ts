import { describe, expect, it } from 'vitest'
import {
  describeReplacement,
  revalidateAnimationProposal,
  toRevalidationSnapshot,
  type RevalidationSnapshot,
} from '../ai/animationRevalidation'
import { composeSequence, type SequenceSnapshot } from '../ai/animationSequence'
import type { BeatAnalysis } from '../ai/animationAnalysis'
import type { CompiledFootprint } from '../engine/compiledFootprint'
import {
  CreateClipCollectionCommand,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSemanticNameCommand,
  SetSlideAnimationScriptCommand,
  SetSlideDurationCommand,
  createCommandSystem,
} from '../engine/commands'
import { runAnimationScript } from '../engine/animationScriptRun'

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

function readyBeat(beatId: string, label = beatId): BeatAnalysis {
  return {
    beatId,
    label,
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
  }
}

function footprint(): CompiledFootprint {
  return {
    from: 0,
    to: 4,
    tracks: [{ nodeId: 'n-cat', target: { kind: 'positionX' } as never }],
    placementParents: ['n-cat'],
    instanceNodes: ['n-cat'],
    entryVersions: {},
    createdNodes: ['script-node-1'],
    createdDataSources: ['script-data-1'],
    effectIds: ['effect-1'],
    audioClipIds: ['audio-1'],
  }
}

function liveSnapshot(overrides: Partial<RevalidationSnapshot> = {}): RevalidationSnapshot {
  return {
    slideId: 's-1',
    nodes: [
      { id: 'n-cat', name: 'Cat' },
      { id: 'n-sofa', name: 'Sofa' },
    ],
    collections: [{ name: 'Walk Cycle', bindings: { cat: 'clip-walk' } }],
    hasCamera: true,
    footprint: null,
    fingerprint: 'fp-live',
    ...overrides,
  }
}

function validatedSnapshot(overrides: Partial<RevalidationSnapshot> = {}): RevalidationSnapshot {
  return liveSnapshot({ fingerprint: 'fp-validated', ...overrides })
}

describe('describeReplacement (issue #445)', () => {
  it('identifies the exact script-created output a rerun would replace and requires approval', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const scope = describeReplacement(footprint(), draft)
    expect(scope.beatIds).toContain('b-walk')
    expect(scope.tracks.map((t) => t.nodeId)).toContain('n-cat')
    expect(scope.placementParents).toContain('n-cat')
    expect(scope.createdNodes).toContain('script-node-1')
    expect(scope.createdDataSources).toContain('script-data-1')
    expect(scope.label.toLowerCase()).toMatch(/replace/)
    expect(scope.label).toMatch(/n-cat/)
    expect(scope.label).toMatch(/script-node-1/)
    expect(scope.requiresApproval).toBe(true)
    expect(scope.warning.toLowerCase()).toMatch(/manual edits.*lost|lost.*manual/)
    expect(scope.warning.toLowerCase()).toMatch(/approval/)
    expect(scope.isFirstRun).toBe(false)
  })

  it('reports a first run with no replacement but still requires approval', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const scope = describeReplacement(null, draft)
    expect(scope.isFirstRun).toBe(true)
    expect(scope.tracks).toEqual([])
    expect(scope.createdNodes).toEqual([])
    expect(scope.requiresApproval).toBe(true)
    expect(scope.label.toLowerCase()).toMatch(/first run|no.*replace|creates/)
  })
})

describe('revalidateAnimationProposal (issue #445)', () => {
  it('identifies affected beats and their dependencies plus replacement when current', () => {
    const draft = composeSequence({
      beats: [
        readyBeat('b-walk', 'Walk across the room'),
        { ...readyBeat('b-sit', 'Sit by the blackboard') },
      ],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot({ fingerprint: 'fp-same' })
    const live = liveSnapshot({ fingerprint: 'fp-same' })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.stale).toBe(false)
    expect(result.blocked).toBe(false)
    expect(result.approvable).toBe(true)
    expect(result.needsReview).toBe(false)
    expect(result.affectedBeatIds).toEqual([])
    // Every beat carries its dependencies even when nothing is stale.
    expect(result.beats).toHaveLength(2)
    expect(result.beats[1].dependencies.join(' ').toLowerCase()).toMatch(/after beat|sequential/)
    expect(result.replacement.requiresApproval).toBe(true)
  })

  it('blocks a stale target deletion and identifies the affected beat with a re-run action', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot()
    const live = liveSnapshot({
      nodes: [{ id: 'n-sofa', name: 'Sofa' }],
      fingerprint: 'fp-moved',
    })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.stale).toBe(true)
    expect(result.blocked).toBe(true)
    expect(result.approvable).toBe(false)
    expect(result.needsReview).toBe(true)
    expect(result.affectedBeatIds).toContain('b-walk')
    const beat = result.beats.find((b) => b.beatId === 'b-walk')!
    expect(beat.affected).toBe(true)
    expect(beat.reasons.join(' ').toLowerCase()).toMatch(/stale|no longer/)
    expect(beat.reasons.join(' ')).toMatch(/n-cat/)
    expect(beat.actions.join(' ').toLowerCase()).toMatch(/re-run analysis/)
    expect(beat.dependencies).toBeDefined()
  })

  it('ignores irrelevant node additions — no block, still approvable when reviewed', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot({ fingerprint: 'fp-a' })
    const live = liveSnapshot({
      nodes: [
        { id: 'n-cat', name: 'Cat' },
        { id: 'n-sofa', name: 'Sofa' },
        { id: 'n-plant', name: 'Plant' },
      ],
      fingerprint: 'fp-b',
    })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.affectedBeatIds).toEqual([])
    expect(result.blocked).toBe(false)
    expect(result.approvable).toBe(true)
  })

  it('blocks a removed collection and reports the shared-definition scope', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot()
    const live = liveSnapshot({ collections: [], fingerprint: 'fp-moved' })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.blocked).toBe(true)
    expect(result.affectedBeatIds).toContain('b-walk')
    const beat = result.beats.find((b) => b.beatId === 'b-walk')!
    expect(beat.reasons.join(' ')).toMatch(/Walk Cycle/)
    expect(beat.actions.join(' ').toLowerCase()).toMatch(/re-run analysis|re-run/)
  })

  it('blocks binding changes on the reused collection', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot()
    const live = liveSnapshot({
      collections: [{ name: 'Walk Cycle', bindings: { tail: 'clip-other' } }],
      fingerprint: 'fp-moved',
    })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.blocked).toBe(true)
    expect(result.affectedBeatIds).toContain('b-walk')
  })

  it('blocks footprint changes underneath the draft and surfaces the replacement', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot({ footprint: null, fingerprint: 'fp-a' })
    const live = liveSnapshot({ footprint: footprint(), fingerprint: 'fp-b' })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.stale).toBe(true)
    expect(result.blocked).toBe(true)
    expect(result.approvable).toBe(false)
    expect(result.affectedBeatIds).toContain('b-walk')
    expect(result.replacement.createdNodes).toContain('script-node-1')
    expect(result.replacement.warning.toLowerCase()).toMatch(/manual edits.*lost/)
  })

  it('requires renewed review after a refresh even when nothing is stale', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const snap = liveSnapshot({ fingerprint: 'fp-same' })
    const unreviewed = revalidateAnimationProposal({
      draft,
      validated: { ...snap },
      live: { ...snap },
      reviewed: false,
    })
    expect(unreviewed.stale).toBe(false)
    expect(unreviewed.blocked).toBe(false)
    expect(unreviewed.needsReview).toBe(true)
    expect(unreviewed.approvable).toBe(false)

    const reviewed = revalidateAnimationProposal({
      draft,
      validated: { ...snap },
      live: { ...snap },
      reviewed: true,
    })
    expect(reviewed.needsReview).toBe(false)
    expect(reviewed.approvable).toBe(true)
  })

  it('blocks a renamed target whose Unique Name binding may be stale', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot()
    const live = liveSnapshot({
      nodes: [
        { id: 'n-cat', name: 'Cat Renamed' },
        { id: 'n-sofa', name: 'Sofa' },
      ],
      fingerprint: 'fp-moved',
    })
    const result = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(result.blocked).toBe(true)
    expect(result.affectedBeatIds).toContain('b-walk')
    expect(result.beats[0].reasons.join(' ').toLowerCase()).toMatch(/renam|unique name|stale/)
  })

  it('never mutates the draft or snapshots', () => {
    const draft = composeSequence({
      beats: [readyBeat('b-walk', 'Walk across the room')],
      views: [],
      snapshot: snapshot(),
    })
    const validated = validatedSnapshot()
    const live = liveSnapshot()
    const before = JSON.stringify({ draft, validated, live })
    revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    describeReplacement(footprint(), draft)
    expect(JSON.stringify({ draft, validated, live })).toBe(before)
  })

  it('adapts the live Context Snapshot without mutating it', () => {
    const animation = {
      nodes: [
        {
          id: 'n-cat',
          name: 'Cat',
          parentId: null,
          depth: 0,
          semanticName: 'cat',
          components: ['mesh'],
          assetDefinitionId: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          worldTransform: null,
          visible: true,
          childCount: 0,
        },
      ],
      rig: { boneCount: 0, bones: [], shapeInventory: [], morphBindings: [], controls: [] },
      clips: [],
      collections: [
        {
          id: 'c1',
          name: 'Walk Cycle',
          category: null,
          bindingCount: 1,
          bindings: { cat: 'clip-walk' },
          hasAlignmentOffsets: false,
        },
      ],
      timeline: {
        slideId: 's-1',
        duration: 12,
        animatedNodeCount: 0,
        totalKeyframes: 0,
        clipInstanceCount: 0,
        placementCount: 0,
        perNode: [],
        controlHosts: [],
        hasAnimationScript: false,
      },
      truncated: { nodes: false, clips: false, collections: false, timelineNodes: false },
    } as never
    const before = JSON.stringify(animation)
    const snap = toRevalidationSnapshot(animation, { footprint: null, fingerprint: 'fp-1' })
    expect(snap.slideId).toBe('s-1')
    expect(snap.nodes).toEqual([{ id: 'n-cat', name: 'Cat' }])
    expect(snap.collections).toEqual([{ name: 'Walk Cycle', bindings: { cat: 'clip-walk' } }])
    expect(JSON.stringify(animation)).toBe(before)
  })
})

describe('revalidation replacement over live engine output (issue #445)', () => {
  function setup() {
    const system = createCommandSystem(() => {})
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Cat performance' }) as never)
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Room' }) as never)
    const slide = system.engine.getActiveSlide()
    if (!slide) throw new Error('expected an active slide')
    system.dispatcher.dispatch(
      new SetSlideDurationCommand({ slideId: slide.id, duration: 12 }) as never,
    )
    const catId = (
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Cat',
        }) as never,
      ) as unknown as { ok: true; inverse: { nodeId: string } }
    ).inverse.nodeId
    const pawId = (
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: catId,
          name: 'Paw',
        }) as never,
      ) as unknown as { ok: true; inverse: { nodeId: string } }
    ).inverse.nodeId
    system.dispatcher.dispatch(
      new SetSemanticNameCommand({ nodeId: catId, semanticName: 'cat' }) as never,
    )
    system.dispatcher.dispatch(
      new SetSemanticNameCommand({ nodeId: pawId, semanticName: 'paw' }) as never,
    )
    const clipId = (
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Paw Wave',
          duration: 2,
          category: 'test',
          channels: [{ property: 'positionX' }],
        }) as never,
      ) as unknown as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    system.dispatcher.dispatch(
      new CreateClipCollectionCommand({ name: 'Walk Cycle', bindings: { paw: clipId } }) as never,
    )
    return { system, slideId: slide.id, catId }
  }

  it('lists the live footprint as the exact replacement and reruns without duplicating', () => {
    const { system, slideId, catId } = setup()
    const cat = system.engine.getNode(catId)
    const draft = composeSequence({
      beats: [
        {
          beatId: 'b-walk',
          label: 'Walk across the room',
          status: 'ready',
          resolvedNodeIds: [catId],
          reusable: [
            {
              collectionId: 'col-walk',
              collectionName: 'Walk Cycle',
              matchedSemantics: ['paw'],
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
        },
      ],
      views: [],
      snapshot: {
        slideId,
        slideName: 'Room',
        duration: 12,
        nodes: [{ id: catId, name: cat.name }],
      },
    })
    expect(draft.summary.draftable).toBe(1)

    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId, source: draft.scriptSource }) as never,
    )
    const boundDispatch = (command: never) => system.dispatcher.dispatch(command as never)
    const first = runAnimationScript(
      system.engine,
      boundDispatch as never,
      slideId,
      draft.scriptSource,
    )
    expect(first.ran).toBe(true)
    const liveFootprint = system.engine.getSlide(slideId).animationScript?.lastCompiled ?? null
    expect(liveFootprint).not.toBeNull()

    // External result: ordinary timeline data (a collection placement on the Cat rig).
    expect(system.engine.getNode(catId).collectionPlacements.length).toBeGreaterThan(0)

    // The proposal identifies the exact script-created output the rerun would replace.
    const scope = describeReplacement(liveFootprint, draft)
    expect(scope.isFirstRun).toBe(false)
    expect(scope.beatIds).toContain('b-walk')
    expect(scope.requiresApproval).toBe(true)
    expect(scope.warning.toLowerCase()).toMatch(/manual edits.*lost/)
    expect(scope.warning.toLowerCase()).toMatch(/approval/)
    for (const track of liveFootprint?.tracks ?? []) {
      expect(scope.tracks.map((t) => t.nodeId)).toContain(track.nodeId)
    }

    // Rerun replaces by footprint instead of duplicating; one undo restores the prior output.
    const count = system.engine.getNode(catId).collectionPlacements.length
    const rerun = runAnimationScript(
      system.engine,
      boundDispatch as never,
      slideId,
      draft.scriptSource,
    )
    expect(rerun.ran).toBe(true)
    expect(system.engine.getNode(catId).collectionPlacements.length).toBe(count)
    expect(system.dispatcher.undo()).toBe(true)
  })
})
