import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  DuplicateSlideCommand,
  PlaceCollectionCommand,
  SetControlSetCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import { createControl, createControlSet } from '../../engine/control'
import { Keyframe } from '../../engine/keyframe'
import { walkPreOrder } from '../../engine/sceneNode'
import type { Scene } from '../../engine/scene'
import { createControlClip } from './helpers'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function addControlKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  controlKey: string,
  time: number,
  value: number,
) {
  expectOk(
    dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'control', nodeId, controlKey }, time, value }),
    ),
  )
}

function findNode(scene: Scene, name: string) {
  for (const node of walkPreOrder(scene.root)) {
    if (node.name === name) {
      return node
    }
  }
  throw new Error(`Node not found: ${name}`)
}

function setup() {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  const { slideId } = expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.getSlide(slideId)
  const rig = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
  const hand = engine.createNode(slide.scene.id, rig.id, 'Hand')
  engine.setSemanticName(hand.id, 'hand')
  return { engine, dispatcher, undoStack, slide, rigId: rig.id, handId: hand.id }
}

function setupControlAndPlacementSlide() {
  const base = setup()
  const { engine, dispatcher, rigId } = base

  const controlClip = createControlClip(engine, 'Nod', 0, 40)
  const controlSet = createControlSet(rigId, [
    createControl({ key: 'Nod', bindings: { hand: controlClip.id }, exposed: true }),
  ])
  expectOk(dispatcher.dispatch(new SetControlSetCommand({ nodeId: rigId, controlSet })))
  addControlKeyframe(dispatcher, rigId, 'Nod', 0, 0)
  addControlKeyframe(dispatcher, rigId, 'Nod', 4, 1)

  const collectionClip = engine.createClip('Wiggle', 1, '', [], [{ property: 'rotation' }])
  collectionClip.addChannelKeyframe('rotation', new Keyframe('wiggle-start', 0, 0))
  collectionClip.addChannelKeyframe('rotation', new Keyframe('wiggle-end', 1, 1))
  const collection = engine.createClipCollection('Rig', { hand: collectionClip.id }, rigId)
  const { placementId } = expectOk(
    dispatcher.dispatch(
      new PlaceCollectionCommand({
        collectionId: collection.id,
        parentNodeId: rigId,
        startTime: 1,
      }),
    ),
  )
  return { ...base, controlClip, controlSet, collection, collectionClip, placementId }
}

