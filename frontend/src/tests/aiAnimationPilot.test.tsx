import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { analyzeBeats, type AnimationAnalysisSnapshot } from '../ai/animationAnalysis'
import { resolveRenderedViews, type RenderedViewSnapshot } from '../ai/renderedViews'
import { composeSequence, type SequenceSnapshot } from '../ai/animationSequence'
import { proposeShapeDrafts } from '../ai/shapeDrafts'
import { revalidateAnimationProposal, type RevalidationSnapshot } from '../ai/animationRevalidation'
import { planAnimationApply } from '../ai/animationApply'
import { buildPilotBeats, describeSupportedConditions, verifyPilot } from '../ai/pilotVerification'
import { AiAnimationView } from '../components/ai/AiAnimationView'
import type { ContextSnapshot } from '../ai/contextSnapshot'

const CAT_ID = 'n-cat'
const SOFA_ID = 'n-sofa-frame'
const BLACKBOARD_ID = 'n-blackboard'

function analysisSnapshot(overrides: Partial<AnimationAnalysisSnapshot> = {}) {
  return {
    nodes: [
      {
        id: 'root',
        name: 'Room',
        parentId: null,
        depth: 0,
        semanticName: null,
        components: [],
        assetDefinitionId: null,
      },
      {
        id: CAT_ID,
        name: 'Cat',
        parentId: 'root',
        depth: 1,
        semanticName: 'cat',
        components: ['mesh'],
        assetDefinitionId: 'asset-cat',
      },
      {
        id: 'n-tail',
        name: 'Tail',
        parentId: CAT_ID,
        depth: 2,
        semanticName: 'tail',
        components: ['mesh'],
        assetDefinitionId: null,
      },
      {
        id: SOFA_ID,
        name: 'Sofa Frame',
        parentId: 'root',
        depth: 1,
        semanticName: null,
        components: ['mesh'],
        assetDefinitionId: 'asset-room',
      },
      {
        id: BLACKBOARD_ID,
        name: 'Blackboard',
        parentId: 'root',
        depth: 1,
        semanticName: 'blackboard',
        components: [],
        assetDefinitionId: 'asset-room',
      },
    ],
    clips: [
      { id: 'clip-walk', name: 'Walk', channels: ['positionX', 'positionY'] },
      { id: 'clip-turn', name: 'Turn', channels: ['rotation'] },
      { id: 'clip-sit', name: 'Sit', channels: ['positionY'] },
      { id: 'clip-stretch', name: 'Stretch', channels: ['positionY'] },
    ],
    collections: [
      { id: 'col-walk', name: 'Walk Cycle', bindings: { cat: 'clip-walk' } },
      { id: 'col-turn', name: 'Turn', bindings: { cat: 'clip-turn' } },
      { id: 'col-sit', name: 'Sit', bindings: { cat: 'clip-sit' } },
      // Name-only decoy: matches "sleep" by name but binds nothing on the cat.
      { id: 'col-sleepy-dog', name: 'Sleepy Dog', bindings: { dog: 'clip-walk' } },
    ],
    shapes: [{ nodeId: CAT_ID, shapeCount: 2, shapeNames: ['Sit', 'Stretch'] }],
    hasCamera: false,
    ...overrides,
  } satisfies AnimationAnalysisSnapshot
}

function viewSnapshot(): RenderedViewSnapshot {
  return {
    slideId: 's-1',
    slideName: 'Room',
    duration: 12,
    nodes: [
      { id: CAT_ID, name: 'Cat' },
      { id: SOFA_ID, name: 'Sofa Frame' },
      { id: BLACKBOARD_ID, name: 'Blackboard' },
    ],
  }
}

function sequenceSnapshot(): SequenceSnapshot {
  return {
    slideId: 's-1',
    slideName: 'Room',
    duration: 12,
    nodes: [
      { id: CAT_ID, name: 'Cat' },
      { id: SOFA_ID, name: 'Sofa Frame' },
      { id: BLACKBOARD_ID, name: 'Blackboard' },
    ],
  }
}

function shapeNodes() {
  return [
    { id: CAT_ID, name: 'Cat', hasMesh: true, shapeNames: ['Sit', 'Stretch'] },
    { id: SOFA_ID, name: 'Sofa Frame', hasMesh: true, shapeNames: [] },
    { id: BLACKBOARD_ID, name: 'Blackboard', hasMesh: false, shapeNames: [] },
  ]
}

