import { useContext, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { AssetDefinition } from '../../api'
import { ASSET_DEFINITION_MIME, AUDIO_ASSET_MIME } from '../../pixi/renderer/dropPlacement'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { registerImportOpener } from '../assets/importTrigger'
import { SORT_OPTIONS } from '../assets/sortOptions'
import type { EmbeddedAsset } from '../../engine/embeddedAsset'
import { EngineContext } from '../../app/engineContext'
import { DeleteAudioAssetCommand } from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { assetsApi } from '../../api'
import { WaveformCanvas } from '../audio/WaveformCanvas'
import {
  bucketCountForDuration,
  computePeaksFromAudioBuffer,
  MAX_FRONTEND_DECODE_SECONDS,
} from '../../audio/waveform'

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

function getDefinitionWaveformPeaks(def: AssetDefinition): number[] | null {
  const meta = def.metadata as Record<string, unknown> | undefined
  if (!meta) return null
  const peaks = meta.waveformPeaks
  if (Array.isArray(peaks) && peaks.length > 0 && peaks.every((p) => typeof p === 'number')) {
    return peaks as number[]
  }
  return null
}

function getDefinitionDuration(def: AssetDefinition): number | null {
  const meta = def.metadata as Record<string, unknown> | undefined
  if (meta && typeof meta.duration === 'number' && Number.isFinite(meta.duration)) return meta.duration as number
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

function AudioEmbeddedPreview({ asset, onClose }: { asset: EmbeddedAsset; onClose: () => void }) {
  const duration = getAssetDuration(asset)
  const peaks = getWaveformPeaks(asset)
  const badge = duration !== null ? formatDurationBadge(duration) : '--:--'
  const engineCtx = useContext(EngineContext)
  const dispatch = engineCtx?.dispatch ?? null
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const handleDelete = () => {
    if (!dispatch) return
    const res = dispatch(new DeleteAudioAssetCommand({ assetId: asset.id }))
    if (!res.ok) useNotificationStore.getState().notify(res.error.message)
    else {
      useNotificationStore.getState().notify(`${asset.name} deleted`)
      onClose()
    }
  }
  const handleAudition = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
      return
    }
    try {
      const dataUrl = `data:${asset.mimeType};base64,${asset.data}`
      const audio = new Audio(dataUrl)
      audioRef.current = audio
      audio.onended = () => setIsPlaying(false)
      audio.onerror = () => setIsPlaying(false)
      await audio.play()
      setIsPlaying(true)
    } catch {
      useNotificationStore.getState().notify('Playback failed')
    }
  }
  const handleSaveGlobal = async () => {
    try {
      const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: asset.mimeType })
      const file = new File([blob], `${asset.name}.${asset.mimeType.split('/')[1] ?? 'wav'}`, { type: asset.mimeType })
      const store = useAssetLibraryStore.getState()
      const result = await store.importFiles([file])
      if (result.created.length > 0) useNotificationStore.getState().notify(`${asset.name} saved to library`)
      else useNotificationStore.getState().notify('Save failed — backend unavailable')
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <section className="asset-preview asset-preview--audio" aria-label="Audio preview">
      <header className="asset-preview__header">
        <h3 className="asset-preview__title">{asset.name}</h3>
        <div className="asset-preview__actions">
          <button className="asset-preview__delete" onClick={handleDelete}>Delete</button>
          <button className="asset-preview__close" onClick={onClose}>Close</button>
        </div>
      </header>
      <div style={{ background: '#1a1a1a', padding: 12, borderRadius: 6 }}>
        <WaveformCanvas peaks={peaks} width={320} height={48} color="#7c5cff" testId="waveform-preview-embedded" />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#aaa' }}>
          <span>{badge}</span>
          <span>{asset.mimeType} • {formatFileSize(Math.round((asset.data.length * 3) / 4))}</span>
        </div>
      </div>
      <dl className="asset-preview__details">
        <dt>Duration</dt><dd>{badge}</dd>
        <dt>Sample rate</dt><dd>{(asset.metadata as Record<string, unknown>)?.sampleRate as number ?? '—'}</dd>
        <dt>Channels</dt><dd>{(asset.metadata as Record<string, unknown>)?.channels as number ?? '—'}</dd>
        <dt>Mime</dt><dd>{asset.mimeType}</dd>
        <dt>Scope</dt><dd>Project only (recorded)</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button data-testid="audio-preview-play" onClick={handleAudition} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: isPlaying ? '#7c5cff' : 'var(--color-bg)', color: isPlaying ? '#fff' : undefined, cursor: 'pointer' }}>{isPlaying ? 'Stop' : 'Listen'}</button>
        <button data-testid="audio-preview-save-global" onClick={handleSaveGlobal} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer' }}>Save between projects</button>
      </div>
    </section>
  )
}

