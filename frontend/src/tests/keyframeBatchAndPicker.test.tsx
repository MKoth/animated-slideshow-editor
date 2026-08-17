import { act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import {
  AddKeyframeCommand,
  MoveKeyframesCommand,
  SetKeyframeValueCommand,
  SetKeyframeInterpolationCommand,
  SetKeyframeTangentsCommand,
  CommandDispatcher,
  UndoStack,
} from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useUiStore } from '../stores/uiStore'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import { deleteSelectedKeyframes } from '../app/keyframeSelectionActions'
import { dispatchKeyframeCommands } from '../engine/keyframeEdit'
import { EASING_PRESETS } from '../engine/easingPresets'

function renderPanel(): { engine: Engine; undoStack: UndoStack; dispatcher: CommandDispatcher } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <InspectorPanel width={300} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

function createSceneWithNode(engine: Engine): { nodeId: string; slideId: string } {
  let result: { nodeId: string; slideId: string } | null = null
  act(() => {
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    result = { nodeId: node.id, slideId: slide.id }
  })
  return result!
}

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: 'positionX' | 'positionY',
  time: number,
  value: number,
): string {
  let keyframeId = ''
  act(() => {
    const result = dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
    )
    if (!result.ok) {
      throw new Error(`expected add to succeed: ${result.error.message}`)
    }
    keyframeId = result.inverse.keyframe.keyframeId
  })
  return keyframeId
}

function selectKeyframes(keyframeIds: readonly string[]): void {
  act(() => {
    const store = useTimelineSelectionStore.getState()
    store.clearSelection()
    for (const id of keyframeIds) {
      store.toggleKeyframe(id)
    }
  })
}

function setPlaying(playing: boolean): void {
  act(() => {
    usePlaybackController.setState({ status: playing ? 'playing' : 'stopped' })
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
  usePlaybackController.setState({ currentTimes: {}, status: 'stopped' })
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
  useUiStore.setState({ animationMode: true, cameraAnimationMode: false })
  localStorage.clear()
})

describe('batch delete keyframes from selection', () => {
  it('deletes all selected keyframes in one history entry', () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 2, 20)
    selectKeyframes([first, second])
    const before = undoStack.entries.length

    let deleted = false
    act(() => {
      deleted = deleteSelectedKeyframes(toReadOnly(engine), (command) =>
        dispatcher.dispatch(command),
      )
    })

    expect(deleted).toBe(true)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(engine.getKeyframes(nodeId, 'positionY')).toHaveLength(0)
    expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })
})

describe('batch move keyframes from selection', () => {
  it('move via dispatch produces one history entry', () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2, 20)
    const before = undoStack.entries.length

    act(() => {
      const commands = [
        new MoveKeyframesCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          moves: [
            { keyframeId: first, newTime: 1.5 },
            { keyframeId: second, newTime: 2.5 },
          ],
        }),
      ]
      dispatchKeyframeCommands(dispatcher.dispatch.bind(dispatcher), commands)
    })

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes[0]?.time).toBeCloseTo(1.5)
    expect(keyframes[1]?.time).toBeCloseTo(2.5)
    expect(undoStack.entries).toHaveLength(before + 1)
  })
})

describe('batch set-value keyframes from selection', () => {
  it('set-value via batch dispatch produces one history entry', () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionX', 2, 20)
    const before = undoStack.entries.length

    act(() => {
      const commands = [
        new SetKeyframeValueCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          keyframeId: first,
          newValue: 15,
        }),
        new SetKeyframeValueCommand({
          target: { kind: 'node', nodeId, property: 'positionX' },
          keyframeId: second,
          newValue: 25,
        }),
      ]
      dispatchKeyframeCommands(dispatcher.dispatch.bind(dispatcher), commands)
    })

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes[0]?.value).toBe(15)
    expect(keyframes[1]?.value).toBe(25)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
  })
})

describe('interpolation picker in InspectorPanel', () => {
  it('shows interpolation picker when exactly one keyframe is selected', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])

    expect(screen.getByLabelText('Interpolation')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Interpolation' })).toHaveValue('linear')
  })

  it('hides interpolation picker when multiple keyframes are selected', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 2, 20)
    selectKeyframes([first, second])

    expect(screen.queryByLabelText('Interpolation')).not.toBeInTheDocument()
  })

  it('hides interpolation picker when no keyframes are selected', () => {
    renderPanel()
    expect(screen.queryByLabelText('Interpolation')).not.toBeInTheDocument()
  })

  it('changing interpolation issues SetKeyframeInterpolationCommand', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'hold')

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes[0]?.interpolation).toBe('hold')
    expect(undoStack.entries.length).toBeGreaterThan(0)
  })

  it('shows Bezier preset buttons when interpolation is bezier', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'bezier')

    expect(screen.getByRole('radiogroup', { name: 'Easing preset' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Linear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ease In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ease Out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ease In-Out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quadratic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cubic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quartic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quintic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('hides preset buttons when interpolation is not bezier', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])

    expect(screen.queryByRole('radiogroup', { name: 'Easing preset' })).not.toBeInTheDocument()
  })

  it('applying a preset sets interpolation to bezier and applies tangent values', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'bezier')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ease In' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Ease In' }))

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes[0]?.interpolation).toBe('bezier')
    expect(keyframes[0]?.tangentIn.time).toBeCloseTo(0)
    expect(keyframes[0]?.tangentIn.value).toBeCloseTo(0)
    expect(keyframes[0]?.tangentOut.time).toBeCloseTo(0.42)
    expect(keyframes[0]?.tangentOut.value).toBeCloseTo(0)
  })
})