describe('DuplicateSlideCommand carries', () => {
  it('copies exposed Controls with fresh ids and preserved keys, so copied Control Tracks resolve and evaluate identically', () => {
    const { engine, dispatcher, slide, rigId, handId, controlSet } = setupControlAndPlacementSlide()
    expect(engine.evaluateNode(handId, 2).transform.x).toBe(20)

    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const copiedRig = findNode(copy.scene, 'Rig')
    const copiedHand = findNode(copy.scene, 'Hand')
    const copiedSet = copiedRig.controlSet
    if (!copiedSet) {
      throw new Error('expected the copy to carry the source Control Set')
    }

    expect(copiedSet.id).not.toBe(controlSet.id)
    expect(copiedSet.hostNodeId).toBe(copiedRig.id)
    expect(copiedSet.controls).toHaveLength(1)
    const copiedControl = copiedSet.controls[0]!
    expect(copiedControl.id).not.toBe(controlSet.controls[0]!.id)
    expect(copiedControl.key).toBe('Nod')
    expect(copiedControl.exposed).toBe(true)
    expect(copiedControl.groups[0]!.id).not.toBe(controlSet.controls[0]!.groups[0]!.id)
    expect(copiedControl.bindings).toEqual(controlSet.controls[0]!.bindings)
    expect(copiedControl.bindings).not.toBe(controlSet.controls[0]!.bindings)

    const sourceTrack = slide.animation.node(rigId)?.controlKeyframes('Nod') ?? []
    const copiedTrack = copy.animation.node(copiedRig.id)?.controlKeyframes('Nod') ?? []
    expect(copiedTrack.map((keyframe) => ({ time: keyframe.time, value: keyframe.value }))).toEqual(
      [
        { time: 0, value: 0 },
        { time: 4, value: 1 },
      ],
    )
    for (const keyframe of copiedTrack) {
      expect(sourceTrack.some((source) => source.id === keyframe.id)).toBe(false)
    }

    for (const time of [0, 1, 2, 3, 4]) {
      expect(engine.evaluateNode(copiedHand.id, time).transform.x).toBe(
        engine.evaluateNode(handId, time).transform.x,
      )
    }
    expect(engine.getNode(rigId).controlSet).toEqual(controlSet)
  })

  it('re-ids every Control group and collection block while preserving their content', () => {
    const { engine, dispatcher, slide, rigId } = setup()
    const controlClip = createControlClip(engine, 'Nod', 0, 40)
    const collectionClip = engine.createClip('Wiggle', 1, '', [], [{ property: 'rotation' }])
    collectionClip.addChannelKeyframe('rotation', new Keyframe('wiggle-start', 0, 0))
    collectionClip.addChannelKeyframe('rotation', new Keyframe('wiggle-end', 1, 1))
    const collection = engine.createClipCollection('Rig', { hand: collectionClip.id }, rigId)
    const controlSet = createControlSet(rigId, [
      createControl({
        key: 'Nod',
        exposed: true,
        groups: [
          { id: 'group-base', name: 'Base', bindings: { hand: controlClip.id } },
          {
            id: 'group-wave',
            name: 'Wave',
            bindings: {},
            collectionBlocks: [
              { id: 'block-wave', collectionId: collection.id, start: 0.2, end: 0.8 },
            ],
          },
        ],
      }),
    ])
    expectOk(dispatcher.dispatch(new SetControlSetCommand({ nodeId: rigId, controlSet })))

    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const copiedControl = findNode(copy.scene, 'Rig').controlSet!.controls[0]!

    expect(copiedControl.groups.map((group) => group.id)).not.toEqual(['group-base', 'group-wave'])
    expect(copiedControl.groups.map((group) => group.name)).toEqual(['Base', 'Wave'])
    expect(copiedControl.groups[0]!.bindings).toEqual({ hand: controlClip.id })
    const copiedBlock = copiedControl.groups[1]!.collectionBlocks![0]!
    expect(copiedBlock.id).not.toBe('block-wave')
    expect(copiedBlock.collectionId).toBe(collection.id)
    expect(copiedBlock.start).toBe(0.2)
    expect(copiedBlock.end).toBe(0.8)
  })

  it('copies Collection placements with fresh ids, preserved collectionId, remapped parent and instance provenance', () => {
    const { engine, dispatcher, slide, rigId, handId, collection, placementId } =
      setupControlAndPlacementSlide()
    const sourceInstance = engine
      .getNode(handId)
      .clipInstances.find((instance) => instance.placementId === placementId)
    if (!sourceInstance) {
      throw new Error('expected the source member instance')
    }

    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const copiedRig = findNode(copy.scene, 'Rig')
    const copiedHand = findNode(copy.scene, 'Hand')

    expect(copiedRig.collectionPlacements).toHaveLength(1)
    const copiedPlacement = copiedRig.collectionPlacements[0]!
    expect(copiedPlacement.id).not.toBe(placementId)
    expect(copiedPlacement.collectionId).toBe(collection.id)
    expect(copiedPlacement.parentNodeId).toBe(copiedRig.id)
    expect(copiedPlacement.startTime).toBe(1)

    expect(copiedHand.clipInstances).toHaveLength(1)
    const copiedInstance = copiedHand.clipInstances[0]!
    expect(copiedInstance.id).not.toBe(sourceInstance.id)
    expect(copiedInstance.clipId).toBe(sourceInstance.clipId)
    expect(copiedInstance.placementId).toBe(copiedPlacement.id)
    expect(copiedInstance.collectionId).toBe(collection.id)
    expect(copiedInstance.collectionTargetId).toBe(copiedRig.id)
    expect(copiedInstance.collectionSemantic).toBe('hand')

    expect(engine.getPlacementMembers(copiedPlacement.id).map((member) => member.nodeId)).toEqual([
      copiedHand.id,
    ])
    expect(engine.getPlacementMembers(placementId).map((member) => member.nodeId)).toEqual([handId])
    expect(engine.getNode(rigId).collectionPlacements[0]!.id).toBe(placementId)
    expect(engine.getNode(handId).clipInstances[0]!.placementId).toBe(placementId)
  })

  it("round-trips a duplicated slide's Control Sets and placements through save/load with no dangling references", () => {
    const { engine, dispatcher, slide, handId, placementId } = setupControlAndPlacementSlide()
    const { slideId: copyId } = expectOk(
      dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id })),
    )

    const restored = createEngine()
    restored.restoreFromJSON(engine.toJSON())
    const restoredCopy = restored.getSlide(copyId)
    const restoredRig = findNode(restoredCopy.scene, 'Rig')
    const restoredHand = findNode(restoredCopy.scene, 'Hand')

    expect(restoredRig.controlSet?.controls.map((control) => control.key)).toEqual(['Nod'])
    expect(
      restoredCopy.animation
        .node(restoredRig.id)
        ?.controlKeyframes('Nod')
        .map((keyframe) => ({ time: keyframe.time, value: keyframe.value })),
    ).toEqual([
      { time: 0, value: 0 },
      { time: 4, value: 1 },
    ])
    for (const time of [0, 2, 4]) {
      expect(restored.evaluateNode(restoredHand.id, time).transform.x).toBe(
        engine.evaluateNode(handId, time).transform.x,
      )
    }

    expect(restoredRig.collectionPlacements).toHaveLength(1)
    const restoredPlacement = restoredRig.collectionPlacements[0]!
    expect(restoredPlacement.parentNodeId).toBe(restoredRig.id)
    expect(restoredPlacement.id).not.toBe(placementId)
    expect(
      restored.getPlacementMembers(restoredPlacement.id).map((member) => member.nodeId),
    ).toEqual([restoredHand.id])
    expect(restoredHand.clipInstances[0]!.placementId).toBe(restoredPlacement.id)

    expect(engine.getNode(handId).clipInstances[0]!.placementId).toBe(placementId)
  })

  it('stays one History entry and undo removes the copy while the source keeps its Controls and placements', () => {
    const { engine, dispatcher, undoStack, slide, rigId, handId, controlSet, placementId } =
      setupControlAndPlacementSlide()
    const entriesBefore = undoStack.entries.length

    const { slideId: copyId } = expectOk(
      dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id })),
    )
    expect(undoStack.entries).toHaveLength(entriesBefore + 1)
    expect(undoStack.entries[0]?.type).toBe('DuplicateSlide')

    expect(dispatcher.undo()).toBe(true)

    expect(engine.project?.slides.map((entry) => entry.id)).toEqual([slide.id])
    expect(() => engine.getSlide(copyId)).toThrow()
    expect(engine.getNode(rigId).controlSet).toEqual(controlSet)
    expect(engine.getNode(rigId).collectionPlacements).toHaveLength(1)
    expect(engine.getPlacementMembers(placementId).map((member) => member.nodeId)).toEqual([handId])
    expect(engine.getNode(handId).clipInstances[0]!.placementId).toBe(placementId)
  })
})
