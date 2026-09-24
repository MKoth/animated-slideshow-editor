import type { EngineEvent } from '../../engine/events'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import type { ClipDefinition } from '../../engine/clipDefinition'
import { Keyframe } from '../../engine/keyframe'
import type { Project } from '../../engine/project'

export function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

/** A `duration: 1` control clip driving `positionX` from `from` at u=0 to `to` at u=1. */
export function createControlClip(
  engine: Engine,
  name: string,
  from: number,
  to: number,
): ClipDefinition {
  const clip = engine.createClip(name, 1, 'control', [], [{ property: 'positionX' }])
  clip.addChannelKeyframe('positionX', new Keyframe(`${name}-start`, 0, from))
  clip.addChannelKeyframe('positionX', new Keyframe(`${name}-end`, 1, to))
  return clip
}

export function makeProject(name: string, slideNames: readonly string[] = []): Project {
  const engine = createEngine()
  engine.createProject({ name })
  for (const slideName of slideNames) {
    engine.createSlide(slideName)
  }
  if (!engine.project) {
    throw new Error('expected a project')
  }
  return engine.project
}

export interface PlacedAsset {
  readonly nodeId: string
  readonly definitionId: string
}

export function makeProjectWithAssets(
  name: string,
  placements: ReadonlyArray<{ readonly name: string; readonly definitionId: string }>,
): { project: Project; placed: PlacedAsset[] } {
  const engine = createEngine()
  engine.createProject({ name })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const placed: PlacedAsset[] = []
  for (const placement of placements) {
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, placement.name, {
      components: {
        assetInstance: { kind: 'assetInstance', assetDefinitionId: placement.definitionId },
      },
    })
    placed.push({ nodeId: node.id, definitionId: placement.definitionId })
  }
  if (!engine.project) {
    throw new Error('Project was not created')
  }
  return { project: engine.project, placed }
}
