import type { Engine } from '../internal'
import type { Command } from './command'
import type { EmbeddedDataSourceDefinition } from '../embeddedDataSource'

export interface EmbedDataSourceParameters {
  readonly definition: EmbeddedDataSourceDefinition
}

export interface EmbedDataSourceInverse {
  readonly id: string
  /** The definition this command replaced, or null when the id was free. */
  readonly previous: EmbeddedDataSourceDefinition | null
}

/**
 * Upsert a flat data source definition into the project. Script `create data`
 * emits this inside the run Transaction, so one Undo removes a data source the
 * script minted; the inverse carries the replaced definition for hand-authored
 * sources the script overwrote.
 */
export class EmbedDataSourceCommand implements Command<EmbedDataSourceInverse> {
  readonly type = 'EmbedDataSource'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #definition: EmbeddedDataSourceDefinition

  constructor(input: EmbedDataSourceParameters) {
    if (typeof input.definition.id !== 'string' || input.definition.id === '') {
      throw new Error('Data source definition id must be a non-empty string')
    }
    if (typeof input.definition.name !== 'string' || input.definition.name === '') {
      throw new Error('Data source definition name must be a non-empty string')
    }
    this.#definition = {
      id: input.definition.id,
      name: input.definition.name,
      dataPoints: input.definition.dataPoints.map((point) => ({ ...point })),
    }
    this.parameters = { definition: this.#definition }
  }

  validate(): void {
    // Shape checked in the constructor; the engine tolerates any valid id.
  }

  execute(engine: Engine): EmbedDataSourceInverse {
    const existing = engine.embeddedDataSources.find(
      (definition) => definition.id === this.#definition.id,
    )
    const previous =
      existing !== undefined && 'dataPoints' in existing
        ? {
            id: existing.id,
            name: existing.name,
            dataPoints: existing.dataPoints.map((point) => ({ ...point })),
          }
        : null
    engine.embedDataSource(this.#definition)
    return { id: this.#definition.id, previous }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
