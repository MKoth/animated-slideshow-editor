import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { ExtractToClipCommand } from '../../engine/commands/extractToClipCommand'
import { computeExtractionBounds } from '../../engine/clipExtraction'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'

interface Props {
  readonly keyframes: readonly ExtractableKeyframe[]
  readonly onClose: () => void
}

export function ClipExtractionModal({ keyframes, onClose }: Props) {
  const { engine, dispatch } = useEngine()
  const clips = engine.clips

  const bounds = useMemo(() => {
    try {
      return computeExtractionBounds(keyframes)
    } catch {
      return null
    }
  }, [keyframes])

  const [mode, setMode] = useState<'new' | 'existing'>(clips.length > 0 ? 'existing' : 'new')
  const [selectedClipId, setSelectedClipId] = useState<string>(clips[0]?.id ?? '')
  const [name, setName] = useState('Extracted Clip')
  const [duration, setDuration] = useState<string>(bounds ? String(bounds.clipDuration) : '1')
  const [category, setCategory] = useState('extracted')
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = () => {
    setError(null)
    try {
      if (mode === 'new') {
        const dur = parseFloat(duration)
        if (!Number.isFinite(dur) || dur < 0) {
          setError('Duration must be a non-negative number')
          return
        }
        if (!name.trim()) {
          setError('Name is required')
          return
        }
        const result = dispatch(
          new ExtractToClipCommand({
            keyframes: [...keyframes],
            name: name.trim(),
            duration: dur,
            category: category.trim(),
          }),
        )
        if (!result.ok) {
          setError(result.error.message)
          return
        }
      } else {
        if (!selectedClipId) {
          setError('Select a clip')
          return
        }
        const result = dispatch(
          new ExtractToClipCommand({
            keyframes: [...keyframes],
            clipId: selectedClipId,
          }),
        )
        if (!result.ok) {
          setError(result.error.message)
          return
        }
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!bounds) {
    return (
      <div className="clip-extraction-modal" data-testid="clip-extraction-modal">
        <div className="clip-extraction-modal__backdrop" onClick={onClose} />
        <div className="clip-extraction-modal__content">
          <h3>Add to Clip</h3>
          <p>No keyframes selected</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="clip-extraction-modal" data-testid="clip-extraction-modal">
      <div className="clip-extraction-modal__backdrop" data-testid="clip-extraction-backdrop" onClick={onClose} />
      <div className="clip-extraction-modal__content" style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: 'var(--color-bg-panel, #fff)', border: '1px solid var(--color-border)', padding: 16, borderRadius: 8, zIndex: 1000, minWidth: 360 }}>
        <h3 style={{ margin: '0 0 12px' }}>Add to Clip</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
          {keyframes.length} keyframe(s) selected — time range {bounds.selStart.toFixed(2)}s to {bounds.selEnd.toFixed(2)}s ({bounds.clipDuration.toFixed(2)}s duration)
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="clip-extraction-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
            New clip
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: clips.length === 0 ? 0.5 : 1 }}>
            <input type="radio" name="clip-extraction-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={clips.length === 0} />
            Existing clip
          </label>
        </div>

        {mode === 'new' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label>
              Name
              <input
                data-testid="clip-extraction-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label>
              Duration (s)
              <input
                data-testid="clip-extraction-duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label>
              Category
              <input
                data-testid="clip-extraction-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          </div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4 }}>
            {clips.map((clip) => (
              <label key={clip.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', background: selectedClipId === clip.id ? 'var(--color-bg-elevated)' : undefined }}>
                <input
                  type="radio"
                  name="existing-clip"
                  checked={selectedClipId === clip.id}
                  onChange={() => setSelectedClipId(clip.id)}
                />
                <span style={{ fontSize: 13 }}>{clip.name}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                  {clip.duration}s · {clip.category || 'uncategorized'}
                </span>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div data-testid="clip-extraction-error" style={{ color: 'var(--color-error, red)', fontSize: 12, marginTop: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button data-testid="clip-extraction-confirm" onClick={handleConfirm} style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 4 }}>
            {mode === 'new' ? 'Create Clip' : 'Add to Clip'}
          </button>
        </div>
      </div>
    </div>
  )
}
