import type { AssetLibrarySync } from '../engine/assetLibrarySync'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'

export type Unsubscribe = () => void

export function registerLibrarySync(sync: AssetLibrarySync): Unsubscribe {
  const apply = (): void => sync.apply(useAssetLibraryStore.getState().definitions)
  apply()
  return useAssetLibraryStore.subscribe(apply)
}
