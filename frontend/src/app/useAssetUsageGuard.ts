import { useEffect } from 'react'
import type { EngineReadOnly } from '../engine'
import { countAssetUsage } from '../engine'
import { registerAssetUsageCounter } from '../stores/assetLibraryStore'

export function useAssetUsageGuard(engine: EngineReadOnly): void {
  useEffect(
    () =>
      registerAssetUsageCounter((assetId) => {
        const project = engine.project
        return project ? countAssetUsage(project, assetId) : 0
      }),
    [engine],
  )
}
