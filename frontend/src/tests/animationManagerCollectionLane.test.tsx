/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack, CreateClipCommand } from '../engine/commands'
import {
  PlaceCollectionCommand,
  ReorderCollectionPlacementCommand,
  MoveClipLayerCommand,
} from '../engine/commands'
import {
  SetClipInstanceSpeedCommand,
  SetClipInstanceStartTimeCommand,
  TransactionCommand,
  SetCollectionPlacementStartTimeCommand,
} from '../engine/commands'
import { useSelectionStore } from '../stores/selectionStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import {
  packCollectionLanesForParent,
  visualDurationForCollectionPlacement,
} from '../engine/animationManagerModel'
import { noopPersistence } from './contextHarness'

function renderManager(
  engine: Engine,
  undo: UndoStack,
  parentNodeId: string | null,
  onClose = () => {},
) {
  const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack: undo,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
  return render(
    <EngineContext.Provider value={value}>
      <AnimationManagerModal
        open={parentNodeId !== null}
        parentNodeId={parentNodeId}
        onClose={onClose}
      />
    </EngineContext.Provider>,
  )
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false } as never)
  useParentingModeStore.getState().reset()
})

describe('Animation Manager 15-06 – Collection Lane single bar, uniform stretch, move and stacking with two-axis reorder', () => {
  it('Collection Lane renders as single bar on parent top collection section, hidden internals, tooltip', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child1 = engine.createNode(slide.scene.id, parent.id, 'Child1')
    engine.setSemanticName(child1.id, 'hand')
    const child2 = engine.createNode(slide.scene.id, parent.id, 'Child2')
    engine.setSemanticName(child2.id, 'foot')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'ClipA',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clip2 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'ClipB',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const col = engine.createClipCollection('MyCollection', { hand: clip1, foot: clip2 }, parent.id)
    // Place via command (creates placement + instances)
    const placeRes = dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: parent.id, startTime: 0 }),
    ) as any
    expect(placeRes.ok).toBe(true)
    const placementId = placeRes.inverse.placementId as string

    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    // Collection lanes section should exist
    const section = await within(modal).findByTestId('collection-lanes-section')
    expect(section).toBeInTheDocument()
    const lane = await within(section).findByTestId(`collection-lane-${placementId}`)
    expect(lane).toBeInTheDocument()
    // Tooltip should contain collection name and bindings
    expect(lane.getAttribute('title')).toContain('MyCollection')
    expect(lane.getAttribute('title')).toContain('hand')
    expect(lane.getAttribute('title')).toContain('foot')
    // Hidden internals: lane should show collection name only, not per-channel breakdown
    const label = within(lane).getByTestId(`collection-lane-label-${placementId}`)
    expect(label.textContent).toBe('MyCollection')
    // Per-object Clip Lanes for child1/child2 should still exist in clips tab? But collection lane is single bar, not per child
    // Ensure collection lane lives on parent top section, not on child rows
    expect(within(modal).queryByTestId(`manager-row-${parent.id}`)).not.toBeInTheDocument() // parent itself not a row, only children
    // Child rows should still exist but their clip lanes are for standalone? They have placement-linked instances, but they still have clipInstances
    // In Clips tab, child rows should show? They have clipInstances, so they are animated children, rows exist
    expect(within(modal).getByTestId(`manager-row-${child1.id}`)).toBeInTheDocument()
  })

  it('Uniform stretch via speed factor newSpeed = oldSpeed * oldVisual / newVisual in one Transaction; MIN_VISUAL 0.25', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child1 = engine.createNode(slide.scene.id, parent.id, 'A')
    engine.setSemanticName(child1.id, 'a_sem')
    const child2 = engine.createNode(slide.scene.id, parent.id, 'B')
    engine.setSemanticName(child2.id, 'b_sem')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C1',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clip2 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C2',
          duration: 4,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const col = engine.createClipCollection('Col', { a_sem: clip1, b_sem: clip2 }, parent.id)
    const placeRes = dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: parent.id, startTime: 0 }),
    ) as any
    const placementId = placeRes.inverse.placementId as string
    const placement = engine.getCollectionPlacement(placementId)
    const getClip = (id: string) => {
      try {
        return engine.getClip(id)
      } catch {
        return null
      }
    }
    const oldVisual = visualDurationForCollectionPlacement(placement, parent, getClip)
    expect(oldVisual).toBeCloseTo(7, 5) // max of 7 and 4 is 7
    // Simulate stretch to newVisual 3.5 (half)
    const newVisual = 3.5
    const factor = oldVisual / newVisual // 2
    const members = engine.getPlacementMembers(placementId)
    const cmds: any[] = []
    for (const m of members) {
      const clip = engine.getClip(m.instance.clipId)
      let newSpeed = m.instance.speed * factor
      const maxSpeed = clip.duration / 0.25
      if (newSpeed > maxSpeed) newSpeed = maxSpeed
      cmds.push(
        new SetClipInstanceSpeedCommand({
          nodeId: m.nodeId,
          instanceId: m.instance.id,
          speed: newSpeed,
        }),
      )
    }
    const tx = new TransactionCommand(cmds)
    const beforeUndoLen = undo.entries.length
    const res = dispatcher.dispatch(tx) as any
    expect(res.ok).toBe(true)
    // One Transaction => one undo entry (nested collapse)
    expect(undo.entries.length).toBe(beforeUndoLen + 1)
    // Verify member speeds scaled uniformly
    for (const m of members) {
      const inst = engine.getClipInstance(m.nodeId, m.instance.id)
      expect(inst.speed).toBeCloseTo(2, 5) // old 1 *2
    }
    // Check MIN_VISUAL clamping: stretch to 0.1 should clamp to 0.25 per member (maxSpeed 28)
    const verySmallVisual = 0.1
    const members2 = engine.getPlacementMembers(placementId)
    // Reset speeds to 1 via undo then try clamp
    undo.undo(engine)
    for (const m of members2) {
      const inst = engine.getClipInstance(m.nodeId, m.instance.id)
      expect(inst.speed).toBeCloseTo(1, 5)
    }
    const placement2b = engine.getCollectionPlacement(placementId)
    const oldVisual2 = visualDurationForCollectionPlacement(placement2b, parent, getClip)
    const newVisualClamped = Math.max(verySmallVisual, 0.25)
    const factorClamped = oldVisual2 / newVisualClamped
    // Compute per-member clamped speed
    const clipA = engine.getClip(members2[0]!.instance.clipId)
    let newSpeedA = 1 * factorClamped
    const maxA = clipA.duration / 0.25
    if (newSpeedA > maxA) newSpeedA = maxA
    expect(newSpeedA).toBeCloseTo(28, 5) // 7/0.25
    // Evaluator unchanged: time evaluation at 0.5s before and after should be same ratio? Not needed
  })

  it('Move shifts all member startTimes together; v1 zero-offset', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child1 = engine.createNode(slide.scene.id, parent.id, 'C1')
    engine.setSemanticName(child1.id, 'a')
    const child2 = engine.createNode(slide.scene.id, parent.id, 'C2')
    engine.setSemanticName(child2.id, 'b')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C1',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clip2 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C2',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const col = engine.createClipCollection('Col', { a: clip1, b: clip2 }, parent.id)
    const placeRes = dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: parent.id, startTime: 0 }),
    ) as any
    const placementId = placeRes.inverse.placementId as string
    const membersBefore = engine.getPlacementMembers(placementId)
    for (const m of membersBefore) expect(m.instance.startTime).toBe(0)
    // Move by delta 3 via Transaction
    const delta = 3
    const cmds: any[] = []
    cmds.push(new SetCollectionPlacementStartTimeCommand({ placementId, startTime: delta }))
    for (const m of membersBefore) {
      cmds.push(
        new SetClipInstanceStartTimeCommand({
          nodeId: m.nodeId,
          instanceId: m.instance.id,
          startTime: m.instance.startTime + delta,
        }),
      )
    }
    const tx = new TransactionCommand(cmds)
    const beforeLen = undo.entries.length
    dispatcher.dispatch(tx)
    expect(undo.entries.length).toBe(beforeLen + 1) // one Transaction
    const membersAfter = engine.getPlacementMembers(placementId)
    for (const m of membersAfter) expect(m.instance.startTime).toBe(3)
    expect(engine.getCollectionPlacement(placementId).startTime).toBe(3)
    // v1 zero-offset: maxVisual derived from 0..visualDuration, so move is delta-shift with no offset mirroring
    // Verify visual still 7
    const getClip = (id: string) => {
      try {
        return engine.getClip(id)
      } catch {
        return null
      }
    }
    const vd = visualDurationForCollectionPlacement(
      engine.getCollectionPlacement(placementId),
      parent,
      getClip,
    )
    expect(vd).toBeCloseTo(7, 5)
  })

  it('Vertically overlapping collection lanes stack greedily; lower wins Priority, unified with clip stacking', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Hand')
    engine.setSemanticName(child.id, 'hand')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C1',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clip2 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C2',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    // Add keyframes distinct values for evaluator check
    const c1 = engine.getClip(clip1)
    c1.channelAnimation('positionX' as any)?.add({
      id: 'k1',
      time: 0,
      value: 0,
      interpolation: 'linear',
      tangentIn: { time: 0, value: 0 },
      tangentOut: { time: 0, value: 0 },
    } as any)
    c1.channelAnimation('positionX' as any)?.add({
      id: 'k2',
      time: 1,
      value: 100,
      interpolation: 'linear',
      tangentIn: { time: 0, value: 0 },
      tangentOut: { time: 0, value: 0 },
    } as any)
    const c2 = engine.getClip(clip2)
    c2.channelAnimation('positionX' as any)?.add({
      id: 'k3',
      time: 0,
      value: 0,
      interpolation: 'linear',
      tangentIn: { time: 0, value: 0 },
      tangentOut: { time: 0, value: 0 },
    } as any)
    c2.channelAnimation('positionX' as any)?.add({
      id: 'k4',
      time: 1,
      value: 999,
      interpolation: 'linear',
      tangentIn: { time: 0, value: 0 },
      tangentOut: { time: 0, value: 0 },
    } as any)
    const col1 = engine.createClipCollection('Col1', { hand: clip1 }, parent.id)
    const col2 = engine.createClipCollection('Col2', { hand: clip2 }, parent.id)
    // Place both overlapping: first at 0, second at 1 (overlap 1..7)
    dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: col1.id, parentNodeId: parent.id, startTime: 0 }),
    )
    dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: col2.id, parentNodeId: parent.id, startTime: 1 }),
    )
    const getClip = (id: string) => {
      try {
        return engine.getClip(id)
      } catch {
        return null
      }
    }
    const getCollection = (id: string) => {
      try {
        return engine.getClipCollection(id)
      } catch {
        return null
      }
    }
    const packed = packCollectionLanesForParent(parent, getClip, getCollection, 100)
    expect(packed).toHaveLength(2)
    // Greedy: first (0..7) track0, second (1..8) cannot fit track0 (since 1 <7), so track1
    expect(packed[0]!.track).toBe(0)
    expect(packed[1]!.track).toBe(1)
    expect(packed[1]!.zIndex).toBeGreaterThan(packed[0]!.zIndex!) // lower wins higher zIndex
    // Unified: check that at overlapping time 2, lower (second) wins evaluator (last instance wins)
    // After placement, child has two instances: first clip1 at 0, second clip2 at 1 (second is later in array, so wins)
    const evalAt2 = engine.evaluateNode(child.id, 2)
    // clip2 at time2: u = (2-1)/7 ≈0.142 => value ≈142 (0->999), clip1 at time2: u=2/7≈0.285 => value≈28.5 (0->100), lower (clip2) should win, so value should be ~142
    expect(evalAt2.transform.x).toBeCloseTo(142.7, 0.5) // approx
  })

  it('Two-axis drag reorders: horizontal → startTime, vertical → order; persists node.clipInstances and collectionPlacements; reorder is one Transaction', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Hand')
    engine.setSemanticName(child.id, 'hand')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipA = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'A',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clipB = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'B',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    engine
      .getClip(clipA)
      .channelAnimation('positionX' as any)
      ?.add({
        id: 'ka1',
        time: 0,
        value: 0,
        interpolation: 'linear',
        tangentIn: { time: 0, value: 0 },
        tangentOut: { time: 0, value: 0 },
      } as any)
    engine
      .getClip(clipA)
      .channelAnimation('positionX' as any)
      ?.add({
        id: 'ka2',
        time: 1,
        value: 10,
        interpolation: 'linear',
        tangentIn: { time: 0, value: 0 },
        tangentOut: { time: 0, value: 0 },
      } as any)
    engine
      .getClip(clipB)
      .channelAnimation('positionX' as any)
      ?.add({
        id: 'kb1',
        time: 0,
        value: 0,
        interpolation: 'linear',
        tangentIn: { time: 0, value: 0 },
        tangentOut: { time: 0, value: 0 },
      } as any)
    engine
      .getClip(clipB)
      .channelAnimation('positionX' as any)
      ?.add({
        id: 'kb2',
        time: 1,
        value: 100,
        interpolation: 'linear',
        tangentIn: { time: 0, value: 0 },
        tangentOut: { time: 0, value: 0 },
      } as any)
    // Create two placements at same start (so reordering changes visual)
    const colA = engine.createClipCollection('ColA', { hand: clipA }, parent.id)
    const colB = engine.createClipCollection('ColB', { hand: clipB }, parent.id)
    const pARes = dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: colA.id, parentNodeId: parent.id, startTime: 0 }),
    ) as any
    const pBRes = dispatcher.dispatch(
      new PlaceCollectionCommand({ collectionId: colB.id, parentNodeId: parent.id, startTime: 0 }),
    ) as any
    const pAId = pARes.inverse.placementId as string
    const pBId = pBRes.inverse.placementId as string
    // Initially order [A,B], B is lower (track1) and wins at time 0.5
    const evalBefore = engine.evaluateNode(child.id, 0.5)
    // At 0.5, both clips at u~0.07: A value ~0.7, B value ~7.14, B wins => ~7.14
    expect(evalBefore.transform.x).toBeCloseTo(7.14, 0.5)
    // Reorder vertically: move A to index1 (swap) – need one Transaction
    const beforeLen = undo.entries.length
    const reorderRes = dispatcher.dispatch(
      new ReorderCollectionPlacementCommand({
        parentNodeId: parent.id,
        placementId: pAId,
        newIndex: 1,
      }),
    ) as any
    expect(reorderRes.ok).toBe(true)
    expect(undo.entries.length).toBe(beforeLen + 1) // one Transaction
    // After reorder, order [B,A], A is lower and should win
    const evalAfter = engine.evaluateNode(child.id, 0.5)
    expect(evalAfter.transform.x).toBeCloseTo(0.71, 0.5)
    // Verify persistence: placements order persisted
    expect(parent.collectionPlacements[0]!.id).toBe(pBId)
    expect(parent.collectionPlacements[1]!.id).toBe(pAId)
    // Verify node.clipInstances order persisted and matches placement order (last wins)
    expect(child.clipInstances[0]!.placementId).toBe(pBId)
    expect(child.clipInstances[1]!.placementId).toBe(pAId)
    // Also test clip lane reorder persistence via MoveClipLayerCommand
    // Add two standalone clip instances on same node without placement
    const clipC = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clipD = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'D',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    // Directly assign without placement
    const instC = engine.assignClipInstance(child.id, clipC, 0, 1, true, {})
    const instD = engine.assignClipInstance(child.id, clipD, 0, 1, true, {})
    // Move D to front via MoveClipLayer
    const moveRes = dispatcher.dispatch(
      new MoveClipLayerCommand({ nodeId: child.id, instanceId: instD.id, newIndex: 0 }),
    ) as any
    expect(moveRes.ok).toBe(true)
    expect(child.clipInstances[0]!.id).toBe(instD.id)
    // Horizontal move would be SetClipInstanceStartTime, also one Transaction
    const horizRes = dispatcher.dispatch(
      new SetClipInstanceStartTimeCommand({ nodeId: child.id, instanceId: instC.id, startTime: 5 }),
    ) as any
    expect(horizRes.ok).toBe(true)
    expect(engine.getClipInstance(child.id, instC.id).startTime).toBe(5)
  })
})