function revalidationSnapshot(overrides: Partial<RevalidationSnapshot> = {}) {
  return {
    slideId: 's-1',
    nodes: [
      { id: CAT_ID, name: 'Cat' },
      { id: SOFA_ID, name: 'Sofa Frame' },
      { id: BLACKBOARD_ID, name: 'Blackboard' },
    ],
    collections: [
      { name: 'Walk Cycle', bindings: { cat: 'clip-walk' } },
      { name: 'Turn', bindings: { cat: 'clip-turn' } },
      { name: 'Sit', bindings: { cat: 'clip-sit' } },
    ],
    hasCamera: false,
    footprint: null,
    fingerprint: 'fp-pilot',
    ...overrides,
  } satisfies RevalidationSnapshot
}

function pilotTargets() {
  return { catNodeId: CAT_ID, sofaNodeId: SOFA_ID, blackboardNodeId: BLACKBOARD_ID }
}

/** Run the full assistant seam for the six-beat pilot route. */
function runPilot(overrides: Partial<AnimationAnalysisSnapshot> = {}) {
  const requested = buildPilotBeats(pilotTargets())
  const analysis = analyzeBeats(requested, analysisSnapshot(overrides))
  const rendered = resolveRenderedViews(
    [
      { id: 'v-sofa', scope: 'focused', time: 0, nodeIds: [CAT_ID, SOFA_ID] },
      { id: 'v-travel', scope: 'focused', time: 4, nodeIds: [CAT_ID] },
      { id: 'v-board', scope: 'focused', time: 8, nodeIds: [CAT_ID, BLACKBOARD_ID] },
    ],
    viewSnapshot(),
  )
  const shapes = proposeShapeDrafts({ beats: analysis.beats, nodes: shapeNodes() })
  const draft = composeSequence({
    beats: analysis.beats,
    views: rendered.views,
    snapshot: sequenceSnapshot(),
    travel: [{ beatId: 'pilot-travel', targetNodeId: CAT_ID, to: { x: 120, y: 40 }, duration: 2 }],
  })
  const snap = revalidationSnapshot()
  const revalidation = revalidateAnimationProposal({
    draft,
    validated: { ...snap },
    live: { ...snap },
    reviewed: true,
  })
  const applyPlan = planAnimationApply({
    draft,
    shapes,
    revalidation,
    approvedBeatIds: ['pilot-travel', 'pilot-sit'],
    approvedDraftIds: [],
  })
  return {
    requested,
    analysis,
    views: rendered.views,
    rendered,
    shapes,
    draft,
    revalidation,
    applyPlan,
  }
}

