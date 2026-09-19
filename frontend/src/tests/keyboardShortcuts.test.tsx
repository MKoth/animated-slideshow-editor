import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { MenuBar } from '../components/editor/MenuBar'
import { KeyboardShortcutsModal } from '../components/editor/KeyboardShortcutsModal'
import { SHORTCUT_CATALOG } from '../shortcuts/shortcutCatalog'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'

function shortcutText(): string {
  return SHORTCUT_CATALOG.map((s) =>
    [s.title, ...s.entries.flatMap((e) => [e.action, ...e.keys])].join(' '),
  ).join(' ')
}

describe('shortcutCatalog', () => {
  it('covers the central registry combos', () => {
    const text = shortcutText()
    for (const action of [
      'Copy selection or selected keyframes',
      'Paste selection or keyframes',
      'Duplicate selection or selected keyframes',
      'Delete selection or selected keyframes',
      'Undo',
      'Redo',
      'Save project',
    ]) {
      expect(text).toContain(action)
    }
    expect(text).toContain('Ctrl/⌘')
  })

  it('covers mesh, canvas, audio, manager, curve and mouse chords without stubs', () => {
    const text = shortcutText()
    for (const action of [
      'Extrude tool',
      'Pivot-drag modifier',
      'Play / pause',
      'Split clip at playhead',
      'Delete selected placement',
      'Pan (drag while held)',
      'Toggle selection',
    ]) {
      expect(text).toContain(action)
    }
    expect(text).not.toContain('Not implemented')
  })
})

describe('KeyboardShortcutsModal', () => {
  it('renders every section view-only (no editable controls)', () => {
    render(<KeyboardShortcutsModal onClose={() => {}} />)

    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeInTheDocument()
    for (const section of SHORTCUT_CATALOG) {
      expect(screen.getByRole('heading', { name: section.title })).toBeInTheDocument()
    }
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<KeyboardShortcutsModal onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('MenuBar Help menu', () => {
  function renderMenuBar(): void {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: {
        save: vi.fn(),
        onCommandSucceeded: () => undefined,
        dispose: () => undefined,
      },
    }
    render(
      <EngineContext.Provider value={value}>
        <MenuBar />
      </EngineContext.Provider>,
    )
  }

  it('opens the shortcuts modal from Help > Keyboard Shortcuts and closes it', async () => {
    renderMenuBar()
    const user = userEvent.setup()

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('menuitem', { name: 'Keyboard Shortcuts' }))

    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeInTheDocument()
    expect(screen.getByText('Copy selection or selected keyframes')).toBeInTheDocument()

    await user.click(screen.getByTestId('keyboard-shortcuts-close'))
    expect(screen.queryByTestId('keyboard-shortcuts-modal')).toBeNull()
  })
})
