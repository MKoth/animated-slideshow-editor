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
  })
  return { nodeId: node.id, cameraId: slide.scene.camera.id }
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

  it('shows the empty state when the selected node is the camera', () => {
    const { engine } = renderPanel()
    const { cameraId } = createSceneWithNode(engine)
    select(cameraId)

    expect(
      screen.getByText('Nothing selected. Select an object to edit its properties.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transform' })).not.toBeInTheDocument()
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
    expect(name).toBeDisabled()
    expect(name.value).toBe('Boy')

    const opacity = screen.getByRole('spinbutton', { name: 'Opacity' }) as HTMLInputElement
    expect(opacity).toBeDisabled()

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

  it('shows the first selected object when multiple are selected', () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    const slide = engine.project?.slides[0]
    const second = engine.createNode(slide?.scene.id ?? '', slide?.scene.root.id ?? '', 'Second')
    selectMany([nodeId, second.id])

    expect(fields().X.value).toBe('12')
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
