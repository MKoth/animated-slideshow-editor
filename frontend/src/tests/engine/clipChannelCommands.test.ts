import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import {
  CommandDispatcher,
  CreateProjectCommand,
  UndoStack,
  CreateClipCommand,
  AddClipChannelCommand,
  RemoveClipChannelCommand,
  AddClipKeyframeCommand,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupBase(log?: CommandLogger): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  return { engine, dispatcher, undoStack }
}

function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

function createEmptyClip(setup: Setup, name = 'TestClip', duration = 1): string {
  const inverse = expectOk(
    setup.dispatcher.dispatch(
      new CreateClipCommand({ name, duration, category: 'test' }),
    ),
  )
  return inverse.clipId
}

describe('AddClipChannelCommand', () => {
  it('adds a channel with inverse data and ClipChannelAdded event', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new AddClipChannelCommand({
        clipId,
        channel: { property: 'positionX' },
      }),
    )

    const inverse = expectOk(result)
    expect(inverse.clipId).toBe(clipId)
    expect(inverse.channelDef).toEqual({ property: 'positionX' })
    expect(setup.engine.getClip(clipId).hasChannel('positionX')).toBe(true)
    expect(events).toEqual([{ type: 'ClipChannelAdded', clipId, channel: 'positionX' }])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
  })

  it('adds a channel with param link', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)

    expectOk(
      setup.dispatcher.dispatch(
        new AddClipChannelCommand({
          clipId,
          channel: { property: 'positionX', paramKey: 'gain', linkMode: 'gain' },
        }),
      ),
    )

    const channelDef = setup.engine.getClip(clipId).getChannel('positionX')
    expect(channelDef).toEqual({ property: 'positionX', paramKey: 'gain', linkMode: 'gain' })
  })

  it('rejects adding a channel that already exists', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)
    expectOk(
      setup.dispatcher.dispatch(
        new AddClipChannelCommand({ clipId, channel: { property: 'positionX' } }),
      ),
    )
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new AddClipChannelCommand({ clipId, channel: { property: 'positionX' } }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('already exists')
    }
    expect(setup.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects adding to a non-existent clip', () => {
    const setup = setupBase()
    const result = setup.dispatcher.dispatch(
      new AddClipChannelCommand({ clipId: 'ghost', channel: { property: 'positionX' } }),
    )
    expect(result.ok).toBe(false)
  })

  it('can add keyframes to the new channel', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)

    expectOk(
      setup.dispatcher.dispatch(
        new AddClipChannelCommand({ clipId, channel: { property: 'positionX' } }),
      ),
    )

    expectOk(
      setup.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'positionX' },
          time: 0.5,
          value: 100,
        }),
      ),
    )

    const keyframes = setup.engine.getClipChannelKeyframes(clipId, 'positionX')
    expect(keyframes).toHaveLength(1)
    expect(keyframes[0]?.value).toBe(100)
  })
})

describe('RemoveClipChannelCommand', () => {
  it('removes a channel with inverse data and ClipChannelRemoved event', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)
    expectOk(
      setup.dispatcher.dispatch(
        new AddClipChannelCommand({ clipId, channel: { property: 'positionX' } }),
      ),
    )
    const events = collectEvents(setup.engine)
    const undoCount = setup.undoStack.entries.length

    const result = setup.dispatcher.dispatch(
      new RemoveClipChannelCommand({ clipId, channel: 'positionX' }),
    )

    const inverse = expectOk(result)
    expect(inverse.clipId).toBe(clipId)
    expect(inverse.channelDef).toEqual({ property: 'positionX' })
    expect(setup.engine.getClip(clipId).hasChannel('positionX')).toBe(false)
    expect(events).toEqual([{ type: 'ClipChannelRemoved', clipId, channel: 'positionX' }])
    expect(setup.undoStack.entries).toHaveLength(undoCount + 1)
  })

  it('removes a channel with param link and preserves link in inverse', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)
    expectOk(
      setup.dispatcher.dispatch(
        new AddClipChannelCommand({
          clipId,
          channel: { property: 'positionX', paramKey: 'gain', linkMode: 'offset' },
        }),
      ),
    )

    const result = setup.dispatcher.dispatch(
      new RemoveClipChannelCommand({ clipId, channel: 'positionX' }),
    )

    const inverse = expectOk(result)
    expect(inverse.channelDef).toEqual({
      property: 'positionX',
      paramKey: 'gain',
      linkMode: 'offset',
    })
  })

  it('removes channel keyframes along with the channel', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)
    expectOk(
      setup.dispatcher.dispatch(
        new AddClipChannelCommand({ clipId, channel: { property: 'positionX' } }),
      ),
    )
    expectOk(
      setup.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'positionX' },
          time: 0.5,
          value: 100,
        }),
      ),
    )
    expect(setup.engine.getClipChannelKeyframes(clipId, 'positionX')).toHaveLength(1)

    expectOk(
      setup.dispatcher.dispatch(
        new RemoveClipChannelCommand({ clipId, channel: 'positionX' }),
      ),
    )

    expect(setup.engine.getClipChannelKeyframes(clipId, 'positionX')).toHaveLength(0)
    expect(setup.engine.getClip(clipId).hasChannel('positionX')).toBe(false)
  })

  it('rejects removing a non-existent channel', () => {
    const setup = setupBase()
    const clipId = createEmptyClip(setup)
    const result = setup.dispatcher.dispatch(
      new RemoveClipChannelCommand({ clipId, channel: 'positionX' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('not found')
    }
  })

  it('rejects removing from a non-existent clip', () => {
    const setup = setupBase()
    const result = setup.dispatcher.dispatch(
      new RemoveClipChannelCommand({ clipId: 'ghost', channel: 'positionX' }),
    )
    expect(result.ok).toBe(false)
  })
})
