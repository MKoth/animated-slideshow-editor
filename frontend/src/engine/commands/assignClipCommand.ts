import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface AssignClipCommandParameters {
  readonly nodeId: string
  readonly clipId: string
  readonly startTime?: number
  readonly speed?: number
  readonly enabled?: boolean
  readonly paramOverrides?: Record<string, number>
}

export interface AssignClipCommandInverse {
  readonly nodeId: string
  readonly instanceId: string
}

export class AssignClipCommand implements Command<AssignClipCommandInverse> {
  readonly type = 'AssignClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #clipId: string
  readonly #startTime: number
  readonly #speed: number
  readonly #enabled: boolean
  readonly #paramOverrides: Record<string, number>

  constructor(input: AssignClipCommandParameters) {
    this.#nodeId = input.nodeId
    this.#clipId = input.clipId
    this.#startTime = input.startTime ?? 0
    this.#speed = input.speed ?? 1
    this.#enabled = input.enabled ?? true
    this.#paramOverrides = input.paramOverrides ? { ...input.paramOverrides } : {}
    this.parameters = {
      nodeId: input.nodeId,
      clipId: input.clipId,
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.speed !== undefined ? { speed: input.speed } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.paramOverrides !== undefined ? { paramOverrides: input.paramOverrides } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getClip(this.#clipId)
    requireFiniteNumber(this.#startTime, 'Start time')
    if (this.#startTime < 0) {
      throw new Error('Start time must be non-negative')
    }
    requireFiniteNumber(this.#speed, 'Speed')
    if (this.#speed < 0) {
      throw new Error('Speed must be non-negative')
    }
  }

  execute(engine: Engine): AssignClipCommandInverse {
    const instance = engine.assignClipInstance(
      this.#nodeId,
      this.#clipId,
      this.#startTime,
      this.#speed,
      this.#enabled,
      { ...this.#paramOverrides },
    )
    return { nodeId: this.#nodeId, instanceId: instance.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
