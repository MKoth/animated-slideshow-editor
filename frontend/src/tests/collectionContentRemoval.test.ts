import { describe, expect, it } from 'vitest'
import { executeRemoveCollectionContent } from '../app/collectionContentRemoval'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import {
  CommandDispatcher,
  CreateClipCommand,
  CreateClipCollectionCommand,
  UndoStack,
} from '../engine/commands'
import { Keyframe } from '../engine/keyframe'

function setup() {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  engine.createProject({ name: 'Project' })
  engine.createSlide('Slide')
  return { engine, undoStack, dispatcher }
}

function created<T>(result: {
  readonly ok: boolean
  readonly inverse?: T
  readonly error?: Error
}): T {
  if (!result.ok) throw result.error ?? new Error('Command failed')
  return result.inverse as T
}

function addClip(engine: Engine, dispatcher: CommandDispatcher, name = 'Move') {
  const { clipId } = created(
    dispatcher.dispatch(
      new CreateClipCommand({
        name,
        duration: 4,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    ),
  )
  const clip = engine.getClip(clipId)
  clip.addChannelKeyframe('positionX', new Keyframe('x1', 0.25, 10))
  clip.addChannelKeyframe('positionX', new Keyframe('x2', 0.5, 20))
  clip.addChannelKeyframe('positionX', new Keyframe('x3', 0.75, 30))
  clip.addVisibleKeyframe(new Keyframe('visible1', 0.5, true))
  return clipId
}

describe('executeRemoveCollectionContent', () => {
  it('deletes inclusive range keyframes from standard and specialized channels, shared uses reflect it, and one undo restores all', () => {
    const { engine, undoStack, dispatcher } = setup()
    const clipId = addClip(engine, dispatcher)
    const first = created(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'First', bindings: { hand: clipId } }),
      ),
    ).collectionId
    created(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Shared', bindings: { other: clipId } }),
      ),
    )
    const before = undoStack.entries.length

    const result = executeRemoveCollectionContent(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        collectionId: first,
        memberNames: new Set(),
        trackKeysBySemantic: new Map([
          ['hand', new Set(['channelAnimations:positionX', 'visibleAnimation:'])],
        ]),
        from: 1,
        to: 2,
      },
    )

    expect(result).toEqual({ ok: true, removedKeyframeCount: 3, removedMemberCount: 0 })
    expect(
      engine
        .getClip(clipId)
        .getChannelKeyframes('positionX')
        .map((keyframe) => keyframe.id),
    ).toEqual(['x3'])
    expect(engine.getClip(clipId).getVisibleKeyframes()).toHaveLength(0)
    expect(engine.getClipCollection(first).getBinding('hand')).toBe(clipId)
    expect(undoStack.entries).toHaveLength(before + 1)

    expect(dispatcher.undo()).toBe(true)
    expect(
      engine
        .getClip(clipId)
        .getChannelKeyframes('positionX')
        .map((keyframe) => keyframe.id),
    ).toEqual(['x1', 'x2', 'x3'])
    expect(
      engine
        .getClip(clipId)
        .getVisibleKeyframes()
        .map((keyframe) => keyframe.id),
    ).toEqual(['visible1'])
    expect(engine.getClipCollection(first).getBinding('hand')).toBe(clipId)
    expect(dispatcher.redo()).toBe(true)
    expect(
      engine
        .getClip(clipId)
        .getChannelKeyframes('positionX')
        .map((keyframe) => keyframe.id),
    ).toEqual(['x3'])
  })

  it('removes a semantic binding and deletes its clip only when no references remain', () => {
    const { engine, undoStack, dispatcher } = setup()
    const unusedClipId = addClip(engine, dispatcher, 'Unused')
    const sharedClipId = addClip(engine, dispatcher, 'Shared')
    const collectionId = created(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({
          name: 'Rig',
          bindings: { unused: unusedClipId, shared: sharedClipId },
        }),
      ),
    ).collectionId
    created(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Other', bindings: { shared: sharedClipId } }),
      ),
    )
    const before = undoStack.entries.length

    const result = executeRemoveCollectionContent(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        collectionId,
        memberNames: new Set(['unused', 'shared']),
        trackKeysBySemantic: new Map(),
        from: 0,
        to: 4,
      },
    )

    expect(result).toEqual({ ok: true, removedKeyframeCount: 0, removedMemberCount: 2 })
    expect(engine.getClipCollection(collectionId).bindings.size).toBe(0)
    expect(() => engine.getClip(unusedClipId)).toThrow()
    expect(engine.getClip(sharedClipId).name).toBe('Shared')
    expect(undoStack.entries).toHaveLength(before + 1)

    expect(dispatcher.undo()).toBe(true)
    expect(engine.getClipCollection(collectionId).getBinding('unused')).toBe(unusedClipId)
    expect(engine.getClipCollection(collectionId).getBinding('shared')).toBe(sharedClipId)
    expect(engine.getClip(unusedClipId).name).toBe('Unused')
    expect(engine.getClip(sharedClipId).name).toBe('Shared')
  })

  it('whole semantic-name removal takes precedence over its selected properties', () => {
    const { engine, undoStack, dispatcher } = setup()
    const clipId = addClip(engine, dispatcher)
    const collectionId = created(
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Rig', bindings: { hand: clipId } }),
      ),
    ).collectionId

    const result = executeRemoveCollectionContent(
      engine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        collectionId,
        memberNames: new Set(['hand']),
        trackKeysBySemantic: new Map([['hand', new Set(['channelAnimations:positionX'])]]),
        from: 0,
        to: 4,
      },
    )

    expect(result).toEqual({ ok: true, removedKeyframeCount: 0, removedMemberCount: 1 })
    expect(engine.getClipCollection(collectionId).bindings.size).toBe(0)
    expect(() => engine.getClip(clipId)).toThrow()
    expect(dispatcher.undo()).toBe(true)
    expect(engine.getClipCollection(collectionId).getBinding('hand')).toBe(clipId)
    expect(engine.getClip(clipId).getChannelKeyframes('positionX')).toHaveLength(3)
  })
})
