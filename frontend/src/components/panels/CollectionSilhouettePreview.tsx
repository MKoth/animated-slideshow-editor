import { useEffect, useRef, useState } from 'react'
import type { EnginePublic } from '../../engine'
import { createEngine } from '../../engine'
import type { SceneNode } from '../../engine'
import type { MeshVertex } from '../../engine/mesh'
import { longestClipDuration } from '../../engine/collectionFlatten'
import {
  EvaluatedWorldTransformSource,
  localToWorldWithPivot,
  pivotOffsetAndSizeFor,
} from '../../engine/worldTransform'
import { deformedMeshWorldVertices } from '../../pixi/renderer/deformedMeshWorld'
import { getCachedCollectionSilhouettePreview } from './collectionSilhouetteCache'

interface CollectionSilhouettePreviewProps {
  engine: EnginePublic
  collectionId: string
  parentNodeId: string
  revision: number
}

interface SilhouetteFrame {
  readonly time: number
  readonly paths: readonly string[]
  readonly viewBox: string
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

const FRAME_COUNT = 5

function descendantsOf(engine: EnginePublic, rootId: string) {
  const root = engine.getNode(rootId)
  const nodes: SceneNode[] = []
  const visit = (node: SceneNode) => {
    nodes.push(node)
    for (const child of node.children) visit(child)
  }
  visit(root)
  return nodes
}

function pointsPath(points: readonly MeshVertex[]): string {
  if (points.length < 3) return ''
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`
}

function facePaths(
  vertices: readonly MeshVertex[],
  faces: readonly { v0: number; v1: number; v2: number }[],
) {
  if (faces.length === 0) return [pointsPath(vertices)].filter(Boolean)
  return faces
    .map((face) => pointsPath([vertices[face.v0], vertices[face.v1], vertices[face.v2]]))
    .filter(Boolean)
}

function buildSilhouetteFrames(
  sourceEngine: EnginePublic,
  collectionId: string,
  parentNodeId: string,
): { frames: SilhouetteFrame[] } | null {
  try {
    const engine = createEngine()
    engine.restoreFromJSON(sourceEngine.toJSON())
    const collection = engine.getClipCollection(collectionId)
    const descendants = descendantsOf(engine, parentNodeId).filter(
      (node) => !!node.semanticName && collection.hasBinding(node.semanticName),
    )
    if (descendants.length === 0) return null

    const duration = longestClipDuration(engine, collectionId)
    const times = Array.from(
      { length: FRAME_COUNT },
      (_, index) => (duration * index) / (FRAME_COUNT - 1),
    )
    engine.applyClipCollection(collectionId, parentNodeId)

    const frames = times.map((time) => {
      const paths: string[] = []
      const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      const slide = engine.getActiveSlide()
      if (!slide) return { time, paths, viewBox: '0 0 1 1' }
      const transformSource = new EvaluatedWorldTransformSource(
        engine,
        () => time,
        new Map(),
        engine.getIKManager(),
        engine.getConstraintManager(),
      )
      transformSource.updateIKOverrides(slide.id, time)
      for (const node of descendants) {
        if (
          !engine.evaluateVisible(node.id, time) ||
          engine.evaluateNode(node.id, time).opacity <= 0
        )
          continue
        const world = transformSource.transformOf(node.id)
        if (!world) continue
        let vertices: readonly MeshVertex[] | null = null
        if (node.components.mesh) {
          vertices = deformedMeshWorldVertices(
            node.components.mesh.mesh,
            slide.scene,
            world,
            (id) => transformSource.transformOf(id),
            engine,
            node.id,
            time,
          )
        } else {
          const baked = engine.getBakedVertices(node.id, time)
          if (baked) {
            const pivotOffset = pivotOffsetAndSizeFor(baked, node)
            vertices = baked.map((point) =>
              localToWorldWithPivot(point.x, point.y, world, pivotOffset),
            )
          }
        }
        if (!vertices || vertices.length < 3) continue
        for (const point of vertices) {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
          bounds.minX = Math.min(bounds.minX, point.x)
          bounds.maxX = Math.max(bounds.maxX, point.x)
          bounds.minY = Math.min(bounds.minY, point.y)
          bounds.maxY = Math.max(bounds.maxY, point.y)
        }
        const faces = node.components.mesh?.mesh.faces ?? []
        paths.push(...facePaths(vertices, faces))
      }
      return {
        time,
        paths,
        viewBox: Number.isFinite(bounds.minX) ? viewBoxFor(bounds) : '0 0 1 1',
      }
    })

    if (!frames.some((frame) => frame.paths.length > 0)) return null
    return { frames }
  } catch {
    return null
  }
}

function cachedSilhouetteFrames(
  engine: EnginePublic,
  collectionId: string,
  parentNodeId: string,
): { frames: SilhouetteFrame[] } | null {
  const key = `${parentNodeId}\u0000${collectionId}`
  return getCachedCollectionSilhouettePreview(engine, key, () =>
    buildSilhouetteFrames(engine, collectionId, parentNodeId),
  )
}

export function CollectionSilhouettePreview({
  engine,
  collectionId,
  parentNodeId,
  revision,
}: CollectionSilhouettePreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null)
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ frames: SilhouetteFrame[] } | null>(null)
  const [previewReady, setPreviewReady] = useState(false)

  useEffect(() => {
    const element = previewRef.current
    if (!element) return
    let cancelled = false
    let observer: IntersectionObserver | null = null
    let timeoutHandle: number | null = null
    let idleHandle: number | null = null
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const calculate = () => {
      if (cancelled) return
      setPreview(cachedSilhouetteFrames(engine, collectionId, parentNodeId))
      setPreviewReady(true)
    }
    const scheduleCalculation = () => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(calculate, { timeout: 200 })
      } else {
        timeoutHandle = window.setTimeout(calculate, 0)
      }
    }

    setPreview(null)
    setPreviewReady(false)
    if (typeof IntersectionObserver === 'undefined') {
      scheduleCalculation()
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect()
            scheduleCalculation()
          }
        },
        { rootMargin: '120px 0px' },
      )
      observer.observe(element)
    }

    return () => {
      cancelled = true
      observer?.disconnect()
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle)
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
    }
  }, [engine, collectionId, parentNodeId, revision])

  if (!previewReady) {
    return (
      <div
        ref={previewRef}
        data-testid={`collection-silhouette-loading-${collectionId}`}
        style={{
          minHeight: 46,
          display: 'flex',
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--color-text-muted, #777)',
        }}
      >
        Pose preview loads when visible
      </div>
    )
  }
  if (!preview) {
    return (
      <div
        ref={previewRef}
        data-testid={`collection-silhouette-empty-${collectionId}`}
        style={{
          minHeight: 46,
          display: 'flex',
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--color-text-muted, #777)',
        }}
      >
        No previewable mesh silhouettes in this collection
      </div>
    )
  }

  const frame = selectedFrame === null ? null : preview.frames[selectedFrame]
  return (
    <div ref={previewRef} data-testid={`collection-silhouette-${collectionId}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #777)' }}>Pose steps</span>
        {preview.frames.map((pose, index) => (
          <button
            key={index}
            type="button"
            data-testid={`collection-silhouette-step-${collectionId}-${index}`}
            aria-label={`Inspect pose ${index + 1} at ${pose.time.toFixed(2)} seconds`}
            title={`${pose.time.toFixed(2)}s · click to inspect`}
            onClick={() => setSelectedFrame(index)}
            style={{
              width: 58,
              height: 42,
              padding: 3,
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 4,
              background: 'var(--color-bg, #fafafa)',
              cursor: 'pointer',
            }}
          >
            <svg width="100%" height="100%" viewBox={pose.viewBox} aria-hidden="true">
              {pose.paths.map((path, pathIndex) => (
                <path key={pathIndex} d={path} fill="currentColor" />
              ))}
            </svg>
            <span style={{ fontSize: 9, color: 'var(--color-text-muted, #666)' }}>
              {pose.time.toFixed(2)}s
            </span>
          </button>
        ))}
      </div>
      {frame && selectedFrame !== null && (
        <div
          role="dialog"
          aria-label={`Collection pose at ${frame.time.toFixed(2)} seconds`}
          data-testid={`collection-silhouette-detail-${collectionId}`}
          style={{
            position: 'relative',
            marginTop: 8,
            width: 260,
            height: 170,
            border: '1px solid var(--color-border, #ddd)',
            borderRadius: 5,
            background: 'var(--color-bg, #fafafa)',
            padding: 8,
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            aria-label="Close pose preview"
            onClick={() => setSelectedFrame(null)}
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
          <svg width="100%" height="calc(100% - 20px)" viewBox={frame.viewBox} aria-hidden="true">
            {frame.paths.map((path, pathIndex) => (
              <path key={pathIndex} d={path} fill="currentColor" />
            ))}
          </svg>
          <div style={{ textAlign: 'center', fontSize: 11 }}>{frame.time.toFixed(2)}s</div>
        </div>
      )}
    </div>
  )
}
