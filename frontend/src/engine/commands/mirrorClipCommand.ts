import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import { requireMirrorAxis, mirrorSkippedNotices } from '../clipMirror'
import type { MirrorAxis } from '../clipMirror'

export interface MirrorClipParameters {
  readonly sourceClipId: string
  readonly newName: string
  readonly axis: MirrorAxis
  readonly targetNodeId?: string
  readonly startTime?: number
}

export interface MirrorClipInverse {
  readonly newClipId: string
  readonly snapshot: unknown
  readonly skipped: readonly string[]
  readonly instanceId?: string
  readonly nodeId?: string
  readonly instanceSnapshot?: unknown
}

export class MirrorClipCommand implements Command<MirrorClipInverse> {
  readonly type = 'MirrorClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sourceClipId: string
  readonly #newName: string
  readonly #axis: MirrorAxis
  readonly #targetNodeId?: string
  readonly #startTime?: number

  constructor(input: MirrorClipParameters) {
    requireString(input.sourceClipId, 'sourceClipId')
    requireString(input.newName, 'newName')
    const axis = requireMirrorAxis(input.axis)
    if (input.targetNodeId !== undefined) requireString(input.targetNodeId, 'targetNodeId')
    if (input.startTime !== undefined) {
      requireFiniteNumber(input.startTime, 'startTime')
      if (input.startTime < 0) throw new Error('startTime must be non-negative')
    }
    this.#sourceClipId = input.sourceClipId
    this.#newName = input.newName
    this.#axis = axis
    this.#targetNodeId = input.targetNodeId
    this.#startTime = input.startTime
    this.parameters = {
      sourceClipId: input.sourceClipId,
      newName: input.newName,
      axis,
      ...(input.targetNodeId !== undefined ? { targetNodeId: input.targetNodeId } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    const source = engine.getClip(this.#sourceClipId)
    requireString(this.#newName, 'newName')
    if (this.#newName.trim() === '') throw new Error('newName must not be empty')
    requireMirrorAxis(this.#axis)
    // Circle/table lanes are skipped with a notice, never silently dropped;
    // surface the notice through the inverse payload for the confirm dialog.
    void source
    if (this.#targetNodeId !== undefined) {
      engine.getNode(this.#targetNodeId)
      if (this.#startTime !== undefined) {
        requireFiniteNumber(this.#startTime!, 'startTime')
        if (this.#startTime! < 0) throw new Error('startTime must be non-negative')
      }
    }
  }

  execute(engine: Engine): MirrorClipInverse {
    const mirrored = engine.createMirroredClip(this.#sourceClipId, this.#axis, this.#newName)
    const snapshot = mirrored.toJSON()
    const source = engine.getClip(this.#sourceClipId)
    // Same notices as the pure mirror module: only lanes holding keyframes.
    const skipped: string[] = [...mirrorSkippedNotices(source)]
    let instanceId: string | undefined
    let nodeId: string | undefined
    let instanceSnapshot: unknown | undefined
    if (this.#targetNodeId !== undefined) {
      const start = this.#startTime ?? 0
      const inst = engine.assignClipInstance(this.#targetNodeId, mirrored.id, start, 1, true, {})
      instanceId = inst.id
      nodeId = this.#targetNodeId
      instanceSnapshot = { ...inst }
    }
    return {
      newClipId: mirrored.id,
      snapshot,
      skipped,
      ...(instanceId ? { instanceId, nodeId, instanceSnapshot } : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
