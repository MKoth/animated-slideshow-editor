import { describe, expect, it } from 'vitest'
import { composeSequence, type SequenceSnapshot } from '../ai/animationSequence'
import {
  acceptShapeDraft,
  proposeShapeDrafts,
  rejectShapeDraft,
  type ShapeDraftResult,
} from '../ai/shapeDrafts'
import {
  revalidateAnimationProposal,
  toRevalidationSnapshotFromAssistant,
  type RevalidationResult,
  type RevalidationSnapshot,
} from '../ai/animationRevalidation'
import {
  applyAnimationBatch,
  dryRunAnimationApply,
  planAnimationApply,
  type AnimationApplyPlan,
} from '../ai/animationApply'
import { computeProjectFingerprint } from '../ai/proposals'
import { checkAnimationScript } from '../engine/animationScriptCheck'
import {
  CreateClipCollectionCommand,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateShapeCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  SetSemanticNameCommand,
  SetSlideDurationCommand,
  createCommandSystem,
} from '../engine/commands'
import { createDefaultRectangleMesh } from '../engine/mesh'
import type { BeatAnalysis } from '../ai/animationAnalysis'
import type { SequenceDraft } from '../ai/animationSequence'

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

function missingBeat(beatId: string, label = beatId): BeatAnalysis {
  return {
    beatId,
    label,
    status: 'missing-motion',
    resolvedNodeIds: ['n-cat'],
    reusable: [],
    nameOnly: { collections: [], clips: [] },
    geometry: {
      state: 'missing-with-suggestion',
      matchedShapes: [],
      closestFit: 'Sit',
      note: 'missing pose',
    },
    prerequisites: [],
    warnings: [],
    question: null,
    actions: ['Author new motion or approve a draft.'],
    candidates: [],
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
    fingerprint: 'fp-same',
    ...overrides,
  }
}

function setupDraft(beats: BeatAnalysis[]): SequenceDraft {
  return composeSequence({ beats, views: [], snapshot: snapshot() })
}

function currentRevalidation(draft: SequenceDraft): RevalidationResult {
  const snap = liveSnapshot()
  return revalidateAnimationProposal({
    draft,
    validated: { ...snap },
    live: { ...snap },
    reviewed: true,
  })
}

function shapeNodes() {
  return [{ id: 'n-cat', name: 'Cat', hasMesh: true, shapeNames: ['Sit'] }]
}

