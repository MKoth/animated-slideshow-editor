import { create } from 'zustand'
import type { KeyframeTarget } from '../engine'
import type { PastePayload } from '../engine/animationManager'

export interface MorphClipboardShapeInfo {
  readonly name: string
  readonly categoryName: string | null
  readonly categoryPath: string | null
}

export interface MorphClipboardMeta {
  readonly vertexCount: number
  readonly shapesById: Readonly<Record<string, MorphClipboardShapeInfo>>
}

export interface KeyframeClipboardTarget {
  readonly target: KeyframeTarget
  readonly payload: PastePayload
  readonly morphMeta?: MorphClipboardMeta
  /** Per-target origin time (earliest keyframe time of this target group) for evaluated delta computation. */
  readonly originTime?: number
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
