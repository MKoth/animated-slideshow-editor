import type { AssetLibrarySync } from '../engine/assetLibrarySync'
import type { MaterialLibrarySync } from '../engine/materialLibrarySync'
import type { ShaderLibrarySync } from '../engine/shaderLibrarySync'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { libraryEventBus } from '../stores/libraryEvents'
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

/**
 * Shader default-uniform edits flow into materials that reference the shader
 * (the backend re-seeds their parameter lists); the material store refreshes
 * from the library and emits MaterialUpdated for every changed definition.
 */
export function registerMaterialUniformPropagation(): Unsubscribe {
  return libraryEventBus.subscribe((event) => {
    if (event.type === 'ShaderUpdated') {
      void useMaterialLibraryStore.getState().refreshAfterShaderUniformUpdate()
    }
  })
}