describe('planAnimationApply (issue #446)', () => {
  it('applies only explicitly approved valid beats as one batch', () => {
    const draft = setupDraft([
      readyBeat('b-walk', 'Walk across the room'),
      readyBeat('b-sit', 'Sit by the blackboard'),
    ])
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const revalidation = currentRevalidation(draft)
    expect(revalidation.approvable).toBe(true)

    const plan = planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: ['b-walk'],
      approvedDraftIds: [],
    })

    expect(plan.appliableBeatIds).toEqual(['b-walk'])
    expect(plan.skippedBeats.map((s) => s.beatId)).toContain('b-sit')
    const unapproved = plan.skippedBeats.find((s) => s.beatId === 'b-sit')!
    expect(unapproved.reason.toLowerCase()).toMatch(/not.*approv|explicit/)
    // The subset script applies the approved beat and omits the unapproved one.
    expect(plan.subsetScriptSource).toMatch(/Walk across the room/)
    expect(plan.subsetScriptSource).toMatch(/\.apply\(/)
    expect(plan.subsetScriptSource).toMatch(/Sit by the blackboard.*omitted/s)
    // Planning is read-only.
    expect(JSON.stringify(draft)).toContain('b-sit')
  })

  it('leaves blocked beats unapplied even when approved', () => {
    const draft = setupDraft([
      readyBeat('b-walk', 'Walk across the room'),
      missingBeat('b-sleep', 'Sleep on the sofa'),
    ])
    expect(draft.summary.blocked).toBe(1)
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const revalidation = currentRevalidation(draft)

    const plan = planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: ['b-walk', 'b-sleep'],
      approvedDraftIds: [],
    })

    expect(plan.appliableBeatIds).toEqual(['b-walk'])
    const skipped = plan.skippedBeats.find((s) => s.beatId === 'b-sleep')!
    expect(skipped.reason.toLowerCase()).toMatch(/blocked/)
    expect(plan.subsetScriptSource).toMatch(/Sleep on the sofa.*omitted|blocked/s)
  })

  it('leaves stale beats unapplied until refreshed and reviewed again', () => {
    const draft = setupDraft([readyBeat('b-walk', 'Walk across the room')])
    const validated = liveSnapshot({ fingerprint: 'fp-validated' })
    const live = liveSnapshot({
      nodes: [{ id: 'n-sofa', name: 'Sofa' }],
      fingerprint: 'fp-moved',
    })
    const revalidation = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    expect(revalidation.blocked).toBe(true)

    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const plan = planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: ['b-walk'],
      approvedDraftIds: [],
    })

    expect(plan.appliableBeatIds).toEqual([])
    expect(plan.approvable).toBe(false)
    const skipped = plan.skippedBeats.find((s) => s.beatId === 'b-walk')!
    expect(skipped.reason.toLowerCase()).toMatch(/stale/)
    expect(skipped.action.toLowerCase()).toMatch(/re-run analysis/)
  })

  it('leaves dependency-incomplete beats unapplied while independents proceed', () => {
    const draft = setupDraft([
      readyBeat('b-walk', 'Walk across the room'),
      readyBeat('b-sit', 'Sit by the blackboard'),
    ])
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const revalidation = currentRevalidation(draft)

    // Approving only the second beat of a sequential pair is dependency-incomplete:
    // placements are sequential ("After beat ..."), so it stays unapplied.
    const plan = planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: ['b-sit'],
      approvedDraftIds: [],
    })

    expect(plan.appliableBeatIds).toEqual([])
    const skipped = plan.skippedBeats.find((s) => s.beatId === 'b-sit')!
    expect(skipped.reason.toLowerCase()).toMatch(/dependenc/)
    expect(plan.subsetScriptSource).toMatch(/^script "Scene Animation Sequence" from 0/m)
    expect(plan.subsetScriptSource).toMatch(/No beats approved in this batch/)
    expect(plan.subsetScriptSource).not.toMatch(/\.apply\(/)
  })

  it('applies only accepted shape drafts; rejected and geometry requests stay unapplied', () => {
    const draft = setupDraft([readyBeat('b-walk', 'Walk across the room')])
    const revalidation = currentRevalidation(draft)
    const beats = [missingBeat('b-sleep', 'Sleep on the sofa')]
    const proposed = proposeShapeDrafts({ beats, nodes: shapeNodes() }).drafts[0]
    const accepted = acceptShapeDraft(proposed)
    const rejected = rejectShapeDraft(proposed, 'Ears cannot fold that far')
    const shapes: ShapeDraftResult = {
      drafts: [accepted, rejected],
      warnings: [],
      summary: { total: 2, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }

    const plan = planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: [],
      approvedDraftIds: [accepted.draftId, rejected.draftId],
    })

    expect(plan.appliableDraftIds).toEqual([accepted.draftId])
    const skipped = plan.skippedDrafts.find((s) => s.draftId === rejected.draftId)!
    expect(skipped.reason.toLowerCase()).toMatch(/reject/)
  })

  it('requires renewed review before anything is appliable', () => {
    const draft = setupDraft([readyBeat('b-walk', 'Walk across the room')])
    const snap = liveSnapshot()
    const revalidation = revalidateAnimationProposal({
      draft,
      validated: { ...snap },
      live: { ...snap },
      reviewed: false,
    })
    expect(revalidation.approvable).toBe(false)
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }

    const plan = planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: ['b-walk'],
      approvedDraftIds: [],
    })

    expect(plan.appliableBeatIds).toEqual([])
    expect(plan.approvable).toBe(false)
    expect(plan.needsReview).toBe(true)
  })

  it('caps the batch to a reviewable size', () => {
    const beats = Array.from({ length: 30 }, (_, i) => readyBeat(`b-${i}`, `Beat ${i}`))
    const full = setupDraft(beats)
    // composeSequence already caps to 12; the apply plan never exceeds it either.
    expect(full.beats.length).toBeLessThanOrEqual(12)
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const revalidation = currentRevalidation(full)
    const plan = planAnimationApply({
      draft: full,
      shapes,
      revalidation,
      approvedBeatIds: full.beats.filter((b) => b.status === 'draftable').map((b) => b.beatId),
      approvedDraftIds: [],
    })
    expect(plan.appliableBeatIds.length).toBeLessThanOrEqual(12)
  })

  it('never mutates its inputs', () => {
    const draft = setupDraft([readyBeat('b-walk', 'Walk across the room')])
    const revalidation = currentRevalidation(draft)
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const before = JSON.stringify({ draft, revalidation, shapes })
    planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds: ['b-walk'],
      approvedDraftIds: [],
    })
    expect(JSON.stringify({ draft, revalidation, shapes })).toBe(before)
  })
})

