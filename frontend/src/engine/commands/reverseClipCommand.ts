import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'

export interface ReverseClipParameters {
  readonly sourceClipId: string
  readonly newName: string
  readonly targetNodeId?: string
  readonly startTime?: number
}

export interface ReverseClipInverse {
  readonly newClipId: string
  readonly snapshot: unknown
  readonly instanceId?: string
  readonly nodeId?: string
  readonly instanceSnapshot?: unknown
}

export class ReverseClipCommand implements Command<ReverseClipInverse> {
  readonly type = 'ReverseClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sourceClipId: string
  readonly #newName: string
  readonly #targetNodeId?: string
  readonly #startTime?: number

  constructor(input: ReverseClipParameters) {
    requireString(input.sourceClipId, 'sourceClipId')
    requireString(input.newName, 'newName')
    if (input.targetNodeId !== undefined) requireString(input.targetNodeId, 'targetNodeId')
    if (input.startTime !== undefined) {
      requireFiniteNumber(input.startTime, 'startTime')
      if (input.startTime < 0) throw new Error('startTime must be non-negative')
    }
    this.#sourceClipId = input.sourceClipId
    this.#newName = input.newName
    this.#targetNodeId = input.targetNodeId
    this.#startTime = input.startTime
    this.parameters = {
      sourceClipId: input.sourceClipId,
      newName: input.newName,
      ...(input.targetNodeId !== undefined ? { targetNodeId: input.targetNodeId } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    const source = engine.getClip(this.#sourceClipId)
    requireString(this.#newName, 'newName')
    if (this.#newName.trim() === '') throw new Error('newName must not be empty')
    // Check duplicate name? Not required, but allow
    void source
    if (this.#targetNodeId !== undefined) {
      engine.getNode(this.#targetNodeId)
      if (this.#startTime !== undefined) {
        requireFiniteNumber(this.#startTime!, 'startTime')
        if (this.#startTime! < 0) throw new Error('startTime must be non-negative')
      }
    }
  }

  execute(engine: Engine): ReverseClipInverse {
    const reversed = engine.createReversedClip(this.#sourceClipId, this.#newName)
    const snapshot = reversed.toJSON()
    let instanceId: string | undefined
    let nodeId: string | undefined
    let instanceSnapshot: unknown | undefined
    if (this.#targetNodeId !== undefined) {
      const start = this.#startTime ?? 0
      const inst = engine.assignClipInstance(this.#targetNodeId, reversed.id, start, 1, true, {})
      instanceId = inst.id
      nodeId = this.#targetNodeId
      instanceSnapshot = { ...inst }
    }
    return {
      newClipId: reversed.id,
      snapshot,
      ...(instanceId ? { instanceId, nodeId, instanceSnapshot } : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
