import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipLibraryEntry } from '../../api'
import type { LibraryClipInput } from '../clipDefinition'

export interface ImportClipParameters {
  readonly entry: ClipLibraryEntry
}

export interface ImportClipInverse {
  readonly clipId: string
}

function toLibraryClipInput(entry: ClipLibraryEntry): LibraryClipInput {
  return {
    name: entry.name,
    duration: entry.duration,
    category: entry.category,
    params: entry.params.map((p) => ({ ...p })),
    channels: entry.channels.map((ch) => ({
      property: ch.property as LibraryClipInput['channels'][number]['property'],
      ...(ch.paramKey !== undefined ? { paramKey: ch.paramKey } : {}),
      ...(ch.linkMode !== undefined ? { linkMode: ch.linkMode as 'gain' | 'offset' } : {}),
    })),
    channelAnimations: entry.channelAnimations,
  }
}

export class ImportClipCommand implements Command<ImportClipInverse> {
  readonly type = 'ImportClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #entry: ClipLibraryEntry

  constructor(input: ImportClipParameters) {
    this.#entry = input.entry
    this.parameters = { clipId: this.#entry.id, name: this.#entry.name }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
  }

  execute(engine: Engine): ImportClipInverse {
    const clip = engine.importClipFromLibrary(toLibraryClipInput(this.#entry))
    return { clipId: clip.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
