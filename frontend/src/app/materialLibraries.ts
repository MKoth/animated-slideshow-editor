import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'

/**
 * Load the material and shader libraries so their definitions register with
 * the engine (`registerMaterialLibrarySync` / `registerShaderLibrarySync`).
 * Panels normally trigger this on mount, but an Animation Script Check or Run
 * needs `material("Name")` to resolve without the Materials panel ever being
 * opened. Already-loaded and known-unavailable libraries are left alone.
 */
export async function ensureMaterialLibrariesLoaded(): Promise<void> {
  const pending: Promise<void>[] = []
  const materials = useMaterialLibraryStore.getState()
  if (!materials.loaded && !materials.unavailable) {
    pending.push(materials.loadLibrary())
  }
  const shaders = useShaderLibraryStore.getState()
  if (!shaders.loaded && !shaders.unavailable) {
    pending.push(shaders.loadLibrary())
  }
  await Promise.all(pending)
}
