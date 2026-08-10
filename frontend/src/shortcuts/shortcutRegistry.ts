export type ShortcutHandler = (event: KeyboardEvent) => void

const bindings = new Map<string, ShortcutHandler>()

export function registerShortcut(combo: string, handler: ShortcutHandler): () => void {
  bindings.set(combo, handler)
  return () => {
    if (bindings.get(combo) === handler) {
      bindings.delete(combo)
    }
  }
}

export function getShortcutHandler(combo: string): ShortcutHandler | undefined {
  return bindings.get(combo)
}

export function formatCombo(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase()
  if (key === 'control' || key === 'meta' || key === 'shift' || key === 'alt') {
    return null
  }
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) {
    parts.push('ctrl')
  }
  parts.push(key)
  return parts.join('+')
}
