import { useState } from 'react'

export interface CollectionKeyframeChoice {
  readonly placementId: string
  readonly name: string
  readonly start: number
  readonly end: number
}

export function CollectionKeyframePickerModal({
  choices,
  hasAttachedKeyframes = false,
  initialPlacementId,
  onClose,
  onAttach,
}: {
  choices: readonly CollectionKeyframeChoice[]
  hasAttachedKeyframes?: boolean
  initialPlacementId?: string
  onClose: () => void
  onAttach: (placementId: string, deleteAttached: boolean) => void
}) {
  const [placementId, setPlacementId] = useState(
    initialPlacementId ?? choices[0]?.placementId ?? '',
  )
  const [deleteAttached, setDeleteAttached] = useState(false)
  if (choices.length === 0 && !hasAttachedKeyframes) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Attach keyframes to collection"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg, #fff)',
          color: 'var(--color-text, #000)',
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 8,
          padding: 16,
          width: 420,
          maxWidth: '90vw',
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>Attach keyframes to collection</h3>
        <label style={{ display: 'grid', gap: 6 }}>
          Collection
          <select
            aria-label="Collection"
            value={placementId}
            onChange={(event) => setPlacementId(event.target.value)}
          >
            <option value="">No collection (detach)</option>
            {choices.map((choice) => (
              <option key={choice.placementId} value={choice.placementId}>
                {choice.name} ({choice.start.toFixed(2)}–{choice.end.toFixed(2)}s)
              </option>
            ))}
          </select>
        </label>
        {hasAttachedKeyframes && (
          <fieldset style={{ marginTop: 12 }}>
            <legend>Previously attached keyframes</legend>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="attached-keyframe-choice"
                checked={!deleteAttached}
                onChange={() => setDeleteAttached(false)}
              />
              Leave them as they are
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="attached-keyframe-choice"
                checked={deleteAttached}
                onChange={() => setDeleteAttached(true)}
              />
              Delete attached keyframes
            </label>
          </fieldset>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button
            onClick={() => onAttach(placementId, deleteAttached)}
            data-testid="confirm-collection-attachment"
          >
            Attach
          </button>
        </div>
      </div>
    </div>
  )
}
