// Baked Shape helper — snapshot current deformed pose (morph → symmetry → bones) as rest vertices
// Uses EvaluatedWorldTransformSource to include IK and constraints, matching sceneRenderer logic.

import type { EnginePublic } from './engine'
import type { MeshVertex } from './mesh'
import { EvaluatedWorldTransformSource } from './worldTransform'
import { walkPreOrder } from './sceneNode'

export function computeBakedVertices(
  engine: EnginePublic,
  nodeId: string,
  time: number,
): readonly MeshVertex[] | null {
  let slideId: string | null = null
  // Try getSlideOfNode if available (internal Engine has it, EnginePublic via cast)
  try {
    const withSlideOfNode = engine as unknown as { getSlideOfNode?: (id: string) => { id: string } }
    const maybeSlide = withSlideOfNode.getSlideOfNode?.(nodeId)
    if (maybeSlide?.id) slideId = maybeSlide.id
  } catch {
    // ignore
  }
  // Fallback: search all slides for node
  if (!slideId && engine.project) {
    for (const slide of engine.project.slides) {
      try {
        if (slide.scene.getNode(nodeId)) {
          slideId = slide.id
          break
        }
      } catch {
        // ignore
      }
    }
  }
  if (!slideId) {
    const active = engine.getActiveSlide()
    if (active) slideId = active.id
    else if (engine.project?.slides[0]) slideId = engine.project.slides[0].id
  }
  if (!slideId) return null

  let slide: { scene: import('./scene').Scene } | null = null
  try {
    slide = engine.getSlide(slideId)
  } catch {
    return null
  }
  if (!slide) return null

  const src = new EvaluatedWorldTransformSource(
    engine,
    () => time,
    new Map(),
    engine.getIKManager(),
    engine.getConstraintManager(),
  )
  src.updateIKOverrides(slideId, time)

  const boneMap = new Map<string, import('./worldTransform').WorldTransform>()
  for (const node of walkPreOrder(slide.scene.root)) {
    if (!node.components.bone) continue
    const wt = src.transformOf(node.id)
    if (wt) boneMap.set(node.id, wt)
  }
  const meshWorld = src.transformOf(nodeId) ?? undefined

  const result = engine.evaluateMeshDeformation(nodeId, time, boneMap, meshWorld)
  if (!result) return null
  return result.deformedVertices
}
