import { useMemo } from 'react'
import { createIsolatedPreviewEngine, type EnginePublic } from '../../engine'
import {
  applyAnimationAssetOperations,
  type AnimationAssetOperation,
} from '../../ai/animationAssetOperations'
import type { LessonJSON, NodeJSON } from '../../engine/json'
import { CollectionSilhouettePreview } from '../panels/CollectionSilhouettePreview'

interface AiAnimationAssetPreviewProps {
  engine: EnginePublic
  operations: readonly AnimationAssetOperation[]
  revision: string
}

interface CollectionPreviewTarget {
  id: string
  parentNodeId: string
  name: string
}

interface DeleteImpact {
  readonly label: string
  readonly dependents: readonly string[]
}

function nodeById(lesson: LessonJSON, nodeId: string): NodeJSON | undefined {
  for (const slide of lesson.slides) {
    const node = slide.scene.nodes.find((entry) => entry.id === nodeId)
    if (node) return node
  }
  return undefined
}

function rootOf(lesson: LessonJSON, nodeId: string): string {
  const byId = new Map(
    lesson.slides.flatMap((slide) => slide.scene.nodes.map((node) => [node.id, node] as const)),
  )
  let current = byId.get(nodeId)
  while (current?.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || parent.parentId === null) break
    current = parent
  }
  return current?.id ?? nodeId
}

function shapePaths(
  vertices: readonly { x: number; y: number }[],
  faces: readonly { v0: number; v1: number; v2: number }[],
): string[] {
  if (faces.length > 0) {
    return faces.flatMap((face) => {
      const points = [vertices[face.v0], vertices[face.v1], vertices[face.v2]]
      if (points.some((point) => !point)) return []
      return [`M ${points.map((point) => `${point?.x} ${point?.y}`).join(' L ')} Z`]
    })
  }
  if (vertices.length < 3) return []
  return [`M ${vertices.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`]
}

function viewBoxFor(vertices: readonly { x: number; y: number }[]): string {
  if (vertices.length === 0) return '0 0 1 1'
  const xs = vertices.map((point) => point.x)
  const ys = vertices.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padding = Math.max(maxX - minX, maxY - minY, 1) * 0.1
  return `${minX - padding} ${minY - padding} ${Math.max(maxX - minX, 1) + padding * 2} ${Math.max(maxY - minY, 1) + padding * 2}`
}

