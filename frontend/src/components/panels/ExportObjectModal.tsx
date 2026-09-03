import { useEffect, useMemo, useState, useContext } from 'react'
import { EngineContext } from '../../app/engineContext'
import { useSelectionStore } from '../../stores/selectionStore'
import { walkPreOrder } from '../../engine/sceneNode'
import type { SceneNode } from '../../engine/sceneNode'
import { useNotificationStore } from '../../stores/notificationStore'
import { assetsApi } from '../../api'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'

interface ExportObjectModalProps {
  open: boolean
  onClose: () => void
  initialRootId?: string
}

export function ExportObjectModal({ open, onClose, initialRootId }: ExportObjectModalProps) {
  const engineCtx = useContext(EngineContext)
  const engine = engineCtx?.engine ?? null
  const selectedIds = useSelectionStore((s) => s.selectedIds)
  const loadLibrary = useAssetLibraryStore((s) => s.loadLibrary)

  const activeSlide = engine?.getActiveSlide() ?? null
  const sceneRoot = activeSlide?.scene.root ?? null

  const allNodes = useMemo(() => {
    if (!sceneRoot) return [] as SceneNode[]
    const list: SceneNode[] = []
    for (const node of walkPreOrder(sceneRoot)) {
      if (node === sceneRoot) continue
      if (node.components.camera) continue
      list.push(node)
    }
    return list
  }, [sceneRoot])

  const [selectedRootId, setSelectedRootId] = useState<string | null>(initialRootId ?? null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) return
    const fallback = initialRootId ?? selectedIds[0] ?? allNodes[0]?.id ?? null
    setSelectedRootId(fallback)
    if (fallback) {
      const node = allNodes.find((n) => n.id === fallback)
      if (node) setName(node.name)
    }
  }, [open, initialRootId, selectedIds, allNodes])

  const auxiliaryInfo = useMemo(() => {
    if (!engine || !activeSlide || !selectedRootId) return null
    try {
      const root = engine.getNode(selectedRootId)
      const nodeIds = new Set<string>([...walkPreOrder(root)].map((n) => n.id))
      const chains = engine.getIKManager().getChainsForSlide(activeSlide.id)
      const ghosts: string[] = []
      for (const chain of chains) {
        const intersects = chain.boneIds.some((id) => nodeIds.has(id))
        if (intersects) {
          if (chain.ghostNodeId && !nodeIds.has(chain.ghostNodeId)) ghosts.push(chain.ghostNodeId)
          if (chain.poleGhostNodeId && !nodeIds.has(chain.poleGhostNodeId)) ghosts.push(chain.poleGhostNodeId)
        }
      }
      const ghostNames = ghosts.map((id) => {
        try {
          return engine.getNode(id).name
        } catch {
          return id
        }
      })
      return { nodeCount: nodeIds.size, ghosts, ghostNames }
    } catch {
      return null
    }
  }, [engine, activeSlide, selectedRootId])

  const handleExport = async () => {
    if (!engine || !selectedRootId) {
      useNotificationStore.getState().notify('Select a subtree to export')
      return
    }
    if (!name.trim()) {
      useNotificationStore.getState().notify('Name is required')
      return
    }
    try {
      const json = engine.exportReusableObject(selectedRootId, name.trim(), description.trim() || undefined)
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeName = name.trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_') || 'object'
      a.href = url
      a.download = `${safeName}.lesson_object`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      // Also store as library entry (backend category=object)
      const file = new File([blob], `${safeName}.lesson_object`, { type: 'application/json' })
      try {
        const result = await assetsApi.uploadAssets([file], ['object'])
        if (result.errors.length > 0) {
          useNotificationStore.getState().notify(result.errors.map((e) => `${e.filename}: ${e.error}`).join('; '))
        }
        if (result.created.length > 0) {
          await loadLibrary()
        }
      } catch (e) {
        // Backend down – still allow download, just notify
        useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
      }

      useNotificationStore.getState().notify(`Exported object: ${name.trim()}`)
      onClose()
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export Object" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="modal" style={{ background: 'var(--color-bg)', borderRadius: 8, padding: 16, minWidth: 420, maxWidth: 560, maxHeight: '80vh', overflowY: 'auto', border: '1px solid var(--color-border)' }}>
        <h3 style={{ margin: '0 0 12px' }}>Export Reusable Object</h3>

        <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Subtree root
          <select value={selectedRootId ?? ''} onChange={(e) => { const v = e.target.value; setSelectedRootId(v || null); const node = allNodes.find(n => n.id===v); if(node) setName(node.name)}} style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }} data-testid="export-root-select">
            <option value="">-- select --</option>
            {allNodes.map((node) => (
              <option key={node.id} value={node.id}>{node.name}{node.semanticName ? ` (${node.semanticName})` : ''} — {node.children.length} children</option>
            ))}
          </select>
        </label>

        {auxiliaryInfo && (
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }} data-testid="auxiliary-info">
            Includes {auxiliaryInfo.nodeCount} node(s)
            {auxiliaryInfo.ghosts.length > 0 && ` + ${auxiliaryInfo.ghosts.length} IK handle/pole node(s): ${auxiliaryInfo.ghostNames.join(', ')}`}
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Object" style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }} data-testid="export-name-input" />
        </label>

        <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" rows={2} style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }} data-testid="export-description-input" />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }} data-testid="export-cancel">Cancel</button>
          <button onClick={() => void handleExport()} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid transparent', background: '#7c5cff', color: '#fff' }} data-testid="export-confirm">Export</button>
        </div>
      </div>
    </div>
  )
}
