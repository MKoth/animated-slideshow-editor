import type { AssetLibrarySync } from '../engine/assetLibrarySync'
import type { MaterialLibrarySync } from '../engine/materialLibrarySync'
import type { ShaderLibrarySync } from '../engine/shaderLibrarySync'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'

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

export function registerShaderLibrarySync(sync: ShaderLibrarySync): Unsubscribe {
  const apply = (): void => sync.apply(useShaderLibraryStore.getState().definitions)
  apply()
  return useShaderLibraryStore.subscribe(apply)
}
