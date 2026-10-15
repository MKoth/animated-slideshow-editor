import { describe, expect, it } from 'vitest'
import { mapTimeWithCollectionPlacement } from '../../engine/collectionKeyframeTiming'
import { createEngineInternal } from '../../engine/internal'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  PlaceCollectionCommand,
  UndoStack,
} from '../../engine/commands'
import {
  deserializeWithClips,
  parseClipCollectionsFromLessonJSON,
  serialize,
} from '../../engine/lessonSerializer'

describe('collection-attached keyframe timing', () => {
  it('moves keyframes by the same offset when a collection placement moves', () => {
    expect(mapTimeWithCollectionPlacement(1.5, 1, 1, 2, 1)).toBe(2.5)
  })

  it('scales keyframe offsets when a collection placement is resized from its left edge', () => {
    expect(mapTimeWithCollectionPlacement(2, 1, 1, 1, 0.5)).toBe(1.5)
  })

  it('moves and stretches linked keyframes with their collection placement', () => {
    const engine = createEngineInternal()
    const dispatcher = new CommandDispatcher(engine, new UndoStack(), () => undefined)
    engine.createProject({ name: 'Timeline attachment' })
    const slide = engine.createSlide('Scene')
    slide.duration = 20
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Character')
    engine.setSemanticName(parent.id, 'character')
    const clip = engine.createClip('Move', 2, '', [], [{ property: 'positionX' }])
    const collection = engine.createClipCollection('Walk', { character: clip.id })
    const placed = dispatcher.dispatch(
      new PlaceCollectionCommand({
        collectionId: collection.id,
        parentNodeId: parent.id,
        startTime: 1,
      }),
    )
    if (!placed.ok) throw new Error('expected placement to succeed')
    const placementId = (placed.inverse as { placementId: string }).placementId
    const added = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: parent.id, property: 'positionX' },
        time: 2,
        value: 5,
      }),
    )
    if (!added.ok) throw new Error('expected keyframe to be added')
    const keyframe = engine.getKeyframes(parent.id, 'positionX')[0]!
    engine.setKeyframeCollectionTimingLink(
      { kind: 'node', nodeId: parent.id, property: 'positionX' },
      keyframe.id,
      { placementId, normalizedTime: 0.5 },
    )

    engine.setCollectionPlacementStartTime(placementId, 3)
    expect(keyframe.time).toBe(4)
    const instance = parent.clipInstances.find((item) => item.placementId === placementId)!
    engine.setClipInstanceSpeed(parent.id, instance.id, 4)
    expect(keyframe.time).toBe(3.25)
    const lesson = serialize(engine.project!, engine.clips, engine.clipCollections)
    const parsedLesson = JSON.parse(lesson) as import('../../engine/json').LessonJSON
    const restored = deserializeWithClips(lesson)
    const restoredEngine = createEngineInternal()
    restoredEngine.openProject(
      restored.project,
      restored.clips,
      parseClipCollectionsFromLessonJSON(parsedLesson),
    )
    const restoredKeyframe = restoredEngine
      .getKeyframes(parent.id, 'positionX')
      .find((item) => item.id === keyframe.id)!
    expect(restoredKeyframe.collectionTimingLink).toEqual({
      placementId,
      normalizedTime: 0.5,
    })
    restoredEngine.setCollectionPlacementStartTime(placementId, 5)
    expect(restoredKeyframe.time).toBe(5.25)
  })
})
