import { useEffect, useMemo, useState } from 'react'
import { useClipLibraryStore } from '../../stores/clipLibraryStore'
import type { ClipLibraryEntry } from '../../api'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  ReverseClipCommand,
  MirrorClipCommand,
  SetScriptLibraryEntryCommand,
  DeleteScriptLibraryEntryCommand,
} from '../../engine/commands'
import { mirrorClipDefaultName, mirrorSkippedLaneNames } from '../../engine/clipMirror'
import type { MirrorAxis } from '../../engine/clipMirror'
import {
  describeScriptFunctionSignature,
  parseScriptLibraryFunction,
} from '../../engine/animationScriptParser'
import type { ScriptLibraryEntry } from '../../engine/scriptLibrary'

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
  const [mirrorPrompt, setMirrorPrompt] = useState<{
    entry: ClipLibraryEntry
    defaultName: string
  } | null>(null)
  const [mirrorNameDraft, setMirrorNameDraft] = useState('')
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>('X')
  const [, setScriptTick] = useState(0)
  useEngineEvent(() => setScriptTick((tick) => tick + 1))
  const [scriptSearch, setScriptSearch] = useState('')
  const [scriptEditor, setScriptEditor] = useState<
    { mode: 'create' } | { mode: 'edit'; entry: ScriptLibraryEntry } | null
  >(null)
  const [scriptNameDraft, setScriptNameDraft] = useState('')
  const [scriptDescriptionDraft, setScriptDescriptionDraft] = useState('')
  const [scriptSourceDraft, setScriptSourceDraft] = useState('')
  const [scriptDeleteConfirm, setScriptDeleteConfirm] = useState<ScriptLibraryEntry | null>(null)

  useEffect(() => {
    if (visible && !loaded) {
      void loadLibrary()
    }
  }, [visible, loaded, loadLibrary])

  const scriptFunctions = useMemo(
    () => [...(engine.project?.scriptFunctions ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, engine.project?.scriptFunctions],
  )

  const filteredScripts = scriptFunctions.filter((entry) => {
    const query = scriptSearch.trim().toLowerCase()
    if (!query) return true
    return (
      entry.name.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query)
    )
  })

  const openScriptCreate = () => {
    setScriptNameDraft('')
    setScriptDescriptionDraft('')
    setScriptSourceDraft('function myFunction(target: node) {\n  target.fadeIn(0.4s)\n}')
    setScriptEditor({ mode: 'create' })
  }

  const openScriptEdit = (entry: ScriptLibraryEntry) => {
    setScriptNameDraft(entry.name)
    setScriptDescriptionDraft(entry.description)
    setScriptSourceDraft(entry.source)
    setScriptEditor({ mode: 'edit', entry })
  }

  const saveScriptEntry = () => {
    const name = scriptNameDraft.trim()
    if (!name) {
      notify('Script function name must not be empty')
      return
    }
    const params =
      scriptEditor?.mode === 'edit'
        ? {
            id: scriptEditor.entry.id,
            name,
            description: scriptDescriptionDraft,
            source: scriptSourceDraft,
          }
        : { name, description: scriptDescriptionDraft, source: scriptSourceDraft }
    const result = dispatch(new SetScriptLibraryEntryCommand(params))
    if (!result.ok) {
      notify(result.error.message)
      return
    }
    notify(
      scriptEditor?.mode === 'edit'
        ? `Script function "${name}" saved`
        : `Script function "${name}" created`,
    )
    setScriptEditor(null)
  }

  const confirmScriptDelete = () => {
    if (!scriptDeleteConfirm) return
    const result = dispatch(new DeleteScriptLibraryEntryCommand({ id: scriptDeleteConfirm.id }))
    if (!result.ok) {
      notify(result.error.message)
      return
    }
    notify(`Script function "${scriptDeleteConfirm.name}" deleted`)
    setScriptDeleteConfirm(null)
  }

  const scriptSignatureOf = (entry: ScriptLibraryEntry): string => {
    const parsed = parseScriptLibraryFunction(entry.source)
    if (parsed.def) return describeScriptFunctionSignature(parsed.def)
    return `${entry.name}(...)`
  }

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
                            <button
                              role="menuitem"
                              data-testid={`library-clip-mirror-${entry.id}`}
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
                                const defaultName = mirrorClipDefaultName(entry.name, axis)
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
                ))}
              </ul>
            )}
          </>
        )}
        <h3 style={{ margin: '16px 0 8px', fontSize: 13 }}>Script Functions</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}>
          Project-scoped Animation Script functions, stored in the .lesson file. Renaming an entry
          breaks call sites with a near-miss diagnostic — the source is never rewritten.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="search"
            aria-label="Search script functions"
            placeholder="Search functions"
            value={scriptSearch}
            onChange={(e) => setScriptSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={openScriptCreate} data-testid="script-function-create">
            New Function
          </button>
        </div>
        {filteredScripts.length === 0 && (
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            {scriptFunctions.length === 0
              ? 'No script functions yet. Create one to reuse across slides.'
              : 'No functions match your search.'}
          </p>
        )}
        {filteredScripts.length > 0 && (
          <ul style={{ maxHeight: 220, overflowY: 'auto', padding: 0, listStyle: 'none' }}>
            {filteredScripts.map((entry) => (
              <li
                key={entry.id}
                data-testid={`script-function-${entry.id}`}
                style={{
                  border: '1px solid var(--color-border, #ddd)',
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 13 }}>{entry.name}</strong>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>v{entry.version}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      aria-label={`Edit ${entry.name}`}
                      onClick={() => openScriptEdit(entry)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${entry.name}`}
                      onClick={() => setScriptDeleteConfirm(entry)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', marginTop: 4 }}>
                  {scriptSignatureOf(entry)}
                </div>
                {entry.description && (
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                    {entry.description}
                  </div>
                )}
              </li>
            ))}
          </ul>
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
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
              ↺ Reverse and Save As… — time mirror
            </h3>
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
      {mirrorPrompt && (
        <div
          className="projects-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Mirror and Save As"
          data-testid="library-mirror-modal"
        >
          <div
            className="projects-dialog"
            style={{ minWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
              ⇋ Mirror and Save As… — space mirror
            </h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}>
              Create a spatially mirrored copy (X = left-right, Y = top-bottom). Timing is
              unchanged; the original is untouched.
            </p>
            <fieldset style={{ margin: '0 0 12px', padding: '8px 10px', fontSize: 13 }}>
              <legend style={{ fontSize: 12 }}>Mirror axis</legend>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <input
                  type="radio"
                  name="library-mirror-axis"
                  checked={mirrorAxis === 'X'}
                  data-testid="library-mirror-axis-x"
                  onChange={() => {
                    const next: MirrorAxis = 'X'
                    setMirrorAxis(next)
                    const prevDefault = mirrorClipDefaultName(mirrorPrompt.entry.name, mirrorAxis)
                    const nextDefault = mirrorClipDefaultName(mirrorPrompt.entry.name, next)
                    setMirrorPrompt({ entry: mirrorPrompt.entry, defaultName: nextDefault })
                    if (mirrorNameDraft === prevDefault || mirrorNameDraft.trim() === '') {
                      setMirrorNameDraft(nextDefault)
                    }
                  }}
                />{' '}
                X — left-right
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="radio"
                  name="library-mirror-axis"
                  checked={mirrorAxis === 'Y'}
                  data-testid="library-mirror-axis-y"
                  onChange={() => {
                    const next: MirrorAxis = 'Y'
                    setMirrorAxis(next)
                    const prevDefault = mirrorClipDefaultName(mirrorPrompt.entry.name, mirrorAxis)
                    const nextDefault = mirrorClipDefaultName(mirrorPrompt.entry.name, next)
                    setMirrorPrompt({ entry: mirrorPrompt.entry, defaultName: nextDefault })
                    if (mirrorNameDraft === prevDefault || mirrorNameDraft.trim() === '') {
                      setMirrorNameDraft(nextDefault)
                    }
                  }}
                />{' '}
                Y — top-bottom
              </label>
            </fieldset>
            {(() => {
              try {
                const src = engine.getClip(mirrorPrompt.entry.id)
                const skipped = mirrorSkippedLaneNames(src)
                if (skipped.length === 0) return null
                return (
                  <p
                    data-testid="mirror-clip-skips"
                    style={{ fontSize: 12, color: 'var(--color-warning, #a60)', margin: '0 0 8px' }}
                  >
                    Not mirrored (out of scope for v1): {skipped.join(', ')}. These lanes stay
                    unchanged on the original.
                  </p>
                )
              } catch {
                return null
              }
            })()}
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              New clip name
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
                data-testid="library-mirror-name-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const name = mirrorNameDraft.trim() || mirrorPrompt.defaultName
                    let clipId = mirrorPrompt.entry.id
                    try {
                      engine.getClip(clipId)
                    } catch {
                      importClip(mirrorPrompt.entry)
                      clipId = mirrorPrompt.entry.id
                    }
                    const res = dispatch(
                      new MirrorClipCommand({
                        sourceClipId: clipId,
                        newName: name,
                        axis: mirrorAxis,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else {
                      notify(`Mirrored clip "${name}" created`)
                      for (const s of res.inverse.skipped) notify(s)
                    }
                    setMirrorPrompt(null)
                  } else if (e.key === 'Escape') setMirrorPrompt(null)
                }}
              />
            </label>
            <div className="projects-dialog__actions">
              <button onClick={() => setMirrorPrompt(null)} data-testid="library-mirror-cancel">
                Cancel
              </button>
              <button
                onClick={() => {
                  const name = mirrorNameDraft.trim() || mirrorPrompt.defaultName
                  let clipId = mirrorPrompt.entry.id
                  try {
                    engine.getClip(clipId)
                  } catch {
                    importClip(mirrorPrompt.entry)
                    clipId = mirrorPrompt.entry.id
                  }
                  const res = dispatch(
                    new MirrorClipCommand({
                      sourceClipId: clipId,
                      newName: name,
                      axis: mirrorAxis,
                    }),
                  )
                  if (!res.ok) notify(res.error.message)
                  else {
                    notify(`Mirrored clip "${name}" created`)
                    for (const s of res.inverse.skipped) notify(s)
                  }
                  setMirrorPrompt(null)
                }}
                data-testid="library-mirror-confirm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {scriptEditor && (
        <div
          className="projects-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            scriptEditor.mode === 'create' ? 'New script function' : 'Edit script function'
          }
          data-testid="script-function-modal"
        >
          <div
            className="projects-dialog"
            style={{ minWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
              {scriptEditor.mode === 'create'
                ? 'New Script Function'
                : `Edit ${scriptEditor.entry.name}`}
              {scriptEditor.mode === 'edit' && (
                <span style={{ fontWeight: 400, opacity: 0.7 }}>
                  {' '}
                  — v{scriptEditor.entry.version}
                </span>
              )}
            </h3>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
              Name (unique, case-insensitive)
              <input
                value={scriptNameDraft}
                onChange={(e) => setScriptNameDraft(e.target.value)}
                placeholder="fillConjugationTable"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px' }}
                data-testid="script-function-name-input"
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
              Description (one line, shown in the browser)
              <input
                value={scriptDescriptionDraft}
                onChange={(e) => setScriptDescriptionDraft(e.target.value)}
                placeholder="Fills a conjugation table row by row"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px' }}
                data-testid="script-function-description-input"
              />
            </label>
            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              Source (one function — the name must match)
              <textarea
                value={scriptSourceDraft}
                onChange={(e) => setScriptSourceDraft(e.target.value)}
                rows={10}
                spellCheck={false}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '6px 8px',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
                data-testid="script-function-source-input"
              />
            </label>
            <div className="projects-dialog__actions">
              <button onClick={() => setScriptEditor(null)} data-testid="script-function-cancel">
                Cancel
              </button>
              <button onClick={saveScriptEntry} data-testid="script-function-save">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {scriptDeleteConfirm && (
        <div className="projects-overlay">
          <div className="projects-dialog" role="dialog" aria-label="Confirm function delete">
            <p className="projects-dialog__message">
              Delete script function &ldquo;{scriptDeleteConfirm.name}&rdquo;? Scripts calling it
              will fail with a near-miss diagnostic.
            </p>
            <div className="projects-dialog__actions">
              <button onClick={() => setScriptDeleteConfirm(null)}>Cancel</button>
              <button onClick={confirmScriptDelete} data-testid="script-function-delete-confirm">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
