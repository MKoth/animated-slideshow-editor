import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { ApplyClipCollectionCommand } from '../../engine/commands/applyClipCollectionCommand'
import { walkPreOrder } from '../../engine/sceneNode'
import { useNotificationStore } from '../../stores/notificationStore'

interface ApplyClipCollectionModalProps {
  open: boolean
  collectionId: string | null
  onClose: () => void
  initialTargetId?: string | null
}

export function ApplyClipCollectionModal({
  open,
  collectionId,
  onClose,
  initialTargetId,
}: ApplyClipCollectionModalProps) {
  const { engine, dispatch } = useEngine()
  const [targetId, setTargetId] = useState<string | null>(initialTargetId ?? null)
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

  const collection = useMemo(() => {
    if (!engine || !collectionId) return null
    try {
      return engine.getClipCollection(collectionId)
    } catch {
      return null
    }
  }, [engine, collectionId])

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    if (initialTargetId) setTargetId(initialTargetId)
    else if (allNodes[0]) setTargetId(allNodes[0].id)
  }, [open, initialTargetId, allNodes])

  const preview = useMemo(() => {
    if (!engine || !collection || !targetId) return null
    try {
      const target = engine.getNode(targetId)
      const nodes = [...walkPreOrder(target)]
      const matches: { nodeName: string; semanticName: string; clipName: string }[] = []
      const seenSemantics = new Set<string>()
      for (const node of nodes) {
        const sem = node.semanticName?.trim()
        if (!sem) continue
        const clipId = collection.getBinding(sem)
        if (!clipId) continue
        try {
          const clip = engine.getClip(clipId)
          matches.push({ nodeName: node.name, semanticName: sem, clipName: clip.name })
          seenSemantics.add(sem)
        } catch {
          // missing clip
        }
      }
      // Group by semantic for display
      const bySemantic = new Map<string, { clipName: string; nodes: string[] }>()
      for (const m of matches) {
        const existing = bySemantic.get(m.semanticName)
        if (existing) existing.nodes.push(m.nodeName)
        else bySemantic.set(m.semanticName, { clipName: m.clipName, nodes: [m.nodeName] })
      }
      return {
        targetName: target.name,
        totalNodes: nodes.length,
        matchCount: matches.length,
        distinctSemantics: seenSemantics.size,
        bySemantic: [...bySemantic.entries()].map(([sem, v]) => ({
          semanticName: sem,
          clipName: v.clipName,
          nodeNames: v.nodes,
        })),
      }
    } catch {
      return null
    }
  }, [engine, collection, targetId])

  const canApply = Boolean(engine && collection && targetId && preview && preview.matchCount > 0)

  const handleApply = () => {
    setLocalError(null)
    if (!engine || !collectionId || !targetId) {
      setLocalError('Select a target hierarchy')
      return
    }
    if (!preview || preview.matchCount === 0) {
      setLocalError(
        `No matching Semantic Names in target "${preview?.targetName ?? targetId}". Ensure target nodes have Semantic Names matching collection bindings.`,
      )
      return
    }
    const result = dispatch(new ApplyClipCollectionCommand({ collectionId, targetNodeId: targetId }))
    if (!result.ok) {
      setLocalError(result.error.message)
      return
    }
    const created = (result.inverse as { created: readonly unknown[] }).created.length
    useNotificationStore
      .getState()
      .notify(`Applied "${collection!.name}" to "${preview!.targetName}" — ${created} instance(s)`)
    onClose()
  }

  if (!open) return null
  if (!collection) {
    return (
      <div
        className="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Apply Clip Collection"
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
            minWidth: 420,
            border: '1px solid var(--color-border)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p>Collection not found</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Apply Clip Collection"
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
        <h3 style={{ margin: '0 0 12px' }}>Apply Clip Collection</h3>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Collection: <strong>{collection.name}</strong> · {collection.bindings.size} binding(s)
        </div>

        <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          Target hierarchy root
          <select
            value={targetId ?? ''}
            onChange={(e) => setTargetId(e.target.value || null)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
            }}
            data-testid="apply-collection-target-select"
          >
            <option value="">-- select --</option>
            {allNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
                {node.semanticName ? ` (${node.semanticName})` : ''} — {node.children.length} children
              </option>
            ))}
          </select>
        </label>

        {preview && (
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }} data-testid="apply-preview-info">
            Target: {preview.targetName} · {preview.totalNodes} node(s) · {preview.matchCount}{' '}
            match(es) across {preview.distinctSemantics} semantic(s)
          </div>
        )}

        {preview && preview.matchCount === 0 && targetId && (
          <div
            className="panel-status panel-status--error"
            role="alert"
            data-testid="apply-no-matches-error"
            style={{ marginBottom: 8 }}
          >
            <p>
              No matching Semantic Names in target hierarchy. Ensure target nodes have Semantic Names
              matching collection bindings: {[...collection.bindings.keys()].join(', ')}
            </p>
          </div>
        )}

        {preview && preview.bySemantic.length > 0 && (
          <div
            style={{
              maxHeight: 160,
              overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              marginBottom: 8,
            }}
            data-testid="apply-bindings-preview"
          >
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-elevated)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Semantic</th>
                  <th style={{ padding: '6px 8px' }}>Clip</th>
                  <th style={{ padding: '6px 8px' }}>Target nodes</th>
                </tr>
              </thead>
              <tbody>
                {preview.bySemantic.map((b) => (
                  <tr key={b.semanticName} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{b.semanticName}</td>
                    <td style={{ padding: '6px 8px' }}>{b.clipName}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {b.nodeNames.join(', ')}
                      {b.nodeNames.length > 1 && ` (${b.nodeNames.length} broadcast)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {localError && (
          <div
            data-testid="apply-collection-error"
            role="alert"
            style={{ color: 'var(--color-danger, red)', fontSize: 12, marginBottom: 8 }}
          >
            {localError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
            }}
            data-testid="apply-collection-cancel"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: canApply ? '#7c5cff' : '#9a9a9a',
              color: '#fff',
              cursor: canApply ? 'pointer' : 'not-allowed',
            }}
            data-testid="apply-collection-confirm"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
