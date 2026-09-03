

interface AudioEffectsMismatchDialogProps {
  readonly derivedDuration: number
  readonly prompterDuration: number
  readonly partText: string
  readonly onChoice: (choice: 'stretch' | 'trim' | 'shift') => void
  readonly onClose: () => void
}

export function AudioEffectsMismatchDialog({
  derivedDuration,
  prompterDuration,
  partText,
  onChoice,
  onClose,
}: AudioEffectsMismatchDialogProps) {
  const diff = derivedDuration - prompterDuration
  const isLonger = diff > 0
  const absDiff = Math.abs(diff)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Audio length mismatch"
      data-testid="audio-effects-mismatch-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 600,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: '#1e1e2e',
          border: '1px solid #333',
          borderRadius: 10,
          width: 520,
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Audio length mismatch</h3>
        <p style={{ fontSize: 11, color: '#aaa', margin: '0 0 4px' }}>
          Derived audio {derivedDuration.toFixed(2)}s vs PrompterPart {prompterDuration.toFixed(2)}s
          {' '}
          (Δ {absDiff.toFixed(2)}s {isLonger ? 'longer' : 'shorter'}) — part “{partText.slice(0, 40)}”
        </p>
        <p style={{ fontSize: 10, color: '#777', margin: '0 0 8px' }}>
          Original asset bytes never rewritten — preview via Web Audio OfflineAudioContext, bake at export via FFmpeg RubberBand.
          Choose how to resolve the mismatch. Each choice is a single Transaction (one undo entry).
        </p>
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column', marginTop: 12 }}>
          <button
            data-testid="mismatch-stretch-audio"
            onClick={() => onChoice('stretch')}
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #7c5cff',
              background: '#7c5cff',
              color: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 11,
            }}
          >
            <strong>Stretch Audio (rubberband to fit)</strong> — adjust playbackRate via RubberBand (pitch preserved, formant preserved) to fit PrompterPart. Export uses <code>rubberband=tempo={(prompterDuration / derivedDuration).toFixed(3)}</code>
          </button>
          <button
            data-testid="mismatch-trim-prompter"
            onClick={() => onChoice('trim')}
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#2a2a3a',
              color: '#e0e0e0',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 11,
            }}
          >
            <strong>Trim/Split PrompterPart</strong> — set PrompterPart.duration to {derivedDuration.toFixed(2)}s (no shift). Gap-free stays, downstream untouched.
          </button>
          <button
            data-testid="mismatch-shift-downstream"
            onClick={() => onChoice('shift')}
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#2a2a3a',
              color: '#e0e0e0',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 11,
            }}
          >
            <strong>Shift Downstream (reflow)</strong> — set duration to {derivedDuration.toFixed(2)}s and shift downstream parts + clips gap-free (UpdatePrompterPartWithShift). Mirrors prompter reflow.
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            data-testid="mismatch-cancel"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#2a2a3a',
              color: '#e0e0e0',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
