import { create } from 'zustand'

export interface PasteDeltaItem {
  readonly index: number
  readonly label: string
  /** Human-readable track description, e.g. "positionX" or "tint" */
  readonly trackLabel: string
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly isNumeric: boolean
  readonly delta: number | null
  readonly ratio: number | null
  readonly sourceValue: number | null
  readonly targetValue: number | null
  readonly disabledReason?: string
}

interface PendingRequest {
  readonly items: readonly PasteDeltaItem[]
  readonly resolve: (choices: readonly boolean[]) => void
  readonly reject: () => void
}

interface PasteDeltaState {
  readonly pending: PendingRequest | null
  request(items: readonly PasteDeltaItem[]): Promise<readonly boolean[]>
  resolve(choices: readonly boolean[]): void
  cancel(): void
}

export const usePasteDeltaStore = create<PasteDeltaState>()((set, get) => ({
  pending: null,
  request: (items) =>
    new Promise<readonly boolean[]>((resolve, reject) => {
      set({
        pending: {
          items,
          resolve: (choices) => resolve(choices),
          reject: () => reject(new Error('cancelled')),
        },
      })
    }),
  resolve: (choices) => {
    const pending = get().pending
    if (!pending) return
    const toResolve = pending.resolve
    set({ pending: null })
    toResolve(choices)
  },
  cancel: () => {
    const pending = get().pending
    if (!pending) return
    const toReject = pending.reject
    set({ pending: null })
    // Resolve with all false to cancel paste? Instead reject to abort.
    // For paste flow, we treat cancel as all false + abort.
    // So reject; caller will handle.
    toReject()
  },
}))

/** Convenience: request delta choices if needed; returns null if cancelled. */
export async function requestPasteDeltaChoices(
  items: readonly PasteDeltaItem[],
): Promise<readonly boolean[] | null> {
  try {
    const choices = await usePasteDeltaStore.getState().request(items)
    return choices
  } catch {
    return null
  }
}
