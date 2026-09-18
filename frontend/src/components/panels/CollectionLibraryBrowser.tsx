import { useEffect, useState } from 'react'
import { useClipCollectionLibraryStore } from '../../stores/clipCollectionLibraryStore'
import type { ClipCollectionLibraryEntry } from '../../api'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEngine } from '../../app/useEngine'
import { ApplyClipCollectionModal } from './ApplyClipCollectionModal'
import {
  DeleteClipCollectionCommand,
  ReverseCollectionCommand,
  MirrorCollectionCommand,
} from '../../engine/commands'
import {
  mirrorCollectionDefaultName,
  buildMirrorSwapPreview,
  collectMirrorSkippedLaneNames,
} from '../../engine/clipMirror'
import type { MirrorAxis } from '../../engine/clipMirror'
import { ALL_COLLECTION_CATEGORIES, distinctCollectionCategories } from './collectionCategories'

export function CollectionLibraryBrowser({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const definitions = useClipCollectionLibraryStore((s) => s.definitions)
  const loading = useClipCollectionLibraryStore((s) => s.loading)
  const error = useClipCollectionLibraryStore((s) => s.error)
  const unavailable = useClipCollectionLibraryStore((s) => s.unavailable)
  const loadLibrary = useClipCollectionLibraryStore((s) => s.loadLibrary)
  const deleteFromLibrary = useClipCollectionLibraryStore((s) => s.deleteFromLibrary)
  const importCollection = useClipCollectionLibraryStore((s) => s.importCollectionFromLibrary)
  const clearError = useClipCollectionLibraryStore((s) => s.clearError)
  const notify = useNotificationStore((s) => s.notify)
  const { engine, dispatch } = useEngine()

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_COLLECTION_CATEGORIES)
  const [deleteConfirm, setDeleteConfirm] = useState<ClipCollectionLibraryEntry | null>(null)
  const [applyCollectionId, setApplyCollectionId] = useState<string | null>(null)
  const [overflowId, setOverflowId] = useState<string | null>(null)
  const [reversePrompt, setReversePrompt] = useState<{
    entry: ClipCollectionLibraryEntry
    defaultName: string
  } | null>(null)
  const [reverseNameDraft, setReverseNameDraft] = useState('')
  const [mirrorPrompt, setMirrorPrompt] = useState<{
    entry: ClipCollectionLibraryEntry
    defaultName: string
  } | null>(null)
  const [mirrorNameDraft, setMirrorNameDraft] = useState('')
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>('X')

  const removeTemporaryImports = (name: string, importedId: string | null): void => {
    const ids = engine.clipCollections
      .filter(
        (collection) =>
          collection.name === name &&
          collection.sourceNodeId === undefined &&
          (collection.id === importedId || importedId !== null),
      )
      .map((collection) => collection.id)
    for (const collectionId of ids) {
      const result = dispatch(new DeleteClipCollectionCommand({ collectionId }))
      if (!result.ok) notify(result.error.message)
    }
  }

  useEffect(() => {
    // Refresh on every open so project changes cannot leave the browser showing
    // an old in-memory snapshot of the shared backend library.
    if (visible) void loadLibrary()
  }, [visible, loadLibrary])

  if (!visible) return null

  const categories = distinctCollectionCategories(
    definitions.map((d) => ({
      category: typeof d.category === 'string' ? d.category : '',
    })),
  )

  const filtered = definitions.filter((entry) => {
    const matchesSearch =
      !search.trim() || entry.name.toLowerCase().includes(search.trim().toLowerCase())
    const entryCat = typeof entry.category === 'string' ? entry.category.trim() : ''
    const matchesCategory =
      categoryFilter === ALL_COLLECTION_CATEGORIES || entryCat === categoryFilter
    return matchesSearch && matchesCategory
  })

  const handleImport = async (entry: ClipCollectionLibraryEntry) => {
    const importedCollectionId = await importCollection(entry, engine)
    const err = useClipCollectionLibraryStore.getState().error
    if (err) {
      notify(`Import failed: ${err}`)
    } else if (importedCollectionId) {
      notify(`Collection "${entry.name}" imported. Select a hierarchy root to apply it.`)
      setApplyCollectionId(importedCollectionId)
    } else {
      notify(`Collection "${entry.name}" could not be imported`)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    const name = deleteConfirm.name
    await deleteFromLibrary(deleteConfirm.id)
    notify(`Collection "${name}" deleted from library`)
    setDeleteConfirm(null)
  }

  return (
    <div className="projects-overlay">
      <div
        className="projects-dialog"
        role="dialog"
        aria-label="Browse Collection Library"
        style={{ maxWidth: 600, width: '100%' }}
      >
        <h2 className="projects-dialog__title">Browse Collection Library</h2>
        {error && (
          <div className="panel-status panel-status--error" role="alert">
            <p>{error}</p>
            <button aria-label="Dismiss error" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {unavailable && (
          <p className="projects-dialog__message">Backend unavailable. Library cannot be loaded.</p>
        )}
        {!unavailable && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                className="animations-toolbar__search"
                type="search"
                aria-label="Search library collections"
                placeholder="Search by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1 }}
              />
              <select
                aria-label="Filter by category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value={ALL_COLLECTION_CATEGORIES}>All categories</option>
                <option value="">Uncategorized</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            {loading && <p>Loading library...</p>}
            {!loading && filtered.length === 0 && (
              <div className="panel-empty-state">
                <p>
                  {definitions.length === 0
                    ? 'Library is empty. Save collections from the Clip Collections section to populate it.'
                    : 'No collections match your search.'}
                </p>
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  maxHeight: 400,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {filtered.map((entry) => {
                  const isSelfContained =
                    Array.isArray((entry as unknown as { clips?: unknown[] }).clips) &&
                    (entry as unknown as { clips?: unknown[] }).clips!.length > 0
                  return (
                    <li
                      key={entry.id}
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ flex: 1, fontSize: 12 }}>{entry.name}</strong>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {typeof entry.category === 'string' && entry.category.trim() !== ''
                            ? `[${entry.category.trim()}]`
                            : 'Uncategorized'}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: isSelfContained
                              ? 'var(--color-success, green)'
                              : 'var(--color-danger)',
                          }}
                        >
                          {Object.keys(entry.bindings).length} binding(s){' '}
                          {isSelfContained ? '· self-contained' : '· legacy (no clips)'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        {Object.entries(entry.bindings).map(([sem, clipId]) => {
                          const clipName = (() => {
                            const clips = (
                              entry as unknown as { clips?: { id: string; name: string }[] }
                            ).clips
                            if (Array.isArray(clips)) {
                              const found = clips.find((c) => c.id === clipId)
                              if (found) return found.name
                            }
                            return clipId.slice(0, 8)
                          })()
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
                            >
                              {sem} → {clipName}
                            </span>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button
                          aria-label={`Import ${entry.name} into project`}
                          title={`Import ${entry.name}`}
                          onClick={() => handleImport(entry)}
                        >
                          Import
                        </button>
                        <button
                          aria-label={`Delete ${entry.name} from library`}
                          title={`Delete ${entry.name}`}
                          onClick={() => setDeleteConfirm(entry)}
                        >
                          Delete
                        </button>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button
                            aria-label={`More options for ${entry.name}`}
                            onClick={() => setOverflowId(overflowId === entry.id ? null : entry.id)}
                            data-testid={`library-collection-ellipsis-${entry.id}`}
                          >
                            ⋯
                          </button>
                          {overflowId === entry.id && (
                            <div
                              role="menu"
                              data-testid={`library-collection-ellipsis-menu-${entry.id}`}
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: '100%',
                                background: 'var(--color-bg, #fff)',
                                border: '1px solid var(--color-border, #ddd)',
                                borderRadius: 6,
                                padding: 4,
                                zIndex: 10,
                                minWidth: 160,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              }}
                            >
                              <button
                                role="menuitem"
                                data-testid={`library-collection-reverse-${entry.id}`}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '6px 10px',
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                }}
                                onClick={() => {
                                  const defaultName = `${entry.name} Reversed`
                                  setReverseNameDraft(defaultName)
                                  setReversePrompt({ entry, defaultName })
                                  setOverflowId(null)
                                }}
                              >
                                Reverse and Save As…
                              </button>
                              <button
                                role="menuitem"
                                data-testid={`library-collection-mirror-${entry.id}`}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '6px 10px',
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                }}
                                onClick={() => {
                                  const axis: MirrorAxis = 'X'
                                  const defaultName = mirrorCollectionDefaultName(entry.name, axis)
                                  setMirrorAxis(axis)
                                  setMirrorNameDraft(defaultName)
                                  setMirrorPrompt({ entry, defaultName })
                                  setOverflowId(null)
                                }}
                              >
                                Mirror and Save As…
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
        <div className="projects-dialog__actions">
          <button className="projects-dialog__button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {deleteConfirm && (
        <div className="projects-overlay">
          <div className="projects-dialog" role="dialog" aria-label="Confirm delete">
            <p className="projects-dialog__message">
              Delete &ldquo;{deleteConfirm.name}&rdquo; from the shared library?
            </p>
            <p className="projects-dialog__message" style={{ fontSize: '0.85em', opacity: 0.7 }}>
              Projects that already imported this collection will keep their copy.
            </p>
            <div className="projects-dialog__actions">
              <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <ApplyClipCollectionModal
        open={applyCollectionId !== null}
        collectionId={applyCollectionId}
        onClose={() => setApplyCollectionId(null)}
      />
      {reversePrompt && (
        <div
          className="projects-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Reverse and Save As"
          data-testid="library-collection-reverse-modal"
        >
          <div
            className="projects-dialog"
            style={{ minWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
              ↺ Reverse and Save As… — time mirror
            </h3>
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              New collection name
              <input
                value={reverseNameDraft}
                onChange={(e) => setReverseNameDraft(e.target.value)}
                placeholder={reversePrompt.defaultName}
                autoFocus
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border)',
                }}
                data-testid="library-collection-reverse-name-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const name = reverseNameDraft.trim() || reversePrompt.defaultName
                    // Import if not in project, then reverse
                    importCollection(reversePrompt.entry, engine).then((importedId) => {
                      const sourceId = importedId ?? reversePrompt.entry.id
                      try {
                        engine.getClipCollection(sourceId)
                      } catch {
                        // Try to find by name
                      }
                      const res = dispatch(
                        new ReverseCollectionCommand({
                          sourceCollectionId: sourceId,
                          newName: name,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else notify(`Reversed collection "${name}" created`)
                      removeTemporaryImports(reversePrompt.entry.name, importedId)
                      setReversePrompt(null)
                    })
                  } else if (e.key === 'Escape') setReversePrompt(null)
                }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setReversePrompt(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border)',
                }}
                data-testid="library-collection-reverse-cancel"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const name = reverseNameDraft.trim() || reversePrompt.defaultName
                  const importedId = await importCollection(reversePrompt.entry, engine)
                  const sourceId = importedId ?? reversePrompt.entry.id
                  const res = dispatch(
                    new ReverseCollectionCommand({ sourceCollectionId: sourceId, newName: name }),
                  )
                  if (!res.ok) notify(res.error.message)
                  else notify(`Reversed collection "${name}" created`)
                  removeTemporaryImports(reversePrompt.entry.name, importedId)
                  setReversePrompt(null)
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid transparent',
                  background: '#7c5cff',
                  color: '#fff',
                }}
                data-testid="library-collection-reverse-confirm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {mirrorPrompt && (
        <div
          className="projects-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Mirror Collection and Save As"
          data-testid="library-collection-mirror-modal"
        >
          <div
            className="projects-dialog"
            style={{ minWidth: 380 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
              ⇋ Mirror Collection and Save As… — space mirror
            </h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}>
              Spatial mirror (X = left-right, Y = top-bottom). Timing is unchanged; lateral bindings
              swap sides; originals are untouched.
            </p>
            <fieldset style={{ margin: '0 0 12px', padding: '8px 10px', fontSize: 13 }}>
              <legend style={{ fontSize: 12 }}>Mirror axis</legend>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <input
                  type="radio"
                  name="library-mirror-collection-axis"
                  checked={mirrorAxis === 'X'}
                  data-testid="library-collection-mirror-axis-x"
                  onChange={() => {
                    setMirrorAxis('X')
                    const nextDefault = mirrorCollectionDefaultName(mirrorPrompt.entry.name, 'X')
                    setMirrorPrompt({ entry: mirrorPrompt.entry, defaultName: nextDefault })
                    if (
                      mirrorNameDraft.trim() === '' ||
                      mirrorNameDraft === mirrorPrompt.defaultName
                    ) {
                      setMirrorNameDraft(nextDefault)
                    }
                  }}
                />{' '}
                X — left-right
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="radio"
                  name="library-mirror-collection-axis"
                  checked={mirrorAxis === 'Y'}
                  data-testid="library-collection-mirror-axis-y"
                  onChange={() => {
                    setMirrorAxis('Y')
                    const nextDefault = mirrorCollectionDefaultName(mirrorPrompt.entry.name, 'Y')
                    setMirrorPrompt({ entry: mirrorPrompt.entry, defaultName: nextDefault })
                    if (
                      mirrorNameDraft.trim() === '' ||
                      mirrorNameDraft === mirrorPrompt.defaultName
                    ) {
                      setMirrorNameDraft(nextDefault)
                    }
                  }}
                />{' '}
                Y — top-bottom
              </label>
            </fieldset>
            <div
              data-testid="library-collection-mirror-preview"
              style={{ fontSize: 12, margin: '0 0 8px' }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Lateral binding swap</div>
              {(() => {
                const preview = buildMirrorSwapPreview(Object.keys(mirrorPrompt.entry.bindings))
                if (!preview.some((p) => p.swapped)) {
                  return (
                    <div style={{ color: 'var(--color-text-muted, #666)' }}>
                      No lateral names — bindings pass through unchanged.
                    </div>
                  )
                }
                return (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {preview.map((p) => (
                      <li key={p.source} style={{ fontFamily: 'monospace' }}>
                        {p.source} → {p.mirrored}
                        {!p.swapped && ' (unchanged)'}
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
            {(() => {
              // Skip preview for library entries: the entry may not be
              // imported yet, so fall back to a generic v1 scope note when
              // per-lane data is unavailable.
              try {
                const inProject = engine.getClipCollection(mirrorPrompt.entry.id)
                const lanes = collectMirrorSkippedLaneNames(
                  (function* () {
                    for (const clipId of Object.values(inProject.getBindingsObject())) {
                      try {
                        yield engine.getClip(clipId)
                      } catch {
                        void 0
                      }
                    }
                  })(),
                )
                if (lanes.length === 0) return null
                return (
                  <p
                    data-testid="library-collection-mirror-skips"
                    style={{
                      fontSize: 12,
                      color: 'var(--color-warning, #a60)',
                      margin: '0 0 8px',
                    }}
                  >
                    Not mirrored (out of scope for v1): {lanes.join(', ')}. These lanes stay
                    unchanged on the originals.
                  </p>
                )
              } catch {
                return (
                  <p
                    data-testid="library-collection-mirror-skips"
                    style={{
                      fontSize: 12,
                      color: 'var(--color-warning, #a60)',
                      margin: '0 0 8px',
                    }}
                  >
                    Circle/table lanes are out of scope for mirror v1 and stay unchanged on the
                    originals.
                  </p>
                )
              }
            })()}
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              New collection name
              <input
                value={mirrorNameDraft}
                onChange={(e) => setMirrorNameDraft(e.target.value)}
                placeholder={mirrorPrompt.defaultName}
                autoFocus
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border)',
                }}
                data-testid="library-collection-mirror-name-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const name = mirrorNameDraft.trim() || mirrorPrompt.defaultName
                    importCollection(mirrorPrompt.entry, engine).then((importedId) => {
                      const sourceId = importedId ?? mirrorPrompt.entry.id
                      const res = dispatch(
                        new MirrorCollectionCommand({
                          sourceCollectionId: sourceId,
                          newName: name,
                          axis: mirrorAxis,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else {
                        notify(`Mirrored collection "${name}" created`)
                        for (const s of res.inverse.skipped) notify(s)
                        for (const w of res.inverse.morphWarnings ?? []) notify(w)
                      }
                      removeTemporaryImports(mirrorPrompt.entry.name, importedId)
                      setMirrorPrompt(null)
                    })
                  } else if (e.key === 'Escape') setMirrorPrompt(null)
                }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setMirrorPrompt(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border)',
                }}
                data-testid="library-collection-mirror-cancel"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const name = mirrorNameDraft.trim() || mirrorPrompt.defaultName
                  const importedId = await importCollection(mirrorPrompt.entry, engine)
                  const sourceId = importedId ?? mirrorPrompt.entry.id
                  const res = dispatch(
                    new MirrorCollectionCommand({
                      sourceCollectionId: sourceId,
                      newName: name,
                      axis: mirrorAxis,
                    }),
                  )
                  if (!res.ok) notify(res.error.message)
                  else {
                    notify(`Mirrored collection "${name}" created`)
                    for (const s of res.inverse.skipped) notify(s)
                    for (const w of res.inverse.morphWarnings ?? []) notify(w)
                  }
                  removeTemporaryImports(mirrorPrompt.entry.name, importedId)
                  setMirrorPrompt(null)
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid transparent',
                  background: '#7c5cff',
                  color: '#fff',
                }}
                data-testid="library-collection-mirror-confirm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
