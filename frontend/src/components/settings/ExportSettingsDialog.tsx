import { useEffect, useState } from 'react'
import { ApiClient } from '../../api/apiClient'
import { ExportApi } from '../../api/exportApi'
import { CAMERA_FRAME_SIZES, cameraAspectRatioLabel } from '../../engine/cameraFrameSize'
import { useUiStore } from '../../stores/uiStore'

export function ExportSettingsDialog({ onClose }: { onClose: () => void }) {
  const [api] = useState(() => new ExportApi(new ApiClient()))
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const cameraFrameSize = useUiStore((state) => state.cameraFrameSize)

  useEffect(() => {
    let cancelled = false
    void api
      .getExportSettings()
      .then((settings) => {
        if (!cancelled) setPath(settings.exportRoot)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Could not load export settings')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const result = await api.updateExportSettings(path.trim())
      setPath(result.exportRoot)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save export settings')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export Settings"
      data-testid="export-settings-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 102,
        background: 'rgba(0,0,0,.6)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <section
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          width: 520,
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Export Settings</h3>
        <p style={{ fontSize: 11, color: '#aaa' }}>
          Absolute path on the backend machine. Each project is saved in a subfolder named with its
          project ID.
        </p>
        <fieldset
          data-testid="camera-frame-size-options"
          style={{ border: '1px solid #555', margin: '12px 0', padding: 10 }}
        >
          <legend style={{ fontSize: 12 }}>Camera frame and export dimensions</legend>
          <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: 11 }}>
            The selected pixel dimensions define a fixed camera shape. Resizing the browser changes
            the preview size, not the frame proportions.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {CAMERA_FRAME_SIZES.map((size) => (
              <label
                key={size.id}
                style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11 }}
              >
                <input
                  type="radio"
                  name="camera-frame-size"
                  value={size.id}
                  checked={cameraFrameSize === size.id}
                  onChange={() => useUiStore.getState().setCameraFrameSize(size.id)}
                />
                <span>
                  {size.width} × {size.height} px
                </span>
                <span style={{ color: '#999' }}>
                  ({cameraAspectRatioLabel(size.id)} · {size.label})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label style={{ display: 'block', fontSize: 12 }}>
          Export folder
          <input
            data-testid="export-root-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            disabled={busy}
            style={{
              display: 'block',
              boxSizing: 'border-box',
              width: '100%',
              marginTop: 6,
              padding: 8,
              background: '#1e1e1e',
              color: '#eee',
              border: '1px solid #555',
            }}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: '#ff8a80', fontSize: 12 }}>
            {error}
          </p>
        )}
        {saved && (
          <p role="status" style={{ color: '#9ccc65', fontSize: 12 }}>
            Export folder saved: {path}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose}>Close</button>
          <button
            data-testid="save-export-root"
            onClick={() => void save()}
            disabled={busy || !path.trim()}
          >
            {busy ? 'Working…' : 'Save folder'}
          </button>
        </div>
      </section>
    </div>
  )
}