describe('tangent fields in InspectorPanel', () => {
  it('shows tangent fields when interpolation is bezier', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'bezier')

    expect(screen.getByText('Tangent In')).toBeInTheDocument()
    expect(screen.getByText('Tangent Out')).toBeInTheDocument()
  })

  it('hides tangent fields when interpolation is not bezier', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])

    expect(screen.queryByText('Tangent In')).not.toBeInTheDocument()
    expect(screen.queryByText('Tangent Out')).not.toBeInTheDocument()
  })

  it('editing tangent fields issues SetKeyframeTangentsCommand', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'bezier')

    const timeInputs = screen.getAllByRole('spinbutton')
    const tangentInTimeInput = timeInputs.find(
      (input) => input.getAttribute('aria-label') === 'Time',
    )
    expect(tangentInTimeInput).toBeDefined()

    await user.clear(tangentInTimeInput!)
    await user.type(tangentInTimeInput!, '0.5')
    await user.tab()

    const keyframes = engine.getKeyframes(nodeId, 'positionX')
    expect(keyframes[0]?.tangentIn.time).toBeCloseTo(0.5)
    expect(undoStack.entries.length).toBeGreaterThan(0)
  })
})

describe('keyframe inspector visibility', () => {
  it('shows Keyframe section when exactly one keyframe is selected', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])

    expect(screen.getByRole('heading', { name: 'Keyframe' })).toBeInTheDocument()
  })

  it('does not show Keyframe section when multiple keyframes are selected', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const first = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    const second = addKeyframe(dispatcher, nodeId, 'positionY', 2, 20)
    selectKeyframes([first, second])

    expect(screen.queryByRole('heading', { name: 'Keyframe' })).not.toBeInTheDocument()
  })

  it('does not show Keyframe section when no keyframes are selected', () => {
    renderPanel()
    expect(screen.queryByRole('heading', { name: 'Keyframe' })).not.toBeInTheDocument()
  })
})

describe('playing disables keyframe inspector', () => {
  it('disables interpolation picker while playing', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    setPlaying(true)

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    expect(select).toBeDisabled()
  })

  it('disables preset buttons while playing', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'bezier')

    setPlaying(true)

    const easeInButton = screen.getByRole('button', { name: 'Ease In' })
    expect(easeInButton).toBeDisabled()
  })

  it('disables tangent fields while playing', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const keyframeId = addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    selectKeyframes([keyframeId])
    const user = userEvent.setup()

    const select = screen.getByRole('combobox', { name: 'Interpolation' })
    await user.selectOptions(select, 'bezier')

    setPlaying(true)

    const timeInputs = screen.getAllByRole('spinbutton')
    for (const input of timeInputs) {
      expect(input).toBeDisabled()
    }
  })
})

describe('easing presets via engine commands', () => {
  it('batch interpolation + tangents applies preset values at engine level', () => {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)

    engine.createProject({ name: 'Test' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')

    const addResult = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: node.id, property: 'positionX' },
        time: 1,
        value: 10,
      }),
    )
    if (!addResult.ok) throw new Error('add failed')
    const kfId = addResult.inverse.keyframe.keyframeId

    const easeInPreset = EASING_PRESETS[1]
    const commands = [
      new SetKeyframeInterpolationCommand({
        target: { kind: 'node', nodeId: node.id, property: 'positionX' },
        keyframeId: kfId,
        interpolation: 'bezier',
      }),
      new SetKeyframeTangentsCommand({
        target: { kind: 'node', nodeId: node.id, property: 'positionX' },
        keyframeId: kfId,
        tangentIn: { ...easeInPreset.tangentIn },
        tangentOut: { ...easeInPreset.tangentOut },
      }),
    ]

    const result = dispatchKeyframeCommands((cmd) => dispatcher.dispatch(cmd), commands)
    expect(result?.ok).toBe(true)

    const keyframes = engine.getKeyframes(node.id, 'positionX')
    expect(keyframes[0]?.interpolation).toBe('bezier')
    expect(keyframes[0]?.tangentIn.time).toBeCloseTo(easeInPreset.tangentIn.time)
    expect(keyframes[0]?.tangentIn.value).toBeCloseTo(easeInPreset.tangentIn.value)
    expect(keyframes[0]?.tangentOut.time).toBeCloseTo(easeInPreset.tangentOut.time)
    expect(keyframes[0]?.tangentOut.value).toBeCloseTo(easeInPreset.tangentOut.value)
  })
})
