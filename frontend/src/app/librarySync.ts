import type { AssetLibrarySync } from '../engine/assetLibrarySync'
import type { MaterialLibrarySync } from '../engine/materialLibrarySync'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'

export type Unsubscribe = () => void

export function registerLibrarySync(sync: AssetLibrarySync): Unsubscribe {
  const apply = (): void => sync.apply(useAssetLibraryStore.getState().definitions)
  apply()
  return useAssetLibraryStore.subscribe(apply)
}

export function registerMaterialLibrarySync(sync: MaterialLibrarySync): Unsubscribe {
  const apply = (): void => sync.apply(useMaterialLibraryStore.getState().definitions)
  apply()
  return useMaterialLibraryStore.subscribe(apply)
}
