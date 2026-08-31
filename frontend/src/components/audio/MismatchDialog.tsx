import { useState } from 'react'
import type { PrompterMismatchKind } from '../../engine/prompter'

interface MismatchDialogProps {
  plannedDuration: number
  recordedDuration: number
  kind: PrompterMismatchKind
  onChoice: (choice: 'speed' | 'extend' | 'keep' | 'discard' | 'slow', shift: boolean) => void
  onClose: () => void
}

export function MismatchDialog({ plannedDuration, recordedDuration, kind, onChoice, onClose }: MismatchDialogProps) {
  const [shift, setShift] = useState(false)
  const diff = Math.abs(recordedDuration - plannedDuration)
  const threshold = Math.max(0.3, 0.05 * plannedDuration)
  const isLonger = kind === 'longer'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Duration mismatch"
      data-testid="mismatch-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 101,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: 8, width: 480, padding: 16, color: '#e0e0e0' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Duration mismatch</h3>
        <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
          Recorded {recordedDuration.toFixed(2)}s vs planned {plannedDuration.toFixed(2)}s (Δ {diff.toFixed(2)}s &gt; {threshold.toFixed(2)}s — max(0.3 s, 5% planned))
        </p>
        <p style={{ fontSize: 11, color: '#aaa', margin: '8px 0' }}>
          Original WAV preserved — <strong>time stretch</strong> (not playbackRate pitch-shift). Tempo stays the same, pitch &amp; formants preserved via RubberBand: preview by WASM offline, export by FFmpeg. <code>playbackRate={(recordedDuration / plannedDuration).toFixed(3)}</code> → <code>timeRatio={(plannedDuration / recordedDuration).toFixed(3)}</code> (output/input).
        </p>
        <p style={{ fontSize: 10, color: '#777', margin: '0 0 4px' }}>
          <em>Speed ↑ → duration ↓, pitch ≈ unchanged</em> — WSOLA/Phase-vocoder quality, good for 0.5×–2× speech. Extreme values may add light metallic smearing.
        </p>
        {isLonger ? (
          <div style={{ display: 'flex', gap: 8, flexDirection: 'column', marginTop: 12 }}>
            <button
              data-testid="mismatch-speed-up"
              onClick={() => onChoice('speed', false)}
              style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #7c5cff', background: '#7c5cff', color: '#fff', cursor: 'pointer', textAlign: 'left' }}
            >
              <strong>Speed up (time stretch)</strong> — tempo {(recordedDuration / plannedDuration).toFixed(3)}×, timeRatio {(plannedDuration / recordedDuration).toFixed(3)} — pitch preserved
            </button>
            <button
              data-testid="mismatch-extend"
              onClick={() => onChoice('extend', shift)}
              style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer', textAlign: 'left' }}
            >
              <strong>Extend duration</strong> — set part duration to {recordedDuration.toFixed(2)}s
            </button>
            <button
              data-testid="mismatch-discard"
              onClick={() => onChoice('discard', false)}
              style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer', textAlign: 'left' }}
            >
              Discard recording
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexDirection: 'column', marginTop: 12 }}>
            <button
              data-testid="mismatch-slow-down"
              onClick={() => onChoice('slow', false)}
              style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #7c5cff', background: '#7c5cff', color: '#fff', cursor: 'pointer', textAlign: 'left' }}
            >
              <strong>Slow down (time stretch)</strong> — tempo {(recordedDuration / plannedDuration).toFixed(3)}×, timeRatio {(plannedDuration / recordedDuration).toFixed(3)} — pitch preserved
            </button>
            <button
              data-testid="mismatch-keep-shorter"
              onClick={() => onChoice('keep', shift)}
              style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer', textAlign: 'left' }}
            >
              <strong>Keep shorter</strong> — set part duration to {recordedDuration.toFixed(2)}s
            </button>
            <button
              data-testid="mismatch-discard"
              onClick={() => onChoice('discard', false)}
              style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer', textAlign: 'left' }}
            >
              Discard recording
            </button>
          </div>
        )}
        {(kind === 'longer' || kind === 'shorter') && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, fontSize: 11, color: '#aaa' }}>
            <input data-testid="mismatch-shift-checkbox" type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
            Move following parts + clips (single-Slide UpdatePrompterPartWithShift transaction)
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} data-testid="mismatch-close" style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
