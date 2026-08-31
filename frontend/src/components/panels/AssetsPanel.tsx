import { useContext, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { AssetDefinition } from '../../api'
import { ASSET_DEFINITION_MIME, AUDIO_ASSET_MIME } from '../../pixi/renderer/dropPlacement'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { registerImportOpener } from '../assets/importTrigger'
import { SORT_OPTIONS } from '../assets/sortOptions'
import type { EmbeddedAsset } from '../../engine/embeddedAsset'
import { EngineContext } from '../../app/engineContext'
import { CreateAudioAssetCommand } from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'

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

function formatDurationBadge(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const fraction = Math.round((seconds % 1) * 10)
  // mm:ss or m:ss.d? spec says mm:ss ; for sub-second we still show mm:ss
  const mm = String(mins).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (fraction > 0 && seconds < 60) {
    return `${mm}:${ss}.${fraction}`
  }
  return `${mm}:${ss}`
}

function getAssetDuration(asset: EmbeddedAsset): number | null {
  const meta = asset.metadata as Record<string, unknown> | undefined
  if (meta && typeof meta.duration === 'number' && Number.isFinite(meta.duration)) return meta.duration
  return null
}

function getWaveformPeaks(asset: EmbeddedAsset): number[] | null {
  const meta = asset.metadata as Record<string, unknown> | undefined
  if (!meta) return null
  const peaks = meta.waveformPeaks
  if (Array.isArray(peaks) && peaks.length > 0 && peaks.every((p) => typeof p === 'number')) {
    return peaks as number[]
  }
  return null
}

function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  return /\.(wav|mp3|mpeg|ogg|webm)$/i.test(file.name)
}

function isAudioDefinition(def: AssetDefinition): boolean {
  if (def.mimeType && def.mimeType.startsWith('audio/')) return true
  if (def.category === 'audio') return true
  const mimeMeta = (def.metadata as Record<string, unknown> | undefined)?.mimeType
  if (typeof mimeMeta === 'string' && mimeMeta.startsWith('audio/')) return true
  // Fallback to filename extension for backend audio assets stored without mimeType
  if (/\.(wav|mp3|mpeg|ogg|webm)$/i.test(def.original_filename)) return true
  return false
}

function inferAudioMimeType(file: File): string {
  if (file.type.startsWith('audio/')) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'wav': return 'audio/wav'
    case 'mp3':
    case 'mpeg': return 'audio/mpeg'
    case 'ogg': return 'audio/ogg'
    case 'webm': return 'audio/webm'
    default: return 'audio/wav'
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // result is data URL like data:audio/wav;base64,xxxx  -> extract base64 part
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

async function decodeAudioDuration(file: File): Promise<number | null> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    // Try to use Web Audio API if available
    const AudioContextCtor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return null
    const ctx = new AudioContextCtor()
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const duration = buffer.duration
    await ctx.close().catch(() => {})
    if (Number.isFinite(duration) && duration > 0) return duration
    return null
  } catch {
    return null
  }
}

