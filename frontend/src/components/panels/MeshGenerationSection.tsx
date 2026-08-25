import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnginePublic, SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { GenerateMeshCommand } from '../../engine/commands'
import type { MeshData } from '../../engine/mesh'
import { generateMesh } from '../../engine/meshGenerator'
import { loadImageDataFromAsset, hasTransparentPixels } from '../../engine/imageDataLoader'

const DEFAULT_DENSITY = 50

export function MeshGenerationSection({
  target,
  engine,
  dispatch,
  notify,
  playing,
}: {
  target: SceneNode
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}) {
  const [density, setDensity] = useState(DEFAULT_DENSITY)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const assetDefinitionId = target.components.assetInstance?.assetDefinitionId
  const embeddedAsset = assetDefinitionId ? engine.getEmbeddedAsset(assetDefinitionId) : undefined
  const hasMesh = Boolean(target.components.mesh)
  const supportsGeneration =
    embeddedAsset !== undefined && embeddedAsset.mimeType.startsWith('image/png')

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const fail = useCallback(
    (message: string) => {
      setError(message)
      notify(message)
    },
    [notify],
  )

  const handleGenerate = useCallback(async () => {
    if (!embeddedAsset) {
      notify('No embedded image available for mesh generation')
      return
    }

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    setGenerating(true)
    setError(null)

    try {
      const imageData = await loadImageDataFromAsset(embeddedAsset)
      if (controller.signal.aborted) return

      if (!hasTransparentPixels(imageData)) {
        notify('Image has no transparent pixels; mesh generation is not needed')
        setGenerating(false)
        return
      }

      const result = generateMesh({ imageData, density })
      if (controller.signal.aborted) return

      const meshData: MeshData = {
        vertices: result.vertices,
        faces: result.faces,
        uvs: result.uvs,
      }

      const commandResult = dispatch(new GenerateMeshCommand({ nodeId: target.id, mesh: meshData }))
      if (!commandResult.ok) {
        fail(commandResult.error.message)
      }
    } catch (err) {
      if (controller.signal.aborted) return
      fail(err instanceof Error ? err.message : String(err))
    } finally {
      if (!controller.signal.aborted) {
        setGenerating(false)
      }
    }
  }, [embeddedAsset, density, target.id, dispatch, notify, fail])

  if (!supportsGeneration) {
    return null
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Mesh Generation</h3>
      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="mesh-density">
          Density
        </label>
        <input
          id="mesh-density"
          className="inspector-field__input"
          type="range"
          min={0}
          max={100}
          step={1}
          value={density}
          disabled={playing || generating}
          onChange={(e) => setDensity(Number(e.target.value))}
        />
        <span className="inspector-field__value">{density}%</span>
      </div>
      {error && (
        <div className="inspector-section__notice" role="alert">
          {error}
        </div>
      )}
      <button
        className="inspector-reset"
        disabled={playing || generating}
        onClick={handleGenerate}
      >
        {generating ? 'Generating...' : hasMesh ? 'Regenerate' : 'Generate Mesh'}
      </button>
    </section>
  )
}
