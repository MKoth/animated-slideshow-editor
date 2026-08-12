import { useEffect, useRef } from 'react'
import { useEngine } from '../../app/useEngine'
import { realPixi } from '../../pixi/renderer/pixi'
import { Renderer } from '../../pixi/renderer/renderer'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'

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
    const renderer = new Renderer(host, engine, dispatch, realPixi, resolveAssetUrl)
    void renderer.start()
    return () => renderer.dispose()
  }, [engine, dispatch])

  return (
    <div className="canvas-panel">
      <div className="canvas-host" ref={hostRef} />
    </div>
  )
}
