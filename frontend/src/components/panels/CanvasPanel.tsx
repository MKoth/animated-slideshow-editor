import { useEffect, useRef } from 'react'
import { captureAssetSnapshot, embeddedDataUrl } from '../../app/assetSnapshot'
import { useEngine } from '../../app/useEngine'
import { realPixi } from '../../pixi/renderer/pixi'
import { Renderer } from '../../pixi/renderer/renderer'
import type { CurrentTimeSource } from '../../pixi/renderer/sceneRenderer'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore'
import { useMissingAssetsStore } from '../../stores/missingAssetsStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useShaderLibraryStore } from '../../stores/shaderLibraryStore'
import { CanvasToolbar } from '../editor/CanvasToolbar'
import { WeightPaintToolbar } from '../editor/WeightPaintToolbar'

export function CanvasPanel() {
  const { engine, dispatch } = useEngine()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const resolveAssetUrl = (definitionId: string): string | null => {
      const embedded = engine.getEmbeddedAsset(definitionId)
      if (embedded) {
        return embeddedDataUrl(embedded)
      }
      const definition = useAssetLibraryStore
        .getState()
        .definitions.find((entry) => entry.id === definitionId)
      const url = definition?.original_url ?? null
      if (url) {
        void captureAssetSnapshot(engine, definitionId)
      }
      return url
    }
    const resolveShaderSource = (shaderId: string): string | null => {
      const state = useShaderLibraryStore.getState()
      const compiled = state.compileStatus[shaderId]?.status === 'Compiled'
      if (!compiled) {
        return null
      }
      return state.definitions.find((definition) => definition.id === shaderId)?.source ?? null
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
      undefined,
      (definitionId) => {
        void captureAssetSnapshot(engine, definitionId)
      },
      resolveShaderSource,
    )
    let knownDefinitions = useAssetLibraryStore.getState().definitions
    const unsubscribeLibrary = useAssetLibraryStore.subscribe((state) => {
      if (state.definitions !== knownDefinitions) {
        knownDefinitions = state.definitions
        renderer.refreshAssetTextures()
      }
    })
    let knownShaders = useShaderLibraryStore.getState().definitions
    let knownCompileStatus = useShaderLibraryStore.getState().compileStatus
    const unsubscribeShaders = useShaderLibraryStore.subscribe((state) => {
      if (state.definitions !== knownShaders || state.compileStatus !== knownCompileStatus) {
        knownShaders = state.definitions
        knownCompileStatus = state.compileStatus
        renderer.refreshNodeRendering()
      }
    })
    let knownMaterials = useMaterialLibraryStore.getState().definitions
    const unsubscribeMaterials = useMaterialLibraryStore.subscribe((state) => {
      if (state.definitions !== knownMaterials) {
        knownMaterials = state.definitions
        renderer.refreshNodeRendering()
      }
    })
    void renderer.start()
    return () => {
      unsubscribeLibrary()
      unsubscribeShaders()
      unsubscribeMaterials()
      renderer.dispose()
    }
  }, [engine, dispatch])

  return (
    <div className="canvas-panel">
      <div className="canvas-host" ref={hostRef} />
      <CanvasToolbar />
      <WeightPaintToolbar />
    </div>
  )
}
