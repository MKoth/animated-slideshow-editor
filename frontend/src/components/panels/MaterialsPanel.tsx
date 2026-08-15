import { useEffect, useState } from 'react'
import type { MaterialDefinition } from '../../api'
import { DEFAULT_MATERIAL_DEFINITION_ID } from '../../engine/materialInstance'
import { uniqueNodeName } from '../../engine/naming'
import { resolveMaterial } from '../../engine/materialResolution'
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore'

function effectiveTint(definition: MaterialDefinition): string {
  return resolveMaterial(definition.parameters, {}).tint
}

function uniqueMaterialName(base: string, existing: readonly MaterialDefinition[]): string {
  return uniqueNodeName(new Set(existing.map((definition) => definition.name)), base)
}

export function MaterialsPanel() {
  const definitions = useMaterialLibraryStore((state) => state.definitions)
  const loading = useMaterialLibraryStore((state) => state.loading)
  const unavailable = useMaterialLibraryStore((state) => state.unavailable)
  const loadLibrary = useMaterialLibraryStore((state) => state.loadLibrary)
  const selectMaterial = useMaterialLibraryStore((state) => state.selectMaterial)
  const createMaterial = useMaterialLibraryStore((state) => state.createMaterial)
  const renameMaterial = useMaterialLibraryStore((state) => state.renameMaterial)
  const duplicateMaterial = useMaterialLibraryStore((state) => state.duplicateMaterial)
  const deleteMaterial = useMaterialLibraryStore((state) => state.deleteMaterial)

  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  const handleCreate = () => {
    void createMaterial({ name: uniqueMaterialName('New Material', definitions) })
  }

  const commitRename = (materialId: string, name: string) => {
    setEditingId(null)
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }
    void renameMaterial(materialId, trimmed)
  }

  const filtered = definitions.filter((definition) =>
    definition.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="materials-panel">
      <div className="materials-toolbar">
        <div className="materials-toolbar__row">
          <button
            className="materials-toolbar__create"
            onClick={handleCreate}
            disabled={unavailable}
          >
            Create Material
          </button>
        </div>
        <div className="materials-toolbar__row">
          <input
            className="materials-toolbar__search"
            type="search"
            aria-label="Search materials"
            placeholder="Search by name"
            value={search}
            disabled={unavailable}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {unavailable ? (
        <div className="panel-status panel-status--unavailable">
          <p>Material library unavailable — start the backend</p>
        </div>
      ) : loading && definitions.length === 0 ? (
        <div className="panel-status">
          <p>Loading library…</p>
        </div>
      ) : definitions.length === 0 ? (
        <div className="panel-empty-state">
          <p>No materials created. Create one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No materials match your search.</p>
        </div>
      ) : (
        <ul className="material-grid">
          {filtered.map((definition) => {
            const editing = editingId === definition.id
            const isDefault = definition.id === DEFAULT_MATERIAL_DEFINITION_ID
            return (
              <li key={definition.id} className="material-grid__item">
                {editing ? (
                  <input
                    className="material-cell__rename"
                    aria-label="Material name"
                    defaultValue={definition.name}
                    autoFocus
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitRename(definition.id, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    onBlur={(event) => {
                      if (editingId === definition.id) {
                        commitRename(definition.id, event.target.value)
                      }
                    }}
                  />
                ) : (
                  <button
                    className="material-cell"
                    aria-label={`Select ${definition.name}`}
                    onClick={() => selectMaterial(definition.id)}
                  >
                    <span
                      className="material-cell__swatch"
                      style={{ backgroundColor: effectiveTint(definition) }}
                      aria-hidden="true"
                    />
                    <span className="material-cell__name">{definition.name}</span>
                  </button>
                )}
                {!editing && (
                  <div className="material-cell__actions">
                    <button
                      aria-label={`Rename ${definition.name}`}
                      title={`Rename ${definition.name}`}
                      onClick={() => setEditingId(definition.id)}
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Duplicate ${definition.name}`}
                      title={`Duplicate ${definition.name}`}
                      onClick={() =>
                        void duplicateMaterial(
                          definition.id,
                          uniqueMaterialName(definition.name, definitions),
                        )
                      }
                    >
                      Duplicate
                    </button>
                    <button
                      aria-label={`Delete ${definition.name}`}
                      title={
                        isDefault
                          ? 'The Default Material cannot be deleted'
                          : `Delete ${definition.name}`
                      }
                      disabled={isDefault}
                      onClick={() => void deleteMaterial(definition.id)}
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
    </div>
  )
}
