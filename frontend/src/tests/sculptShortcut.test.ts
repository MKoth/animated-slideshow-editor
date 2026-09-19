import { beforeEach, describe, expect, it } from 'vitest'
import { formatCombo, getShortcutHandler } from '../shortcuts/shortcutRegistry'
import { registerMeshEditShortcuts } from '../shortcuts/meshEditShortcuts'
import { SHORTCUT_CATALOG } from '../shortcuts/shortcutCatalog'
import { useMeshEditStore } from '../stores/meshEditStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useEditingModeStore } from '../stores/editingModeStore'
import { useBoneEditStore } from '../stores/boneEditStore'

function pressC(): void {
  const combo = formatCombo({
    key: 'c',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  } as KeyboardEvent)
  const handler = getShortcutHandler(combo ?? '')
  expect(handler).toBeDefined()
  handler?.({} as KeyboardEvent)
}

beforeEach(() => {
  useMeshEditStore.getState().exitMeshEdit()
  useSelectionStore.getState().clear()
  useEditingModeStore.getState().exitMode()
  useBoneEditStore.getState().exit()
})

describe('sculpt shortcut (C)', () => {
  it('switches to the sculpt tool when already editing a mesh', () => {
    const dispose = registerMeshEditShortcuts()
    try {
      useMeshEditStore.getState().enterMeshEdit('node1')
      expect(useMeshEditStore.getState().meshEditTool).toBe('select')

      pressC()

      expect(useMeshEditStore.getState().meshEditNodeId).toBe('node1')
      expect(useMeshEditStore.getState().meshEditTool).toBe('sculpt')
    } finally {
      dispose()
    }
  })

  it('enters mesh edit + sculpt from a canvas selection', () => {
    const dispose = registerMeshEditShortcuts()
    try {
      useSelectionStore.getState().select('node9')

      pressC()

      expect(useEditingModeStore.getState().mode).toBe('meshEdit')
      expect(useMeshEditStore.getState().meshEditNodeId).toBe('node9')
      expect(useMeshEditStore.getState().meshEditTool).toBe('sculpt')
    } finally {
      dispose()
    }
  })

  it('does nothing when there is no mesh edit node and no selection', () => {
    const dispose = registerMeshEditShortcuts()
    try {
      pressC()

      expect(useMeshEditStore.getState().meshEditNodeId).toBeNull()
      expect(useEditingModeStore.getState().mode).toBe('default')
    } finally {
      dispose()
    }
  })

  it('exits bone edit when entering sculpt from selection', () => {
    const dispose = registerMeshEditShortcuts()
    try {
      useBoneEditStore.getState().enter(null)
      useSelectionStore.getState().select('node7')

      pressC()

      expect(useBoneEditStore.getState().isEditing).toBe(false)
      expect(useMeshEditStore.getState().meshEditTool).toBe('sculpt')
    } finally {
      dispose()
    }
  })

  it('is documented in the shortcut catalog', () => {
    const text = SHORTCUT_CATALOG.map((s) =>
      [s.title, ...s.entries.flatMap((e) => [e.action, ...e.keys])].join(' '),
    ).join(' ')
    expect(text).toContain('Sculpt tool')
    expect(text).toContain('C')
  })
})
