import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import { CommandDispatcher, MoveNodeCommand, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useNotificationStore } from '../stores/notificationStore'
import { useSelectionStore } from '../stores/selectionStore'

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
): { nodeId: string; cameraId: string } {
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
  return { nodeId: node.id, cameraId: slide.scene.camera.id }
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

function fields(): { [key: string]: HTMLInputElement } {
  const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
  const map: { [key: string]: HTMLInputElement } = {}
  for (const input of inputs) {
    map[input.getAttribute('aria-label') ?? input.name] = input
  }
  return map
}

function rotationOf(engine: Engine, nodeId: string): number {
  return engine.getNode(nodeId).transform.rotation
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
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

describe('InspectorPanel transform editing', () => {
  it('applies an X edit on Enter, records inverse data, and updates the canvas and hierarchy', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const x = fields().X
    await user.clear(x)
    await user.type(x, '42')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).transform.x).toBe(42)
    expect(engine.getNode(nodeId).transform.y).toBe(-4)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('MoveNode')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldX: 12, oldY: -4 })
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

    expect(engine.getNode(nodeId).transform.y).toBe(-10)
    expect(undoStack.entries).toHaveLength(before + 1)
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

    expect(engine.getNode(nodeId).transform.x).toBe(12)
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

    expect(engine.getNode(nodeId).transform.scaleX).toBe(2)
    expect(undoStack.entries).toHaveLength(before)
    expect(useNotificationStore.getState().notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Scale X must not be zero' })]),
    )
    expect(fields()['Scale X'].value).toBe('2')
  })

  it('normalizes rotation beyond ±360° into the engine and the field', async () => {
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

  it('edits scale X and scale Y independently', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const user = userEvent.setup()

    const scaleX = fields()['Scale X']
    await user.clear(scaleX)
    await user.type(scaleX, '4')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).transform).toMatchObject({ scaleX: 4, scaleY: 0.5 })
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

    expect(engine.getNode(nodeId).transform.scaleX).toBe(-1)
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

describe('InspectorPanel drag-to-adjust', () => {
  it('adjusts X by dragging the field horizontally and records commands', () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    select(nodeId)
    const before = undoStack.entries.length
    const x = fields().X

    fireEvent.pointerDown(x, { clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 103, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 115, clientY: 10 })
    fireEvent.pointerUp(window)

    expect(engine.getNode(nodeId).transform.x).toBe(27)
    expect(undoStack.entries).toHaveLength(before + 2)
    expect(undoStack.entries[0].type).toBe('MoveNode')
    expect(undoStack.entries[0].inverse).toMatchObject({ nodeId, oldX: 15 })
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

    expect(engine.getNode(nodeId).transform).toMatchObject({ scaleX: 2.5, scaleY: 0.5 })
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
  it('returns the object to identity as one composite command recorded in the log', () => {
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
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (undoStack.entries[0].parameters.commands as { type: string }[]).map(
      (command) => command.type,
    )
    expect(children).toEqual(['MoveNode', 'RotateNode', 'ScaleNode'])
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
    expect(engine.getNode(nodeId).transform).toEqual({
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

describe('InspectorPanel opacity editing', () => {
  it('clamps an over-100 edit to 100% and records SetOpacity with the old value', async () => {
    const { engine, undoStack } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, {}, 0.5)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '150')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).opacity).toBe(1)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('SetOpacity')
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldOpacity: 0.5 })
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

    expect(engine.getNode(nodeId).opacity).toBe(0)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].inverse).toEqual({ nodeId, oldOpacity: 0.5 })
    expect(opacity.value).toBe('0')
  })

  it('applies a valid percentage edit and emits OpacityChanged', async () => {
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

    expect(engine.getNode(nodeId).opacity).toBe(0.33)
    expect(events).toContain('OpacityChanged')
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

    expect(engine.getNode(nodeId).opacity).toBe(0.5)
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

    expect(engine.getNode(nodeId).opacity).toBe(0.6)
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

  it('applies an opacity edit to every selected object as one composite command', async () => {
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

    expect(engine.getNode(nodeId).opacity).toBe(0.5)
    expect(engine.getNode(secondId).opacity).toBe(0.5)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as {
        type: string
        nodeId: string
        opacity: number
      }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId, opacity: command.opacity }))
    expect(children).toEqual([
      { type: 'SetOpacity', nodeId, opacity: 0.5 },
      { type: 'SetOpacity', nodeId: secondId, opacity: 0.5 },
    ])
    expect((screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement).value).toBe(
      '50',
    )
  })

  it('applies an X edit to every selected object as one composite command', async () => {
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

    expect(engine.getNode(nodeId).transform).toMatchObject({ x: 42, y: -4 })
    expect(engine.getNode(secondId).transform).toMatchObject({ x: 42, y: 0 })
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as {
        type: string
        nodeId: string
      }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId }))
    expect(children).toEqual([
      { type: 'MoveNode', nodeId },
      { type: 'MoveNode', nodeId: secondId },
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

    expect(engine.getNode(nodeId).transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    expect(engine.getNode(secondId).transform).toEqual({
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
    expect(children).toEqual([
      'MoveNode',
      'RotateNode',
      'ScaleNode',
      'MoveNode',
      'RotateNode',
      'ScaleNode',
    ])
  })

  it('emits NodeRenamed for every renaming and OpacityChanged for every opacity edit in a multi edit', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine, 'Second', {}, 0.4)
    selectMany([nodeId, secondId])
    const user = userEvent.setup()
    const events: string[] = []
    engine.subscribe((event) => events.push(event.type))

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Hero')
    await user.keyboard('{Enter}')

    const renameEvents = events.filter((type) => type === 'NodeRenamed')
    expect(renameEvents).toHaveLength(2)
    expect(engine.getNode(nodeId).name).toBe('Hero')
    expect(engine.getNode(secondId).name).toBe('Hero (2)')

    const opacity = screen.getByRole('textbox', { name: 'Opacity' }) as HTMLInputElement
    await user.clear(opacity)
    await user.type(opacity, '80')
    await user.keyboard('{Enter}')

    expect(events.filter((type) => type === 'OpacityChanged')).toHaveLength(2)
    expect(engine.getNode(nodeId).opacity).toBe(0.8)
    expect(engine.getNode(secondId).opacity).toBe(0.8)
  })
})
