import { useState, useRef } from 'react'
import type { SceneNode } from '../../engine'
import { isGroupNode, walkPreOrder } from '../../engine/sceneNode'
import {
  DEFAULT_SHADOW_EFFECT,
  collectShadowCasters,
  getCastShadow,
  isCasterRenderable,
  type ShadowEffect,
  type ShadowProperty,
} from '../../engine/shadowEffect'
import {
  SetCastShadowCommand,
  SetShadowEffectCommand,
  SetShadowParamCommand,
  TransactionCommand,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'

interface ShadowInspectorSectionProps {
  target: SceneNode
  engine: unknown
  dispatch: DispatchCommand
  notify: (msg: string) => void
  playing: boolean
}

const LABELS: Record<keyof ShadowEffect, string> = {
  offsetX: 'Offset X',
  offsetY: 'Offset Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  skewX: 'Skew X',
  skewY: 'Skew Y',
  rotation: 'Rotation',
  blur: 'Blur',
  opacity: 'Opacity',
  color: 'Color',
}

function parseNumber(raw: string, fallback: number): number {
  const v = Number(raw.trim())
  return Number.isFinite(v) ? v : fallback
}

export function ShadowInspectorSection({
  target,
  engine: _engine,
  dispatch,
  notify,
  playing,
}: ShadowInspectorSectionProps) {
  void _engine
  const [draft, setDraft] = useState<Partial<ShadowEffect>>({})
  const [isEditingSource, setIsEditingSource] = useState(false)
  const [showSilhouette, setShowSilhouette] = useState(false)
  // drag state for coalescing sliders
  const dragRef = useRef<{ property: ShadowProperty; startValue: number } | null>(null)

  if (!isGroupNode(target)) return null
  const effect = target.shadowEffect
  const enabled = !!effect

  const current: ShadowEffect = effect
    ? { ...effect, ...draft }
    : { ...DEFAULT_SHADOW_EFFECT, ...draft }

  const toggleEnabled = () => {
    if (playing) {
      notify('Cannot edit shadow while playing')
      return
    }
    try {
      const next = enabled ? null : { ...DEFAULT_SHADOW_EFFECT }
      const result = dispatch(new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }))
      if (result && !result.ok) throw result.error
      setDraft({})
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const commitParam = (property: ShadowProperty, rawValue: string | number) => {
    if (!effect) return
    try {
      let value: number | string
      if (property === 'color') {
        value = String(rawValue).trim()
      } else if (property === 'opacity') {
        // UI percent 0..100 -> fraction 0..1; NaN handled by command
        const rawNum = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        if (!Number.isFinite(rawNum)) {
          value = rawNum
        } else if (typeof rawValue === 'string') {
          // String from number input: treat as percent 0..100
          const p = Number(String(rawValue).trim())
          value = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) / 100 : p
        } else {
          // Number from range/slider: already percent 0..100, but could be direct fraction from code
          // If value >1, treat as percent; else fraction (to support programmatic calls)
          value = rawNum > 1 ? rawNum / 100 : rawNum
        }
      } else if (property === 'blur') {
        const n = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        value = n
      } else {
        const n = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        if (!Number.isFinite(n)) {
          notify(`Shadow ${LABELS[property]} must be a finite number`)
          return
        }
        value = n
      }
      const result = dispatch(new SetShadowParamCommand({ nodeId: target.id, property, value }))
      if (result && !result.ok) throw result.error
      setDraft({})
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  // For drag coalescing: NumericField-like behavior where pointerMove updates draft but only pointerUp commits as one Transaction
  const commitParamAsTransaction = (property: ShadowProperty, value: number | string) => {
    if (!effect) return
    try {
      let v: number | string = value
      if (property === 'opacity') {
        // value is percent 0..100 from slider drag
        const num = typeof value === 'number' ? value : Number(String(value).trim())
        if (!Number.isFinite(num)) {
          v = num
        } else {
          v = num > 1 ? num / 100 : num
        }
      }
      const cmd = new SetShadowParamCommand({ nodeId: target.id, property, value: v })
      const tx = new TransactionCommand([cmd])
      const result = dispatch(tx)
      if (result && !result.ok) throw result.error
      setDraft({})
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const applyGroundPreset = () => {
    if (!effect) return
    if (playing) {
      notify('Cannot edit shadow while playing')
      return
    }
    try {
      const cmds = [
        new SetShadowParamCommand({ nodeId: target.id, property: 'scaleX', value: 1.1 }),
        new SetShadowParamCommand({ nodeId: target.id, property: 'scaleY', value: 0.2 }),
        new SetShadowParamCommand({ nodeId: target.id, property: 'skewX', value: -12 }),
        new SetShadowParamCommand({ nodeId: target.id, property: 'blur', value: 11 }),
        new SetShadowParamCommand({ nodeId: target.id, property: 'opacity', value: 0.25 }),
        new SetShadowParamCommand({ nodeId: target.id, property: 'offsetY', value: 8 }),
      ]
      const result = dispatch(new TransactionCommand(cmds))
      if (result && !result.ok) throw result.error
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const allDescendants: SceneNode[] = (() => {
    const out: SceneNode[] = []
    for (const n of walkPreOrder(target)) {
      if (n.id !== target.id) out.push(n)
    }
    return out
  })()

  const casterSet = (() => {
    const casters = collectShadowCasters(target as unknown as { children: readonly unknown[] }) as SceneNode[]
    return new Set<string>(casters.map((c) => c.id))
  })()

  const toggleCastShadow = (node: SceneNode) => {
    const isBoneOrGhost = !!(node.components.bone || node.components.ghost || node.components.camera)
    if (isBoneOrGhost) {
      notify('Bone / Ghost / Camera nodes cannot cast shadows')
      return
    }
    const currentCast = getCastShadow(node as unknown as { components: Record<string, unknown>; castShadow?: boolean })
    try {
      const result = dispatch(new SetCastShadowCommand({ nodeId: node.id, castShadow: !currentCast }))
      if (result && !result.ok) throw result.error
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const pad = effect ? Math.ceil(effect.blur * 2 + 4) : 4

  const titleId = `shadow-section-${target.id}`

  return (
    <section className="inspector-section" aria-labelledby={titleId}>
      <h3
        id={titleId}
        className="inspector-section__title"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: playing ? 'not-allowed' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={toggleEnabled}
            disabled={playing}
            title={playing ? 'Cannot edit while playing' : 'Toggle shadow effect'}
            aria-label="Shadow"
          />
          Shadow
        </label>
        {enabled && (
          <button
            type="button"
            onClick={applyGroundPreset}
            disabled={playing}
            title={playing ? 'Cannot edit while playing' : 'Apply Ground preset (one undo)'}
            aria-label="Ground preset"
            style={{ marginLeft: 'auto', fontSize: 12, padding: '2px 6px' }}
          >
            ↘ Ground
          </button>
        )}
      </h3>
      {enabled && effect && (
        <div className="inspector-shadow-fields" style={{ display: 'grid', gap: 8 }}>
          {/* Offset X */}
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.offsetX}</span>
            <input
              type="number"
              step={1}
              value={String(current.offsetX)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, offsetX: parseNumber(e.target.value, current.offsetX) }))
              }
              onBlur={(e) => commitParam('offsetX', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('offsetX', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.offsetX
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  lastValue = next
                  setDraft((d) => ({ ...d, offsetX: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('offsetX', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.offsetX}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.offsetY}</span>
            <input
              type="number"
              step={1}
              value={String(current.offsetY)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, offsetY: parseNumber(e.target.value, current.offsetY) }))
              }
              onBlur={(e) => commitParam('offsetY', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('offsetY', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.offsetY
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  lastValue = next
                  setDraft((d) => ({ ...d, offsetY: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('offsetY', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.offsetY}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.scaleX}</span>
            <input
              type="number"
              step={0.05}
              value={String(current.scaleX)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, scaleX: parseNumber(e.target.value, current.scaleX) }))
              }
              onBlur={(e) => commitParam('scaleX', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('scaleX', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.scaleX
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const step = 0.05
                  const next = Number(
                    (Math.round((startValue + delta * step) / step) * step).toFixed(4),
                  )
                  lastValue = next
                  setDraft((d) => ({ ...d, scaleX: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('scaleX', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.scaleX}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.scaleY}</span>
            <input
              type="number"
              step={0.01}
              value={String(current.scaleY)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, scaleY: parseNumber(e.target.value, current.scaleY) }))
              }
              onBlur={(e) => commitParam('scaleY', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('scaleY', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.scaleY
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const step = 0.01
                  const next = Number(
                    (Math.round((startValue + delta * step) / step) * step).toFixed(4),
                  )
                  lastValue = next
                  setDraft((d) => ({ ...d, scaleY: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('scaleY', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.scaleY}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.skewX}</span>
            <input
              type="number"
              step={1}
              value={String(current.skewX)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, skewX: parseNumber(e.target.value, current.skewX) }))
              }
              onBlur={(e) => commitParam('skewX', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('skewX', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.skewX
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  lastValue = next
                  setDraft((d) => ({ ...d, skewX: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('skewX', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.skewX}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.skewY}</span>
            <input
              type="number"
              step={1}
              value={String(current.skewY)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, skewY: parseNumber(e.target.value, current.skewY) }))
              }
              onBlur={(e) => commitParam('skewY', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('skewY', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.skewY
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  lastValue = next
                  setDraft((d) => ({ ...d, skewY: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('skewY', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.skewY}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.rotation}</span>
            <input
              type="number"
              step={1}
              value={String(current.rotation)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, rotation: parseNumber(e.target.value, current.rotation) }))
              }
              onBlur={(e) => commitParam('rotation', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('rotation', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.rotation
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  lastValue = next
                  setDraft((d) => ({ ...d, rotation: next }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('rotation', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label={LABELS.rotation}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.blur}</span>
            <input
              type="range"
              min={0}
              max={32}
              step={1}
              value={String(current.blur)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onPointerDown={() => {
                if (playing) return
                dragRef.current = { property: 'blur', startValue: current.blur }
              }}
              onPointerUp={(e) => {
                const drag = dragRef.current
                dragRef.current = null
                if (drag && playing) return
                const v = parseNumber((e.target as HTMLInputElement).value, current.blur)
                // Commit as transaction (one undo)
                const clamped = Math.max(0, Math.min(32, Math.round(v)))
                commitParamAsTransaction('blur', clamped)
              }}
              onChange={(e) => {
                const v = parseNumber(e.target.value, current.blur)
                setDraft((d) => ({ ...d, blur: v }))
                // Don't commit on change during drag; wait for pointerUp
              }}
              aria-label={LABELS.blur}
            />
            <input
              type="number"
              step={1}
              min={0}
              max={32}
              value={String(current.blur)}
              disabled={playing}
              onChange={(e) =>
                setDraft((d) => ({ ...d, blur: parseNumber(e.target.value, current.blur) }))
              }
              onBlur={(e) => commitParam('blur', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('blur', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = current.blur
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  const clamped = Math.max(0, Math.min(32, next))
                  lastValue = clamped
                  setDraft((d) => ({ ...d, blur: clamped }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('blur', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label="Blur value"
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.opacity}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={String(Math.round(current.opacity * 100))}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onPointerDown={() => {
                if (playing) return
                dragRef.current = {
                  property: 'opacity',
                  startValue: Math.round(current.opacity * 100),
                }
              }}
              onPointerUp={(e) => {
                const drag = dragRef.current
                dragRef.current = null
                if (drag && playing) return
                const v = parseNumber((e.target as HTMLInputElement).value, current.opacity * 100)
                commitParamAsTransaction('opacity', v)
              }}
              onChange={(e) => {
                const v = parseNumber(e.target.value, current.opacity * 100)
                setDraft((d) => ({ ...d, opacity: v / 100 }))
              }}
              aria-label={LABELS.opacity}
            />
            <input
              type="number"
              step={1}
              min={0}
              max={100}
              value={String(Math.round(current.opacity * 100))}
              disabled={playing}
              onChange={(e) =>
                setDraft((d) => ({ ...d, opacity: parseNumber(e.target.value, 0) / 100 }))
              }
              onBlur={(e) => commitParam('opacity', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('opacity', (e.target as HTMLInputElement).value)
              }}
              onPointerDown={(e) => {
                if (playing) return
                const startX = e.clientX
                const startValue = Math.round(current.opacity * 100)
                let lastValue = startValue
                let dragging = false
                const onMove = (ev: PointerEvent) => {
                  const delta = ev.clientX - startX
                  if (!dragging && Math.abs(delta) < 3) return
                  dragging = true
                  ev.preventDefault()
                  const next = Math.round(startValue + delta * 1)
                  const clamped = Math.max(0, Math.min(100, next))
                  lastValue = clamped
                  setDraft((d) => ({ ...d, opacity: clamped / 100 }))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  if (dragging && lastValue !== startValue) {
                    commitParamAsTransaction('opacity', lastValue)
                  }
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
              aria-label="Opacity value"
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.color}</span>
            <input
              type="color"
              value={current.color}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) => {
                setDraft((d) => ({ ...d, color: e.target.value }))
                commitParam('color', e.target.value)
              }}
              aria-label={LABELS.color}
            />
            <input
              type="text"
              value={current.color}
              disabled={playing}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              onBlur={(e) => commitParam('color', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('color', (e.target as HTMLInputElement).value)
              }}
              aria-label="Color hex"
            />
          </label>
        </div>
      )}
      {enabled && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <button
            type="button"
            onClick={() => setIsEditingSource((v) => !v)}
            disabled={playing}
            title={playing ? 'Cannot edit while playing' : 'Edit which descendants cast shadows'}
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            {isEditingSource ? 'Done Editing Shadow Source' : 'Edit Shadow Source…'}
          </button>
          {isEditingSource && (
            <div style={{ display: 'grid', gap: 4, border: '1px solid #555', padding: 8, borderRadius: 4 }}>
              <div style={{ fontSize: 11, color: '#aaa' }}>
                Click descendant to toggle Cast Shadow. Bone / Ghost / Camera cannot cast (disabled). Non-casters dimmed to 30%, casters amber 2px outline.
              </div>
              {allDescendants.length === 0 && <div style={{ fontSize: 12 }}>No descendants</div>}
              {allDescendants.map((node) => {
                const isBoneOrGhost = !!(node.components.bone || node.components.ghost || node.components.camera)
                const isCaster = casterSet.has(node.id)
                const castShadowVal = getCastShadow(node as unknown as { components: Record<string, unknown>; castShadow?: boolean })
                const isPrunedByAncestor = (() => {
                  let cur: SceneNode | null = node.parent
                  while (cur && cur.id !== target.id) {
                    if (!getCastShadow(cur as unknown as { components: Record<string, unknown>; castShadow?: boolean })) return true
                    cur = cur.parent
                  }
                  if (target.id !== node.id) {
                    // also check direct? Already handled via casterSet? Actually if ancestor false, casterSet won't contain node
                  }
                  return false
                })()
                return (
                  <div
                    key={node.id}
                    onClick={() => !isBoneOrGhost && toggleCastShadow(node)}
                    title={
                      isBoneOrGhost
                        ? 'Bone / Ghost / Camera nodes cannot cast shadows'
                        : isPrunedByAncestor
                          ? 'Pruned by ancestor with Cast Shadow = false — child cannot re-enable'
                          : isCaster
                            ? 'Caster — click to disable Cast Shadow'
                            : 'Non-caster — click to enable Cast Shadow'
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 4px',
                      cursor: isBoneOrGhost ? 'not-allowed' : 'pointer',
                      opacity: isBoneOrGhost ? 0.5 : isCaster ? 1 : 0.3,
                      border: isCaster ? '2px solid #f59e0b' : '1px solid transparent',
                      borderRadius: 3,
                      background: isCaster ? 'rgba(245,158,11,0.1)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={castShadowVal}
                      disabled={isBoneOrGhost}
                      onChange={() => toggleCastShadow(node)}
                      onClick={(e) => e.stopPropagation()}
                      title={isBoneOrGhost ? 'Bone / Ghost / Camera cannot cast' : undefined}
                    />
                    <span style={{ fontSize: 12, flex: 1 }}>{node.name}</span>
                    <span style={{ fontSize: 10, color: '#888' }}>
                      {isBoneOrGhost ? 'Bone/Ghost' : isCasterRenderable(node as unknown as { components: Record<string, unknown> }) ? '' : ' (group)'}
                      {isCaster ? ' ● caster' : ' ○ non-caster'}
                    </span>
                  </div>
                )
              })}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
                <input type="checkbox" checked={showSilhouette} onChange={(e) => setShowSilhouette(e.target.checked)} />
                Show silhouette
              </label>
              {showSilhouette && (
                <div style={{ fontSize: 11, color: '#aaa', border: '1px dashed #f59e0b', padding: 4, borderRadius: 3 }}>
                  Silhouette BBox debug overlay: union world AABB + pad {pad}px
                  <div>Pad = ceil(blur*2+4) = {pad}</div>
                  <div>Casters: {casterSet.size} / Descendants: {allDescendants.length}</div>
                  <div style={{ marginTop: 4, fontStyle: 'italic' }}>Canvas overlay draws amber rect around silhouette bounds when enabled.</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
