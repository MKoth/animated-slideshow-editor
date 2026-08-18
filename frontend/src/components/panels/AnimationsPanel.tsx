import { useEffect, useState } from 'react'
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
      event.type === 'KeyframeValueChanged'
    ) {
      setTick((t) => t + 1)
    }
  })

  useEffect(() => {
    initClipLibraryStore(dispatch as Parameters<typeof initClipLibraryStore>[0])
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

  return (
    <div className="animations-panel">
      <div className="animations-toolbar">
        <div className="animations-toolbar__row">
          <button className="animations-toolbar__create" onClick={handleCreate}>
            Create Clip
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
    </div>
  )
}
