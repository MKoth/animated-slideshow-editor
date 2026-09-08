import { useEffect, useState } from 'react'
import { useClipCollectionLibraryStore } from '../../stores/clipCollectionLibraryStore'
import type { ClipCollectionLibraryEntry } from '../../api'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEngine } from '../../app/useEngine'
import { ApplyClipCollectionModal } from './ApplyClipCollectionModal'
import { ReverseCollectionCommand } from '../../engine/commands'

export function CollectionLibraryBrowser({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
  const [deleteConfirm, setDeleteConfirm] = useState<ClipCollectionLibraryEntry | null>(null)
  const [applyCollectionId, setApplyCollectionId] = useState<string | null>(null)
  const [overflowId, setOverflowId] = useState<string | null>(null)
  const [reversePrompt, setReversePrompt] = useState<{ entry: ClipCollectionLibraryEntry; defaultName: string } | null>(null)
  const [reverseNameDraft, setReverseNameDraft] = useState('')

  useEffect(() => {
    // Refresh on every open so project changes cannot leave the browser showing
    // an old in-memory snapshot of the shared backend library.
    if (visible) void loadLibrary()
  }, [visible, loadLibrary])

  if (!visible) return null

  const filtered = definitions.filter((entry) => {
    return !search.trim() || entry.name.toLowerCase().includes(search.trim().toLowerCase())
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
      <div className="projects-dialog" role="dialog" aria-label="Browse Collection Library" style={{ maxWidth: 600, width: '100%' }}>
        <h2 className="projects-dialog__title">Browse Collection Library</h2>
        {error && (
          <div className="panel-status panel-status--error" role="alert">
            <p>{error}</p>
            <button aria-label="Dismiss error" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {unavailable && <p className="projects-dialog__message">Backend unavailable. Library cannot be loaded.</p>}
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
                      style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: 8 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ flex: 1, fontSize: 12 }}>{entry.name}</strong>
                        <span
                          style={{
                            fontSize: 11,
                            color: isSelfContained ? 'var(--color-success, green)' : 'var(--color-danger)',
                          }}
                        >
                          {Object.keys(entry.bindings).length} binding(s){' '}
                          {isSelfContained ? '· self-contained' : '· legacy (no clips)'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        {Object.entries(entry.bindings).map(([sem, clipId]) => {
                          const clipName = (() => {
                            const clips = (entry as unknown as { clips?: { id: string; name: string }[] }).clips
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
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12 }}
                                onClick={() => {
                                  const defaultName = `${entry.name} Reversed`
                                  setReverseNameDraft(defaultName)
                                  setReversePrompt({ entry, defaultName })
                                  setOverflowId(null)
                                }}
                              >
                                Reverse and Save As…
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
            <p className="projects-dialog__message">Delete &ldquo;{deleteConfirm.name}&rdquo; from the shared library?</p>
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
        <div className="projects-overlay" role="dialog" aria-modal="true" aria-label="Reverse and Save As" data-testid="library-collection-reverse-modal">
          <div className="projects-dialog" style={{ minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Reverse and Save As…</h3>
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              New collection name
              <input
                value={reverseNameDraft}
                onChange={(e) => setReverseNameDraft(e.target.value)}
                placeholder={reversePrompt.defaultName}
                autoFocus
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }}
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
                      const res = dispatch(new ReverseCollectionCommand({ sourceCollectionId: sourceId, newName: name }))
                      if (!res.ok) notify(res.error.message)
                      else notify(`Reversed collection "${name}" created`)
                      setReversePrompt(null)
                    })
                  } else if (e.key === 'Escape') setReversePrompt(null)
                }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setReversePrompt(null)} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)' }} data-testid="library-collection-reverse-cancel">
                Cancel
              </button>
              <button
                onClick={async () => {
                  const name = reverseNameDraft.trim() || reversePrompt.defaultName
                  const importedId = await importCollection(reversePrompt.entry, engine)
                  const sourceId = importedId ?? reversePrompt.entry.id
                  const res = dispatch(new ReverseCollectionCommand({ sourceCollectionId: sourceId, newName: name }))
                  if (!res.ok) notify(res.error.message)
                  else notify(`Reversed collection "${name}" created`)
                  setReversePrompt(null)
                }}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid transparent', background: '#7c5cff', color: '#fff' }}
                data-testid="library-collection-reverse-confirm"
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
