import { useMemo, useState } from 'react'
import { createAnimationScriptPreview, type EnginePublic } from '../../engine'
import { EvaluatedWorldTransformSource } from '../../engine/worldTransform'
import { deformedMeshWorldVertices } from '../../pixi/renderer/deformedMeshWorld'
import type { MeshVertex } from '../../engine/mesh'

interface SceneFrame {
  readonly time: number
  readonly viewBox: string
  readonly paths: readonly string[]
}

interface AiAnimationScriptPreviewProps {
  engine: EnginePublic
  slideId: string
  source: string
  revision: string
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function viewBoxFor(bounds: Bounds): string {
  const width = Math.max(bounds.maxX - bounds.minX, 1)
  const height = Math.max(bounds.maxY - bounds.minY, 1)
  const padding = Math.max(width, height) * 0.08
  return `${bounds.minX - padding} ${bounds.minY - padding} ${width + padding * 2} ${height + padding * 2}`
}

function pathsFor(
  vertices: readonly MeshVertex[],
  faces: readonly { v0: number; v1: number; v2: number }[],
): string[] {
  return faces.flatMap((face) => {
    const points = [vertices[face.v0], vertices[face.v1], vertices[face.v2]]
    if (points.some((point) => !point)) return []
    return [`M ${points.map((point) => `${point?.x} ${point?.y}`).join(' L ')} Z`]
  })
}

function buildFrames(
  sourceEngine: EnginePublic,
  slideId: string,
  source: string,
  revision: string,
): { frames: SceneFrame[]; error: string | null; revision: string } {
  try {
    const built = createAnimationScriptPreview(sourceEngine.toJSON(), slideId, source)
    if (!built.engine) {
      return { frames: [], error: built.error ?? 'Could not build the scene preview.', revision }
    }
    const engine = built.engine
    const slide = engine.getSlide(slideId)
    const footprint = slide.animationScript?.lastCompiled
    const start = Math.max(0, footprint?.from ?? 0)
    const end = Math.min(slide.duration, Math.max(start, footprint?.to ?? slide.duration))
    const times = Array.from({ length: 5 }, (_, index) => start + ((end - start) * index) / 4)
    const nodes: {
      id: string
      mesh: NonNullable<ReturnType<typeof engine.getNode>['components']['mesh']>
    }[] = []
    const visit = (nodeId: string): void => {
      const node = engine.getNode(nodeId)
      if (node.components.mesh) nodes.push({ id: node.id, mesh: node.components.mesh })
      for (const child of node.children) visit(child.id)
    }
    visit(slide.scene.root.id)

    const frames = times.map((time) => {
      const paths: string[] = []
      const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      const transforms = new EvaluatedWorldTransformSource(
        engine,
        () => time,
        new Map(),
        engine.getIKManager(),
        engine.getConstraintManager(),
      )
      transforms.updateIKOverrides(slideId, time)
      for (const { id, mesh } of nodes) {
        if (!engine.evaluateVisible(id, time) || engine.evaluateNode(id, time).opacity <= 0)
          continue
        const world = transforms.transformOf(id)
        if (!world) continue
        const vertices = deformedMeshWorldVertices(
          mesh.mesh,
          slide.scene,
          world,
          (nodeId) => transforms.transformOf(nodeId),
          engine,
          id,
          time,
        )
        for (const point of vertices) {
          bounds.minX = Math.min(bounds.minX, point.x)
          bounds.minY = Math.min(bounds.minY, point.y)
          bounds.maxX = Math.max(bounds.maxX, point.x)
          bounds.maxY = Math.max(bounds.maxY, point.y)
        }
        paths.push(...pathsFor(vertices, mesh.mesh.faces))
      }
      return {
        time,
        paths,
        viewBox: Number.isFinite(bounds.minX) ? viewBoxFor(bounds) : '0 0 1 1',
      }
    })
    if (!frames.some((frame) => frame.paths.length > 0)) {
      return {
        frames,
        error: 'No visible mesh geometry was available to render in the scene preview.',
        revision,
      }
    }
    return { frames, error: null, revision }
  } catch (error) {
    return {
      frames: [],
      error:
        error instanceof Error ? error.message : 'Could not render this isolated scene preview.',
      revision,
    }
  }
}

export function AiAnimationScriptPreview({
  engine,
  slideId,
  source,
  revision,
}: AiAnimationScriptPreviewProps) {
  const preview = useMemo(
    () => buildFrames(engine, slideId, source, revision),
    [engine, slideId, source, revision],
  )
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null)
  const selected = selectedFrame === null ? null : preview.frames[selectedFrame]

  return (
    <div data-testid="ai-animation-script-preview">
      <strong>Isolated scene preview — no live Project changes</strong>
      {preview.error && <div role="alert">{preview.error}</div>}
      {preview.frames.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {preview.frames.map((frame, index) => (
            <button
              key={`${index}-${frame.time}`}
              type="button"
              data-testid={`ai-animation-script-preview-frame-${index}`}
              aria-label={`Inspect scene at ${frame.time.toFixed(2)} seconds`}
              onClick={() => setSelectedFrame(index)}
              style={{ width: 90, height: 74, padding: 4 }}
            >
              <svg width="100%" height="48" viewBox={frame.viewBox} aria-hidden="true">
                {frame.paths.map((path, pathIndex) => (
                  <path
                    key={pathIndex}
                    d={path}
                    fill="currentColor"
                    fillOpacity="0.35"
                    stroke="currentColor"
                    strokeWidth="0.6"
                  />
                ))}
              </svg>
              <span>{frame.time.toFixed(2)}s</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div role="dialog" aria-label={`Scene preview at ${selected.time.toFixed(2)} seconds`}>
          <button type="button" onClick={() => setSelectedFrame(null)}>
            Close preview
          </button>
          <svg width="100%" height="300" viewBox={selected.viewBox}>
            {selected.paths.map((path, index) => (
              <path
                key={index}
                d={path}
                fill="currentColor"
                fillOpacity="0.35"
                stroke="currentColor"
                strokeWidth="0.6"
              />
            ))}
          </svg>
          <div>{selected.time.toFixed(2)} seconds · scene mesh silhouettes</div>
        </div>
      )}
    </div>
  )
}
