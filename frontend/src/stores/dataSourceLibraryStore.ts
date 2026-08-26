import { create } from 'zustand'
import type { EmbeddedDataSourceUnion } from '../engine/project'
import { DataSourceDefinition, type DataPoint } from '../engine/dataSourceDefinition'
import { uniqueNodeName } from '../engine/naming'
import { libraryEventBus } from './libraryEvents'

type Engine = {
  readonly embedDataSource: (definition: EmbeddedDataSourceUnion) => void
  readonly removeDataSource: (id: string) => boolean
}

function embeddedToDefinition(embedded: EmbeddedDataSourceUnion): DataSourceDefinition {
  if ('nodes' in embedded) {
    throw new Error('FlowchartDataSourceDefinition not supported in panel yet')
  }
  return new DataSourceDefinition(
    embedded.id,
    embedded.name,
    embedded.dataPoints.map((p) => ({
      label: p.label,
      value: p.value,
      ...(p.series !== undefined ? { series: p.series } : {}),
      ...(p.tooltip !== undefined ? { tooltip: p.tooltip } : {}),
      ...(p.color !== undefined ? { color: p.color } : {}),
    })),
  )
}

function definitionToEmbedded(def: DataSourceDefinition): EmbeddedDataSourceUnion {
  return {
    id: def.id,
    name: def.name,
    dataPoints: def.dataPoints.map((p) => ({
      label: p.label,
      value: p.value,
      ...(p.series !== undefined ? { series: p.series } : {}),
      ...(p.tooltip !== undefined ? { tooltip: p.tooltip } : {}),
      ...(p.color !== undefined ? { color: p.color } : {}),
    })),
  }
}

interface DataSourceLibraryState {
  definitions: DataSourceDefinition[]
  selectedId: string | null
  loadFromEngine: (embeddedDataSources: readonly EmbeddedDataSourceUnion[]) => void
  selectDataSource: (id: string | null) => void
  createDataSource: (name: string) => DataSourceDefinition | null
  renameDataSource: (id: string, name: string) => void
  deleteDataSource: (id: string) => void
  duplicateDataSource: (sourceId: string, name: string) => DataSourceDefinition | null
  updateDataPoints: (id: string, dataPoints: readonly DataPoint[]) => void
}

let engineRef: Engine | null = null

function generateDataSourceId(): string {
  return `ds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function initDataSourceLibraryStore(engine: Engine): void {
  engineRef = engine
}

export const useDataSourceLibraryStore = create<DataSourceLibraryState>()((set, get) => ({
  definitions: [],
  selectedId: null,

  loadFromEngine: (embeddedDataSources) => {
    const definitions: DataSourceDefinition[] = []
    for (const embedded of embeddedDataSources) {
      if ('nodes' in embedded) {
        continue
      }
      try {
        definitions.push(embeddedToDefinition(embedded))
      } catch {
        // Skip invalid definitions
      }
    }
    set({ definitions })
  },

  selectDataSource: (id) => set({ selectedId: id }),

  createDataSource: (name) => {
    const { definitions } = get()
    const taken = new Set(definitions.map((d) => d.name))
    const uniqueName = uniqueNodeName(taken, name)
    const id = generateDataSourceId()
    const def = new DataSourceDefinition(id, uniqueName, [])
    engineRef?.embedDataSource(definitionToEmbedded(def))
    set((state) => ({ definitions: [def, ...state.definitions] }))
    libraryEventBus.emit({ type: 'DataSourceCreated', id: def.id, name: def.name })
    return def
  },

  renameDataSource: (id, name) => {
    const { definitions } = get()
    const existing = definitions.find((d) => d.id === id)
    if (!existing) return
    const def = new DataSourceDefinition(id, name, existing.dataPoints)
    engineRef?.embedDataSource(definitionToEmbedded(def))
    set((state) => ({
      definitions: state.definitions.map((d) => (d.id === id ? def : d)),
    }))
    libraryEventBus.emit({ type: 'DataSourceRenamed', id: def.id, name: def.name })
  },

  deleteDataSource: (id) => {
    const { definitions } = get()
    const existing = definitions.find((d) => d.id === id)
    if (!existing) return
    engineRef?.removeDataSource(id)
    set((state) => ({
      definitions: state.definitions.filter((d) => d.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    }))
    libraryEventBus.emit({ type: 'DataSourceRemoved', id })
  },

  duplicateDataSource: (sourceId, name) => {
    const { definitions } = get()
    const source = definitions.find((d) => d.id === sourceId)
    if (!source) return null
    const taken = new Set(definitions.map((d) => d.name))
    const uniqueName = uniqueNodeName(taken, name)
    const id = generateDataSourceId()
    const def = new DataSourceDefinition(id, uniqueName, source.dataPoints)
    engineRef?.embedDataSource(definitionToEmbedded(def))
    set((state) => ({ definitions: [def, ...state.definitions] }))
    libraryEventBus.emit({ type: 'DataSourceCreated', id: def.id, name: def.name })
    return def
  },

  updateDataPoints: (id, dataPoints) => {
    const { definitions } = get()
    const existing = definitions.find((d) => d.id === id)
    if (!existing) return
    const def = new DataSourceDefinition(id, existing.name, dataPoints)
    engineRef?.embedDataSource(definitionToEmbedded(def))
    set((state) => ({
      definitions: state.definitions.map((d) => (d.id === id ? def : d)),
    }))
    libraryEventBus.emit({ type: 'DataSourceUpdated', id: def.id, name: def.name })
  },
}))
