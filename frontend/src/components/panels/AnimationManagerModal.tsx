import { useEffect, useMemo, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  getManagerRows,
  type ManagerTab,
} from '../../engine/animationManagerModel'
import { getOrphanKeyframes } from '../../engine/animationManagerModel'

interface AnimationManagerModalProps {
  open: boolean
  parentNodeId: string | null
  onClose: () => void
}

export function AnimationManagerModal({ open, parentNodeId, onClose }: AnimationManagerModalProps) {
  const { engine } = useEngine()
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<ManagerTab>('clips')
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ clipId: string; nodeId: string } | null>(null)

  useEngineEvent(() => setTick((t) => t + 1))

  // Reset tab and expanded when opening parent changes
  useEffect(() => {
    if (open) {
      setActiveTab('clips')
      setExpandedMap({})
      setEditing(null)
    }
  }, [open, parentNodeId])

  // Esc handling: drills back from editor (stub), second Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(null)
          e.stopPropagation()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, editing, onClose])

  const activeSlide = open ? engine.getActiveSlide() : null
  const parentNode = useMemo(() => {
    if (!open || !parentNodeId) return null
    try {
      return engine.getNode(parentNodeId)
    } catch {
      return null
    }
  }, [open, parentNodeId, engine])

  const managerRows = useMemo(() => {
    if (!activeSlide || !parentNode) return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    return getManagerRows(parentNode, activeSlide, engine.materialDefinitions, getClip)
  }, [activeSlide, parentNode, engine])

  const overlayLabel = parentNode ? `Animation Manager — ${parentNode.name}` : 'Animation Manager'

  if (!open) return null

  const handleBackdropClick = () => {
    if (editing) {
      setEditing(null)
    } else {
      onClose()
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={overlayLabel}
      data-testid="animation-manager-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="modal"
        data-testid="animation-manager-modal"
        style={{
          background: 'var(--color-bg, #ffffff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 760,
          maxWidth: 960,
          width: '92vw',
          minHeight: 520,
          maxHeight: '88vh',
          overflow: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16 }} data-testid="animation-manager-title">
            {editing ? (
              <>
                <button
                  onClick={() => setEditing(null)}
                  data-testid="manager-back-button"
                  style={{
                    marginRight: 8,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg-elevated, #f5f5f5)',
                    cursor: 'pointer',
                  }}
                >
                  ← Back
                </button>
                Editing {(() => {
                  try {
                    return engine.getClip(editing.clipId).name
                  } catch {
                    return editing.clipId
                  }
                })()} — {(() => {
                  try {
                    return engine.getNode(editing.nodeId).name
                  } catch {
                    return editing.nodeId
                  }
                })()}
              </>
            ) : parentNode ? (
              `Animation Manager — ${parentNode.name}`
            ) : (
              'Animation Manager'
            )}
          </h3>
          <button
            onClick={() => (editing ? setEditing(null) : onClose())}
            data-testid="animation-manager-close"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg, #fff)',
              cursor: 'pointer',
            }}
          >
            {editing ? 'Back' : 'Close'}
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Manager views"
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--color-bg-elevated, #f0f0f0)',
            borderRadius: 6,
            padding: 2,
            width: 'fit-content',
          }}
          data-testid="manager-tabs"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'collections'}
            data-testid="manager-tab-collections"
            onClick={() => setActiveTab('collections')}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'collections' ? 'var(--color-accent, #7c5cff)' : 'transparent',
              color: activeTab === 'collections' ? '#fff' : 'var(--color-text-muted, #666)',
            }}
          >
            Collections
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'clips'}
            data-testid="manager-tab-clips"
            onClick={() => setActiveTab('clips')}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'clips' ? 'var(--color-accent, #7c5cff)' : 'transparent',
              color: activeTab === 'clips' ? '#fff' : 'var(--color-text-muted, #666)',
            }}
          >
            Clips
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'orphans'}
            data-testid="manager-tab-orphans"
            onClick={() => setActiveTab('orphans')}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'orphans' ? 'var(--color-accent, #7c5cff)' : 'transparent',
              color: activeTab === 'orphans' ? '#fff' : 'var(--color-text-muted, #666)',
            }}
          >
            Orphans
          </button>
        </div>

        {/* Stub for editor drill-in: if editing, show placeholder */}
        {editing ? (
          <div
            data-testid="manager-editor-placeholder"
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              padding: 24,
              textAlign: 'center',
              color: 'var(--color-text-muted, #666)',
              fontSize: 13,
            }}
          >
            Clip editor for {editing.clipId} (stubbed in this slice). Press Esc to go back, Esc again to close.
          </div>
        ) : managerRows.length === 0 ? (
          <div
            data-testid="manager-empty"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted, #666)',
              padding: 12,
              border: '1px dashed var(--color-border, #ddd)',
              borderRadius: 6,
              textAlign: 'center',
            }}
          >
            No animated children under "{parentNode?.name ?? 'parent'}". Add keyframes or assign a clip to a descendant to see it here.
          </div>
        ) : (
          <div
            data-testid="manager-rows"
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              overflow: 'hidden',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Column-like rows: group headers + animated params */}
            {managerRows.map((row) => {
              const isExpanded = expandedMap[row.node.id] ?? true
              const animatedParamCount = row.animatedParams.length
              return (
                <div key={row.node.id} data-testid={`manager-row-${row.node.id}`} style={{ borderBottom: '1px solid var(--color-border, #ddd)' }}>
                  <div
                    role="button"
                    aria-expanded={isExpanded}
                    data-testid={`manager-toggle-${row.node.id}`}
                    onClick={() =>
                      setExpandedMap((prev) => ({ ...prev, [row.node.id]: !isExpanded }))
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'var(--color-bg-elevated, #fafafa)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      paddingLeft: `${12 + row.depth * 16}px`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 16,
                        textAlign: 'center',
                        fontSize: 12,
                      }}
                    >
                      {isExpanded ? '−' : '+'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{row.node.name}</span>
                    {row.node.semanticName && (
                      <span
                        style={{ fontSize: 11, color: 'var(--color-text-muted, #666)', marginLeft: 6 }}
                        title={`Semantic: ${row.node.semanticName}`}
                      >
                        ({row.node.semanticName})
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                      {animatedParamCount} param{animatedParamCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div data-testid={`manager-params-${row.node.id}`} style={{ background: 'var(--color-bg-panel, #fff)' }}>
                      {row.animatedParams.length === 0 ? (
                        <div
                          style={{
                            padding: '6px 12px 6px 32px',
                            fontSize: 12,
                            color: 'var(--color-text-muted, #666)',
                          }}
                        >
                          No animated params (clip without channels)
                        </div>
                      ) : (
                        row.animatedParams.map((param) => {
                          const orphanKeyframes = activeSlide
                            ? getOrphanKeyframes(row.node, activeSlide, param)
                            : []
                          const showDiamonds = activeTab === 'orphans' && orphanKeyframes.length > 0
                          return (
                            <div
                              key={`${row.node.id}-${param.kind}-${param.key}`}
                              data-testid={`manager-param-${row.node.id}-${param.key}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '6px 12px 6px 32px',
                                borderTop: '1px solid var(--color-border, #eee)',
                                fontSize: 12,
                              }}
                            >
                              <span style={{ flex: 1 }}>{param.label}</span>
                              {activeTab !== 'orphans' && (
                                <span
                                  style={{ fontSize: 10, color: 'var(--color-text-muted, #888)' }}
                                  data-testid={`manager-param-kind-${row.node.id}-${param.key}`}
                                >
                                  {param.kind}
                                </span>
                              )}
                              {showDiamonds && (
                                <span
                                  style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                                  data-testid={`manager-orphan-diamonds-${row.node.id}-${param.key}`}
                                >
                                  {orphanKeyframes.map((kf) => (
                                    <span
                                      key={kf.id}
                                      data-testid={`orphan-diamond-${kf.id}`}
                                      title={`orphan keyframe at ${kf.time}s`}
                                      aria-label={`orphan keyframe at ${kf.time}s`}
                                      style={{
                                        width: 8,
                                        height: 8,
                                        background: 'var(--color-accent, #7c5cff)',
                                        border: '1px solid #fff',
                                        transform: 'rotate(45deg)',
                                        display: 'inline-block',
                                        flexShrink: 0,
                                      }}
                                    />
                                  ))}
                                  <span style={{ fontSize: 10, color: 'var(--color-text-muted, #666)', marginLeft: 4 }}>
                                    {orphanKeyframes.length} orphan
                                  </span>
                                </span>
                              )}
                              {activeTab === 'orphans' && !showDiamonds && orphanKeyframes.length === 0 && (
                                <span
                                  style={{ fontSize: 10, color: 'var(--color-text-muted, #999)' }}
                                  data-testid={`manager-no-orphan-${row.node.id}-${param.key}`}
                                >
                                  no orphan
                                </span>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer hint */}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted, #888)' }}>
          Press Esc to close{editing ? ' (Esc drills back first)' : ''} • Click backdrop to close • Filtered to animated descendants only (pre-order)
        </div>
      </div>
    </div>
  )
}
