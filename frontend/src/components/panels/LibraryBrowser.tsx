import { useEffect, useState } from 'react'
import { useClipLibraryStore } from '../../stores/clipLibraryStore'
import type { ClipLibraryEntry } from '../../api'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEngine } from '../../app/useEngine'
import { ReverseClipCommand } from '../../engine/commands'

function formatDuration(seconds: number): string {
  return `${seconds}s`
}

export function LibraryBrowser() {
  const visible = useClipLibraryStore((state) => state.libraryBrowserVisible)
  const definitions = useClipLibraryStore((state) => state.definitions)
  const loaded = useClipLibraryStore((state) => state.loaded)
  const loading = useClipLibraryStore((state) => state.loading)
  const error = useClipLibraryStore((state) => state.error)
  const unavailable = useClipLibraryStore((state) => state.unavailable)
  const loadLibrary = useClipLibraryStore((state) => state.loadLibrary)
  const closeBrowser = useClipLibraryStore((state) => state.closeLibraryBrowser)
  const deleteFromLibrary = useClipLibraryStore((state) => state.deleteFromLibrary)
  const importClip = useClipLibraryStore((state) => state.importClipFromLibrary)
  const clearError = useClipLibraryStore((state) => state.clearError)
  const notify = useNotificationStore((state) => state.notify)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<ClipLibraryEntry | null>(null)
  const { engine, dispatch } = useEngine()
  const [overflowId, setOverflowId] = useState<string | null>(null)
  const [reversePrompt, setReversePrompt] = useState<{
    entry: ClipLibraryEntry
    defaultName: string
  } | null>(null)
  const [reverseNameDraft, setReverseNameDraft] = useState('')

  useEffect(() => {
    if (visible && !loaded) {
      void loadLibrary()
    }
  }, [visible, loaded, loadLibrary])

  if (!visible) {
    return null
  }

  const categories = Array.from(
    new Set(definitions.map((d) => d.category).filter((c): c is string => Boolean(c))),
  ).sort()

  const filtered = definitions.filter((entry) => {
    const matchesSearch =
      !search.trim() || entry.name.toLowerCase().includes(search.trim().toLowerCase())
    const matchesCategory = !categoryFilter || entry.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const handleImport = (entry: ClipLibraryEntry) => {
    importClip(entry)
    notify(`Clip "${entry.name}" imported into project`)
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    const name = deleteConfirm.name
    await deleteFromLibrary(deleteConfirm.id)
    notify(`Clip "${name}" deleted from library`)
    setDeleteConfirm(null)
  }

  return (
    <div className="projects-overlay">
      <div
        className="projects-dialog"
        role="dialog"
        aria-label="Browse Library"
        style={{ maxWidth: 600, width: '100%' }}
      >
        <h2 className="projects-dialog__title">Browse Library</h2>
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
                aria-label="Search library clips"
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
                <option value="">All categories</option>
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
                    ? 'Library is empty. Save clips from the Animations panel to populate it.'
                    : 'No clips match your search.'}
                </p>
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <ul className="animation-grid" style={{ maxHeight: 400, overflowY: 'auto' }}>
                {filtered.map((entry) => (
                  <li key={entry.id} className="animation-grid__item">
                    <div className="animation-cell">
                      <span className="animation-cell__thumbnail" aria-hidden="true" />
                      <span className="animation-cell__name">{entry.name}</span>
                      <span className="animation-cell__duration">
                        {formatDuration(entry.duration)}
                      </span>
                      {entry.category && (
                        <span className="animation-cell__category">{entry.category}</span>
                      )}
                      <span className="animation-cell__category">{entry.channels.length} ch</span>
                    </div>
                    <div className="animation-cell__actions">
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
                          data-testid={`library-clip-ellipsis-${entry.id}`}
                        >
                          ⋯
                        </button>
                        {overflowId === entry.id && (
                          <div
                            role="menu"
                            data-testid={`library-clip-ellipsis-menu-${entry.id}`}
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
                              data-testid={`library-clip-reverse-${entry.id}`}
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
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="projects-dialog__actions">
          <button className="projects-dialog__button" onClick={closeBrowser}>
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
              Projects that already imported this clip will keep their copy.
            </p>
            <div className="projects-dialog__actions">
              <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {reversePrompt && (
        <div
          className="projects-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Reverse and Save As"
          data-testid="library-reverse-modal"
        >
          <div
            className="projects-dialog"
            style={{ minWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Reverse and Save As…</h3>
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              New clip name
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
                data-testid="library-reverse-name-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const name = reverseNameDraft.trim() || reversePrompt.defaultName
                    // Ensure clip is in project, then reverse
                    let clipId = reversePrompt.entry.id
                    try {
                      engine.getClip(clipId)
                    } catch {
                      // Import first
                      importClip(reversePrompt.entry)
                      clipId = reversePrompt.entry.id
                    }
                    const res = dispatch(
                      new ReverseClipCommand({ sourceClipId: clipId, newName: name }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else notify(`Reversed clip "${name}" created`)
                    setReversePrompt(null)
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
                data-testid="library-reverse-cancel"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const name = reverseNameDraft.trim() || reversePrompt.defaultName
                  let clipId = reversePrompt.entry.id
                  try {
                    engine.getClip(clipId)
                  } catch {
                    importClip(reversePrompt.entry)
                    clipId = reversePrompt.entry.id
                  }
                  const res = dispatch(
                    new ReverseClipCommand({ sourceClipId: clipId, newName: name }),
                  )
                  if (!res.ok) notify(res.error.message)
                  else notify(`Reversed clip "${name}" created`)
                  setReversePrompt(null)
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid transparent',
                  background: '#7c5cff',
                  color: '#fff',
                }}
                data-testid="library-reverse-confirm"
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