function AudioGlobalPreview({ definition, onClose }: { definition: AssetDefinition; onClose: () => void }) {
  const duration = getDefinitionDuration(definition)
  const peaks = getDefinitionWaveformPeaks(definition)
  const badge = duration !== null ? formatDurationBadge(duration) : '--:--'
  const deleteAsset = useAssetLibraryStore((state) => state.deleteAsset)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const handleDelete = async () => {
    await deleteAsset(definition.id)
    onClose()
  }
  const handleAudition = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
      return
    }
    try {
      const audio = new Audio(definition.original_url)
      audioRef.current = audio
      audio.onended = () => setIsPlaying(false)
      audio.onerror = () => setIsPlaying(false)
      await audio.play()
      setIsPlaying(true)
    } catch {
      useNotificationStore.getState().notify('Playback failed')
    }
  }
  return (
    <section className="asset-preview asset-preview--audio" aria-label="Audio preview">
      <header className="asset-preview__header">
        <h3 className="asset-preview__title">{definition.name}</h3>
        <div className="asset-preview__actions">
          <button className="asset-preview__delete" onClick={handleDelete}>Delete</button>
          <button className="asset-preview__close" onClick={onClose}>Close preview</button>
        </div>
      </header>
      <div style={{ background: '#1a1a1a', padding: 12, borderRadius: 6 }}>
        <WaveformCanvas peaks={peaks} width={320} height={48} color="#7c5cff" testId="waveform-preview-global" />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#aaa' }}>
          <span>{badge}</span>
          <span>{definition.mimeType ?? definition.category} • {formatFileSize(definition.file_size)}</span>
        </div>
      </div>
      <dl className="asset-preview__details">
        <dt>Category</dt><dd>{definition.category}</dd>
        <dt>Duration</dt><dd>{badge}</dd>
        <dt>Resolution</dt><dd>{definition.width} × {definition.height}</dd>
        <dt>File size</dt><dd>{formatFileSize(definition.file_size)}</dd>
        <dt>Imported</dt><dd>{formatImportDate(definition.import_date)}</dd>
        <dt>Scope</dt><dd>Global (shared between projects)</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button data-testid="audio-preview-play-global" onClick={handleAudition} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: isPlaying ? '#7c5cff' : 'var(--color-bg)', color: isPlaying ? '#fff' : undefined, cursor: 'pointer' }}>{isPlaying ? 'Stop' : 'Listen'}</button>
      </div>
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
      <div className={view === 'grid' ? 'asset-cell__thumb' : 'asset-row__thumb'} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
        <WaveformCanvas peaks={peaks} width={view === 'grid' ? 120 : 160} height={24} color="#7c5cff" testId="waveform-canvas-embedded" />
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

