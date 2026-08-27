import { useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { DataPoint } from '../../engine/dataSourceDefinition'
import { defaultChartComponent } from '../../engine/defaultChart'
import { defaultTableComponent } from '../../engine/defaultTable'
import { defaultTextComponent } from '../../engine/defaultText'
import { namesInTree, uniqueNodeName } from '../../engine/naming'
import { useSelectionStore } from '../../stores/selectionStore'
import { CreateNodeCommand } from '../../engine/commands'
import {
  useDataSourceLibraryStore,
  initDataSourceLibraryStore,
} from '../../stores/dataSourceLibraryStore'

interface DataPointRowProps {
  point: DataPoint
  onChange: (updated: DataPoint) => void
  onRemove: () => void
}

function DataPointRow({ point, onChange, onRemove }: DataPointRowProps) {
  return (
    <tr className="data-source-detail__row">
      <td>
        <input
          className="data-source-detail__input"
          aria-label="Label"
          value={point.label}
          onChange={(e) => onChange({ ...point, label: e.target.value })}
        />
      </td>
      <td>
        <input
          className="data-source-detail__input data-source-detail__input--number"
          aria-label="Value"
          type="number"
          value={point.value}
          onChange={(e) => onChange({ ...point, value: Number(e.target.value) || 0 })}
        />
      </td>
      <td>
        <input
          className="data-source-detail__input"
          aria-label="Series"
          value={point.series ?? ''}
          placeholder="—"
          onChange={(e) => onChange({ ...point, series: e.target.value || undefined })}
        />
      </td>
      <td>
        <input
          className="data-source-detail__input"
          aria-label="Tooltip"
          value={point.tooltip ?? ''}
          placeholder="—"
          onChange={(e) => onChange({ ...point, tooltip: e.target.value || undefined })}
        />
      </td>
      <td>
        <input
          className="data-source-detail__input data-source-detail__input--color"
          aria-label="Color"
          type="color"
          value={point.color ?? '#000000'}
          onChange={(e) => onChange({ ...point, color: e.target.value })}
        />
      </td>
      <td>
        <button
          className="data-source-detail__remove"
          aria-label={`Remove ${point.label}`}
          onClick={onRemove}
        >
          ×
        </button>
      </td>
    </tr>
  )
}

export function DataSourcesPanel() {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)

  useEngineEvent((event) => {
    if (event.type === 'ProjectLoaded') {
      setTick((t) => t + 1)
    }
  })

  useEffect(() => {
    initDataSourceLibraryStore(engine)
    useDataSourceLibraryStore.getState().loadFromEngine(engine.embeddedDataSources)
  }, [engine])

  const definitions = useDataSourceLibraryStore((state) => state.definitions)
  const selectedId = useDataSourceLibraryStore((state) => state.selectedId)
  const selectDataSource = useDataSourceLibraryStore((state) => state.selectDataSource)
  const createDataSource = useDataSourceLibraryStore((state) => state.createDataSource)
  const renameDataSource = useDataSourceLibraryStore((state) => state.renameDataSource)
  const deleteDataSource = useDataSourceLibraryStore((state) => state.deleteDataSource)
  const duplicateDataSource = useDataSourceLibraryStore((state) => state.duplicateDataSource)
  const updateDataPoints = useDataSourceLibraryStore((state) => state.updateDataPoints)

  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleCreate = () => {
    const taken = new Set(definitions.map((d) => d.name))
    createDataSource(uniqueNodeName(taken, 'New Data Source'))
  }

  const handleCreateTable = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Table')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { table: defaultTableComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
  }

  const handleCreateChart = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Chart')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { chart: defaultChartComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
  }

  const handleCreateText = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Text')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { text: defaultTextComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
  }

  const commitRename = (id: string, name: string) => {
    setEditingId(null)
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    renameDataSource(id, trimmed)
  }

  const handleDelete = (id: string) => {
    deleteDataSource(id)
  }

  const handleDuplicate = (id: string, name: string) => {
    const taken = new Set(definitions.map((d) => d.name))
    duplicateDataSource(id, uniqueNodeName(taken, name))
  }

  const filtered = definitions.filter((ds) =>
    ds.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const selected = definitions.find((ds) => ds.id === selectedId)

  const handleAddPoint = () => {
    if (!selected) return
    const existingLabels = new Set(selected.dataPoints.map((p) => p.label))
    let label = 'Point'
    let counter = 1
    while (existingLabels.has(label)) {
      counter += 1
      label = `Point ${counter}`
    }
    updateDataPoints(selected.id, [...selected.dataPoints, { label, value: 0 }])
  }

  const handlePointChange = (index: number, updated: DataPoint) => {
    if (!selected) return
    const points = [...selected.dataPoints]
    points[index] = updated
    updateDataPoints(selected.id, points)
  }

  const handlePointRemove = (index: number) => {
    if (!selected) return
    const points = selected.dataPoints.filter((_, i) => i !== index)
    updateDataPoints(selected.id, points)
  }

  return (
    <div className="data-sources-panel">
      <div className="data-sources-toolbar">
        <div className="data-sources-toolbar__row">
          <button className="data-sources-toolbar__create" onClick={handleCreate}>
            Create Data Source
          </button>
          <button className="data-sources-toolbar__create" onClick={handleCreateTable}>
            Create Table
          </button>
          <button className="data-sources-toolbar__create" onClick={handleCreateChart}>
            Create Chart
          </button>
          <button className="data-sources-toolbar__create" onClick={handleCreateText}>
            Create Text
          </button>
        </div>
        <div className="data-sources-toolbar__row">
          <input
            className="data-sources-toolbar__search"
            type="search"
            aria-label="Search data sources"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {definitions.length === 0 ? (
        <div className="panel-empty-state">
          <p>No data sources created. Create one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No data sources match your search.</p>
        </div>
      ) : (
        <ul className="data-source-grid">
          {filtered.map((ds) => {
            const editing = editingId === ds.id
            return (
              <li key={ds.id} className="data-source-grid__item">
                {editing ? (
                  <input
                    className="data-source-cell__rename"
                    aria-label="Data source name"
                    defaultValue={ds.name}
                    autoFocus
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitRename(ds.id, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    onBlur={(event) => {
                      if (editingId === ds.id) {
                        commitRename(ds.id, event.target.value)
                      }
                    }}
                  />
                ) : (
                  <button
                    className="data-source-cell"
                    aria-label={`Select ${ds.name}`}
                    onClick={() => selectDataSource(ds.id)}
                  >
                    <span className="data-source-cell__icon" aria-hidden="true" />
                    <span className="data-source-cell__name">{ds.name}</span>
                    <span className="data-source-cell__count">
                      {ds.dataPoints.length} point{ds.dataPoints.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                )}
                {!editing && (
                  <div className="data-source-cell__actions">
                    <button
                      aria-label={`Rename ${ds.name}`}
                      title={`Rename ${ds.name}`}
                      onClick={() => setEditingId(ds.id)}
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Duplicate ${ds.name}`}
                      title={`Duplicate ${ds.name}`}
                      onClick={() => handleDuplicate(ds.id, ds.name)}
                    >
                      Duplicate
                    </button>
                    <button
                      aria-label={`Delete ${ds.name}`}
                      title={`Delete ${ds.name}`}
                      onClick={() => handleDelete(ds.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {selected && (
        <section className="data-source-detail" aria-label="Data source detail">
          <header className="data-source-detail__header">
            <h3 className="data-source-detail__title">{selected.name}</h3>
            <button className="data-source-detail__close" onClick={() => selectDataSource(null)}>
              Close
            </button>
          </header>
          <div className="data-source-detail__table-wrapper">
            <table className="data-source-detail__table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Value</th>
                  <th>Series</th>
                  <th>Tooltip</th>
                  <th>Color</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.dataPoints.map((point, index) => (
                  <DataPointRow
                    key={index}
                    point={point}
                    onChange={(updated) => handlePointChange(index, updated)}
                    onRemove={() => handlePointRemove(index)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <button className="data-source-detail__add" onClick={handleAddPoint}>
            Add Data Point
          </button>
        </section>
      )}
    </div>
  )
}
