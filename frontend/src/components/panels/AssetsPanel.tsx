import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { AssetDefinition } from '../../api'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { registerImportOpener } from '../assets/importTrigger'
import { SORT_OPTIONS } from '../assets/sortOptions'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatImportDate(importDate: string): string {
  return importDate.slice(0, 10)
}

interface PreviewProps {
  definition: AssetDefinition
  onClose: () => void
}

function AssetPreview({ definition, onClose }: PreviewProps) {
  const deleteAsset = useAssetLibraryStore((state) => state.deleteAsset)

  return (
    <section className="asset-preview" aria-label="Asset preview">
      <header className="asset-preview__header">
        <h3 className="asset-preview__title">{definition.name}</h3>
        <div className="asset-preview__actions">
          <button className="asset-preview__delete" onClick={() => void deleteAsset(definition.id)}>
            Delete asset
          </button>
          <button className="asset-preview__close" onClick={onClose}>
            Close preview
          </button>
        </div>
      </header>
      <img className="asset-preview__image" src={definition.original_url} alt={definition.name} />
      <dl className="asset-preview__details">
        <dt>Category</dt>
        <dd>{definition.category}</dd>
        <dt>Resolution</dt>
        <dd>
          {definition.width} × {definition.height}
        </dd>
        <dt>File size</dt>
        <dd>{formatFileSize(definition.file_size)}</dd>
        <dt>Imported</dt>
        <dd>{formatImportDate(definition.import_date)}</dd>
        <dt>Tags</dt>
        <dd>{definition.tags.length > 0 ? definition.tags.join(', ') : '—'}</dd>
        <dt>Description</dt>
        <dd>{definition.description || '—'}</dd>
        <dt>AI description</dt>
        <dd>{definition.ai_description || '—'}</dd>
      </dl>
    </section>
  )
}

type AssetView = 'grid' | 'list'

interface AssetCellProps {
  definition: AssetDefinition
  view: AssetView
  onSelect: (assetId: string) => void
}

function AssetCell({ definition, view, onSelect }: AssetCellProps) {
  return (
    <button
      className={view === 'grid' ? 'asset-cell' : 'asset-row'}
      aria-label={`Select ${definition.name}`}
      onClick={() => onSelect(definition.id)}
    >
      <img
        className={view === 'grid' ? 'asset-cell__thumb' : 'asset-row__thumb'}
        src={definition.thumbnail_url}
        alt={definition.name}
      />
      <span className={view === 'grid' ? 'asset-cell__name' : 'asset-row__name'}>
        {definition.name}
      </span>
      <span className={view === 'grid' ? 'asset-cell__category' : 'asset-row__category'}>
        {definition.category}
      </span>
    </button>
  )
}

export function AssetsPanel() {
  const definitions = useAssetLibraryStore((state) => state.definitions)
  const loading = useAssetLibraryStore((state) => state.loading)
  const unavailable = useAssetLibraryStore((state) => state.unavailable)
  const search = useAssetLibraryStore((state) => state.search)
  const sort = useAssetLibraryStore((state) => state.sort)
  const order = useAssetLibraryStore((state) => state.order)
  const selectedId = useAssetLibraryStore((state) => state.selectedId)
  const loadLibrary = useAssetLibraryStore((state) => state.loadLibrary)
  const setSearch = useAssetLibraryStore((state) => state.setSearch)
  const setSorting = useAssetLibraryStore((state) => state.setSorting)
  const selectAsset = useAssetLibraryStore((state) => state.selectAsset)
  const importFiles = useAssetLibraryStore((state) => state.importFiles)

  const [view, setView] = useState<AssetView>('grid')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useEffect(() => registerImportOpener(() => fileInputRef.current?.click()), [])

  const handleImportFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) {
      void importFiles(files)
    }
  }

  const handleSortChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const option = SORT_OPTIONS.find((candidate) => candidate.label === event.target.value)
    if (option) {
      setSorting(option.sort, option.order)
    }
  }

  const selected = definitions.find((definition) => definition.id === selectedId)
  const activeSortLabel = SORT_OPTIONS.find(
    (option) => option.sort === sort && option.order === order,
  )?.label

  return (
    <div className="assets-panel">
      <div className="assets-toolbar">
        <div className="assets-toolbar__row">
          <button
            className="assets-toolbar__import"
            onClick={() => fileInputRef.current?.click()}
            disabled={unavailable}
          >
            Import Assets
          </button>
          <div className="assets-toolbar__views" role="group" aria-label="View">
            <button
              className={
                view === 'grid'
                  ? 'assets-toolbar__view assets-toolbar__view--active'
                  : 'assets-toolbar__view'
              }
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
            >
              Grid view
            </button>
            <button
              className={
                view === 'list'
                  ? 'assets-toolbar__view assets-toolbar__view--active'
                  : 'assets-toolbar__view'
              }
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              List view
            </button>
          </div>
        </div>
        <div className="assets-toolbar__row">
          <input
            className="assets-toolbar__search"
            type="search"
            aria-label="Search assets"
            placeholder="Search by name"
            value={search}
            disabled={unavailable}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="assets-toolbar__sort"
            aria-label="Sort assets"
            value={activeSortLabel}
            disabled={unavailable}
            onChange={handleSortChange}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.label} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={handleImportFiles}
      />
      {unavailable ? (
        <div className="assets-status assets-status--unavailable">
          <p>Asset library unavailable — start the backend</p>
        </div>
      ) : loading && definitions.length === 0 ? (
        <div className="assets-status">
          <p>Loading library…</p>
        </div>
      ) : definitions.length === 0 ? (
        <div className="panel-empty-state">
          <p>No assets imported. Import images to build your library.</p>
        </div>
      ) : (
        <>
          <ul className={view === 'grid' ? 'asset-grid' : 'asset-list'}>
            {definitions.map((definition) => (
              <li key={definition.id}>
                <AssetCell definition={definition} view={view} onSelect={selectAsset} />
              </li>
            ))}
          </ul>
          {selected && <AssetPreview definition={selected} onClose={() => selectAsset(null)} />}
        </>
      )}
    </div>
  )
}
