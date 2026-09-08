import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack, CreateClipCommand } from '../engine/commands'
import { useSelectionStore } from '../stores/selectionStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import { noopPersistence } from './contextHarness'

function renderManager(engine: Engine, undo: UndoStack, parentNodeId: string | null) {
  const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack: undo,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
  return render(
    <EngineContext.Provider value={value}>
      <AnimationManagerModal open={parentNodeId !== null} parentNodeId={parentNodeId} onClose={() => {}} />
    </EngineContext.Provider>,
  )
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false } as never)
  useParentingModeStore.getState().reset()
})

describe('15-07 Manager portability via dropdown and export', () => {
  it('manager shows Export .lesson_object button and dropdown lists available collections', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    slide.duration = 10
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'RigHandle')
    const child = engine.createNode(slide.scene.id, parent.id, 'Arm')
    engine.setSemanticName(child.id, 'arm')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip = (
      dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 7, category: '' })) as unknown as {
        inverse: { clipId: string }
      }
    ).inverse.clipId as string
    engine.createClipCollection('MyCol', { arm: clip }, parent.id)
    // Need animated child to make manager rows appear (child has clipInstance)
    engine.assignClipInstance(child.id, clip, 0, 1, true, {})
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    // Export button should be visible
    const exportBtn = within(modal).getByTestId('manager-export-object')
    expect(exportBtn).toBeInTheDocument()
    expect(exportBtn).toHaveTextContent('Export .lesson_object')
    // Dropdown section should exist
    const section = within(modal).getByTestId('collection-lanes-section')
    expect(section).toBeInTheDocument()
    const select = within(section).getByTestId('place-collection-select')
    expect(select).toBeInTheDocument()
    // Options should include MyCol
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options.join(' ')).toContain('MyCol')
    // Place button disabled when no selection
    const placeBtn = within(section).getByTestId('place-collection-button')
    expect(placeBtn).toBeDisabled()
    // Selecting collection enables button
    // Simulate change event
    const colId = engine.clipCollections[0]!.id
    // Use fireEvent to change
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(select, { target: { value: colId } })
    expect(placeBtn).toBeEnabled()
  })
})
