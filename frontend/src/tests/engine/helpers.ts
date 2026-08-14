import type { EngineEvent } from '../../engine/events'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import type { Project } from '../../engine/project'

export function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
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
