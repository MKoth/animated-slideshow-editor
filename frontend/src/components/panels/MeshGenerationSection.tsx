import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnginePublic, SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { GenerateMeshCommand } from '../../engine/commands'
import type { MeshData } from '../../engine/mesh'
import { generateMesh } from '../../engine/meshGenerator'
import type { MeshGeneratorInput } from '../../engine/meshGenerator'
import type { BoneSegment } from '../../engine/meshGenerator'
import { loadImageDataFromAsset, hasTransparentPixels } from '../../engine/imageDataLoader'
import { useMeshPreviewStore } from '../../stores/meshPreviewStore'
import { collectBones } from '../../engine/riggingQueries'

const DEFAULTS = {
  meshDensity: 30,
  boundarySpacing: 8,
  jointDensity: 2.0,
  jointRadius: 60,
  jointMinDist: 20,
  maxVertices: 300,
} as const

function collectBoneSegments(engine: EnginePublic): BoneSegment[] {
  const slide = engine.getActiveSlide()
  if (!slide) return []

  const sceneRoot = slide.scene.root

  const allBones = collectBones(sceneRoot)
  const segments: BoneSegment[] = []

  for (const bone of allBones) {
    const boneComponent = bone.components.bone
    if (!boneComponent) continue

    const tx = bone.transform.x
    const ty = bone.transform.y
    const rotation = (bone.transform.rotation * Math.PI) / 180
    const length = boneComponent.length

    const ex = tx + Math.cos(rotation) * length
    const ey = ty + Math.sin(rotation) * length

    segments.push({ sx: tx, sy: ty, ex, ey })
  }

  return segments
}

