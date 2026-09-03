import { useEffect, useState, useRef, useContext } from 'react'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { EngineContext } from '../../app/engineContext'
import { validateReusableObject } from '../../engine/reusableObject'
import type { ReusableObjectJSON } from '../../engine/reusableObject'
import { useNotificationStore } from '../../stores/notificationStore'
import { assetsApi } from '../../api'
import { ExportObjectModal } from './ExportObjectModal'
import { ImportReusableObjectCommand } from '../../engine/commands'

export function ObjectsPanel() {
  const definitions = useAssetLibraryStore((s) => s.definitions)
  const loading = useAssetLibraryStore((s) => s.loading)
  const unavailable = useAssetLibraryStore((s) => s.unavailable)
  const loadLibrary = useAssetLibraryStore((s) => s.loadLibrary)
  const deleteAsset = useAssetLibraryStore((s) => s.deleteAsset)
  const engineCtx = useContext(EngineContext)
  const engine = engineCtx?.engine ?? null
  const dispatch = engineCtx?.dispatch ?? null

  const [exportOpen, setExportOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  const objects = definitions.filter((d) => d.category === 'object' || d.category === 'Object')

  const handleImport = async (assetId: string) => {
    if (!engine) {
      useNotificationStore.getState().notify('No project loaded')
      return
    }
    const def = definitions.find((d) => d.id === assetId)
    if (!def) return
    try {
      const res = await fetch(def.original_url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ReusableObjectJSON
      const errors = validateReusableObject(json)
      if (errors.length > 0) throw new Error(errors.join('; '))
      if (dispatch) {
        const result = dispatch(new ImportReusableObjectCommand({ objectJson: json }))
        if (!result.ok) throw new Error(result.error.message)
      } else {
        engine.importReusableObject(json)
      }
      useNotificationStore.getState().notify(`Imported object: ${json.name}`)
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDownload = async (assetId: string) => {
    const def = definitions.find((d) => d.id === assetId)
    if (!def) return
    try {
      const res = await fetch(def.original_url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${def.name}.lesson_object`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDelete = async (assetId: string) => {
    await deleteAsset(assetId)
  }

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !engine) return
    try {
      const text = await file.text()
      const json = JSON.parse(text) as ReusableObjectJSON
      const errors = validateReusableObject(json)
      if (errors.length > 0) throw new Error(errors.join('; '))
      if (dispatch) {
        const result = dispatch(new ImportReusableObjectCommand({ objectJson: json }))
        if (!result.ok) throw new Error(result.error.message)
      } else {
        engine.importReusableObject(json)
      }
      useNotificationStore.getState().notify(`Imported object: ${json.name}`)
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    }
  }

  const handleUploadFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text) as unknown
      const errors = validateReusableObject(json)
      if (errors.length > 0) throw new Error(errors.join('; '))
      // Keep filename as is; ensure category object
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const uploadFile = new File([blob], file.name.endsWith('.lesson_object') ? file.name : `${file.name}.lesson_object`, { type: 'application/json' })
      const result = await assetsApi.uploadAssets([uploadFile], ['object'])
      if (result.errors.length > 0) {
        useNotificationStore.getState().notify(result.errors.map((e) => `${e.filename}: ${e.error}`).join('; '))
      }
      if (result.created.length > 0) {
        useNotificationStore.getState().notify(`Saved object to library: ${result.created[0]?.name}`)
        await loadLibrary()
      }
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="objects-panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setExportOpen(true)} data-testid="objects-export-button" style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          Export Object
        </button>
        <button onClick={() => fileInputRef.current?.click()} data-testid="objects-import-file-button" style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          Import .lesson_object
        </button>
        <input ref={fileInputRef} type="file" accept=".lesson_object,application/json" hidden onChange={handleFileImport} />
        {/* hidden upload to library input */}
        <input id="objects-upload-input" type="file" accept=".lesson_object,application/json" hidden onChange={handleUploadFromFile} />
        <button onClick={() => document.getElementById('objects-upload-input')?.click()} data-testid="objects-upload-button" style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          Upload to Library
        </button>
      </div>

      {unavailable ? (
        <div className="panel-status panel-status--unavailable"><p>Object library unavailable — start the backend</p></div>
      ) : loading && objects.length === 0 ? (
        <div className="panel-status"><p>Loading library…</p></div>
      ) : objects.length === 0 ? (
        <div className="panel-empty-state"><p>No objects in library. Export a subtree or upload a .lesson_object file.</p></div>
      ) : (
        <ul className="objects-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {objects.map((def) => {
            const meta = def.metadata as Record<string, unknown> | undefined
            const nodeCount = typeof meta?.nodeCount === 'number' ? meta.nodeCount : undefined
            const objectName = typeof meta?.objectName === 'string' ? meta.objectName as string : def.name
            return (
              <li key={def.id} className="objects-item" data-testid={`object-item-${def.id}`} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{objectName}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>{def.original_filename} {nodeCount !== undefined ? `• ${nodeCount} nodes` : ''}</div>
                  {typeof meta?.description === 'string' && <div style={{ fontSize: 11 }}>{meta.description as string}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleImport(def.id)} data-testid={`object-import-${def.id}`} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }}>Import</button>
                  <button onClick={() => void handleDownload(def.id)} data-testid={`object-download-${def.id}`} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }}>Download</button>
                  <button onClick={() => void handleDelete(def.id)} data-testid={`object-delete-${def.id}`} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }}>Delete</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {exportOpen && <ExportObjectModal open={exportOpen} onClose={() => setExportOpen(false)} />}

      {/* hidden select for import target? Could extend with parent selection later */}
    </div>
  )
}
