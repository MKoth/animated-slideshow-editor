import { useState } from 'react'
import type { AudioTrackId } from '../../engine/audioClip'
import {
  useAudioResizePreferenceStore,
  type AudioResizeMode,
} from '../../stores/audioResizePreferenceStore'

interface AudioClipResizeDialogProps {
  trackId: AudioTrackId
  onChoice: (mode: AudioResizeMode, dontAskAgain: boolean) => void
  onClose: () => void
}

export function AudioClipResizeDialog({ trackId, onChoice, onClose }: AudioClipResizeDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false)

  const handleChoice = (mode: AudioResizeMode) => {
    if (dontAskAgain) {
      useAudioResizePreferenceStore.getState().setPreference(trackId, mode)
    }
    onChoice(mode, dontAskAgain)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resize audio clip"
      data-testid="audio-resize-dialog"
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
      <div
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          width: 480,
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Resize audio clip</h3>
        <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
          How should the clip be resized? Choose an option for the <strong>{trackId}</strong> track.
        </p>
        <p style={{ fontSize: 11, color: '#aaa', margin: '8px 0' }}>
          Original WAV preserved — <strong>time stretch</strong> (not playbackRate pitch-shift).
          Tempo stays the same, pitch &amp; formants preserved via RubberBand: preview by WASM
          offline, export by FFmpeg. <code>playbackRate</code> derived, original AudioAsset bytes
          never rewritten.
        </p>
        <p style={{ fontSize: 10, color: '#777', margin: '0 0 4px' }}>
          <em>Trim = hard cut</em> (edit <code>sourceStart</code>/<code>sourceEnd</code>).{' '}
          <em>Time-stretch = preserve content</em> (set <code>playbackRate</code>, pitch preserved).
        </p>
        <p style={{ fontSize: 10, color: '#777', margin: '0 0 4px' }}>
          <em>Speed ↑ → duration ↓, pitch ≈ unchanged</em> — WSOLA/Phase-vocoder quality, good for
          0.5×–2× speech. Extreme values may add light metallic smearing.
        </p>
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column', marginTop: 12 }}>
          <button
            data-testid="audio-resize-trim"
            onClick={() => handleChoice('trim')}
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#333',
              color: '#e0e0e0',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <strong>Trim (hard cut)</strong> — edit <code>sourceStart</code>/<code>sourceEnd</code>,
            content cut
          </button>
          <button
            data-testid="audio-resize-stretch"
            onClick={() => handleChoice('stretch')}
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #7c5cff',
              background: '#7c5cff',
              color: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <strong>Time-stretch (preserve content)</strong> — set <code>playbackRate</code>,
            RubberBand at export
          </button>
        </div>
        <label
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            marginTop: 12,
            fontSize: 11,
            color: '#aaa',
          }}
        >
          <input
            data-testid="audio-resize-dont-ask"
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />
          Don&apos;t ask again for {trackId} track
        </label>
        <p style={{ fontSize: 10, color: '#666', margin: '4px 0 0 22' }}>
          Alt-drag = stretch, Shift-drag = trim (override). Reset in settings.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            onClick={onClose}
            data-testid="audio-resize-close"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#333',
              color: '#e0e0e0',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
