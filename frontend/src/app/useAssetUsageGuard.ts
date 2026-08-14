import { useEffect } from 'react'
import type { EnginePublic } from '../engine'
import { countAssetUsage } from '../engine'
import { registerAssetUsageCounter } from '../stores/assetLibraryStore'

export function useAssetUsageGuard(engine: EnginePublic): void {
  useEffect(
    () =>
      registerAssetUsageCounter((assetId) => {
        const project = engine.project
        return project ? countAssetUsage(project, assetId) : 0
      }),
    [engine],
  )
}
