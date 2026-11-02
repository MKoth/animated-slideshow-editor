import { useState } from 'react'
import { usePopularAudioStore } from '../../stores/popularAudioStore'
import { WaveformEditorModal } from './WaveformEditorModal'
import { useEngine } from '../../app/useEngine'
import { cropAudioToWav } from '../../audio/recording'

export function PopularAudioModal({
  onClose,
  onAdd,
  slideId,
}: {
  onClose: () => void
  onAdd: (id: string) => void
  slideId: string
}) {
  const recordings = usePopularAudioStore((state) => state.recordings)
  const rename = usePopularAudioStore((state) => state.rename)
  const remove = usePopularAudioStore((state) => state.remove)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingCopy, setPendingCopy] = useState<
    import('../../stores/popularAudioStore').PopularAudio | null
  >(null)
  const [newCopyName, setNewCopyName] = useState('')
  const recording = recordings.find((item) => item.id === editingId) ?? null
  return (
    <div
      data-testid="popular-audio-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="popular-audio-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,.65)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Popular recordings"
        data-testid="popular-audio-modal"
        className="popular-audio-dialog"
        style={{
          width: 'min(720px, 90vw)',
          maxHeight: '80vh',
          overflow: 'auto',
          background: '#20202b',
          color: '#eee',
          border: '1px solid #6250a8',
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 16px 60px #000',
        }}
      >
        <header className="popular-audio-dialog__header">
          <div>
            <span className="popular-audio-dialog__eyebrow">AUDIO LIBRARY</span>
            <h2>Popular recordings</h2>
            <p>Your saved copies, ready to reuse on any slide.</p>
          </div>
          <button className="popular-audio-dialog__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {recordings.length === 0 ? (
          <p className="popular-audio-empty">
            No saved recordings yet. Right-click an audio clip and choose “Save to popular
            recordings”.
          </p>
        ) : (
          recordings.map((recording) => (
            <article key={recording.id} className="popular-audio-card">
              <div className="popular-audio-card__main">
                <span className="popular-audio-card__icon">♫</span>
                <input
                  aria-label="Recording name"
                  value={recording.name}
                  onChange={(event) => rename(recording.id, event.target.value)}
                  className="popular-audio-card__name"
                />
                <button
                  className="popular-audio-button popular-audio-button--primary"
                  onClick={() => onAdd(recording.id)}
                >
                  Add to timeline
                </button>
                <button
                  className="popular-audio-button"
                  onClick={() => {
                    if (editingId === recording.id) {
                      setEditingId(null)
                      return
                    }
                    setEditingId(recording.id)
                  }}
                >
                  {editingId === recording.id ? 'Close editor' : 'Edit waveform'}
                </button>
                <button
                  className="popular-audio-button popular-audio-button--danger"
                  aria-label={`Delete ${recording.name}`}
                  onClick={() => remove(recording.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      {recording && (
        <PopularAudioEditModal
          recording={recording}
          slideId={slideId}
          onClose={() => setEditingId(null)}
          onSave={async (values) => {
            const { deletedRange, ...recordingValues } = values
            const cropped = await cropAudioToWav(
              recording.data,
              values.sourceStart,
              values.sourceEnd,
              deletedRange,
            )
            const name = `${recording.name} (edited)`
            setPendingCopy({
              ...recording,
              ...recordingValues,
              ...cropped,
              mimeType: 'audio/wav',
              sourceStart: 0,
              sourceEnd: cropped.duration,
              id: `popular-audio-${crypto.randomUUID()}`,
              name,
            })
            setNewCopyName(name)
          }}
        />
      )}
      {pendingCopy && (
        <div className="popular-audio-name-backdrop" data-testid="popular-audio-name-dialog">
          <form
            className="popular-audio-name-dialog__content"
            onSubmit={(event) => {
              event.preventDefault()
              const name = newCopyName.trim()
              if (!name) return
              usePopularAudioStore.getState().add({ ...pendingCopy, name })
              setPendingCopy(null)
            }}
          >
            <h3>Save edited copy</h3>
            <p>The original recording will stay in Popular recordings.</p>
            <label>
              New copy name
              <input
                autoFocus
                aria-label="New copy name"
                value={newCopyName}
                onChange={(event) => setNewCopyName(event.target.value)}
              />
            </label>
            <div className="popular-audio-name-dialog__actions">
              <button
                type="button"
                className="popular-audio-button"
                onClick={() => setPendingCopy(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="popular-audio-button popular-audio-button--primary"
                disabled={!newCopyName.trim()}
              >
                Save copy
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function PopularAudioEditModal({
  recording,
  slideId,
  onClose,
  onSave,
}: {
  recording: import('../../stores/popularAudioStore').PopularAudio
  slideId: string
  onClose: () => void
  onSave: (
    values: Pick<
      import('../../stores/popularAudioStore').PopularAudio,
      'sourceStart' | 'sourceEnd' | 'playbackRate' | 'pitchSemitones' | 'noiseReduction'
    > & { deletedRange?: { start: number; end: number } },
  ) => void | Promise<void>
}) {
  const { engine } = useEngine()
  const assetId = `popular-asset-${recording.id}`
  if (!engine.getEmbeddedAsset(assetId))
    engine.embedAsset({
      id: assetId,
      name: recording.name,
      data: recording.data,
      mimeType: recording.mimeType,
      metadata: { duration: recording.duration, waveformPeaks: recording.waveformPeaks },
    })
  return (
    <WaveformEditorModal
      slideId={slideId}
      clipId={`popular-editor-${recording.id}`}
      libraryRecording={recording}
      onSaveLibrary={onSave}
      onClose={onClose}
    />
  )
}