export function AiAnimationAssetPreview({
  engine,
  operations,
  revision,
}: AiAnimationAssetPreviewProps) {
  const draft = useMemo(() => {
    try {
      let candidate = applyAnimationAssetOperations(engine.toJSON(), operations)
      const previews: CollectionPreviewTarget[] = []
      for (const operation of operations) {
        if (operation.kind === 'upsertCollection') {
          if (operation.collection.sourceNodeId) {
            previews.push({
              id: operation.collection.id,
              name: operation.collection.name,
              parentNodeId: operation.collection.sourceNodeId,
            })
          }
        } else if (operation.kind === 'upsertClip' && operation.nodeId) {
          const node = nodeById(candidate, operation.nodeId)
          if (!node?.semanticName) continue
          const parentNodeId = rootOf(candidate, operation.nodeId)
          const previewId = `ai-preview-collection-${operation.clip.id}`
          candidate = applyAnimationAssetOperations(candidate, [
            {
              kind: 'upsertCollection',
              action: 'create',
              collection: {
                id: previewId,
                name: `AI preview ${operation.clip.id}`,
                bindings: { [node.semanticName]: operation.clip.id },
                sourceNodeId: parentNodeId,
              },
            },
          ])
          previews.push({ id: previewId, name: operation.clip.name, parentNodeId })
        }
      }
      return { engine: createIsolatedPreviewEngine(candidate), previews, error: null, revision }
    } catch (error) {
      return {
        engine: null,
        previews: [],
        error: error instanceof Error ? error.message : 'Could not build the isolated preview.',
        revision,
      }
    }
  }, [engine, operations, revision])

  const shapes = operations.filter(
    (operation): operation is Extract<AnimationAssetOperation, { kind: 'upsertShape' }> =>
      operation.kind === 'upsertShape',
  )
  const hasAnimationPreview = operations.some(
    (operation) => operation.kind === 'upsertCollection' || operation.kind === 'upsertClip',
  )
  const deleteImpacts: DeleteImpact[] = operations.flatMap((operation) => {
    if (operation.kind === 'deleteClip') {
      const clip = engine.clips.find((entry) => entry.id === operation.clipId)
      const dependents = engine.clipCollections
        .filter((collection) =>
          Object.values(collection.getBindingsObject()).includes(operation.clipId),
        )
        .map((collection) => `Clip Collection “${collection.name}”`)
      for (const slide of engine.project?.slides ?? []) {
        const visit = (nodeId: string): void => {
          const node = engine.getNode(nodeId)
          for (const instance of engine.getClipInstances(nodeId)) {
            if (instance.clipId === operation.clipId) {
              dependents.push(`Clip Instance ${instance.id} on “${node.name}”`)
            }
          }
          for (const child of node.children) visit(child.id)
        }
        visit(slide.scene.root.id)
      }
      return [{ label: `Clip “${clip?.name ?? operation.clipId}”`, dependents }]
    }
    if (operation.kind === 'deleteShape') {
      const shape = engine
        .getShapes(operation.nodeId)
        .find((entry) => entry.id === operation.shapeId)
      const dependents: string[] = []
      const binding = engine.getMorphBinding(operation.nodeId)
      if (binding?.fromShapeId === operation.shapeId || binding?.toShapeId === operation.shapeId) {
        dependents.push('the current morph binding on this node')
      }
      if (shape) {
        for (const clip of engine.clips) {
          const referenced = clip.getMorphKeyframes().some((keyframe) => {
            const value = keyframe.value as { fromShapeName?: unknown; toShapeName?: unknown }
            return value.fromShapeName === shape.name || value.toShapeName === shape.name
          })
          if (referenced) dependents.push(`Clip “${clip.name}” morph keyframes`)
        }
      }
      return [{ label: `Shape “${shape?.name ?? operation.shapeId}”`, dependents }]
    }
    if (operation.kind === 'deleteClipInstance') {
      let instanceName = operation.instanceId
      try {
        const instance = engine
          .getClipInstances(operation.nodeId)
          .find((entry) => entry.id === operation.instanceId)
        if (instance) instanceName = engine.getClip(instance.clipId).name
      } catch {
        // A stale reference is reported by dry-run validation.
      }
      return [{ label: `Clip Instance “${instanceName}” on ${operation.nodeId}`, dependents: [] }]
    }
    if (operation.kind === 'deleteCollection') {
      const collection = engine.clipCollections.find((entry) => entry.id === operation.collectionId)
      const dependents: string[] = []
      for (const slide of engine.project?.slides ?? []) {
        const visit = (nodeId: string): void => {
          const node = engine.getNode(nodeId)
          if (
            engine
              .getCollectionPlacements(nodeId)
              .some((placement) => placement.collectionId === operation.collectionId)
          ) {
            dependents.push(`placed on “${node.name}”`)
          }
          for (const instance of engine.getClipInstances(nodeId)) {
            if (instance.collectionId === operation.collectionId && !instance.placementId) {
              dependents.push(`applied Clip Instance ${instance.id} on “${node.name}”`)
            }
          }
          for (const child of node.children) visit(child.id)
        }
        visit(slide.scene.root.id)
      }
      return [
        { label: `Clip Collection “${collection?.name ?? operation.collectionId}”`, dependents },
      ]
    }
    return []
  })

  return (
    <div data-testid="ai-animation-asset-preview" className="ai-animation-asset-preview">
      <strong>Draft preview — isolated from the live project</strong>
      {shapes.map((operation) => (
        <div key={operation.shape.id} data-testid={`ai-shape-asset-preview-${operation.shape.id}`}>
          {(() => {
            let faces: readonly { v0: number; v1: number; v2: number }[] = []
            let sourceVertices: readonly { x: number; y: number }[] = []
            try {
              faces = engine.getNode(operation.nodeId).components.mesh?.mesh.faces ?? []
              const sourceId = operation.sourceShapeId ?? operation.targetId
              if (sourceId) {
                sourceVertices =
                  engine.getShapes(operation.nodeId).find((shape) => shape.id === sourceId)
                    ?.vertices ?? []
              }
            } catch {
              // Stale targets remain visible in the proposal card and fail dry-run.
            }
            return (
              <>
                <div>
                  {operation.shape.name} on {operation.nodeId} · {operation.shape.vertices.length}{' '}
                  vertices
                </div>
                <svg
                  width="220"
                  height="140"
                  viewBox={viewBoxFor(operation.shape.vertices)}
                  role="img"
                  aria-label={`${operation.shape.name} draft shape`}
                >
                  {shapePaths(operation.shape.vertices, faces).map((path, index) => (
                    <path
                      key={index}
                      d={path}
                      fill="currentColor"
                      fillOpacity="0.42"
                      stroke="currentColor"
                      strokeWidth="0.6"
                    />
                  ))}
                  {sourceVertices.length > 0 &&
                    shapePaths(sourceVertices, faces).map((path, index) => (
                      <path
                        key={`source-${index}`}
                        d={path}
                        fill="none"
                        stroke="currentColor"
                        strokeDasharray="2 2"
                        strokeWidth="0.8"
                        opacity="0.55"
                      />
                    ))}
                </svg>
                <div>
                  {sourceVertices.length > 0
                    ? `Dashed outline: source Shape ${operation.sourceShapeId ?? operation.targetId}; solid mesh: proposed Shape. Live geometry remains unchanged until approval.`
                    : 'The live Shape remains unchanged until approval.'}
                </div>
              </>
            )
          })()}
        </div>
      ))}
      {deleteImpacts.map((impact, index) => (
        <div key={`${impact.label}-${index}`} data-testid={`ai-animation-asset-delete-${index}`}>
          Delete target: {impact.label}
          {impact.dependents.length > 0 ? (
            <div>References that may be affected: {impact.dependents.join('; ')}</div>
          ) : (
            <div>No dependent animation assets found.</div>
          )}
          <div>
            {impact.label.startsWith('Clip Collection')
              ? 'Existing placements follow regular collection-delete behavior: placement links are removed and their Clip Instances remain as manual clips.'
              : 'Only the listed, explicitly approved delete operations will be removed.'}
          </div>
        </div>
      ))}
      {hasAnimationPreview && draft.error && (
        <div role="alert">Visual preview unavailable: {draft.error}</div>
      )}
      {draft.engine &&
        draft.previews.map((preview) => (
          <div
            key={`${preview.id}-${revision}`}
            data-testid={`ai-animation-asset-preview-${preview.id}`}
          >
            <div>{preview.name} · step-by-step motion preview</div>
            <CollectionSilhouettePreview
              engine={draft.engine as EnginePublic}
              collectionId={preview.id}
              parentNodeId={preview.parentNodeId}
              revision={revision.length}
            />
          </div>
        ))}
      {hasAnimationPreview && draft.previews.length === 0 && !draft.error && (
        <div>
          Motion preview needs a source rig/parent with Semantic Names matching the Collection
          bindings.
        </div>
      )}
    </div>
  )
}
