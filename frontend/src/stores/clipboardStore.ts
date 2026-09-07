import { create } from 'zustand'
import type { Transform } from '../engine'
import type { ReusableObjectJSON } from '../engine/reusableObject'

export interface ClipboardItem {
  readonly definitionId: string
  readonly sceneId: string
  readonly parentId: string
  readonly name: string
  readonly transform: Transform
  readonly semanticName?: string
}

export interface ClipboardPayload {
  readonly version: 1
  readonly createdAt: number
  readonly entries: readonly ReusableObjectJSON[]
}

export interface ClipboardState {
  readonly items: readonly ClipboardItem[]
  readonly payload: ClipboardPayload | null
  copy(items: readonly ClipboardItem[]): void
  copyPayload(payload: ClipboardPayload): void
  setPayload(payload: ClipboardPayload | null): void
  clear(): void
}

export const CLIPBOARD_PAYLOAD_VERSION = 1 as const
export const CLIPBOARD_SYSTEM_MIME = 'application/x-animated-slideshow'

export function serializeClipboardPayload(payload: ClipboardPayload): string {
  return JSON.stringify(payload)
}

export function deserializeClipboardPayload(text: string): ClipboardPayload | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== 1 ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return null
    }
    return parsed as unknown as ClipboardPayload
  } catch {
    return null
  }
}

export async function writeSystemClipboard(payload: ClipboardPayload): Promise<void> {
  const text = serializeClipboardPayload(payload)
  if (text.length > 8 * 1024 * 1024) {
    return
  }
  try {
    const nav = navigator as unknown as {
      clipboard?: {
        writeText?: (t: string) => Promise<void>
        write?: (items: unknown[]) => Promise<void>
      }
    }
    if (
      nav.clipboard?.write &&
      typeof window !== 'undefined' &&
      (window as unknown as { ClipboardItem?: unknown }).ClipboardItem
    ) {
      const ClipboardItemCtor = (
        window as unknown as { ClipboardItem: new (items: Record<string, Blob>) => unknown }
      ).ClipboardItem
      const jsonBlob = new Blob([text], { type: 'application/json' })
      const plainBlob = new Blob([text], { type: 'text/plain' })
      const item = new ClipboardItemCtor({
        'application/json': jsonBlob,
        'text/plain': plainBlob,
      } as unknown as Record<string, Blob>)
      await nav.clipboard.write([item] as unknown[])
      return
    }
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text)
      return
    }
  } catch {
    // silently ignore NotAllowedError / SecurityError - in-memory payload survives
  }
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'absolute'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  } catch {
    // ignore
  }
}

export async function readSystemClipboard(): Promise<ClipboardPayload | null> {
  try {
    const nav = navigator as unknown as {
      clipboard?: { readText?: () => Promise<string>; read?: () => Promise<unknown[]> }
    }
    if (nav.clipboard?.readText) {
      const text = await nav.clipboard.readText()
      if (text && text.length > 0) {
        const parsed = deserializeClipboardPayload(text)
        if (parsed) return parsed
        // also try parsing plain ReusableObject array fallback for legacy
        try {
          const legacy = JSON.parse(text) as unknown
          if (
            Array.isArray(legacy) &&
            legacy.length > 0 &&
            (legacy[0] as Record<string, unknown>).nodes
          ) {
            return {
              version: 1,
              createdAt: Date.now(),
              entries: legacy as unknown as ReusableObjectJSON[],
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // permission denied or not secure context
  }
  return null
}

export const useClipboardStore = create<ClipboardState>()((set) => ({
  items: [],
  payload: null,

  copy: (items) => set((state) => ({ items: [...items], payload: state.payload })),
  copyPayload: (payload) => set((state) => ({ payload, items: state.items })),
  setPayload: (payload) => set({ payload }),
  clear: () => set({ items: [], payload: null }),
}))