function BackendAudioCell({ definition, view, onSelect }: { definition: AssetDefinition; view: AssetView; onSelect: (id: string) => void }) {
  const duration = getDefinitionDuration(definition)
  const initialPeaks = getDefinitionWaveformPeaks(definition)
  const [peaks, setPeaks] = useState<number[] | null>(initialPeaks)
  const [quickPeaks, setQuickPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    // If already have canonical peaks from metadata, nothing to do (still fetch to ensure idempotent but keep cached)
    if (initialPeaks && initialPeaks.length >= 800) {
      // already canonical — no quick decode needed, but still ensure backend cache is warm
      return
    }
    const doFetch = async () => {
      try {
        // For <30s: quick paint via fetch+decode before backend canonical
        if (duration !== null && duration < MAX_FRONTEND_DECODE_SECONDS) {
          try {
            const resp = await fetch(definition.original_url)
            if (resp.ok) {
              const buf = await resp.arrayBuffer()
              const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
                ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
              if (Ctor) {
                const ctx = new Ctor()
                const audioBuf = await ctx.decodeAudioData(buf)
                const qp = computePeaksFromAudioBuffer(audioBuf, bucketCountForDuration(audioBuf.duration))
                if (!cancelled) setQuickPeaks(qp)
                await ctx.close().catch(() => {})
              }
            }
          } catch { /* quick decode best-effort */ }
        }
        const data = await assetsApi.getPeaks(definition.id)
        if (!cancelled && Array.isArray(data.peaks) && data.peaks.length >= 800) {
          setPeaks(data.peaks)
        } else if (!cancelled && quickPeaks) {
          setPeaks(quickPeaks)
        }
      } catch { /* backend may be down */ }
    }
    void doFetch()
    return () => { cancelled = true }
  }, [definition.id, definition.original_url, duration, initialPeaks, quickPeaks])

  const displayPeaks = peaks ?? quickPeaks
  const badge = duration !== null ? formatDurationBadge(duration) : '--:--'

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'copy'
    // Backend audio definitions also support AUDIO_ASSET_MIME for audio lanes; also set definition mime
    event.dataTransfer.setData(AUDIO_ASSET_MIME, definition.id)
    event.dataTransfer.setData(ASSET_DEFINITION_MIME, definition.id)
    event.dataTransfer.setDragImage(event.currentTarget, 0, 0)
  }

  return (
    <button
      className={view === 'grid' ? 'asset-cell asset-cell--audio' : 'asset-row asset-row--audio'}
      aria-label={`Select ${definition.name}`}
      draggable
      onClick={() => onSelect(definition.id)}
      onDragStart={handleDragStart}
      data-asset-id={definition.id}
    >
      <div className={view === 'grid' ? 'asset-cell__thumb' : 'asset-row__thumb'} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
        <WaveformCanvas peaks={displayPeaks} width={view === 'grid' ? 120 : 160} height={24} color="#7c5cff" testId="waveform-canvas-backend" />
        <span className="badge" style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>
          {badge}
        </span>
      </div>
      <span className={view === 'grid' ? 'asset-cell__name' : 'asset-row__name'}>{definition.name}</span>
      <span className={view === 'grid' ? 'asset-cell__category' : 'asset-row__category'}>
        {definition.category} ♫
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
      // Audio imports go global via backend (like images), not embedded.
      // Recorded audio stays project-only via CreateAudioAssetCommand in RecordModal.
      void importFiles(audioFiles)
    }
  }

  const handleSortChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const option = SORT_OPTIONS.find((candidate) => candidate.label === event.target.value)
    if (option) {
      setSorting(option.sort, option.order)
    }
  }

  const selected = definitions.find((definition) => definition.id === selectedId)
  const selectedEmbedded = embeddedAudioAssets.find((a) => a.id === selectedId) ?? null
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
                {isAudioDefinition(definition) ? (
                  <BackendAudioCell definition={definition} view={view} onSelect={selectAsset} />
                ) : (
                  <AssetCell definition={definition} view={view} onSelect={selectAsset} />
                )}
              </li>
            ))}
            {filteredEmbeddedAudio.map((asset) => (
              <li key={asset.id}>
                <AudioAssetCell asset={asset} view={view} onSelect={selectAsset} />
              </li>
            ))}
          </ul>
          {selected && !isAudioDefinition(selected) && <AssetPreview definition={selected} onClose={() => selectAsset(null)} />}
          {selected && isAudioDefinition(selected) && <AudioGlobalPreview definition={selected} onClose={() => selectAsset(null)} />}
          {!selected && selectedEmbedded && <AudioEmbeddedPreview asset={selectedEmbedded} onClose={() => selectAsset(null)} />}
        </>
      )}
    </div>
  )
}
