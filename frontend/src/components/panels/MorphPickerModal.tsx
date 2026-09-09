/* eslint-disable react-hooks/set-state-in-effect -- sync picker state when modal opens */
import { useMemo, useState, useEffect } from 'react'
import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { SetKeyframeValueCommand } from '../../engine/commands'
import type { MorphKeyframeValue } from '../../engine/shape'
import { useShapeCategoryViewStore } from '../../stores/shapeCategoryViewStore'

interface MorphPickerModalProps {
  open: boolean
  nodeId: string
  keyframeId: string
  value: MorphKeyframeValue
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (msg: string) => void
  onClose: () => void
}

export function MorphPickerModal({
  open,
  nodeId,
  keyframeId,
  value,
  engine,
  dispatch,
  notify,
  onClose,
}: MorphPickerModalProps) {
  const [selectedCat, setSelectedCat] = useState<string | null>(value.fromShapeId ? null : null)
  const [fromId, setFromId] = useState<string | null>(value.fromShapeId)
  const [toId, setToId] = useState<string | null>(value.toShapeId)
  const [coeff, setCoeff] = useState<number>(value.coefficient)

  useEffect(() => {
    if (open) {
      setFromId(value.fromShapeId)
      setToId(value.toShapeId)
      setCoeff(value.coefficient)
      // auto-select category of from shape
      try {
        const shapes = engine.getShapes(nodeId)
        const fromShape = shapes.find((s) => s.id === value.fromShapeId)
        setSelectedCat(fromShape?.categoryId ?? null)
      } catch {
        setSelectedCat(null)
      }
    }
  }, [open, value, nodeId, engine])

  const shapes = useMemo(() => {
    try {
      return engine.getShapes(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId, open])
  const categories = useMemo(() => {
    try {
      return engine.getShapeCategories(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId, open])

  // Build category tree
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, typeof categories>()
    for (const c of categories) {
      const key = c.parentId ?? null
      if (!map.has(key)) map.set(key, [] as unknown as typeof categories)
      ;(map.get(key) as unknown as import('../../engine/shapeCategory').ShapeCategory[]).push(c)
    }
    return map
  }, [categories])

  const isCatCollapsed = (catId: string) =>
    useShapeCategoryViewStore.getState().collapsedIds[`${nodeId}:${catId}`] === true
  const [, setTick] = useState(0)
  useEffect(() => {
    const unsub = useShapeCategoryViewStore.subscribe(() => setTick((t) => t + 1))
    return unsub
  }, [])

  const filteredShapes = useMemo(() => {
    if (selectedCat === null) {
      // show Uncategorized only when selectedCat === null explicitly? Actually null means Uncategorized, undefined means all?
      // We treat selectedCat null as Uncategorized, but also provide All view
      return shapes.filter((s) => (s.categoryId ?? null) === null)
    }
    return shapes.filter((s) => s.categoryId === selectedCat)
  }, [shapes, selectedCat])

  const handleSave = () => {
    const newValue: MorphKeyframeValue = {
      fromShapeId: fromId,
      toShapeId: toId,
      coefficient: Math.max(0, Math.min(1, coeff)),
    }
    const result = dispatch(
      new SetKeyframeValueCommand({
        target: { kind: 'morph', nodeId },
        keyframeId,
        newValue: newValue as unknown as import('../../engine/keyframe').KeyframeValue,
      }),
    )
    if (!result.ok) notify(result.error.message)
    else onClose()
  }

  if (!open) return null

  const renderCat = (catId: string, depth: number): React.ReactNode => {
    const cat = categories.find((c) => c.id === catId)!
    const collapsed = isCatCollapsed(catId)
    const childCats = childrenByParent.get(catId) ?? []
    const isSelected = selectedCat === catId
    return (
      <li key={catId} style={{ marginLeft: depth * 12 }}>
        <button
          onClick={() => setSelectedCat(catId)}
          style={{
            width: '100%',
            textAlign: 'left',
            background: isSelected ? '#1a73e8' : 'transparent',
            color: isSelected ? '#fff' : 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '4px 6px',
            cursor: 'pointer',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {childCats.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation()
                useShapeCategoryViewStore.getState().toggleCollapsed(nodeId, catId)
              }}
              style={{
                width: 16,
                height: 16,
                display: 'grid',
                placeItems: 'center',
                border: '1px solid var(--color-border)',
                borderRadius: 3,
                fontSize: 9,
                background: isSelected ? 'rgba(255,255,255,0.2)' : 'transparent',
              }}
            >
              {collapsed ? '▶' : '▼'}
            </span>
          )}
          {cat.name}
        </button>
        {!collapsed && childCats.map((c) => renderCat(c.id, depth + 1))}
      </li>
    )
  }

  const rootCats = childrenByParent.get(null) ?? []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit Morph"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          borderRadius: 8,
          width: 720,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>Edit Morph — select shapes by category</h3>
          <button onClick={onClose} style={{ fontSize: 12, padding: '4px 8px' }}>
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left: categories */}
          <div
            style={{
              width: 220,
              borderRight: '1px solid var(--color-border)',
              overflowY: 'auto',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <button
              onClick={() => setSelectedCat(null)}
              style={{
                textAlign: 'left',
                background: selectedCat === null ? '#1a73e8' : 'transparent',
                color: selectedCat === null ? '#fff' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: '4px 6px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Uncategorized
            </button>
            {rootCats.length > 0 && (
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>Categories</div>
            )}
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {rootCats.map((c) => renderCat(c.id, 0))}
            </ul>
            <button
              onClick={() => setSelectedCat(undefined as unknown as string | null)}
              style={{ marginTop: 8, fontSize: 11, padding: '4px 6px' }}
            >
              Show All Shapes
            </button>
          </div>
          {/* Right: shapes + coefficient */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Selected category:{' '}
              {selectedCat === null
                ? 'Uncategorized'
                : selectedCat === undefined
                  ? 'All'
                  : (categories.find((c) => c.id === selectedCat)?.name ?? '—')}
            </div>
            {(selectedCat === undefined ? shapes : filteredShapes).length === 0 ? (
              <p style={{ fontSize: 12, opacity: 0.6 }}>No shapes in this category.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(selectedCat === undefined ? shapes : filteredShapes).map((shape) => (
                  <div
                    key={shape.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      background:
                        fromId === shape.id || toId === shape.id
                          ? 'color-mix(in srgb, #1a73e8 8%, var(--color-bg))'
                          : 'transparent',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12 }}>{shape.name}</span>
                    <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name="morph-from"
                        checked={fromId === shape.id}
                        onChange={() => setFromId(shape.id)}
                      />{' '}
                      From
                    </label>
                    <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name="morph-to"
                        checked={toId === shape.id}
                        onChange={() => setToId(shape.id)}
                      />{' '}
                      To
                    </label>
                  </div>
                ))}
              </div>
            )}
            <div
              style={{
                borderTop: '1px solid var(--color-border)',
                paddingTop: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                Coefficient (0 … 1)
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={coeff}
                  onChange={(e) => setCoeff(parseFloat(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={coeff}
                  onChange={(e) => setCoeff(parseFloat(e.target.value) || 0)}
                  style={{
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    width: 100,
                  }}
                />
              </label>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                From: {fromId ? (shapes.find((s) => s.id === fromId)?.name ?? fromId) : '—'} → To:{' '}
                {toId ? (shapes.find((s) => s.id === toId)?.name ?? toId) : '—'} @{' '}
                {coeff.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button onClick={onClose} style={{ fontSize: 12, padding: '6px 12px' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              background: '#1a73e8',
              color: '#fff',
              border: '1px solid #1a73e8',
              borderRadius: 4,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
