import type { EngineEvent } from '../../engine/events'
import type { Engine } from '../../engine/engine'

export function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}
