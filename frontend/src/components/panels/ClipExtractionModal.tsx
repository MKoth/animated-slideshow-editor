import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { ExtractToClipCommand } from '../../engine/commands/extractToClipCommand'
import { computeExtractionBounds } from '../../engine/clipExtraction'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import { SHADOW_LABELS } from '../../engine/shadowEffect'
import type { ShadowProperty } from '../../engine/shadowEffect'

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

  // Shadow section: list only animated shadow props (checked by default), normalizing each to shadow:${property}
  const shadowProps = useMemo(() => {
    const set = new Set<ShadowProperty>()
    for (const kf of keyframes) {
      if (kf.target.kind === 'shadow') {
        set.add(kf.target.property)
      }
    }
    return [...set].sort()
  }, [keyframes])

  const [enabledShadowProps, setEnabledShadowProps] = useState<Set<ShadowProperty>>(
    () => new Set(shadowProps),
  )

  const toggleShadowProp = (prop: ShadowProperty, checked: boolean) => {
    setEnabledShadowProps((prev) => {
      const next = new Set(prev)
      if (checked) next.add(prop)
      else next.delete(prop)
      return next
    })
  }

  const filteredKeyframes = useMemo(() => {
    if (shadowProps.length === 0) return keyframes
    return keyframes.filter((kf) => {
      if (kf.target.kind !== 'shadow') return true
      return enabledShadowProps.has(kf.target.property)
    })
  }, [keyframes, shadowProps, enabledShadowProps])

  const filteredBounds = useMemo(() => {
    try {
      return computeExtractionBounds(filteredKeyframes)
    } catch {
      return null
    }
  }, [filteredKeyframes])

  const handleConfirm = () => {
    setError(null)
    if (filteredKeyframes.length === 0) {
      setError('No keyframes selected — enable at least one shadow property or select keyframes')
      return
    }
    if (shadowProps.length > 0 && enabledShadowProps.size === 0) {
      setError('Select at least one shadow property')
      return
    }
    // Validate normalized extraction will keep [0,1] for shadow channels via normalizeExtractable
    // Compute bounds from filtered selection to ensure correct duration
    if (!filteredBounds) {
      setError('No keyframes to extract')
      return
    }
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
            keyframes: [...filteredKeyframes],
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
            keyframes: [...filteredKeyframes],
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

  // Display bounds for the filtered selection when Shadow filtering active
  const displayBounds = filteredBounds ?? bounds
  const displayCount = filteredKeyframes.length
  return (
    <div className="clip-extraction-modal" data-testid="clip-extraction-modal">
      <div
        className="clip-extraction-modal__backdrop"
        data-testid="clip-extraction-backdrop"
        onClick={onClose}
      />
      <div
        className="clip-extraction-modal__content"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-bg-panel, #fff)',
          border: '1px solid var(--color-border)',
          padding: 16,
          borderRadius: 8,
          zIndex: 1000,
          minWidth: 360,
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>Add to Clip</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
          {displayCount} keyframe(s) selected
          {displayCount !== keyframes.length ? ` (filtered from ${keyframes.length})` : ''} — time
          range{' '}
          {displayBounds
            ? `${displayBounds.selStart.toFixed(2)}s to ${displayBounds.selEnd.toFixed(2)}s (${displayBounds.clipDuration.toFixed(2)}s duration)`
            : '—'}
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name="clip-extraction-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            New clip
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: clips.length === 0 ? 0.5 : 1,
            }}
          >
            <input
              type="radio"
              name="clip-extraction-mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              disabled={clips.length === 0}
            />
            Existing clip
          </label>
        </div>

        {shadowProps.length > 0 && (
          <div
            data-testid="clip-extraction-shadow-section"
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: 8,
              marginBottom: 12,
              background: 'var(--color-bg-elevated, #f7f7f7)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Shadow</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
              Only animated shadow props — checked by default, normalized to{' '}
              <code>shadow:${'{property}'}</code> in [0,1]
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {shadowProps.map((prop) => (
                <label
                  key={prop}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                >
                  <input
                    type="checkbox"
                    data-testid={`shadow-prop-${prop}`}
                    checked={enabledShadowProps.has(prop)}
                    onChange={(e) => toggleShadowProp(prop, e.target.checked)}
                  />
                  <span>{SHADOW_LABELS[prop]} </span>
                  <code
                    style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
                  >{`shadow:${prop}`}</code>
                  <span
                    style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)' }}
                  >
                    {
                      keyframes.filter(
                        (k) =>
                          k.target.kind === 'shadow' &&
                          (k.target as { property: ShadowProperty }).property === prop,
                      ).length
                    }{' '}
                    keyframe(s)
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

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
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
            }}
          >
            {clips.map((clip) => (
              <label
                key={clip.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  background: selectedClipId === clip.id ? 'var(--color-bg-elevated)' : undefined,
                }}
              >
                <input
                  type="radio"
                  name="existing-clip"
                  checked={selectedClipId === clip.id}
                  onChange={() => setSelectedClipId(clip.id)}
                />
                <span style={{ fontSize: 13 }}>{clip.name}</span>
                <span
                  style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}
                >
                  {clip.duration}s · {clip.category || 'uncategorized'}
                </span>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div
            data-testid="clip-extraction-error"
            style={{ color: 'var(--color-error, red)', fontSize: 12, marginTop: 8 }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            data-testid="clip-extraction-confirm"
            onClick={handleConfirm}
            style={{
              background: 'var(--color-accent)',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 4,
            }}
          >
            {mode === 'new' ? 'Create Clip' : 'Add to Clip'}
          </button>
        </div>
      </div>
    </div>
  )
}
