import { registerShortcut } from './shortcutRegistry'

export interface SaveShortcutDeps {
  readonly save: () => void
}

export function registerSaveShortcut(getDeps: () => SaveShortcutDeps): () => void {
  return registerShortcut('ctrl+s', () => {
    getDeps().save()
  })
}
