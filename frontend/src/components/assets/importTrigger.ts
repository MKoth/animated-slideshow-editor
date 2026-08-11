let opener: (() => void) | null = null

export function registerImportOpener(fn: () => void): () => void {
  opener = fn
  return () => {
    if (opener === fn) {
      opener = null
    }
  }
}

export function triggerAssetImport(): void {
  opener?.()
}
