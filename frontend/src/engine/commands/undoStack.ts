export interface UndoStackEntry<Inverse = unknown> {
  readonly id: string
  readonly type: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly inverse: Inverse
}

export type UndoStackListener = () => void

export class UndoStack {
  #entries: readonly UndoStackEntry[] = []
  readonly #listeners = new Set<UndoStackListener>()

  get entries(): readonly UndoStackEntry[] {
    return this.#entries
  }

  record(entry: UndoStackEntry): void {
    this.#entries = [entry, ...this.#entries]
    for (const listener of this.#listeners) {
      listener()
    }
  }

  subscribe = (listener: UndoStackListener): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}
