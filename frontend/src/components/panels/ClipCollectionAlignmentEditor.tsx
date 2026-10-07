import { useMemo, useRef, useState } from 'react'
import { walkPreOrder } from '../../engine/sceneNode'
import { SetClipCollectionAlignmentOffsetsCommand } from '../../engine/commands'
import type { ClipCollectionAlignmentOffsets } from '../../engine/clipCollection'
import { useEngine } from '../../app/useEngine'
import { usePlaybackController } from '../../stores/playbackStore'

export function ClipCollectionAlignmentEditor({
  collectionId,
  parentNodeId,
  onClose,
}: {
  collectionId: string
  parentNodeId: string
  onClose: () => void
}) {
  const { engine, dispatch } = useEngine()
  const slide = engine.getActiveSlide()!
  const time = usePlaybackController((state) => state.currentTimes[slide.id] ?? 0)
  const collection = engine.getClipCollection(collectionId)
  const parent = engine.getNode(parentNodeId)
  const semantics = useMemo(() => {
    const names = new Set<string>()
    for (const node of walkPreOrder(parent)) {
      const semantic = node.semanticName?.trim()
      if (semantic && collection.hasBinding(semantic)) names.add(semantic)
    }
    for (const semantic of collection.bindings.keys()) names.add(semantic)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [parent, collection])
  const [semanticName, setSemanticName] = useState(semantics[0] ?? '')
  const [revision, setRevision] = useState(0)
  void revision
  const offset = collection.getAlignmentOffset(semanticName) ?? { x: 0, y: 0 }
  const [draftX, setDraftX] = useState(String(offset.x))
  const [draftY, setDraftY] = useState(String(offset.y))
  const dragRef = useRef<{
    startX: number
    startY: number
    initialX: number
    initialY: number
  } | null>(null)

  const update = (axis: 'x' | 'y', rawValue: string) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    const next: Record<string, { x: number; y: number }> = { ...collection.alignmentOffsets }
    const current = next[semanticName] ?? { x: 0, y: 0 }
    const updated = { ...current, [axis]: value }
    if (updated.x === 0 && updated.y === 0) delete next[semanticName]
    else next[semanticName] = updated
    dispatch(
      new SetClipCollectionAlignmentOffsetsCommand({
        collectionId,
        alignmentOffsets: next as ClipCollectionAlignmentOffsets,
      }) as never,
    )
    setRevision((current) => current + 1)
  }

  const previewDragOffset = (x: number, y: number) => {
    const next: Record<string, { x: number; y: number }> = { ...collection.alignmentOffsets }
    if (x === 0 && y === 0) delete next[semanticName]
    else next[semanticName] = { x, y }
    engine.setClipCollectionAlignmentOffsets(collectionId, next)
    setDraftX(String(x))
    setDraftY(String(y))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Collection alignment offsets"
      data-testid="collection-alignment-editor"
      style={overlayStyle}
    >
      <div style={panelStyle}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ flex: 1 }}>Align {collection.name}</strong>
          <button onClick={onClose} aria-label="Close alignment editor">
            ×
          </button>
        </header>
        <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>
          Offsets apply throughout this collection’s animation and are saved with the collection.
        </p>
        <label style={labelStyle}>
          Part
          <select
            aria-label="Semantic part"
            data-testid="collection-alignment-semantic"
            value={semanticName}
            onChange={(event) => {
              const nextSemantic = event.target.value
              const nextOffset = collection.getAlignmentOffset(nextSemantic) ?? { x: 0, y: 0 }
              setSemanticName(nextSemantic)
              setDraftX(String(nextOffset.x))
              setDraftY(String(nextOffset.y))
            }}
            style={inputStyle}
          >
            {semantics.map((semantic) => (
              <option key={semantic} value={semantic}>
                {semantic}
              </option>
            ))}
          </select>
        </label>
        {(['x', 'y'] as const).map((axis) => (
          <label key={axis} style={labelStyle}>
            {axis.toUpperCase()} offset
            <input
              type="number"
              step="1"
              value={axis === 'x' ? draftX : draftY}
              data-testid={`collection-alignment-${axis}`}
              onChange={(event) =>
                axis === 'x' ? setDraftX(event.target.value) : setDraftY(event.target.value)
              }
              onBlur={(event) => update(axis, event.target.value)}
              style={inputStyle}
            />
          </label>
        ))}
        <div
          role="application"
          aria-label="Drag to adjust X and Y offsets"
          data-testid="collection-alignment-drag-pad"
          onPointerDown={(event) => {
            if (typeof event.currentTarget.setPointerCapture === 'function') {
              event.currentTarget.setPointerCapture(event.pointerId)
            }
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              initialX: offset.x,
              initialY: offset.y,
            }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag) return
            previewDragOffset(
              Math.round(drag.initialX + event.clientX - drag.startX),
              Math.round(drag.initialY + event.clientY - drag.startY),
            )
          }}
          onPointerUp={() => {
            const drag = dragRef.current
            if (!drag) return
            dragRef.current = null
            const finalOffsets = { ...collection.alignmentOffsets }
            engine.setClipCollectionAlignmentOffsets(collectionId, {
              ...finalOffsets,
              ...(drag.initialX === 0 && drag.initialY === 0
                ? { [semanticName]: { x: 0, y: 0 } }
                : { [semanticName]: { x: drag.initialX, y: drag.initialY } }),
            })
            dispatch(
              new SetClipCollectionAlignmentOffsetsCommand({
                collectionId,
                alignmentOffsets: finalOffsets,
              }) as never,
            )
          }}
          onPointerCancel={() => {
            const drag = dragRef.current
            dragRef.current = null
            if (!drag) return
            const restored: Record<string, { x: number; y: number }> = {
              ...collection.alignmentOffsets,
            }
            if (drag.initialX === 0 && drag.initialY === 0) delete restored[semanticName]
            else restored[semanticName] = { x: drag.initialX, y: drag.initialY }
            engine.setClipCollectionAlignmentOffsets(collectionId, restored)
            setDraftX(String(drag.initialX))
            setDraftY(String(drag.initialY))
          }}
          style={{
            height: 88,
            border: '1px solid var(--color-border, #bbb)',
            borderRadius: 4,
            backgroundImage:
              'linear-gradient(to right, transparent calc(50% - .5px), #aaa 50%, transparent calc(50% + .5px)), linear-gradient(to bottom, transparent calc(50% - .5px), #aaa 50%, transparent calc(50% + .5px))',
            backgroundColor: '#f4f4f4',
            position: 'relative',
            cursor: 'move',
            touchAction: 'none',
          }}
        >
          <span style={{ position: 'absolute', left: 6, top: 4, fontSize: 10, color: '#666' }}>
            Drag here to nudge · 1 px per screen pixel
          </span>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `calc(50% + ${Math.max(-100, Math.min(100, offset.x))}px)`,
              top: `calc(50% + ${Math.max(-35, Math.min(35, offset.y))}px)`,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--color-accent, #7c5cff)',
              transform: 'translate(-50%, -50%)',
            }}
          />
        </div>
        <label style={labelStyle}>
          Preview time · {time.toFixed(2)}s
          <input
            type="range"
            min={0}
            max={slide.duration}
            step={0.01}
            value={time}
            data-testid="collection-alignment-preview-time"
            onChange={(event) =>
              usePlaybackController
                .getState()
                .setCurrentTime(slide.id, Number(event.target.value), slide.duration)
            }
            style={{ width: '100%' }}
          />
        </label>
        <div style={{ fontSize: 11, color: '#777' }}>
          Scrub the slide timeline to check the correction across the motion.
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 3000,
  background: 'rgba(0,0,0,.35)',
  display: 'grid',
  placeItems: 'center',
}
const panelStyle: React.CSSProperties = {
  width: 360,
  maxWidth: 'calc(100vw - 32px)',
  padding: 16,
  borderRadius: 8,
  background: 'var(--color-bg, #fff)',
  color: 'var(--color-text, #222)',
  boxShadow: '0 8px 30px rgba(0,0,0,.25)',
  display: 'grid',
  gap: 10,
}
const labelStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12 }
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  boxSizing: 'border-box',
  border: '1px solid var(--color-border, #ccc)',
  borderRadius: 4,
}