function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  unit,
  disabled,
  onChange,
  onPointerUp,
  onLostPointerCapture,
}: {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  disabled: boolean
  onChange: (value: number) => void
  onPointerUp?: () => void
  onLostPointerCapture?: () => void
}) {
  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="inspector-field__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onLostPointerCapture}
      />
      <span className="inspector-field__value">{unit ? `${value}${unit}` : value}</span>
    </div>
  )
}

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
  const [meshDensity, setMeshDensity] = useState<number>(DEFAULTS.meshDensity)
  const [boundarySpacing, setBoundarySpacing] = useState<number>(DEFAULTS.boundarySpacing)
  const [jointDensity, setJointDensity] = useState<number>(DEFAULTS.jointDensity)
  const [jointRadius, setJointRadius] = useState<number>(DEFAULTS.jointRadius)
  const [jointMinDist, setJointMinDist] = useState<number>(DEFAULTS.jointMinDist)
  const [maxVertices, setMaxVertices] = useState<number>(DEFAULTS.maxVertices)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const imageDataRef = useRef<ImageData | null>(null)

  const assetDefinitionId = target.components.assetInstance?.assetDefinitionId
  const embeddedAsset = assetDefinitionId ? engine.getEmbeddedAsset(assetDefinitionId) : undefined
  const hasMesh = Boolean(target.components.mesh)
  const supportsGeneration =
    embeddedAsset !== undefined && embeddedAsset.mimeType.startsWith('image/png')

  const boneSegments = useMemo(() => collectBoneSegments(engine), [engine])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      useMeshPreviewStore.getState().clearPreviewMesh()
    }
  }, [])

  useEffect(() => {
    imageDataRef.current = null
    if (!embeddedAsset) return
    let cancelled = false
    void loadImageDataFromAsset(embeddedAsset).then((data) => {
      if (!cancelled) {
        imageDataRef.current = data
      }
    })
    return () => {
      cancelled = true
    }
  }, [embeddedAsset])

  const fail = useCallback(
    (message: string) => {
      setError(message)
      notify(message)
    },
    [notify],
  )

  const clearPreview = useCallback(() => {
    useMeshPreviewStore.getState().clearPreviewMesh()
  }, [])

  const buildInput = useCallback(
    (
      density: number,
      bSpacing: number,
      jDensity: number,
      jRadius: number,
      jMinDist: number,
      maxV: number,
    ): MeshGeneratorInput | null => {
      if (!imageDataRef.current) return null
      return {
        imageData: imageDataRef.current,
        meshDensity: density,
        boundarySpacing: bSpacing,
        jointDensity: jDensity,
        jointRadius: jRadius,
        jointMinDist: jMinDist,
        maxVertices: maxV,
        bones: boneSegments.length > 0 ? boneSegments : undefined,
      }
    },
    [boneSegments],
  )

  const updatePreview = useCallback(
    (
      density: number,
      bSpacing: number,
      jDensity: number,
      jRadius: number,
      jMinDist: number,
      maxV: number,
    ) => {
      if (!hasMesh || !imageDataRef.current) return
      try {
        const input = buildInput(density, bSpacing, jDensity, jRadius, jMinDist, maxV)
        if (!input) return
        const result = generateMesh(input)
        const meshData: MeshData = {
          vertices: result.vertices,
          faces: result.faces,
          uvs: result.uvs,
        }
        useMeshPreviewStore.getState().setPreviewMesh(target.id, meshData)
      } catch (err) {
        useMeshPreviewStore.getState().clearPreviewMesh()
        fail(err instanceof Error ? err.message : String(err))
      }
    },
    [hasMesh, target.id, fail, buildInput],
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

      imageDataRef.current = imageData

      const input: MeshGeneratorInput = {
        imageData,
        meshDensity,
        boundarySpacing,
        jointDensity,
        jointRadius,
        jointMinDist,
        maxVertices,
        bones: boneSegments.length > 0 ? boneSegments : undefined,
      }

      const result = generateMesh(input)
      if (controller.signal.aborted) return

      const meshData: MeshData = {
        vertices: result.vertices,
        faces: result.faces,
        uvs: result.uvs,
      }

      useMeshPreviewStore.getState().clearPreviewMesh()
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
  }, [
    embeddedAsset,
    meshDensity,
    boundarySpacing,
    jointDensity,
    jointRadius,
    jointMinDist,
    maxVertices,
    boneSegments,
    target.id,
    dispatch,
    notify,
    fail,
  ])

  if (!supportsGeneration) {
    return null
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Mesh Generation</h3>

      <Slider
        id="mesh-density"
        label="Mesh Density"
        min={10}
        max={80}
        step={1}
        value={meshDensity}
        disabled={playing || generating}
        onChange={(v) => {
          setMeshDensity(v)
          updatePreview(v, boundarySpacing, jointDensity, jointRadius, jointMinDist, maxVertices)
        }}
        onPointerUp={clearPreview}
        onLostPointerCapture={clearPreview}
      />

      <Slider
        id="boundary-spacing"
        label="Boundary Spacing"
        min={2}
        max={30}
        step={1}
        value={boundarySpacing}
        unit="px"
        disabled={playing || generating}
        onChange={(v) => {
          setBoundarySpacing(v)
          updatePreview(meshDensity, v, jointDensity, jointRadius, jointMinDist, maxVertices)
        }}
      />

      <Slider
        id="joint-density"
        label="Joint Density"
        min={1.0}
        max={5.0}
        step={0.1}
        value={jointDensity}
        disabled={playing || generating}
        onChange={(v) => {
          setJointDensity(v)
          updatePreview(meshDensity, boundarySpacing, v, jointRadius, jointMinDist, maxVertices)
        }}
      />

      <Slider
        id="joint-radius"
        label="Joint Radius"
        min={10}
        max={150}
        step={1}
        value={jointRadius}
        unit="px"
        disabled={playing || generating}
        onChange={(v) => {
          setJointRadius(v)
          updatePreview(meshDensity, boundarySpacing, jointDensity, v, jointMinDist, maxVertices)
        }}
      />

      <Slider
        id="joint-min-dist"
        label="Joint Min Dist from Edge"
        min={5}
        max={80}
        step={1}
        value={jointMinDist}
        unit="px"
        disabled={playing || generating}
        onChange={(v) => {
          setJointMinDist(v)
          updatePreview(meshDensity, boundarySpacing, jointDensity, jointRadius, v, maxVertices)
        }}
      />

      <Slider
        id="max-vertices"
        label="Max Vertices"
        min={50}
        max={1000}
        step={50}
        value={maxVertices}
        disabled={playing || generating}
        onChange={(v) => {
          setMaxVertices(v)
          updatePreview(meshDensity, boundarySpacing, jointDensity, jointRadius, jointMinDist, v)
        }}
      />

      {error && (
        <div className="inspector-section__notice" role="alert">
          {error}
        </div>
      )}
      <button className="inspector-reset" disabled={playing || generating} onClick={handleGenerate}>
        {generating ? 'Generating...' : hasMesh ? 'Regenerate' : 'Generate Mesh'}
      </button>
    </section>
  )
}