type AssetFilter = 'all' | 'images' | 'audio'

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
  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(ASSET_DEFINITION_MIME, definition.id)
    event.dataTransfer.setDragImage(event.currentTarget, 0, 0)
  }

  return (
    <button
      className={view === 'grid' ? 'asset-cell' : 'asset-row'}
      aria-label={`Select ${definition.name}`}
      draggable
      onClick={() => onSelect(definition.id)}
      onDragStart={handleDragStart}
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

interface AudioAssetCellProps {
  asset: EmbeddedAsset
  view: AssetView
  onSelect?: (assetId: string) => void
}

function AudioAssetCell({ asset, view, onSelect }: AudioAssetCellProps) {
  const duration = getAssetDuration(asset)
  const peaks = getWaveformPeaks(asset)
  const badge = duration !== null ? formatDurationBadge(duration) : '--:--'

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(AUDIO_ASSET_MIME, asset.id)
    event.dataTransfer.setDragImage(event.currentTarget, 0, 0)
  }

  const handleSelect = () => onSelect?.(asset.id)

  return (
    <button
      className={view === 'grid' ? 'asset-cell asset-cell--audio' : 'asset-row asset-row--audio'}
      aria-label={`Select ${asset.name}`}
      draggable
      onClick={handleSelect}
      onDragStart={handleDragStart}
      data-asset-id={asset.id}
      data-mime={asset.mimeType}
    >
      <div className={view === 'grid' ? 'asset-cell__thumb' : 'asset-row__thumb'} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', borderRadius: 4 }}>
        {peaks ? (
          <div className="waveform" style={{ display: 'flex', alignItems: 'center', gap: 1, height: 24, width: '90%' }} aria-hidden="true">
            {peaks.slice(0, 40).map((p, i) => (
              <i key={i} style={{ display: 'block', flex: 1, background: '#7c5cff', borderRadius: 1, height: `${Math.max(2, Math.min(24, Math.abs(p) * 24))}px` }} />
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 16 }} aria-hidden="true">♫</span>
        )}
        <span className="badge" style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>
          {badge}
        </span>
      </div>
      <span className={view === 'grid' ? 'asset-cell__name' : 'asset-row__name'}>{asset.name}</span>
      <span className={view === 'grid' ? 'asset-cell__category' : 'asset-row__category'}>
        {asset.mimeType} ♫
      </span>
    </button>
  )
}

function useEmbeddedAudioAssets(): EmbeddedAsset[] {
  const ctx = useContext(EngineContext)
  const [tick, setTick] = useState(0)
  const engine = ctx?.engine ?? null
  useEffect(() => {
    if (!engine) return
    const unsub = engine.subscribe(() => setTick((t) => t + 1))
    return unsub
  }, [engine])
  void tick
  if (!ctx || !engine) return []
  return engine.embeddedAssets.filter((a) => a.mimeType.startsWith('audio/'))
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
  const [filter, setFilter] = useState<AssetFilter>('all')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const embeddedAudioAssets = useEmbeddedAudioAssets()

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useEffect(() => registerImportOpener(() => fileInputRef.current?.click()), [])

  // Engine access for audio embedded import (useContext to avoid throwing outside provider)
  const engineCtx = useContext(EngineContext)
  const engineDispatch = engineCtx?.dispatch ?? null

  const handleImportFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    const audioFiles = files.filter(isAudioFile)
    const imageFiles = files.filter((f) => !isAudioFile(f))
    if (imageFiles.length > 0) {
      void importFiles(imageFiles)
    }
    if (audioFiles.length > 0) {
      if (!engineDispatch) {
        // No engine available: fall back to backend upload for audio as well
        void importFiles(audioFiles)
        return
      }
      void (async () => {
        for (const file of audioFiles) {
          try {
            const base64 = await fileToBase64(file)
            const mimeType = inferAudioMimeType(file)
            const duration = await decodeAudioDuration(file)
            const name = file.name.replace(/\.[^/.]+$/, '') || file.name
            const metadata: Record<string, unknown> = {}
            if (duration !== null) metadata.duration = duration
            const result = engineDispatch!(new CreateAudioAssetCommand({ name, data: base64, mimeType, metadata }))
            if (!result.ok) {
              useNotificationStore.getState().notify(`${file.name}: ${result.error.message}`)
            } else {
              useNotificationStore.getState().notify(`${file.name} imported as audio`)
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            useNotificationStore.getState().notify(`${file.name}: ${message}`)
          }
        }
      })()
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

  const filteredDefinitions = definitions.filter((d) => {
    const isAudio = isAudioDefinition(d)
    if (filter === 'audio') return isAudio
    if (filter === 'images') return !isAudio
    return true
  })

  const filteredEmbeddedAudio = filter === 'images' ? [] : embeddedAudioAssets.filter((a) => {
    if (!search.trim()) return true
    return a.name.toLowerCase().includes(search.trim().toLowerCase())
  })

  // For display counts: All shows both, Images shows only definitions, Audio shows only audio (definitions audio + embedded)
  const hasAnyForFilter = filter === 'audio'
    ? filteredDefinitions.length > 0 || filteredEmbeddedAudio.length > 0
    : filter === 'images'
      ? filteredDefinitions.length > 0
      : filteredDefinitions.length > 0 || filteredEmbeddedAudio.length > 0

  const showEmpty = !hasAnyForFilter

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
        <div className="assets-toolbar__row" role="group" aria-label="Filter">
          <button
            className={filter === 'all' ? 'filter-chip filter-chip--active' : 'filter-chip'}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={filter === 'images' ? 'filter-chip filter-chip--active' : 'filter-chip'}
            aria-pressed={filter === 'images'}
            onClick={() => setFilter('images')}
          >
            Images
          </button>
          <button
            className={filter === 'audio' ? 'filter-chip filter-chip--active' : 'filter-chip'}
            aria-pressed={filter === 'audio'}
            onClick={() => setFilter('audio')}
          >
            Audio
          </button>
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
        accept="image/png,image/jpeg,image/webp,audio/wav,audio/mpeg,audio/mp3,audio/ogg,audio/webm"
        multiple
        hidden
        onChange={handleImportFiles}
      />
      {unavailable ? (
        <div className="panel-status panel-status--unavailable">
          <p>Asset library unavailable — start the backend</p>
        </div>
      ) : loading && definitions.length === 0 && filteredEmbeddedAudio.length === 0 ? (
        <div className="panel-status">
          <p>Loading library…</p>
        </div>
      ) : showEmpty ? (
        <div className="panel-empty-state">
          <p>
            {filter === 'audio'
              ? 'No audio assets. Import audio to build your library.'
              : filter === 'images'
                ? 'No image assets. Import images to build your library.'
                : 'No assets imported. Import images to build your library.'}
          </p>
        </div>
      ) : (
        <>
          <ul className={view === 'grid' ? 'asset-grid' : 'asset-list'}>
            {filteredDefinitions.map((definition) => (
              <li key={definition.id}>
                <AssetCell definition={definition} view={view} onSelect={selectAsset} />
              </li>
            ))}
            {filteredEmbeddedAudio.map((asset) => (
              <li key={asset.id}>
                <AudioAssetCell asset={asset} view={view} onSelect={selectAsset} />
              </li>
            ))}
          </ul>
          {selected && <AssetPreview definition={selected} onClose={() => selectAsset(null)} />}
        </>
      )}
    </div>
  )
}
