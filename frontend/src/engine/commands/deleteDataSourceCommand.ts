import type { Engine } from '../internal'
import type { Command } from './command'
import type { EmbeddedDataSourceDefinition } from '../embeddedDataSource'

export interface DeleteDataSourceParameters {
  readonly dataSourceId: string
}

export interface DeleteDataSourceInverse {
  readonly dataSourceId: string
  readonly definition: EmbeddedDataSourceDefinition
}

/**
 * Remove a flat data source definition from the project. The Animation Script
 * clear path uses it to replace data sources a previous run minted; the
 * inverse carries the definition so Undo restores it verbatim.
 */
export class DeleteDataSourceCommand implements Command<DeleteDataSourceInverse> {
  readonly type = 'DeleteDataSource'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #dataSourceId: string

  constructor(input: DeleteDataSourceParameters) {
    if (typeof input.dataSourceId !== 'string' || input.dataSourceId === '') {
      throw new Error('Data source id must be a non-empty string')
    }
    this.#dataSourceId = input.dataSourceId
    this.parameters = { dataSourceId: input.dataSourceId }
  }

  validate(engine: Engine): void {
    const existing = engine.embeddedDataSources.find(
      (definition) => definition.id === this.#dataSourceId,
    )
    if (existing === undefined) {
      throw new Error(`Data source not found: ${this.#dataSourceId}`)
    }
    if (!('dataPoints' in existing)) {
      throw new Error(`Data source "${this.#dataSourceId}" is a flowchart definition`)
    }
  }

  execute(engine: Engine): DeleteDataSourceInverse {
    const existing = engine.embeddedDataSources.find(
      (definition) => definition.id === this.#dataSourceId,
    )
    if (existing === undefined || !('dataPoints' in existing)) {
      throw new Error(`Data source not found: ${this.#dataSourceId}`)
    }
    const definition: EmbeddedDataSourceDefinition = {
      id: existing.id,
      name: existing.name,
      dataPoints: existing.dataPoints.map((point) => ({ ...point })),
    }
    engine.removeDataSource(this.#dataSourceId)
    return { dataSourceId: this.#dataSourceId, definition }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
