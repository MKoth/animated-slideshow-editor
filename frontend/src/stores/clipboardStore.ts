import { create } from 'zustand'
import type { Transform } from '../engine'

export interface ClipboardItem {
  readonly definitionId: string
  readonly sceneId: string
  readonly parentId: string
  readonly name: string
  readonly transform: Transform
  readonly semanticName?: string
}

export interface ClipboardState {
  readonly items: readonly ClipboardItem[]
  copy(items: readonly ClipboardItem[]): void
}

export const useClipboardStore = create<ClipboardState>()((set) => ({
  items: [],

  copy: (items) => set({ items: [...items] }),
}))
