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
  readonly clipEditClipId: string | null
  copy(targets: readonly KeyframeClipboardTarget[], originTime: number): void
  setClipEditContext(clipId: string | null): void
  clear(): void
}

export const useKeyframeClipboardStore = create<KeyframeClipboardState>()((set) => ({
  targets: [],
  originTime: 0,
  clipEditClipId: null,

  copy: (targets, originTime) => set({ targets: [...targets], originTime }),
  setClipEditContext: (clipId) => set({ clipEditClipId: clipId }),
  clear: () => set({ targets: [], originTime: 0, clipEditClipId: null }),
}))

export function isKeyframeClipboardEmpty(): boolean {
  return useKeyframeClipboardStore.getState().targets.length === 0
}
