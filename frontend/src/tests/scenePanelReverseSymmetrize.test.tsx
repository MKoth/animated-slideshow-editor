import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ScenePanel } from '../components/panels/ScenePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useSelectionStore } from '../stores/selectionStore'

function renderPanel(): { engine: Engine } {
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
      <ScenePanel />
    </EngineContext.Provider>,
  )
  return { engine }
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false })
})

describe('ScenePanel Reverse Symmetrize entry', () => {
  it('is offered only for animated subtrees and opens the modal', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const left = engine.createNode(slide.scene.id, slide.scene.root.id, 'Left Ear')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Right Ear')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Idle')
    engine.addKeyframe({ kind: 'node', nodeId: left.id, property: 'positionX' }, 1, 5)

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Idle' }))
    expect(screen.queryByTestId('scene-reverse-symmetrize')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Left Ear' }))
    fireEvent.click(screen.getByTestId('scene-reverse-symmetrize'))
    expect(await screen.findByTestId('reverse-symmetrize-modal')).toBeInTheDocument()
  })

  it('is offered when only the guessed sibling is animated', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const right = engine.createNode(slide.scene.id, slide.scene.root.id, 'Right Ear')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Left Ear')
    engine.addKeyframe({ kind: 'node', nodeId: right.id, property: 'positionX' }, 1, 5)

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Left Ear' }))
    expect(screen.getByTestId('scene-reverse-symmetrize')).toBeInTheDocument()
  })

  it('is offered for opacity-only subtrees', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const faded = engine.createNode(slide.scene.id, slide.scene.root.id, 'Faded')
    engine.addKeyframe({ kind: 'node', nodeId: faded.id, property: 'opacity' }, 1, 0.5)

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Faded' }))
    expect(screen.getByTestId('scene-reverse-symmetrize')).toBeInTheDocument()
  })

  it('preselects a sibling created after the panel first mounted', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    // Let the panel (and its modal host) mount before the nodes exist, so a
    // stale candidate snapshot would not contain the guessed sibling.
    await screen.findByRole('tree', { name: 'Scene tree of Slide 1' })
    const left = engine.createNode(slide.scene.id, slide.scene.root.id, 'Left Ear')
    const right = engine.createNode(slide.scene.id, slide.scene.root.id, 'Right Ear')
    engine.addKeyframe({ kind: 'node', nodeId: left.id, property: 'positionX' }, 1, 5)

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Left Ear' }))
    fireEvent.click(screen.getByTestId('scene-reverse-symmetrize'))
    expect(
      ((await screen.findByTestId(`reverse-symmetrize-type-${left.id}`)) as HTMLSelectElement)
        .value,
    ).toBe('sibling')
    expect(
      (screen.getByTestId(`reverse-symmetrize-sibling-${left.id}`) as HTMLSelectElement).value,
    ).toBe(right.id)
  })
})
