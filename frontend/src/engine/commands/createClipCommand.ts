import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber, requireString } from '../guards'
import type { ClipChannelDef, ClipParam } from '../clipDefinition'

export interface CreateClipParameters {
  readonly name: string
  readonly duration: number
  readonly category?: string
  readonly params?: readonly ClipParam[]
  readonly channels?: readonly ClipChannelDef[]
}

export interface CreateClipInverse {
  readonly clipId: string
}

export class CreateClipCommand implements Command<CreateClipInverse> {
  readonly type = 'CreateClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #name: string
  readonly #duration: number
  readonly #category: string
  readonly #params: readonly ClipParam[]
  readonly #channels: readonly ClipChannelDef[]

  constructor(input: CreateClipParameters) {
    this.#name = input.name
    this.#duration = input.duration
    this.#category = input.category ?? ''
    this.#params = input.params ?? []
    this.#channels = input.channels ?? []
    this.parameters = {
      name: input.name,
      duration: input.duration,
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.params !== undefined ? { params: input.params } : {}),
      ...(input.channels !== undefined ? { channels: input.channels } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    requireString(this.#name, 'Clip name')
    requireFiniteNumber(this.#duration, 'Clip duration')
    if (this.#duration < 0) {
      throw new Error('Clip duration must be non-negative')
    }
  }

  execute(engine: Engine): CreateClipInverse {
    const clip = engine.createClip(
      this.#name,
      this.#duration,
      this.#category,
      [...this.#params],
      [...this.#channels],
    )
    return { clipId: clip.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