describe('pilot route (issue #447)', () => {
  it('builds the six-beat cat-on-sofa-to-blackboard route from caller-supplied stable ids', () => {
    const beats = buildPilotBeats(pilotTargets())

    expect(beats.map((beat) => beat.id)).toEqual([
      'pilot-sleep',
      'pilot-wake',
      'pilot-get-down',
      'pilot-travel',
      'pilot-camera',
      'pilot-sit',
    ])
    // Every beat targets the supplied character node — the route is generic,
    // never hard-coded to one named cat.
    for (const beat of beats) {
      expect(beat.target.nodeId).toBe(CAT_ID)
    }
  })

  it('builds the same six-beat structure for an equivalent rig and scene', () => {
    const beats = buildPilotBeats({
      catNodeId: 'n-robot',
      sofaNodeId: 'n-crate',
      blackboardNodeId: 'n-wallchart',
    })

    expect(beats).toHaveLength(6)
    expect(beats.map((beat) => beat.id)).toEqual([
      'pilot-sleep',
      'pilot-wake',
      'pilot-get-down',
      'pilot-travel',
      'pilot-camera',
      'pilot-sit',
    ])
    for (const beat of beats) {
      expect(beat.target.nodeId).toBe('n-robot')
    }
  })

  it('checks walk/turn/sit reuse by binding compatibility while absent motion and camera stay explicit', () => {
    const { analysis } = runPilot()

    const byId = new Map(analysis.beats.map((beat) => [beat.beatId, beat]))
    // Walk and sit reuse binding-compatible collections.
    expect(byId.get('pilot-travel')!.status).toBe('ready')
    expect(byId.get('pilot-travel')!.reusable.map((c) => c.collectionName)).toContain('Walk Cycle')
    expect(byId.get('pilot-sit')!.status).toBe('ready')
    expect(byId.get('pilot-sit')!.reusable.map((c) => c.collectionName)).toContain('Sit')
    // Turn is binding-compatible but blocked on the missing camera prerequisite.
    const camera = byId.get('pilot-camera')!
    expect(camera.status).toBe('missing-prerequisite')
    expect(camera.reusable.map((c) => c.collectionName)).toContain('Turn')
    expect(camera.prerequisites.join(' ')).toMatch(/camera/i)
    // Absent sleep, wake/stretch, and get-down motion is reported as a gap.
    for (const id of ['pilot-sleep', 'pilot-wake', 'pilot-get-down']) {
      const beat = byId.get(id)!
      expect(beat.status).toBe('missing-motion')
      expect(beat.reusable).toEqual([])
      expect(beat.actions.join(' ')).toMatch(/author|draft/i)
    }
    // The toward-camera beat clears once the live Project supplies a camera.
    const withCamera = analyzeBeats(
      buildPilotBeats(pilotTargets()),
      analysisSnapshot({
        hasCamera: true,
        nodes: [
          ...analysisSnapshot().nodes,
          {
            id: 'n-camera',
            name: 'Camera',
            parentId: null,
            depth: 0,
            semanticName: null,
            components: ['camera'],
            assetDefinitionId: null,
          },
        ],
      }),
    )
    expect(withCamera.beats.find((b) => b.beatId === 'pilot-camera')!.status).toBe('ready')
  })

  it('never counts name-only matches as reusable', () => {
    const { analysis } = runPilot()

    const sleep = analysis.beats.find((beat) => beat.beatId === 'pilot-sleep')!
    expect(sleep.status).toBe('missing-motion')
    expect(sleep.reusable).toEqual([])
    expect(sleep.nameOnly.collections.map((c) => c.name)).toContain('Sleepy Dog')
    expect(sleep.warnings.join(' ')).toMatch(/not assumed compatible|binding/i)
  })

  it('links reusable beats to labelled previews carrying Slide, time, and stable node ids', () => {
    const { draft } = runPilot()

    const travel = draft.beats.find((beat) => beat.beatId === 'pilot-travel')!
    expect(travel.status).toBe('draftable')
    expect(travel.previewViewIds.length).toBeGreaterThan(0)
    const full = draft.previews.find((preview) => preview.beatId === null)!
    expect(full.slideId).toBe('s-1')
    expect(full.label).toMatch(/Room/)
    expect(full.nodeIds).toContain(CAT_ID)
    for (const preview of draft.previews) {
      expect(preview.slideId).toBe('s-1')
      expect(preview.label).toMatch(/\[s-1\]/)
      expect(preview.label).toMatch(/\[n-[\w-]+\]/)
    }
    // Blocked pilot beats stay undrafted while independent beats proceed.
    expect(draft.beats.find((b) => b.beatId === 'pilot-sleep')!.status).toBe('blocked')
    expect(draft.summary.draftable).toBeGreaterThan(0)
    // The retained script compiles the draftable beats to ordinary timeline data.
    expect(draft.scriptSource).toMatch(/\.apply\(/)
    expect(draft.scriptSource).toMatch(/Walk Cycle/)
  })

  it('warns when visual fit is unverified instead of inferring it from names', () => {
    const requested = buildPilotBeats(pilotTargets())
    const analysis = analyzeBeats(requested, analysisSnapshot())
    const draft = composeSequence({
      beats: analysis.beats,
      views: [],
      snapshot: sequenceSnapshot(),
    })

    const travel = draft.beats.find((beat) => beat.beatId === 'pilot-travel')!
    expect(travel.status).toBe('draftable')
    expect(travel.previewViewIds).toEqual([])
    expect(travel.warnings.join(' ')).toMatch(/rendered preview|focused view/i)
  })

  it('proposes reviewable Shape drafts for missing poses without mutating the source', () => {
    const before = JSON.stringify(shapeNodes())
    const { analysis, shapes } = runPilot()

    const missing = analysis.beats.filter((beat) =>
      ['pilot-sleep', 'pilot-wake', 'pilot-get-down'].includes(beat.beatId),
    )
    expect(missing.every((beat) => beat.status === 'missing-motion')).toBe(true)
    // Wake/stretch has name-level Shape evidence yet no reusable motion.
    const wake = analysis.beats.find((beat) => beat.beatId === 'pilot-wake')!
    expect(wake.geometry.state).toBe('available')
    expect(shapes.drafts.length).toBeGreaterThan(0)
    for (const draft of shapes.drafts) {
      expect(draft.sourceShapeName).toBeTruthy()
    }
    expect(JSON.stringify(shapeNodes())).toBe(before)
  })

  it('records successes, blockers, and limitations across the six beats', () => {
    const stages = runPilot()
    const before = JSON.stringify({
      requested: stages.requested,
      beats: stages.analysis.beats,
      views: stages.views,
      draft: stages.draft.beats,
    })
    const verification = verifyPilot(stages)

    expect(verification.coversAllSix).toBe(true)
    expect(verification.beats).toHaveLength(6)
    const byId = new Map(verification.beats.map((beat) => [beat.beatId, beat]))
    expect(byId.get('pilot-travel')!.reusableNames).toContain('Walk Cycle')
    expect(byId.get('pilot-sit')!.reusableNames).toContain('Sit')
    expect(byId.get('pilot-camera')!.prerequisites.join(' ')).toMatch(/camera/i)
    for (const id of ['pilot-sleep', 'pilot-wake', 'pilot-get-down']) {
      expect(byId.get(id)!.status).toBe('missing-motion')
    }
    expect(verification.summary.blocked).toBeGreaterThan(0)
    expect(verification.successes.join(' ')).toMatch(/Walk Cycle|Sit/)
    expect(verification.blockers.join(' ')).toMatch(/camera/i)
    expect(verification.limitations.join(' ')).toMatch(/sleep|wake|get-down/i)
    // Verification is read-only.
    expect(
      JSON.stringify({
        requested: stages.requested,
        beats: stages.analysis.beats,
        views: stages.views,
        draft: stages.draft.beats,
      }),
    ).toBe(before)
  })

  it('verifies the same evidence shape on an equivalent rig and scene', () => {
    const equivalent = analysisSnapshot({
      nodes: [
        {
          id: 'root',
          name: 'Garage',
          parentId: null,
          depth: 0,
          semanticName: null,
          components: [],
          assetDefinitionId: null,
        },
        {
          id: 'n-robot',
          name: 'Robot',
          parentId: 'root',
          depth: 1,
          semanticName: 'robot',
          components: ['mesh'],
          assetDefinitionId: 'asset-robot',
        },
        {
          id: 'n-crate',
          name: 'Crate',
          parentId: 'root',
          depth: 1,
          semanticName: null,
          components: ['mesh'],
          assetDefinitionId: 'asset-garage',
        },
        {
          id: 'n-wallchart',
          name: 'Wallchart',
          parentId: 'root',
          depth: 1,
          semanticName: 'wallchart',
          components: [],
          assetDefinitionId: 'asset-garage',
        },
      ],
      collections: [
        { id: 'col-roll', name: 'Roll', bindings: { robot: 'clip-walk' } },
        { id: 'col-spin', name: 'Spin', bindings: { robot: 'clip-turn' } },
        { id: 'col-park', name: 'Park', bindings: { robot: 'clip-sit' } },
      ],
      shapes: [{ nodeId: 'n-robot', shapeCount: 1, shapeNames: ['Park'] }],
    })
    const requested = buildPilotBeats({
      catNodeId: 'n-robot',
      sofaNodeId: 'n-crate',
      blackboardNodeId: 'n-wallchart',
    })
    const analysis = analyzeBeats(requested, equivalent)

    const verification = verifyPilot({
      requested,
      analysis,
      views: [],
      draft: composeSequence({
        beats: analysis.beats,
        views: [],
        snapshot: {
          slideId: 's-9',
          slideName: 'Garage',
          duration: 12,
          nodes: [
            { id: 'n-robot', name: 'Robot' },
            { id: 'n-crate', name: 'Crate' },
            { id: 'n-wallchart', name: 'Wallchart' },
          ],
        },
      }),
      shapes: proposeShapeDrafts({
        beats: analysis.beats,
        nodes: [{ id: 'n-robot', name: 'Robot', hasMesh: true, shapeNames: ['Park'] }],
      }),
      revalidation: revalidateAnimationProposal({
        draft: composeSequence({ beats: analysis.beats, views: [], snapshot: sequenceSnapshot() }),
        validated: revalidationSnapshot(),
        live: revalidationSnapshot(),
        reviewed: true,
      }),
      applyPlan: planAnimationApply({
        draft: composeSequence({ beats: analysis.beats, views: [], snapshot: sequenceSnapshot() }),
        shapes: {
          drafts: [],
          warnings: [],
          summary: { total: 0, proposed: 0, needsArtistGeometry: 0 },
          note: '',
        },
        revalidation: revalidateAnimationProposal({
          draft: composeSequence({
            beats: analysis.beats,
            views: [],
            snapshot: sequenceSnapshot(),
          }),
          validated: revalidationSnapshot(),
          live: revalidationSnapshot(),
          reviewed: true,
        }),
        approvedBeatIds: [],
        approvedDraftIds: [],
      }),
    })

    expect(verification.coversAllSix).toBe(true)
    expect(verification.beats.map((beat) => beat.beatId)).toEqual([
      'pilot-sleep',
      'pilot-wake',
      'pilot-get-down',
      'pilot-travel',
      'pilot-camera',
      'pilot-sit',
    ])
    // No cat/room wording leaks into the evidence keys — targets are stable ids.
    for (const beat of verification.beats) {
      for (const id of beat.targetNodeIds) {
        expect(id).toBe('n-robot')
      }
    }
  })

  it('blocks stale pilot beats until refreshed and keeps them unapplied', () => {
    const stages = runPilot()
    const live = revalidationSnapshot({
      nodes: [{ id: SOFA_ID, name: 'Sofa Frame' }],
      fingerprint: 'fp-moved',
    })
    const revalidation = revalidateAnimationProposal({
      draft: stages.draft,
      validated: revalidationSnapshot(),
      live,
      reviewed: true,
    })
    expect(revalidation.blocked).toBe(true)

    const applyPlan = planAnimationApply({
      draft: stages.draft,
      shapes: stages.shapes,
      revalidation,
      approvedBeatIds: ['pilot-travel', 'pilot-sit'],
      approvedDraftIds: [],
    })
    expect(applyPlan.appliableBeatIds).toEqual([])

    const verification = verifyPilot({ ...stages, revalidation, applyPlan })
    expect(verification.summary.affected).toBeGreaterThan(0)
    expect(verification.blockers.join(' ')).toMatch(/stale|refresh/i)
  })

  it('keeps blocked pilot beats unapplied while approved beats apply as one batch', () => {
    const stages = runPilot()

    expect(stages.applyPlan.appliableBeatIds).toEqual(['pilot-travel', 'pilot-sit'])
    const skipped = stages.applyPlan.skippedBeats.map((beat) => beat.beatId)
    expect(skipped).toContain('pilot-sleep')
    expect(skipped).toContain('pilot-camera')
    expect(stages.applyPlan.subsetScriptSource).toMatch(/\.apply\(/)
    expect(stages.applyPlan.subsetScriptSource).toMatch(/Sleep on the sofa.*omitted|blocked/s)
  })

  it('bounds the supported conditions and gates broader claims on human evidence review', () => {
    const verification = verifyPilot(runPilot())
    const conditions = describeSupportedConditions(verification)

    expect(conditions.route).toHaveLength(6)
    expect(conditions.prerequisites.join(' ')).toMatch(/camera/i)
    expect(conditions.prerequisites.join(' ')).toMatch(/stable.*id|Unique Name/i)
    expect(conditions.limitations.join(' ')).toMatch(/sleep|wake|get-down/i)
    expect(conditions.requiresHumanEvidenceReview).toBe(true)
    expect(conditions.claim).toMatch(/human evidence review/i)
    // Failures narrow the claim instead of hiding behind a broad feature claim.
    expect(conditions.claim).toMatch(/pilot/i)
    expect(conditions.claim).not.toMatch(/all rigs|every scene|general/i)
  })
})

function pilotContext(): ContextSnapshot {
  return {
    projectName: 'Cat Pilot',
    projectId: 'p-1',
    activeSlideName: 'Room',
    activeSlideDuration: 12,
    slides: [{ id: 's-1', name: 'Room', order: 0 }],
    sceneNodes: ['Cat [n-cat]'],
    selection: [],
    materials: [],
    shaders: [],
    clips: ['Walk', 'Turn', 'Sit'],
    assets: [],
    clipCollections: ['Walk Cycle', 'Turn', 'Sit'],
    audio: [],
    embeddedAudio: [],
    animatableParams: ['positionX'],
    scriptVerbs: ['reveal'],
    animation: {
      nodes: [
        {
          id: CAT_ID,
          name: 'Cat',
          parentId: 'root',
          depth: 1,
          semanticName: 'cat',
          components: ['mesh'],
          assetDefinitionId: 'asset-cat',
          transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
          worldTransform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          childCount: 1,
        },
        {
          id: 'n-tail',
          name: 'Tail',
          parentId: CAT_ID,
          depth: 2,
          semanticName: 'tail',
          components: ['mesh'],
          assetDefinitionId: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          childCount: 0,
        },
        {
          id: SOFA_ID,
          name: 'Sofa Frame',
          parentId: 'root',
          depth: 1,
          semanticName: null,
          components: ['mesh'],
          assetDefinitionId: 'asset-room',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          childCount: 0,
        },
        {
          id: BLACKBOARD_ID,
          name: 'Blackboard',
          parentId: 'root',
          depth: 1,
          semanticName: 'blackboard',
          components: [],
          assetDefinitionId: 'asset-room',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          childCount: 0,
        },
      ],
      rig: {
        boneCount: 0,
        bones: [],
        shapeInventory: [{ nodeId: CAT_ID, shapeCount: 2, shapeNames: ['Sit', 'Stretch'] }],
        morphBindings: [],
        controls: [],
      },
      clips: [
        {
          id: 'clip-walk',
          name: 'Walk',
          duration: 2,
          category: 'locomotion',
          channelCount: 2,
          channels: ['positionX', 'positionY'],
        },
        {
          id: 'clip-turn',
          name: 'Turn',
          duration: 1,
          category: 'locomotion',
          channelCount: 1,
          channels: ['rotation'],
        },
        {
          id: 'clip-sit',
          name: 'Sit',
          duration: 1,
          category: 'pose',
          channelCount: 1,
          channels: ['positionY'],
        },
      ],
      collections: [
        {
          id: 'col-walk',
          name: 'Walk Cycle',
          category: 'locomotion',
          bindingCount: 1,
          bindings: { cat: 'clip-walk' },
          hasAlignmentOffsets: false,
        },
        {
          id: 'col-turn',
          name: 'Turn',
          category: 'locomotion',
          bindingCount: 1,
          bindings: { cat: 'clip-turn' },
          hasAlignmentOffsets: false,
        },
        {
          id: 'col-sit',
          name: 'Sit',
          category: 'pose',
          bindingCount: 1,
          bindings: { cat: 'clip-sit' },
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
    },
  }
}

describe('AiAnimationView pilot verification (issue #447)', () => {
  it('verifies the six-beat pilot and documents the supported conditions', () => {
    const before = JSON.stringify(pilotContext())
    render(
      <AiAnimationView
        projectId="p-1"
        conversationId="c-1"
        context={pilotContext()}
        beats={buildPilotBeats(pilotTargets())}
        viewRequests={[
          { id: 'v-sofa', scope: 'focused', time: 0, nodeIds: [CAT_ID, SOFA_ID] },
          { id: 'v-board', scope: 'focused', time: 8, nodeIds: [CAT_ID, BLACKBOARD_ID] },
        ]}
        travel={[
          { beatId: 'pilot-travel', targetNodeId: CAT_ID, to: { x: 120, y: 40 }, duration: 2 },
        ]}
      />,
    )

    expect(screen.getByTestId('ai-pilot-verification')).toBeInTheDocument()
    expect(screen.getByTestId('ai-pilot-summary')).toHaveTextContent(/6 beats/)
    for (const id of [
      'pilot-sleep',
      'pilot-wake',
      'pilot-get-down',
      'pilot-travel',
      'pilot-camera',
      'pilot-sit',
    ]) {
      expect(screen.getByTestId(`ai-pilot-beat-${id}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('ai-pilot-beat-pilot-travel')).toHaveTextContent(/Walk Cycle/)
    expect(screen.getByTestId('ai-pilot-beat-pilot-sleep')).toHaveTextContent(
      /missing.*motion|no compatible/i,
    )
    expect(screen.getByTestId('ai-pilot-beat-pilot-camera')).toHaveTextContent(/camera/i)
    expect(screen.getByTestId('ai-pilot-conditions')).toHaveTextContent(/camera/i)
    expect(screen.getByTestId('ai-pilot-review-gate')).toHaveTextContent(/human evidence review/i)
    // The pilot section is read-only like every other assistant section.
    expect(JSON.stringify(pilotContext())).toBe(before)
  })

  it('shows an empty note when the pilot route has not been requested yet', () => {
    render(<AiAnimationView projectId="p-1" conversationId="c-1" context={pilotContext()} />)

    expect(screen.getByTestId('ai-pilot-empty')).toBeInTheDocument()
  })
})
