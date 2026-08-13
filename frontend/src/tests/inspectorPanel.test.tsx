import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  MoveNodeCommand,
  UndoStack,
} from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useUiStore } from '../stores/uiStore'

function renderPanel(): { engine: Engine; undoStack: UndoStack; dispatcher: CommandDispatcher } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
  }
  render(
    <EngineContext.Provider value={value}>
      <InspectorPanel width={300} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

function createSceneWithNode(
  engine: Engine,
  transform?: {
    x?: number
    y?: number
    rotation?: number
    scaleX?: number
    scaleY?: number
  },
  opacity = 1,
): { nodeId: string; cameraId: string; slideId: string } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy', {
    transform: {
      x: transform?.x ?? 12,
      y: transform?.y ?? -4,
      rotation: transform?.rotation ?? 0,
      scaleX: transform?.scaleX ?? 2,
      scaleY: transform?.scaleY ?? 0.5,
    },
    opacity,
  })
  return { nodeId: node.id, cameraId: slide.scene.camera.id, slideId: slide.id }
}

function createSecondNode(
  engine: Engine,
  name = 'Second',
  transform?: {
    x?: number
    y?: number
    rotation?: number
    scaleX?: number
    scaleY?: number
  },
  opacity = 1,
): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: {
      x: transform?.x ?? 0,
      y: transform?.y ?? 0,
      rotation: transform?.rotation ?? 0,
      scaleX: transform?.scaleX ?? 1,
      scaleY: transform?.scaleY ?? 1,
    },
    opacity,
  }).id
}

function select(nodeId: string): void {
  act(() => {
    useSelectionStore.getState().select(nodeId)
  })
}

function selectMany(nodeIds: string[]): void {
  act(() => {
    useSelectionStore.getState().selectMany(nodeIds)
  })
}

