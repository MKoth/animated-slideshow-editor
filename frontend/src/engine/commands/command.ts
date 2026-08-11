import type { Engine } from '../internal'

export interface Command<Inverse = unknown> {
  readonly type: string
  readonly parameters: Readonly<Record<string, unknown>>
  validate(engine: Engine): void
  execute(engine: Engine): Inverse
  toJSON(): Readonly<Record<string, unknown>>
}

export type CommandResult<Inverse = unknown> =
  { readonly ok: true; readonly inverse: Inverse } | { readonly ok: false; readonly error: Error }
