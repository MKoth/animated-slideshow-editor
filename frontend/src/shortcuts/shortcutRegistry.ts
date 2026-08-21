export type ShortcutHandler = (event: KeyboardEvent) => void

const bindings = new Map<string, ShortcutHandler[]>()

export function registerShortcut(combo: string, handler: ShortcutHandler): () => void {
  const existing = bindings.get(combo) ?? []
  existing.push(handler)
  bindings.set(combo, existing)
  return () => {
    const list = bindings.get(combo)
    if (!list) {
      return
    }
    const idx = list.indexOf(handler)
    if (idx >= 0) {
      list.splice(idx, 1)
    }
    if (list.length === 0) {
      bindings.delete(combo)
    }
  }
}

export function getShortcutHandler(combo: string): ShortcutHandler | undefined {
  const list = bindings.get(combo)
  if (!list || list.length === 0) {
    return undefined
  }
  if (list.length === 1) {
    return list[0]
  }
  return (event: KeyboardEvent) => {
    for (const h of list) {
      h(event)
    }
  }
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