/** Shared live rig: Cat parent (meshed, one `Sit` shape) + `paw` part child with a reusable `Walk Cycle` collection. */
function setupLiveRig() {
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
        components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
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
  system.dispatcher.dispatch(new CreateShapeCommand({ nodeId: catId, name: 'Sit' }) as never)
  const baseline = system.undoStack.entries.length
  return { system, slideId: slide.id, catId, baseline }
}

describe('dryRunAnimationApply (issue #446)', () => {
  function setup() {
    return setupLiveRig()
  }

  function liveDraft(catId: string, catName: string, slideId: string) {
    return composeSequence({
      beats: [
        {
          ...readyBeat('b-walk', 'Walk across the room'),
          resolvedNodeIds: [catId],
          // The live rig binds the collection through the `paw` semantic part.
          reusable: [
            {
              collectionId: 'col-walk',
              collectionName: 'Walk Cycle',
              matchedSemantics: ['paw'],
              clipIds: ['clip-walk'],
            },
          ],
        },
      ],
      views: [],
      snapshot: { slideId, slideName: 'Room', duration: 12, nodes: [{ id: catId, name: catName }] },
    })
  }

  function liveAssistantSnapshot(catId: string, catName: string, slideId: string) {
    return {
      nodes: [
        {
          id: catId,
          name: catName,
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
          bindings: { paw: 'clip-paw' },
          hasAlignmentOffsets: false,
        },
      ],
      timeline: {
        slideId,
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
  }

  function livePlan(
    draft: SequenceDraft,
    catId: string,
    catName: string,
    slideId: string,
    approvedBeatIds: string[] = ['b-walk'],
  ): AnimationApplyPlan {
    const validated = toRevalidationSnapshotFromAssistant(
      liveAssistantSnapshot(catId, catName, slideId),
      { footprint: null, fingerprint: 'fp-same' },
    )
    const live = {
      ...validated,
      collections: validated.collections.map((c) => ({ ...c, bindings: { ...c.bindings } })),
      nodes: validated.nodes.map((n) => ({ ...n })),
    }
    const revalidation = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    const shapes: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    return planAnimationApply({
      draft,
      shapes,
      revalidation,
      approvedBeatIds,
      approvedDraftIds: [],
    })
  }

  it('passes on an approved valid batch without mutating the engine', () => {
    const { system, slideId, catId } = setup()
    const cat = system.engine.getNode(catId)
    const draft = liveDraft(catId, cat.name, slideId)
    expect(draft.summary.draftable).toBe(1)
    const plan = livePlan(draft, catId, cat.name, slideId)
    expect(plan.appliableBeatIds).toEqual(['b-walk'])
    expect(plan.approvable).toBe(true)

    const before = computeProjectFingerprint(system.engine)
    const placementsBefore = system.engine.getNode(catId).collectionPlacements.length
    const result = dryRunAnimationApply(system.engine, slideId, plan)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    // The dry-run never executes: no project movement, no new history.
    expect(computeProjectFingerprint(system.engine)).toBe(before)
    expect(system.engine.getNode(catId).collectionPlacements.length).toBe(placementsBefore)
  })

  it('fails a batch with nothing appliable before anything executes', () => {
    const { system, slideId, catId, baseline } = setup()
    const cat = system.engine.getNode(catId)
    const draft = liveDraft(catId, cat.name, slideId)
    // Nothing explicitly approved: the batch stays unapplied.
    const plan = livePlan(draft, catId, cat.name, slideId, [])
    expect(plan.appliableBeatIds).toEqual([])

    const before = computeProjectFingerprint(system.engine)
    const result = dryRunAnimationApply(system.engine, slideId, plan)
    expect(result.ok).toBe(false)
    expect(result.errors[0].message.toLowerCase()).toMatch(/nothing appliable|approve/)
    expect(computeProjectFingerprint(system.engine)).toBe(before)
    expect(system.undoStack.entries.length).toBe(baseline)
  })
})

describe('applyAnimationBatch (issue #446)', () => {
  function setup() {
    return setupLiveRig()
  }

  function planFor(
    system: ReturnType<typeof setup>['system'],
    slideId: string,
    catId: string,
    beats: BeatAnalysis[],
    approvedBeatIds: string[],
    approvedDraftIds: string[] = [],
    shapeDrafts: ShapeDraftResult = {
      drafts: [],
      warnings: [],
      summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    },
  ): AnimationApplyPlan {
    const cat = system.engine.getNode(catId)
    // The synthetic readyBeat helper speaks the `cat` semantic; the live rig
    // binds the collection through the `paw` semantic part — normalize here so
    // the draft, like the live analysis, carries binding evidence.
    const liveBeats = beats.map((beat) =>
      beat.reusable.length > 0
        ? {
            ...beat,
            reusable: beat.reusable.map((candidate) => ({
              ...candidate,
              matchedSemantics: ['paw'],
            })),
          }
        : beat,
    )
    const draft = composeSequence({
      beats: liveBeats,
      views: [],
      snapshot: {
        slideId,
        slideName: 'Room',
        duration: 12,
        nodes: [{ id: catId, name: cat.name }],
      },
    })
    const validated = toRevalidationSnapshotFromAssistant(
      {
        nodes: [
          {
            id: catId,
            name: cat.name,
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
            bindings: { paw: 'clip-paw' },
            hasAlignmentOffsets: false,
          },
        ],
        timeline: {
          slideId,
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
      } as never,
      {
        footprint: system.engine.getSlide(slideId).animationScript?.lastCompiled ?? null,
        fingerprint: 'fp-same',
      },
    )
    const live = {
      ...validated,
      collections: validated.collections.map((c) => ({ ...c, bindings: { ...c.bindings } })),
      nodes: validated.nodes.map((n) => ({ ...n })),
    }
    const revalidation = revalidateAnimationProposal({ draft, validated, live, reviewed: true })
    return planAnimationApply({
      draft,
      shapes: shapeDrafts,
      revalidation,
      approvedBeatIds,
      approvedDraftIds,
    })
  }

  it('applies approved beats to the active Project as one Transaction with one History Entry', () => {
    const { system, slideId, catId, baseline } = setup()
    const plan = planFor(
      system,
      slideId,
      catId,
      [{ ...readyBeat('b-walk', 'Walk across the room'), resolvedNodeIds: [catId] }],
      ['b-walk'],
    )
    expect(plan.approvable).toBe(true)
    // The retained subset script is runnable before anything is applied.
    const checked = checkAnimationScript(system.engine, slideId, plan.subsetScriptSource)
    expect(checked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(checked.runnable).toBe(true)

    let saved = 0
    system.dispatcher.setOnCommandSucceeded(() => {
      saved += 1
    })
    const beforePlacements = system.engine.getNode(catId).collectionPlacements.length
    const result = applyAnimationBatch(
      { dispatcher: system.dispatcher, undoStack: system.undoStack, engine: system.engine },
      slideId,
      plan,
    )
    expect(result.ok).toBe(true)
    expect(result.appliedBeatIds).toEqual(['b-walk'])
    expect(result.skippedBeatIds).toEqual([])
    expect(result.historyEntryId).toBeTruthy()
    // Exactly one new History Entry for the whole batch, through the AI source.
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
    expect(system.undoStack.entries[0].source).toBe('ai')
    // The active Project changed in memory: ordinary timeline data plus the retained recipe.
    expect(system.engine.getNode(catId).collectionPlacements.length).toBeGreaterThan(
      beforePlacements,
    )
    expect(system.engine.getSlide(slideId).animationScript?.source).toContain(
      'Walk across the room',
    )
    // Persistence rides the existing Save flow channel — no implicit save inside apply.
    expect(saved).toBe(1)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled).not.toBeNull()
  })

  it('leaves blocked beats unapplied while the approved beat applies', () => {
    const { system, slideId, catId, baseline } = setup()
    const plan = planFor(
      system,
      slideId,
      catId,
      [
        { ...readyBeat('b-walk', 'Walk across the room'), resolvedNodeIds: [catId] },
        { ...missingBeat('b-sleep', 'Sleep on the sofa'), resolvedNodeIds: [catId] },
      ],
      ['b-walk', 'b-sleep'],
    )
    expect(plan.appliableBeatIds).toEqual(['b-walk'])
    expect(plan.skippedBeats.map((s) => s.beatId)).toContain('b-sleep')

    const result = applyAnimationBatch(
      { dispatcher: system.dispatcher, undoStack: system.undoStack, engine: system.engine },
      slideId,
      plan,
    )
    expect(result.ok).toBe(true)
    expect(result.appliedBeatIds).toEqual(['b-walk'])
    expect(result.skippedBeatIds).toContain('b-sleep')
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    // The retained recipe documents the blocked beat as omitted — never applied.
    expect(system.engine.getSlide(slideId).animationScript?.source).toMatch(
      /Sleep on the sofa.*omitted/s,
    )
  })

  it('duplicates approved Shape drafts with the source unchanged in the same Transaction', () => {
    const { system, slideId, catId, baseline } = setup()
    const sourceBefore = JSON.parse(JSON.stringify(system.engine.getShapes(catId)[0]))
    const proposed = proposeShapeDrafts({
      beats: [
        {
          ...missingBeat('b-sleep', 'Sleep on the sofa'),
          resolvedNodeIds: [catId],
        },
      ],
      nodes: [{ id: catId, name: 'Cat', hasMesh: true, shapeNames: ['Sit'] }],
    }).drafts[0]
    const accepted = acceptShapeDraft(proposed)
    const shapeDrafts: ShapeDraftResult = {
      drafts: [accepted],
      warnings: [],
      summary: { total: 1, proposed: 0, needsArtistGeometry: 0 },
      note: '',
    }
    const plan = planFor(
      system,
      slideId,
      catId,
      [{ ...readyBeat('b-walk', 'Walk across the room'), resolvedNodeIds: [catId] }],
      ['b-walk'],
      [accepted.draftId],
      shapeDrafts,
    )
    expect(plan.appliableDraftIds).toEqual([accepted.draftId])

    const result = applyAnimationBatch(
      { dispatcher: system.dispatcher, undoStack: system.undoStack, engine: system.engine },
      slideId,
      plan,
    )
    expect(result.ok).toBe(true)
    expect(result.appliedDraftIds).toEqual([accepted.draftId])
    // Still exactly one History Entry for beats plus drafts together.
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
    const shapes = system.engine.getShapes(catId)
    expect(shapes).toHaveLength(2)
    expect(shapes[0]).toEqual(sourceBefore)
    // Topology preserved: the copy carries the same vertex count as the mesh.
    const mesh = system.engine.getNode(catId).components.mesh!.mesh
    expect(shapes[1].vertices).toHaveLength(mesh.vertices.length)
    // Beats applied alongside the draft in the same batch.
    expect(system.engine.getNode(catId).collectionPlacements.length).toBeGreaterThan(0)
  })

  it('rolls back fully with no partial history when live state goes stale before execution', () => {
    const { system, slideId, catId, baseline } = setup()
    const plan = planFor(
      system,
      slideId,
      catId,
      [{ ...readyBeat('b-walk', 'Walk across the room'), resolvedNodeIds: [catId] }],
      ['b-walk'],
    )
    expect(plan.approvable).toBe(true)
    const placementsBefore = system.engine.getNode(catId).collectionPlacements.length

    // The project moves between review and approval: the target disappears.
    system.dispatcher.dispatch(new DeleteNodeCommand({ nodeId: catId }) as never)
    const moved = system.undoStack.entries.length

    const result = applyAnimationBatch(
      { dispatcher: system.dispatcher, undoStack: system.undoStack, engine: system.engine },
      slideId,
      plan,
    )
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toMatch(/stale|runnable|check/i)
    expect(result.appliedBeatIds).toEqual([])
    // No partial history from the failed batch and no placements from it.
    expect(system.undoStack.entries.length).toBe(moved)
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    void placementsBefore
  })

  it('restores the prior output with one undo and stays save-compatible', () => {
    const { system, slideId, catId } = setup()
    const plan = planFor(
      system,
      slideId,
      catId,
      [{ ...readyBeat('b-walk', 'Walk across the room'), resolvedNodeIds: [catId] }],
      ['b-walk'],
    )
    const result = applyAnimationBatch(
      { dispatcher: system.dispatcher, undoStack: system.undoStack, engine: system.engine },
      slideId,
      plan,
    )
    expect(result.ok).toBe(true)
    expect(system.engine.getNode(catId).collectionPlacements.length).toBeGreaterThan(0)

    // Save-compatible: the applied output serializes with the project.
    const json = JSON.stringify(system.engine.toJSON())
    expect(json).toContain('Walk across the room')
    expect(JSON.parse(json).project.name).toBe('Cat performance')

    // One undo restores the prior Run output as one coherent Transaction.
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getNode(catId).collectionPlacements.length).toBe(0)
  })
})
