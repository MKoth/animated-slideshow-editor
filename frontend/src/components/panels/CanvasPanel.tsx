import { useEffect, useRef } from 'react'
import { useEngine } from '../../app/useEngine'
import { Renderer } from '../../pixi/renderer/renderer'

export function CanvasPanel() {
  const { engine, dispatch } = useEngine()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const renderer = new Renderer(host, engine, dispatch)
    void renderer.start()
    return () => renderer.dispose()
  }, [engine, dispatch])

  return (
    <div className="canvas-panel">
      <div className="canvas-host" ref={hostRef} />
    </div>
  )
}
