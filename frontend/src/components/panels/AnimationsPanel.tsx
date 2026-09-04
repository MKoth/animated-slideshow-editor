import { useEffect, useRef, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { uniqueNodeName } from '../../engine/naming'
import {
  useClipLibraryStore,
  clipToRecord,
  initClipLibraryStore,
} from '../../stores/clipLibraryStore'
import type { ClipLibraryClip } from '../../stores/clipLibraryStore'
import { useKeyframeClipboardStore } from '../../stores/keyframeClipboardStore'
import { useTimelineSelectionStore } from '../../stores/timelineSelectionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { LibraryBrowser } from './LibraryBrowser'
import {
  DeleteClipCollectionCommand,
  RenameClipCollectionCommand,
} from '../../engine/commands'
import { ApplyClipCollectionModal } from './ApplyClipCollectionModal'
import { ExportClipCollectionModal } from './ExportClipCollectionModal'
import { CollectionLibraryBrowser } from './CollectionLibraryBrowser'
import {
  useClipCollectionLibraryStore,
  initClipCollectionLibraryStore,
} from '../../stores/clipCollectionLibraryStore'

function uniqueClipName(base: string, existing: readonly ClipLibraryClip[]): string {
  return uniqueNodeName(new Set(existing.map((clip) => clip.name)), base)
}

function formatDuration(seconds: number): string {
  return `${seconds}s`
}

export function AnimationsPanel() {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)

  useEngineEvent((event) => {
    if (
      event.type === 'ProjectLoaded' ||
      event.type === 'ClipCreated' ||
      event.type === 'ClipRemoved' ||
      event.type === 'ClipRenamed' ||
      event.type === 'ClipDuplicated' ||
      event.type === 'ClipDurationChanged' ||
      event.type === 'ClipCategoryChanged' ||
      event.type === 'ClipParamDefaultChanged' ||
      event.type === 'ClipChannelLinkChanged' ||
      event.type === 'KeyframeAdded' ||
      event.type === 'KeyframeRemoved' ||
      event.type === 'KeyframeMoved' ||
      event.type === 'KeyframeValueChanged' ||
      event.type === 'ClipCollectionCreated' ||
      event.type === 'ClipCollectionRemoved' ||
      event.type === 'ClipCollectionRenamed' ||
      event.type === 'ClipCollectionBindingsChanged' ||
      event.type === 'ClipCollectionApplied'
    ) {
      setTick((t) => t + 1)
    }
  })

  useEffect(() => {
    initClipLibraryStore(dispatch as Parameters<typeof initClipLibraryStore>[0])
    initClipCollectionLibraryStore(dispatch as Parameters<typeof initClipCollectionLibraryStore>[0])
    // Preload collection library so Save duplicate checks work even before opening browser
    void useClipCollectionLibraryStore.getState().loadLibrary()
    void useClipLibraryStore.getState().loadLibrary()
  }, [dispatch])

  const definitions = engine.clips.map(clipToRecord)
  const selectedId = useClipLibraryStore((state) => state.selectedId)
  const error = useClipLibraryStore((state) => state.error)
  const selectClip = useClipLibraryStore((state) => state.selectClip)
  const clearError = useClipLibraryStore((state) => state.clearError)
  const createClip = useClipLibraryStore((state) => state.createClip)
  const renameClip = useClipLibraryStore((state) => state.renameClip)
  const duplicateClip = useClipLibraryStore((state) => state.duplicateClip)
  const deleteClip = useClipLibraryStore((state) => state.deleteClip)
  const saveToLibrary = useClipLibraryStore((state) => state.saveToLibrary)
  const libraryDefinitions = useClipLibraryStore((state) => state.definitions)
  const notify = useNotificationStore((state) => state.notify)
  const openLibraryBrowser = useClipLibraryStore((state) => state.openLibraryBrowser)

  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saveConfirm, setSaveConfirm] = useState<{
    clipId: string
    clipName: string
    existingEntryId: string
  } | null>(null)

  const handleCreate = () => {
    createClip(uniqueClipName('New Clip', definitions))
  }

  const commitRename = (clipId: string, name: string) => {
    setEditingId(null)
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return
    }
    renameClip(clipId, trimmed)
  }

  const handleDelete = (clipId: string) => {
    deleteClip(clipId, engine)
  }

  const commitSave = async (clipId: string, overwriteEntryId?: string) => {
    const clip = engine.getClip(clipId)
    const result = await saveToLibrary(clip, overwriteEntryId)
    if (result) {
      notify(
        overwriteEntryId
          ? `Clip "${clip.name}" updated in library`
          : `Clip "${clip.name}" saved to library`,
      )
    }
  }

  const handleSaveToLibrary = async (clipId: string) => {
    const clip = engine.getClip(clipId)
    const existing = libraryDefinitions.find((entry) => entry.name === clip.name)
    if (existing) {
      setSaveConfirm({ clipId, clipName: clip.name, existingEntryId: existing.id })
      return
    }
    await commitSave(clipId)
  }

  const handleOverwrite = async () => {
    if (!saveConfirm) return
    await commitSave(saveConfirm.clipId, saveConfirm.existingEntryId)
    setSaveConfirm(null)
  }

  const handleSaveAsNew = async () => {
    if (!saveConfirm) return
    const clip = engine.getClip(saveConfirm.clipId)
    const existingNames = new Set(libraryDefinitions.map((e) => e.name))
    const newName = uniqueNodeName(existingNames, clip.name)
    const original = clip.toJSON()
    const renamed = {
      ...original,
      name: newName,
      toJSON() {
        return { ...original, name: newName }
      },
    }
    const result = await saveToLibrary(renamed as never)
    if (result) {
      notify(`Clip "${newName}" saved to library`)
    }
    setSaveConfirm(null)
  }

  const handleEdit = (clipId: string) => {
    selectClip(clipId)
    useKeyframeClipboardStore.getState().setClipEditContext(clipId)
    useTimelineSelectionStore.getState().setEditingContext('clip-edit')
    useTimelineSelectionStore.getState().clearSelection()
  }

  const filtered = definitions.filter((clip) =>
    clip.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const selected = definitions.find((clip) => clip.id === selectedId)

  const collections = engine.clipCollections
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [applyCollectionId, setApplyCollectionId] = useState<string | null>(null)
  const [exportCollectionOpen, setExportCollectionOpen] = useState(false)
  const [browseCollectionsOpen, setBrowseCollectionsOpen] = useState(false)
  const collectionLibraryDefs = useClipCollectionLibraryStore((s) => s.definitions)
  const collectionLibraryError = useClipCollectionLibraryStore((s) => s.error)
  const clearCollectionLibraryError = useClipCollectionLibraryStore((s) => s.clearError)
  const collectionLibraryLoaded = useClipCollectionLibraryStore((s) => s.loaded)
  const saveCollectionToLibrary = useClipCollectionLibraryStore((s) => s.saveToLibrary)
  const [collectionSaveConfirm, setCollectionSaveConfirm] = useState<{
    collectionId: string
    collectionName: string
    existingEntryId: string
  } | null>(null)
  const collectionFileInputRef = useRef<HTMLInputElement>(null)

  const downloadCollectionFile = (collectionId: string) => {
    const collection = engine.getClipCollection(collectionId)
    const clips: Record<string, unknown>[] = []
    const seen = new Set<string>()
    for (const clipId of Object.values(collection.getBindingsObject())) {
      if (seen.has(clipId)) continue
      seen.add(clipId)
      clips.push(engine.getClip(clipId).toJSON() as unknown as Record<string, unknown>)
    }
    const payload = {
      format: 'animated-slides-clip-collection',
      version: 1,
      name: collection.name,
      bindings: collection.getBindingsObject(),
      clips,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const safeName = collection.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_') || 'collection'
    anchor.href = url
    anchor.download = `${safeName}.clip_collection`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    notify(`Collection "${collection.name}" exported to file`)
  }

  const importCollectionFile = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object') throw new Error('Collection file must contain an object')
      const value = parsed as {
        format?: unknown
        version?: unknown
        name?: unknown
        bindings?: unknown
        clips?: unknown
      }
      if (value.format !== 'animated-slides-clip-collection' || value.version !== 1) {
        throw new Error('Unsupported clip collection file')
      }
      if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Collection name is missing')
      if (!value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings)) {
        throw new Error('Collection bindings are missing')
      }
      if (!Array.isArray(value.clips)) throw new Error('Collection clips are missing')
      const entry = {
        id: `clipCollection-file-${Date.now()}`,
        name: value.name,
        bindings: value.bindings as Record<string, string>,
        source_node_id: null,
        clips: value.clips as Record<string, unknown>[],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const importedId = await useClipCollectionLibraryStore
        .getState()
        .importCollectionFromLibrary(entry, engine)
      const error = useClipCollectionLibraryStore.getState().error
      if (error || !importedId) {
        notify(`Import failed: ${error ?? 'unknown error'}`)
        return
      }
      setApplyCollectionId(importedId)
      notify(`Collection "${value.name}" imported. Select a hierarchy root to apply it.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read collection file')
    } finally {
      if (collectionFileInputRef.current) collectionFileInputRef.current.value = ''
    }
  }

  const handleDeleteCollection = (collectionId: string) => {
    const result = dispatch(new DeleteClipCollectionCommand({ collectionId }))
    if (!result.ok) notify(result.error.message)
    else notify('Collection deleted')
  }
  const commitRenameCollection = (collectionId: string, raw: string) => {
    setEditingCollectionId(null)
    const trimmed = raw.trim()
    if (!trimmed) return
    const result = dispatch(new RenameClipCollectionCommand({ collectionId, name: trimmed }))
    if (!result.ok) notify(result.error.message)
  }
  const ensureReferencedClipsInLibrary = async (col: ReturnType<typeof engine.getClipCollection>) => {
    const saveClipToLibrary = useClipLibraryStore.getState().saveToLibrary
    const clipDefs = useClipLibraryStore.getState().definitions
    const clipLibraryLoaded = useClipLibraryStore.getState().loaded
    if (!clipLibraryLoaded) {
      try {
        await useClipLibraryStore.getState().loadLibrary()
      } catch {
        // ignore
      }
    }
    for (const clipId of Object.values(col.getBindingsObject())) {
      try {
        const clip = engine.getClip(clipId)
        const exists = useClipLibraryStore.getState().definitions.some((d) => d.id === clipId)
        void clipDefs
        if (!exists) {
          const res = await saveClipToLibrary(clip)
          if (!res) {
            // clip save failed, but continue
          }
        }
      } catch {
        // clip not in project — will fail on import, ignore
      }
    }
  }

  const handleSaveCollectionToLibrary = async (collectionId: string) => {
    const col = engine.getClipCollection(collectionId)
    // If this exact collection was already saved (same id), offer to update that entry regardless of name
    const existingById = collectionLibraryDefs.find((e) => e.id === col.id)
    if (existingById) {
      setCollectionSaveConfirm({ collectionId, collectionName: col.name, existingEntryId: existingById.id })
      return
    }
    const existingByName = collectionLibraryDefs.find((e) => e.name === col.name)
    if (existingByName) {
      setCollectionSaveConfirm({ collectionId, collectionName: col.name, existingEntryId: existingByName.id })
      return
    }
    await ensureReferencedClipsInLibrary(col)
    const result = await saveCollectionToLibrary(col, undefined, engine)
    if (result) {
      await useClipCollectionLibraryStore.getState().loadLibrary()
      notify(`Collection "${col.name}" saved to library (self-contained with clips)`)
    } else {
      const err = useClipCollectionLibraryStore.getState().error
      notify(`Save failed: ${err ?? 'the backend rejected the request'}`)
    }
  }
  const handleOverwriteCollection = async () => {
    if (!collectionSaveConfirm) return
    const col = engine.getClipCollection(collectionSaveConfirm.collectionId)
    await ensureReferencedClipsInLibrary(col)
    const result = await saveCollectionToLibrary(col, collectionSaveConfirm.existingEntryId, engine)
    if (result) {
      await useClipCollectionLibraryStore.getState().loadLibrary()
      notify(`Collection "${col.name}" updated in library`)
    } else {
      const err = useClipCollectionLibraryStore.getState().error
      notify(`Update failed: ${err ?? 'the backend rejected the request'}`)
    }
    setCollectionSaveConfirm(null)
  }
  const handleSaveCollectionAsNew = async () => {
    if (!collectionSaveConfirm) return
    const col = engine.getClipCollection(collectionSaveConfirm.collectionId)
    const existingNames = new Set(collectionLibraryDefs.map((e) => e.name))
    let newName = col.name
    let counter = 1
    while (existingNames.has(newName)) {
      newName = `${col.name} ${counter}`
      counter++
    }
    await ensureReferencedClipsInLibrary(col)
    const { clipCollectionsApi } = await import('../../api')
    const newId = `clipCollection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Build self-contained clips snapshot like store does
    const bindings = col.getBindingsObject()
    const seen = new Set<string>()
    const clips: Record<string, unknown>[] = []
    for (const clipId of Object.values(bindings)) {
      if (seen.has(clipId)) continue
      seen.add(clipId)
      try {
        const clip = engine.getClip(clipId)
        clips.push(clip.toJSON() as unknown as Record<string, unknown>)
      } catch {
        // ignore missing
      }
    }
    try {
      const result = await clipCollectionsApi.createCollection({
        id: newId,
        name: newName,
        bindings,
        clips: clips.length > 0 ? clips : null,
      })
      await useClipCollectionLibraryStore.getState().loadLibrary()
      notify(`Collection "${newName}" saved to library`)
      void result
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
    setCollectionSaveConfirm(null)
  }

  return (
    <div className="animations-panel">
      <div className="animations-toolbar">
        <div className="animations-toolbar__row">
          <button className="animations-toolbar__create" onClick={handleCreate}>
            Create Clip
          </button>
          <button className="animations-toolbar__create" onClick={openLibraryBrowser}>
            Browse Library
          </button>
        </div>
        <div className="animations-toolbar__row">
          <input
            className="animations-toolbar__search"
            type="search"
            aria-label="Search clips"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {error && (
        <div className="panel-status panel-status--error" role="alert">
          <p>{error}</p>
          <button aria-label="Dismiss error" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      {definitions.length === 0 ? (
        <div className="panel-empty-state">
          <p>No clips created. Create one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No clips match your search.</p>
        </div>
      ) : (
        <ul className="animation-grid">
          {filtered.map((clip) => {
            const editing = editingId === clip.id
            return (
              <li key={clip.id} className="animation-grid__item">
                {editing ? (
                  <input
                    className="animation-cell__rename"
                    aria-label="Clip name"
                    defaultValue={clip.name}
                    autoFocus
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitRename(clip.id, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    onBlur={(event) => {
                      if (editingId === clip.id) {
                        commitRename(clip.id, event.target.value)
                      }
                    }}
                  />
                ) : (
                  <button
                    className="animation-cell"
                    aria-label={`Select ${clip.name}`}
                    onClick={() => selectClip(clip.id)}
                  >
                    <span className="animation-cell__thumbnail" aria-hidden="true" />
                    <span className="animation-cell__name">{clip.name}</span>
                    <span className="animation-cell__duration">
                      {formatDuration(clip.duration)}
                    </span>
                    {clip.category && (
                      <span className="animation-cell__category">{clip.category}</span>
                    )}
                  </button>
                )}
                {!editing && (
                  <div className="animation-cell__actions">
                    <button
                      aria-label={`Rename ${clip.name}`}
                      title={`Rename ${clip.name}`}
                      onClick={() => setEditingId(clip.id)}
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Duplicate ${clip.name}`}
                      title={`Duplicate ${clip.name}`}
                      onClick={() => duplicateClip(clip.id, uniqueClipName(clip.name, definitions))}
                    >
                      Duplicate
                    </button>
                    <button
                      aria-label={`Delete ${clip.name}`}
                      title={`Delete ${clip.name}`}
                      onClick={() => handleDelete(clip.id)}
                    >
                      Delete
                    </button>
                    <button
                      aria-label={`Save ${clip.name} to Library`}
                      title={`Save ${clip.name} to Library`}
                      onClick={() => handleSaveToLibrary(clip.id)}
                    >
                      Save to Library
                    </button>
                    <button
                      aria-label={`Edit ${clip.name}`}
                      title={`Edit ${clip.name}`}
                      onClick={() => handleEdit(clip.id)}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <section className="clip-collections" aria-label="Clip Collections" style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Clip Collections</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => collectionFileInputRef.current?.click()}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
              data-testid="collections-import-file-button"
            >
              Import File
            </button>
            <button
              onClick={() => setBrowseCollectionsOpen(true)}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
              data-testid="collections-browse-button"
            >
              Browse Library
            </button>
            <button
              onClick={() => setExportCollectionOpen(true)}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)' }}
              data-testid="collections-export-button"
              title="Export collection from Scene hierarchy (right-click a node for context menu)"
            >
              Export Collection…
            </button>
          </div>
        </header>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
          Map semanticName → clip. Export from Scene tree (right-click parent), then Apply to target hierarchy. Blocking if any clipped node lacks Semantic Name. Saved to <strong>Library</strong> persists across projects — use <em>Save to Library</em> then <em>Browse Library → Import</em> in another project.
        </p>
        {collectionLibraryError && (
          <div className="panel-status panel-status--error" role="alert" style={{ marginBottom: 8 }}>
            <p>{collectionLibraryError}</p>
            <button aria-label="Dismiss error" onClick={clearCollectionLibraryError}>
              Dismiss
            </button>
          </div>
        )}
        {collections.length === 0 ? (
          <div className="panel-empty-state" style={{ padding: 12 }}>
            <p style={{ fontSize: 12 }}>No collections in this project. Right-click a parent in Scene → Export Clip Collection…</p>
            {collectionLibraryLoaded && collectionLibraryDefs.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                You have {collectionLibraryDefs.length} saved in Library — click <em>Browse Library</em> to import.
              </p>
            )}
            {collectionLibraryLoaded && collectionLibraryDefs.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                Library is empty. Export a collection then <em>Save to Library</em> to make it available in other projects.
              </p>
            )}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {collections.map((col) => {
              const bindings = [...col.bindings.entries()]
              const editing = editingCollectionId === col.id
              return (
                <li
                  key={col.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    padding: 8,
                    background: 'var(--color-bg-elevated, #fafafa)',
                  }}
                  data-testid={`collection-${col.id}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {editing ? (
                      <input
                        aria-label="Collection name"
                        defaultValue={col.name}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRenameCollection(col.id, e.currentTarget.value)
                          else if (e.key === 'Escape') setEditingCollectionId(null)
                        }}
                        onBlur={(e) => {
                          if (editingCollectionId === col.id) commitRenameCollection(col.id, e.target.value)
                        }}
                        style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--color-border)' }}
                        data-testid={`collection-rename-input-${col.id}`}
                      />
                    ) : (
                      <strong style={{ flex: 1, fontSize: 12 }} title={col.id}>
                        {col.name}
                      </strong>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {bindings.length} binding(s)
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {bindings.length === 0 ? (
                      <em>empty</em>
                    ) : (
                      bindings.map(([sem, clipId]) => {
                        let clipName = clipId
                        try {
                          clipName = engine.getClip(clipId).name
                        } catch {
                          // missing
                        }
                        return (
                          <span
                            key={sem}
                            style={{
                              display: 'inline-block',
                              marginRight: 8,
                              fontFamily: 'monospace',
                              background: 'var(--color-bg)',
                              border: '1px solid var(--color-border)',
                              borderRadius: 4,
                              padding: '1px 4px',
                            }}
                            title={`${sem} → ${clipName}`}
                          >
                            {sem} → {clipName}
                          </span>
                        )
                      })
                    )}
                  </div>
                  {col.sourceNodeId && (
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      source: {(() => {
                        try {
                          return engine.getNode(col.sourceNodeId!).name
                        } catch {
                          return col.sourceNodeId
                        }
                      })()}
                    </div>
                  )}
                  {!editing && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setApplyCollectionId(col.id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        data-testid={`collection-apply-${col.id}`}
                      >
                        Apply…
                      </button>
                      <button
                        onClick={() => setEditingCollectionId(col.id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        data-testid={`collection-rename-${col.id}`}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => handleSaveCollectionToLibrary(col.id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        data-testid={`collection-save-${col.id}`}
                        title="Save to shared library (persists across projects)"
                      >
                        Save Collection to Library
                      </button>
                      <button
                        onClick={() => downloadCollectionFile(col.id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        data-testid={`collection-export-file-${col.id}`}
                        title="Export collection and referenced clips as a portable file"
                      >
                        Export File
                      </button>
                      <button
                        onClick={() => handleDeleteCollection(col.id)}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        data-testid={`collection-delete-${col.id}`}
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
      </section>

      {selected && (
        <section className="clip-detail" aria-label="Clip detail">
          <header className="clip-detail__header">
            <h3 className="clip-detail__title">{selected.name}</h3>
            <button className="clip-detail__close" onClick={() => selectClip(null)}>
              Close
            </button>
          </header>
          <dl className="clip-detail__fields">
            <div className="clip-detail__field">
              <dt>Duration</dt>
              <dd>{formatDuration(selected.duration)}</dd>
            </div>
            <div className="clip-detail__field">
              <dt>Category</dt>
              <dd>{selected.category || '—'}</dd>
            </div>
            <div className="clip-detail__field">
              <dt>Channels</dt>
              <dd>{selected.channelCount}</dd>
            </div>
          </dl>
        </section>
      )}
      <input
        ref={collectionFileInputRef}
        type="file"
        accept=".clip_collection,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importCollectionFile(file)
        }}
        data-testid="collections-import-file-input"
      />
      {saveConfirm && (
        <div className="projects-overlay">
          <div className="projects-dialog" role="dialog" aria-label="Save to Library">
            <p className="projects-dialog__message">
              A clip named &ldquo;{saveConfirm.clipName}&rdquo; already exists in the library.
            </p>
            <div className="projects-dialog__actions">
              <button onClick={() => setSaveConfirm(null)}>Cancel</button>
              <button onClick={handleSaveAsNew}>Save as New</button>
              <button onClick={handleOverwrite}>Overwrite</button>
            </div>
          </div>
        </div>
      )}
      <LibraryBrowser />
      <CollectionLibraryBrowser visible={browseCollectionsOpen} onClose={() => setBrowseCollectionsOpen(false)} />
      {collectionSaveConfirm && (
        <div className="projects-overlay">
          <div className="projects-dialog" role="dialog" aria-label="Save Collection to Library">
            <p className="projects-dialog__message">
              A collection named &ldquo;{collectionSaveConfirm.collectionName}&rdquo; already exists in the library.
            </p>
            <div className="projects-dialog__actions">
              <button onClick={() => setCollectionSaveConfirm(null)}>Cancel</button>
              <button onClick={handleSaveCollectionAsNew}>Save as New</button>
              <button onClick={handleOverwriteCollection}>Overwrite</button>
            </div>
          </div>
        </div>
      )}
      <ApplyClipCollectionModal
        open={applyCollectionId !== null}
        collectionId={applyCollectionId}
        onClose={() => setApplyCollectionId(null)}
      />
      <ExportClipCollectionModal
        open={exportCollectionOpen}
        parentNodeId={null}
        onClose={() => setExportCollectionOpen(false)}
      />
    </div>
  )
}