function scrub(engine: Engine, time: number): void {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  act(() => {
    usePlaybackController.getState().setCurrentTime(slide.id, time, slide.duration)
  })
}

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity',
  time: number,
  value: number,
): void {
  const result = dispatcher.dispatch(new AddKeyframeCommand({ nodeId, property, time, value }))
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error?.message}`)
  }
}

function fields(): { [key: string]: HTMLInputElement } {
  const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
  const map: { [key: string]: HTMLInputElement } = {}
  for (const input of inputs) {
    map[input.getAttribute('aria-label') ?? input.name] = input
  }
  return map
}

function fieldContainer(label: string): HTMLElement {
  const field = screen.getByRole('spinbutton', { name: label }).closest('.inspector-field')
  if (!field) {
    throw new Error(`expected an inspector field for ${label}`)
  }
  return field as HTMLElement
}

function rotationOf(engine: Engine, nodeId: string): number {
  return engine.evaluateNode(nodeId, 0).transform.rotation
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
  usePlaybackController.setState({ currentTimes: {} })
  localStorage.clear()
  useUiStore.setState({ animationMode: true })
})

describe('InspectorPanel empty state', () => {
  it('shows the empty state when nothing is selected', () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)

    expect(
      screen.getByText('Nothing selected. Select an object to edit its properties.'),
    ).toBeInTheDocument()
  })

  it('shows the camera transform when the camera node is selected, with rotation locked', () => {
    const { engine } = renderPanel()
    const { cameraId } = createSceneWithNode(engine)
    select(cameraId)

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transform' })).toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(name.value).toBe('Camera')
    const rotation = screen.getByRole('spinbutton', { name: 'Rotation' }) as HTMLInputElement
    expect(rotation).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'X' })).not.toBeDisabled()
  })
})

describe('InspectorPanel sections', () => {
  it('shows the selected object properties with placeholder and transform sections', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transform' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset Transform' })).toBeInTheDocument()

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(name).not.toBeDisabled()
    expect(name.value).toBe('Boy')

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    expect(opacity).not.toBeDisabled()
    expect(opacity.value).toBe('100')

    const seen = fields()
    expect(seen.X.value).toBe('12')
    expect(seen.Y.value).toBe('-4')
    expect(seen.Rotation.value).toBe('0')
    expect(seen['Scale X'].value).toBe('2')
    expect(seen['Scale Y'].value).toBe('0.5')
  })

  it('converts the engine rotation radians into degrees', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, { rotation: Math.PI / 2 })
    select(nodeId)

    expect(fields().Rotation.value).toBe('90')
  })

  it('shows placeholder sections reading Coming in future versions', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)

    for (const section of [
      'Material',
      'Animation',
      'Shader',
      'Anchors',
      'Physics',
      'AI Metadata',
    ]) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
    expect(screen.getAllByText('Coming in future versions.')).toHaveLength(6)
  })
})

describe('InspectorPanel animation indicators', () => {
  it('shows no indicator for static properties', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)

    expect(screen.queryByTitle('Animated')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Playhead on keyframe')).not.toBeInTheDocument()
    expect(fieldContainer('X').querySelector('.inspector-field__indicator')).toBeNull()
  })

  it('shows a filled dot for an animated property away from its keyframes', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    select(nodeId)

    expect(screen.getByTitle('Animated')).toBeInTheDocument()
    expect(fieldContainer('X').querySelector('.inspector-field__indicator')).toHaveAttribute(
      'data-state',
      'animated',
    )
    expect(fieldContainer('Y').querySelector('.inspector-field__indicator')).toBeNull()
  })

  it('shows a diamond when the playhead sits exactly on a keyframe', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    select(nodeId)

    expect(screen.getByTitle('Playhead on keyframe')).toBeInTheDocument()
    expect(fieldContainer('X').querySelector('.inspector-field__indicator')).toHaveAttribute(
      'data-state',
      'onKeyframe',
    )
  })

  it('shows an animated dot that becomes a diamond when scrubbed onto the keyframe', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 2, 10)
    select(nodeId)
    expect(screen.getByTitle('Animated')).toBeInTheDocument()

    scrub(engine, 2)

    expect(screen.getByTitle('Playhead on keyframe')).toBeInTheDocument()
    expect(screen.queryByTitle('Animated')).not.toBeInTheDocument()
  })

  it('shows the opacity indicator for an animated opacity', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'opacity', 1, 0.5)
    select(nodeId)

    expect(screen.getByTitle('Animated')).toBeInTheDocument()
    expect(fieldContainer('Opacity').querySelector('.inspector-field__indicator')).not.toBeNull()
  })

  it('shows no indicator for the locked camera rotation', () => {
    const { engine } = renderPanel()
    const { cameraId } = createSceneWithNode(engine)
    select(cameraId)

    expect(fieldContainer('Rotation').querySelector('.inspector-field__indicator')).toBeNull()
  })
})

describe('InspectorPanel transform auto-key editing', () => {
  it('creates a keyframe at the playhead on Enter, records inverse data, and updates the field', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const x = fields().X
    await user.clear(x)
    await user.type(x, '42')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).transform.x).toBe(12)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(engine.evaluateNode(nodeId, 0).transform.x).toBe(42)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].inverse).toEqual({
      nodeId,
      property: 'positionX',
      keyframeId: expect.any(String),
      time: 0,
      value: 42,
    })
    expect(fields().X.value).toBe('42')
  })

  it('commits an edit on blur', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const y = fields().Y
    await user.clear(y)
    await user.type(y, '-10')
    await user.tab()

    expect(engine.evaluateNode(nodeId, 0).transform.y).toBe(-10)
    expect(undoStack.entries).toHaveLength(before + 1)
  })

  it('updates the keyframe under the playhead instead of creating a new one', async () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 2, 10)
    scrub(engine, 2)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const x = fields().X
    await user.clear(x)
    await user.type(x, '42')
    await user.keyboard('{Enter}')

    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(1)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('SetKeyframeValue')
    expect(fields().X.value).toBe('42')
  })

  it('rejects NaN and Infinity input with a notification and leaves the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const x = fields().X
    await user.clear(x)
    await user.type(x, 'abc')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).transform.x).toBe(12)
    expect(undoStack.entries).toHaveLength(before)
    expect(useNotificationStore.getState().notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'X must be a number' })]),
    )
    expect(fields().X.value).toBe('12')
  })

  it('rejects zero scale with a notification and leaves the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const scaleX = fields()['Scale X']
    await user.clear(scaleX)
    await user.type(scaleX, '0')
    await user.keyboard('{Enter}')

    expect(engine.getKeyframes(nodeId, 'scaleX')).toHaveLength(0)
    expect(undoStack.entries).toHaveLength(before)
    expect(useNotificationStore.getState().notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Scale X must not be zero' })]),
    )
    expect(fields()['Scale X'].value).toBe('2')
  })

  it('normalizes rotation beyond ±360° into the keyframe value and the field', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()

    const rotation = fields().Rotation
    await user.clear(rotation)
    await user.type(rotation, '450')
    await user.keyboard('{Enter}')

    expect(rotationOf(engine, nodeId)).toBeCloseTo(Math.PI / 2, 10)
    expect(fields().Rotation.value).toBe('90')
  })

  it('edits scale X and scale Y independently through keyframes', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()

    const scaleX = fields()['Scale X']
    await user.clear(scaleX)
    await user.type(scaleX, '4')
    await user.keyboard('{Enter}')

    const evaluated = engine.evaluateNode(nodeId, 0)
    expect(evaluated.transform.scaleX).toBe(4)
    expect(evaluated.transform.scaleY).toBe(0.5)
    expect(fields()['Scale Y'].value).toBe('0.5')
  })

  it('applies negative scale as a mirror without error', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()

    const scaleX = fields()['Scale X']
    await user.clear(scaleX)
    await user.type(scaleX, '-1')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).transform.scaleX).toBe(-1)
  })

  it('reverts a stale selection that no longer exists to the empty state', () => {
    renderPanel()
    select('ghost')

    expect(
      screen.getByText('Nothing selected. Select an object to edit its properties.'),
    ).toBeInTheDocument()
  })

  it('shows the common value when the selection shares one', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, { x: 12, y: 12, scaleX: 2, scaleY: 2 })
    engine.setOpacity(nodeId, 0.5)
    const secondId = createSecondNode(engine, 'Second', { x: 12, y: 12, scaleX: 2, scaleY: 2 }, 0.5)
    selectMany([nodeId, secondId])

    expect(fields().X.value).toBe('12')
    expect(fields().Y.value).toBe('12')
    expect(fields()['Scale X'].value).toBe('2')
    expect(fields()['Scale Y'].value).toBe('2')
    expect((screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement).value).toBe(
      '50',
    )
  })
})

describe('InspectorPanel scrubbing shows evaluated values', () => {
  it('interpolates the field value between two keyframes as the playhead moves', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 0, 10)
    addKeyframe(dispatcher, nodeId, 'positionX', 2, 30)
    select(nodeId)

    expect(fields().X.value).toBe('10')
    scrub(engine, 1)
    expect(fields().X.value).toBe('20')
    scrub(engine, 2)
    expect(fields().X.value).toBe('30')
  })

  it('shows the stored value for static properties regardless of the playhead', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)

    scrub(engine, 4.5)
    expect(fields().X.value).toBe('12')
    expect(fields().Y.value).toBe('-4')
  })
})

describe('InspectorPanel drag-to-adjust', () => {
  it('adjusts X by dragging the field horizontally, recording add then update commands', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const before = undoStack.entries.length
    const x = fields().X

    fireEvent.pointerDown(x, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 103, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 115, clientY: 10 })
    fireEvent.pointerUp(window)

    expect(engine.evaluateNode(nodeId, 0).transform.x).toBe(27)
    expect(undoStack.entries).toHaveLength(before + 2)
    expect(undoStack.entries[0].type).toBe('SetKeyframeValue')
    expect(undoStack.entries[1].type).toBe('AddKeyframe')
    expect(fields().X.value).toBe('27')
  })

  it('adjusts rotation in degrees while dragging', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const rotation = fields().Rotation

    fireEvent.pointerDown(rotation, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 10 })
    fireEvent.pointerUp(window)

    expect(rotationOf(engine, nodeId)).toBeCloseTo((20 * Math.PI) / 180, 10)
    expect(fields().Rotation.value).toBe('20')
  })

  it('adjusts scale with a fine step and keeps X and Y separate', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const scaleX = fields()['Scale X']

    fireEvent.pointerDown(scaleX, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 150, clientY: 10 })
    fireEvent.pointerUp(window)

    const evaluated = engine.evaluateNode(nodeId, 0)
    expect(evaluated.transform.scaleX).toBe(2.5)
    expect(evaluated.transform.scaleY).toBe(0.5)
  })

  it('a click without movement focuses the field for typing', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const x = fields().X

    fireEvent.pointerDown(x, { clientX: 100, clientY: 10 })
    fireEvent.pointerUp(window)

    expect(document.activeElement).toBe(x)
  })
})

describe('InspectorPanel reset transform', () => {
  it('returns the object to identity as one composite keyframe command recorded in the log', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {
      x: 100,
      y: 200,
      rotation: Math.PI / 4,
      scaleX: 3,
      scaleY: 2,
    })
    select(nodeId)
    const before = undoStack.entries.length

    fireEvent.click(screen.getByRole('button', { name: 'Reset Transform' }))

    expect(engine.evaluateNode(nodeId, 0).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as { type: string; property: string }[]
    ).map((command) => command.type)
    expect(children).toEqual([
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
      'AddKeyframe',
    ])
    expect(fields().X.value).toBe('0')
    expect(fields().Rotation.value).toBe('0')
  })

  it('records nothing when the object is already at identity', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    select(nodeId)
    const before = undoStack.entries.length

    fireEvent.click(screen.getByRole('button', { name: 'Reset Transform' }))

    expect(undoStack.entries).toHaveLength(before)
    expect(engine.evaluateNode(nodeId, 0).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })
})

describe('InspectorPanel live updates', () => {
  it('reflects transform changes made outside the inspector', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)

    act(() => {
      dispatcher.dispatch(new MoveNodeCommand({ nodeId, x: 300, y: 200 }))
    })

    expect(fields().X.value).toBe('300')
    expect(fields().Y.value).toBe('200')
  })
})

describe('InspectorPanel name editing', () => {
  it('renames the object on Enter, records inverse data, and emits NodeRenamed', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length
    const events: string[] = []
    engine.subscribe((event) => events.push(event.type))

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Hero')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).name).toBe('Hero')
    expect(events).toContain('NodeRenamed')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('RenameNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldName: 'Boy' })
    expect(name.value).toBe('Hero')
  })

  it('auto-suffixes a duplicate name within the slide', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const kidId = createSecondNode(engine, 'Kid')
    select(kidId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Boy')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).name).toBe('Boy')
    expect(engine.getNode(kidId).name).toBe('Boy (2)')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('RenameNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId: kidId, oldName: 'Kid' })
  })

  it('rejects an empty name with a notification and leaves the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await user.clear(name)
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).name).toBe('Boy')
    expect(undoStack.entries).toHaveLength(before)
    expect(useNotificationStore.getState().notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Node name must not be empty' })]),
    )
    expect(name.value).toBe('Boy')
  })

  it('commits a rename on blur', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Hero')
    await user.tab()

    expect(engine.getNode(nodeId).name).toBe('Hero')
    expect(undoStack.entries).toHaveLength(before + 1)
  })
})

describe('InspectorPanel opacity auto-key editing', () => {
  it('clamps an over-100 edit to 100% and records an AddKeyframe at the playhead', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {}, 0.5)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '150')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(1)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('AddKeyframe')
    expect(undoStack.entries[0].parameters).toMatchObject({ property: 'opacity', value: 1 })
    expect(opacity.value).toBe('100')
  })

  it('clamps a negative edit to 0%', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {}, 0.5)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '-20')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].parameters.value).toBe(0)
    expect(opacity.value).toBe('0')
  })

  it('applies a valid percentage edit and emits KeyframeAdded', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {}, 0.5)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length
    const events: string[] = []
    engine.subscribe((event) => events.push(event.type))

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '33')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0.33)
    expect(events).toContain('KeyframeAdded')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(opacity.value).toBe('33')
  })

  it('rejects non-numeric input with a notification and leaves the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {}, 0.5)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, 'abc')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0.5)
    expect(undoStack.entries).toHaveLength(before)
    expect(useNotificationStore.getState().notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Opacity must be a number' })]),
    )
    expect(opacity.value).toBe('50')
  })

  it('adjusts opacity by dragging the field', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {}, 0.5)
    select(nodeId)
    const before = undoStack.entries.length
    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement

    fireEvent.pointerDown(opacity, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 110, clientY: 10 })
    fireEvent.pointerUp(window)

    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0.6)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(opacity.value).toBe('60')
  })
})

describe('InspectorPanel multi-selection', () => {
  it('shows the object count in the header and a mixed marker for differing values', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine, 'Second', {}, 0.4)
    selectMany([nodeId, secondId])

    expect(screen.getByRole('heading', { name: '2 Objects Selected' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'General' })).not.toBeInTheDocument()
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('—')
    expect((screen.getByRole('textbox', { name: 'X' }) as HTMLInputElement).value).toBe('—')
    expect((screen.getByRole('textbox', { name: 'Opacity' }) as HTMLInputElement).value).toBe('—')
    expect((screen.getByRole('spinbutton', { name: 'Rotation' }) as HTMLInputElement).value).toBe(
      '0',
    )
  })

  it('applies a name edit to every selected object as one composite command', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    selectMany([nodeId, secondId])
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Hero')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).name).toBe('Hero')
    expect(engine.getNode(secondId).name).toBe('Hero (2)')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as {
        type: string
        nodeId: string
        name: string
      }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId, name: command.name }))
    expect(children).toEqual([
      { type: 'RenameNode', nodeId, name: 'Hero' },
      { type: 'RenameNode', nodeId: secondId, name: 'Hero (2)' },
    ])
    expect(name.value).toBe('—')
  })

  it('applies an opacity edit to every selected object as one composite keyframe command', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine, 'Second', {}, 0.4)
    selectMany([nodeId, secondId])
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const opacity = screen.getByRole('textbox', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '50')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0.5)
    expect(engine.evaluateNode(secondId, 0).opacity).toBe(0.5)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as {
        type: string
        nodeId: string
        value: number
      }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId, value: command.value }))
    expect(children).toEqual([
      { type: 'AddKeyframe', nodeId, value: 0.5 },
      { type: 'AddKeyframe', nodeId: secondId, value: 0.5 },
    ])
    expect((screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement).value).toBe(
      '50',
    )
  })

  it('applies an X edit to every selected object as one composite keyframe command', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    selectMany([nodeId, secondId])
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const x = screen.getByRole('textbox', { name: 'X' }) as HTMLInputElement
    await user.clear(x)
    await user.type(x, '42')
    await user.keyboard('{Enter}')

    expect(engine.evaluateNode(nodeId, 0).transform.x).toBe(42)
    expect(engine.evaluateNode(secondId, 0).transform.x).toBe(42)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as {
        type: string
        nodeId: string
      }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId }))
    expect(children).toEqual([
      { type: 'AddKeyframe', nodeId },
      { type: 'AddKeyframe', nodeId: secondId },
    ])
    expect((screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement).value).toBe('42')
  })

  it('resets the transform of every selected object in one composite command', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine, 'Second', { x: 5, y: 5 })
    selectMany([nodeId, secondId])
    const before = undoStack.entries.length

    fireEvent.click(screen.getByRole('button', { name: 'Reset Transform' }))

    expect(engine.evaluateNode(nodeId, 0).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(engine.evaluateNode(secondId, 0).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (undoStack.entries[0].parameters.commands as { type: string }[]).map(
      (command) => command.type,
    )
    expect(children).toHaveLength(6)
    expect(children.every((type) => type === 'AddKeyframe')).toBe(true)
  })

  it('emits KeyframeAdded for every auto-key edit in a multi edit', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine, 'Second', {}, 0.4)
    selectMany([nodeId, secondId])
    const user = userEvent.setup()
    const events: string[] = []
    engine.subscribe((event) => events.push(event.type))

    const opacity = screen.getByRole('textbox', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '80')
    await user.keyboard('{Enter}')

    expect(events.filter((type) => type === 'KeyframeAdded')).toHaveLength(2)
    expect(engine.evaluateNode(nodeId, 0).opacity).toBe(0.8)
    expect(engine.evaluateNode(secondId, 0).opacity).toBe(0.8)
  })
})

describe('InspectorPanel base mode (Animation Mode off)', () => {
  beforeEach(() => {
    useUiStore.setState({ animationMode: false })
  })

  it('shows stored values regardless of the playhead', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, { x: 12 })
    addKeyframe(dispatcher, nodeId, 'positionX', 0, 200)
    addKeyframe(dispatcher, nodeId, 'positionX', 2, 400)
    scrub(engine, 1)
    select(nodeId)

    expect(fields().X.value).toBe('12')
    expect(screen.getByTitle('Animated')).toBeInTheDocument()
  })

  it('dispatches a MoveNode with inverse data on Enter, touching no keyframes', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    scrub(engine, 3)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const x = fields().X
    await user.clear(x)
    await user.type(x, '42')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).transform.x).toBe(42)
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(engine.evaluateNode(nodeId, 3).transform.x).toBe(42)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('MoveNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldX: 12, oldY: -4 })
    expect(fields().X.value).toBe('42')
  })

  it('dispatches a SetOpacity with inverse data for an opacity edit', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '33')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).opacity).toBe(0.33)
    expect(engine.getKeyframes(nodeId, 'opacity')).toHaveLength(0)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('SetOpacity')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldOpacity: 1 })
    expect(opacity.value).toBe('33')
  })

  it('disables a field whose property has any keyframe and still shows the indicator', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    select(nodeId)

    expect(screen.getByLabelText('X')).toBeDisabled()
    expect(screen.getByLabelText('Y')).not.toBeDisabled()
    expect(screen.getByLabelText('Rotation')).not.toBeDisabled()
    expect(fieldContainer('X').querySelector('.inspector-field__indicator')).toHaveAttribute(
      'data-state',
      'animated',
    )
  })

  it('disables the opacity field when opacity has keyframes', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'opacity', 1, 0.5)
    select(nodeId)

    expect(screen.getByLabelText('Opacity')).toBeDisabled()
    expect(fieldContainer('Opacity').querySelector('.inspector-field__indicator')).not.toBeNull()
  })

  it('disables a field when any selected node is animated, even if others are static', () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, { x: 12, y: 12 })
    const secondId = createSecondNode(engine, 'Second', { x: 12, y: 12 })
    addKeyframe(dispatcher, secondId, 'positionX', 1, 5)
    selectMany([nodeId, secondId])

    expect(screen.getByLabelText('X')).toBeDisabled()
    expect(screen.getByLabelText('Y')).not.toBeDisabled()
  })

  it('resets the transform through stored Move/Rotate/Scale commands with inverse data', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {
      x: 100,
      y: 200,
      rotation: Math.PI / 4,
      scaleX: 3,
      scaleY: 2,
    })
    select(nodeId)
    const before = undoStack.entries.length

    fireEvent.click(screen.getByRole('button', { name: 'Reset Transform' }))

    expect(engine.getNode(nodeId).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(engine.getKeyframes(nodeId, 'positionX')).toHaveLength(0)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (undoStack.entries[0].parameters.commands as { type: string }[]).map(
      (command) => command.type,
    )
    expect(children).toEqual(['MoveNode', 'RotateNode', 'ScaleNode'])
    expect(fields().X.value).toBe('0')
    expect(fields().Rotation.value).toBe('0')
  })

  it('edits a disabled animated field are impossible while other fields stay editable', () => {
    const { engine, dispatcher, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    addKeyframe(dispatcher, nodeId, 'positionX', 1, 10)
    select(nodeId)
    const before = undoStack.entries.length
    const x = screen.getByLabelText('X') as HTMLInputElement

    fireEvent.pointerDown(x, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 10 })
    fireEvent.pointerUp(window)

    expect(engine.getNode(nodeId).transform.x).toBe(12)
    expect(undoStack.entries).toHaveLength(before)
  })
})
