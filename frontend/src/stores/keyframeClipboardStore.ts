import { create } from 'zustand'
import type { KeyframeTarget } from '../engine'
import type { PastePayload } from '../engine/animationManager'

export interface KeyframeClipboardTarget {
  readonly target: KeyframeTarget
  readonly payload: PastePayload
}

export interface KeyframeClipboardState {
  readonly targets: readonly KeyframeClipboardTarget[]
  readonly originTime: number
  copy(targets: readonly KeyframeClipboardTarget[], originTime: number): void
  clear(): void
}

export const useKeyframeClipboardStore = create<KeyframeClipboardState>()((set) => ({
  targets: [],
  originTime: 0,

  copy: (targets, originTime) => set({ targets: [...targets], originTime }),
  clear: () => set({ targets: [], originTime: 0 }),
}))

export function isKeyframeClipboardEmpty(): boolean {
  return useKeyframeClipboardStore.getState().targets.length === 0
}
