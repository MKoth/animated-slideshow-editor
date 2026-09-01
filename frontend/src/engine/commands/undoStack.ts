import type { Engine } from '../internal'
import { applyRedo, applyUndo } from './undoHandlers'

export interface UndoStackEntry<Inverse = unknown> {
  readonly id: string
  readonly type: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly inverse: Inverse
  readonly timestamp?: number
  readonly source?: 'user' | 'ai'
}

export type UndoStackListener = () => void

export class UndoStack {
  #entries: readonly UndoStackEntry[] = []
  #redoEntries: readonly UndoStackEntry[] = []
  readonly #listeners = new Set<UndoStackListener>()

  get entries(): readonly UndoStackEntry[] {
    return this.#entries
  }

  get redoEntries(): readonly UndoStackEntry[] {
    return this.#redoEntries
  }

  get canUndo(): boolean {
    return this.#entries.length > 0
  }

  get canRedo(): boolean {
    return this.#redoEntries.length > 0
  }

  record(entry: UndoStackEntry): void {
    this.#entries = [entry, ...this.#entries]
    if (this.#redoEntries.length > 0) {
      this.#redoEntries = []
    }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  clear(): void {
    const hadEntries = this.#entries.length > 0 || this.#redoEntries.length > 0
    if (!hadEntries) {
      return
    }
    this.#entries = []
    this.#redoEntries = []
    for (const listener of this.#listeners) {
      listener()
    }
  }

  undo(engine: Engine): UndoStackEntry | null {
    const top = this.#entries[0]
    if (!top) return null
    this.#entries = this.#entries.slice(1)
    try {
      if (top.type === 'Transaction') {
        const inverse = top.inverse as { children: readonly { type: string; parameters: Readonly<Record<string, unknown>>; inverse: unknown }[] }
        // Apply children in reverse order to correctly revert
        for (let i = inverse.children.length - 1; i >= 0; i--) {
          const child = inverse.children[i]
          applyUndo(engine, child.type, child.parameters, child.inverse)
        }
      } else {
        applyUndo(engine, top.type, top.parameters, top.inverse)
      }
    } catch (error) {
      // If undo fails, push entry back to avoid losing history (partial rollback already attempted via handlers which are best-effort)
      this.#entries = [top, ...this.#entries]
      throw error
    }
    this.#redoEntries = [top, ...this.#redoEntries]
    for (const listener of this.#listeners) {
      listener()
    }
    return top
  }

  redo(engine: Engine): UndoStackEntry | null {
    const top = this.#redoEntries[0]
    if (!top) return null
    this.#redoEntries = this.#redoEntries.slice(1)
    try {
      if (top.type === 'Transaction') {
        const inverse = top.inverse as { children: readonly { type: string; parameters: Readonly<Record<string, unknown>>; inverse: unknown }[] }
        for (const child of inverse.children) {
          applyRedo(engine, child.type, child.parameters, child.inverse)
        }
      } else {
        applyRedo(engine, top.type, top.parameters, top.inverse)
      }
    } catch (error) {
      this.#redoEntries = [top, ...this.#redoEntries]
      throw error
    }
    this.#entries = [top, ...this.#entries]
    for (const listener of this.#listeners) {
      listener()
    }
    return top
  }

  subscribe = (listener: UndoStackListener): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}
