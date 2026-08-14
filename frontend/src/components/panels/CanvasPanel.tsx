import { useEffect, useRef } from 'react'
import { useEngine } from '../../app/useEngine'
import { realPixi } from '../../pixi/renderer/pixi'
import { Renderer } from '../../pixi/renderer/renderer'
import type { CurrentTimeSource } from '../../pixi/renderer/sceneRenderer'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../../stores/missingAssetsStore'
import { usePlaybackController } from '../../stores/playbackStore'

export function CanvasPanel() {
  const { engine, dispatch } = useEngine()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const resolveAssetUrl = (definitionId: string): string | null => {
      const definition = useAssetLibraryStore
        .getState()
        .definitions.find((entry) => entry.id === definitionId)
      return definition?.original_url ?? null
    }
    const isAssetMissing = (definitionId: string): boolean => {
      const report = useMissingAssetsStore.getState().report
      return report?.missing.some((entry) => entry.assetDefinitionId === definitionId) ?? false
    }
    const currentTime: CurrentTimeSource = {
      getTime: (slideId) => usePlaybackController.getState().getTime(slideId),
      subscribe: (listener) => usePlaybackController.subscribe(listener),
    }
    const renderer = new Renderer(
      host,
      engine,
      dispatch,
      realPixi,
      resolveAssetUrl,
      currentTime,
      isAssetMissing,
    )
    let knownDefinitions = useAssetLibraryStore.getState().definitions
    const unsubscribeLibrary = useAssetLibraryStore.subscribe((state) => {
      if (state.definitions !== knownDefinitions) {
        knownDefinitions = state.definitions
        renderer.refreshAssetTextures()
      }
    })
    void renderer.start()
    return () => {
      unsubscribeLibrary()
      renderer.dispose()
    }
  }, [engine, dispatch])

  return (
    <div className="canvas-panel">
      <div className="canvas-host" ref={hostRef} />
    </div>
  )
}
