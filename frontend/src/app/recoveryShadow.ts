import { deserialize } from '../engine/lessonSerializer'
import type { Project } from '../engine'

export const RECOVERY_SHADOW_KEY = 'recoveryShadow'
export const LAST_SAVED_KEY = 'recoveryLastSaved'

export function writeShadow(blob: string): void {
  localStorage.setItem(RECOVERY_SHADOW_KEY, blob)
}

export function readShadow(): string | null {
  return localStorage.getItem(RECOVERY_SHADOW_KEY)
}

export function clearShadow(): void {
  localStorage.removeItem(RECOVERY_SHADOW_KEY)
}

export function recordLastSaved(blob: string): void {
  localStorage.setItem(LAST_SAVED_KEY, blob)
}

export function hasRecoverableShadow(): boolean {
  const shadow = readShadow()
  return shadow !== null && shadow !== localStorage.getItem(LAST_SAVED_KEY)
}

export function loadRecoverableProject(): Project | null {
  if (!hasRecoverableShadow()) {
    return null
  }
  const blob = readShadow()
  if (blob === null) {
    return null
  }
  try {
    return deserialize(blob)
  } catch {
    clearShadow()
    return null
  }
}
