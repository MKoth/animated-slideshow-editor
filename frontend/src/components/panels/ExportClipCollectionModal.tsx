import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { ExportClipCollectionCommand } from '../../engine/commands/exportClipCollectionCommand'
import { walkPreOrder } from '../../engine/sceneNode'
import { useSelectionStore } from '../../stores/selectionStore'
import { useNotificationStore } from '../../stores/notificationStore'

interface ExportClipCollectionModalProps {
  open: boolean
  parentNodeId: string | null
  onClose: () => void
}

export function ExportClipCollectionModal({ open, parentNodeId, onClose }: ExportClipCollectionModalProps) {
  const { engine, dispatch } = useEngine()
  const [name, setName] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const activeSlide = engine?.getActiveSlide() ?? null
  const sceneRoot = activeSlide?.scene.root ?? null

  const allNodes = useMemo(() => {
    if (!sceneRoot) return []
    const list: typeof sceneRoot[] = []
    for (const node of walkPreOrder(sceneRoot)) {
      if (node === sceneRoot) continue
      if (node.components.camera) continue
      list.push(node)
    }
    return list
  }, [sceneRoot])

  // Initialize name from parent node
  useEffect(() => {
    if (!open) return
    setLocalError(null)
    if (parentNodeId && engine) {
      try {
        const node = engine.getNode(parentNodeId)
        setName(node.name)
      } catch {
        setName('')
      }
    } else if (allNodes[0]) {
      setName(allNodes[0].name)
    }
  }, [open, parentNodeId, engine, allNodes])

  const [effectiveParentId, setEffectiveParentId] = useState<string | null>(parentNodeId)
  useEffect(() => {
    setEffectiveParentId(parentNodeId)
  }, [parentNodeId])

  const preview = useMemo(() => {
    if (!engine || !effectiveParentId) return null
    try {
      const parent = engine.getNode(effectiveParentId)
      const missing: { id: string; name: string; clipIds: string[] }[] = []
      let hasClip = false
      for (const node of walkPreOrder(parent)) {
        if (node.clipInstances.length > 0) {
          hasClip = true
          const sem = node.semanticName
          if (!sem || sem.trim() === '') {
            missing.push({
              id: node.id,
              name: node.name,
              clipIds: node.clipInstances.map((c) => c.clipId),
            })
          }
        }
      }
      // Build bindings preview (same logic as engine, first per semantic)
      const bindings: { semanticName: string; clipId: string; clipName: string }[] = []
      const seen = new Set<string>()
      for (const node of walkPreOrder(parent)) {
        const sem = node.semanticName?.trim()
        if (!sem) continue
        if (seen.has(sem)) continue
        if (node.clipInstances.length === 0) continue
        const clipId = node.clipInstances[0]!.clipId
        try {
          const clip = engine.getClip(clipId)
          bindings.push({ semanticName: sem, clipId, clipName: clip.name })
          seen.add(sem)
        } catch {
          // skip missing clip
        }
      }
      return {
        parentName: parent.name,
        hasClip,
        missing,
        bindings,
        nodeCount: [...walkPreOrder(parent)].length,
      }
    } catch {
      return null
    }
  }, [engine, effectiveParentId])

  const blockingError = (() => {
    if (!preview) return null
    if (!preview.hasClip) {
      return `No clips found in hierarchy rooted at "${preview.parentName}". Assign a clip to at least one node in the subtree before exporting.`
    }
    if (preview.missing.length > 0) {
      const names = preview.missing.map((m) => m.name).join(', ')
      return `Cannot export: ${preview.missing.length} node(s) with clips have no Semantic Name: ${names}. Set Semantic Name in Inspector (e.g. left_hand) before export.`
    }
    if (preview.bindings.length === 0) {
      return `No exportable bindings found in hierarchy rooted at "${preview.parentName}". Ensure nodes have both a Semantic Name and a clip.`
    }
    return null
  })()

  const canExport = Boolean(
    engine && effectiveParentId && name.trim() && preview && !blockingError && !localError,
  )

  const handleExport = () => {
    setLocalError(null)
    if (!engine || !effectiveParentId) {
      setLocalError('Select a hierarchy to export')
      return
    }
    if (!name.trim()) {
      setLocalError('Name is required')
      return
    }
    if (blockingError) {
      setLocalError(blockingError)
      return
    }
    const result = dispatch(
      new ExportClipCollectionCommand({ parentNodeId: effectiveParentId, name: name.trim() }),
    )
    if (!result.ok) {
      setLocalError(result.error.message)
      return
    }
    useNotificationStore
      .getState()
      .notify(`Exported ClipCollection "${name.trim()}" (${preview?.bindings.length ?? 0} bindings)`)
    onClose()
  }

  if (!open) return null

  // Fallback parent selector if opened without context (from Animations panel)
  const showParentSelector = !parentNodeId

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Export Clip Collection"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="modal"
        style={{
          background: 'var(--color-bg)',
          borderRadius: 8,
          padding: 16,
          minWidth: 460,
          maxWidth: 600,
          maxHeight: '80vh',
          overflowY: 'auto',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 12px' }}>Export Clip Collection</h3>

        {showParentSelector ? (
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
            Hierarchy root
            <select
              value={effectiveParentId ?? ''}
              onChange={(e) => {
                const v = e.target.value || null
                setEffectiveParentId(v)
                if (v && engine) {
                  try {
                    const node = engine.getNode(v)
                    setName(node.name)
                  } catch {
                    // ignore
                  }
                }
              }}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--color-border)',
              }}
              data-testid="export-collection-parent-select"
            >
              <option value="">-- select --</option>
              {allNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                  {node.semanticName ? ` (${node.semanticName})` : ''} — {node.children.length}{' '}
                  children
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Hierarchy: <strong>{preview?.parentName ?? effectiveParentId}</strong> ·{' '}
            {preview?.nodeCount ?? 0} node(s) in subtree
          </div>
        )}

        {preview && (
          <div
            style={{ fontSize: 11, color: '#666', marginBottom: 8 }}
            data-testid="collection-preview-info"
          >
            {preview.bindings.length} binding(s) • {preview.nodeCount} node(s) scanned
          </div>
        )}

        {/* Blocking errors: no clips */}
        {preview && !preview.hasClip && (
          <div
            className="panel-status panel-status--error"
            role="alert"
            data-testid="clip-collection-export-error"
            style={{ marginBottom: 8 }}
          >
            <p>{blockingError}</p>
          </div>
        )}

        {/* Blocking errors: missing semantic */}
        {preview && preview.missing.length > 0 && (
          <div
            className="panel-status panel-status--error"
            role="alert"
            data-testid="clip-collection-missing-semantic"
            style={{ marginBottom: 8, flexDirection: 'column', alignItems: 'stretch' }}
          >
            <p>
              {preview.missing.length} node(s) with clips have no Semantic Name — fix before export:
            </p>
            <ul style={{ margin: '6px 0 0 16px', fontSize: 12, listStyle: 'disc' }}>
              {preview.missing.map((m) => (
                <li key={m.id} style={{ marginBottom: 2 }}>
                  <button
                    onClick={() => {
                      useSelectionStore.getState().select(m.id)
                      // Close modal so inspector is visible? Keep open but notify
                      useNotificationStore.getState().notify(`Selected "${m.name}" — set its Semantic Name in Inspector`)
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--color-danger)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                    data-testid={`missing-semantic-${m.id}`}
                    title="Select this node to set Semantic Name"
                  >
                    {m.name}
                  </button>
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>
                    clip: {m.clipIds.map((id) => {
                      try {
                        return engine!.getClip(id).name
                      } catch {
                        return id
                      }
                    }).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Set Semantic Name in Inspector → General → Semantic Name (e.g. left_hand)
            </span>
          </div>
        )}

        {preview && preview.bindings.length > 0 && preview.missing.length === 0 && (
          <div
            style={{
              maxHeight: 160,
              overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              marginBottom: 8,
            }}
            data-testid="collection-bindings-preview"
          >
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-elevated)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Semantic Name</th>
                  <th style={{ padding: '6px 8px' }}>Clip</th>
                </tr>
              </thead>
              <tbody>
                {preview.bindings.map((b) => (
                  <tr key={b.semanticName} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{b.semanticName}</td>
                    <td style={{ padding: '6px 8px' }}>{b.clipName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Collection name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Rig Animation"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
            }}
            data-testid="export-collection-name-input"
            autoFocus
          />
        </label>

        {localError && (
          <div
            data-testid="clip-collection-export-local-error"
            role="alert"
            style={{ color: 'var(--color-danger, red)', fontSize: 12, marginBottom: 8 }}
          >
            {localError}
          </div>
        )}

        {blockingError && !localError && preview && preview.missing.length === 0 && !preview.hasClip && null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
            }}
            data-testid="export-collection-cancel"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: canExport ? '#7c5cff' : '#9a9a9a',
              color: '#fff',
              cursor: canExport ? 'pointer' : 'not-allowed',
            }}
            data-testid="export-collection-confirm"
            title={!canExport && blockingError ? blockingError : undefined}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
