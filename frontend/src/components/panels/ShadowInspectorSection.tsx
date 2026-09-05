import { useState } from 'react'
import type { SceneNode } from '../../engine'
import { isGroupNode } from '../../engine/sceneNode'
import { DEFAULT_SHADOW_EFFECT, type ShadowEffect } from '../../engine/shadowEffect'
import { SetShadowEffectCommand } from '../../engine/commands'
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
  // Only for single group node — parent caller ensures this, but double-check
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

  const commitField = (key: keyof ShadowEffect, rawValue: string | number) => {
    if (!effect) return
    let nextEffect: ShadowEffect = { ...effect }
    if (key === 'color') {
      const color = String(rawValue).trim()
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        notify(`Shadow ${LABELS[key]} must be #rrggbb`)
        return
      }
      nextEffect = { ...effect, color: color.toLowerCase() }
    } else if (key === 'opacity') {
      const percent = parseNumber(String(rawValue), effect.opacity * 100)
      const clamped = Math.max(0, Math.min(100, percent))
      nextEffect = { ...effect, opacity: clamped / 100 }
    } else if (key === 'blur') {
      const n = parseNumber(String(rawValue), effect.blur)
      const clamped = Math.max(0, Math.min(32, Math.round(n)))
      nextEffect = { ...effect, blur: clamped }
    } else {
      const n = parseNumber(String(rawValue), effect[key] as number)
      if (!Number.isFinite(n)) {
        notify(`Shadow ${LABELS[key]} must be a finite number`)
        return
      }
      nextEffect = { ...effect, [key]: n } as ShadowEffect
    }
    try {
      const result = dispatch(new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: nextEffect }))
      if (result && !result.ok) throw result.error
      setDraft({})
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const titleId = `shadow-section-${target.id}`

  return (
    <section className="inspector-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="inspector-section__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: playing ? 'not-allowed' : 'pointer' }}>
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
              onChange={(e) => setDraft((d) => ({ ...d, offsetX: parseNumber(e.target.value, current.offsetX) }))}
              onBlur={(e) => commitField('offsetX', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('offsetX', (e.target as HTMLInputElement).value)
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
              onChange={(e) => setDraft((d) => ({ ...d, offsetY: parseNumber(e.target.value, current.offsetY) }))}
              onBlur={(e) => commitField('offsetY', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('offsetY', (e.target as HTMLInputElement).value)
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
              onChange={(e) => setDraft((d) => ({ ...d, scaleX: parseNumber(e.target.value, current.scaleX) }))}
              onBlur={(e) => commitField('scaleX', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('scaleX', (e.target as HTMLInputElement).value)
              }}
              aria-label={LABELS.scaleX}
            />
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.scaleY}</span>
            <input
              type="number"
              step={0.05}
              value={String(current.scaleY)}
              disabled={playing}
              title={playing ? 'Cannot edit while playing' : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, scaleY: parseNumber(e.target.value, current.scaleY) }))}
              onBlur={(e) => commitField('scaleY', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('scaleY', (e.target as HTMLInputElement).value)
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
              onChange={(e) => setDraft((d) => ({ ...d, skewX: parseNumber(e.target.value, current.skewX) }))}
              onBlur={(e) => commitField('skewX', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('skewX', (e.target as HTMLInputElement).value)
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
              onChange={(e) => setDraft((d) => ({ ...d, skewY: parseNumber(e.target.value, current.skewY) }))}
              onBlur={(e) => commitField('skewY', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('skewY', (e.target as HTMLInputElement).value)
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
              onChange={(e) => setDraft((d) => ({ ...d, rotation: parseNumber(e.target.value, current.rotation) }))}
              onBlur={(e) => commitField('rotation', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('rotation', (e.target as HTMLInputElement).value)
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
              onChange={(e) => {
                const v = parseNumber(e.target.value, current.blur)
                setDraft((d) => ({ ...d, blur: v }))
                commitField('blur', v)
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
              onChange={(e) => setDraft((d) => ({ ...d, blur: parseNumber(e.target.value, current.blur) }))}
              onBlur={(e) => commitField('blur', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('blur', (e.target as HTMLInputElement).value)
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
              onChange={(e) => {
                const v = parseNumber(e.target.value, current.opacity * 100)
                setDraft((d) => ({ ...d, opacity: v / 100 }))
                commitField('opacity', v)
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
              onChange={(e) => setDraft((d) => ({ ...d, opacity: parseNumber(e.target.value, 0) / 100 }))}
              onBlur={(e) => commitField('opacity', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('opacity', (e.target as HTMLInputElement).value)
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
                commitField('color', e.target.value)
              }}
              aria-label={LABELS.color}
            />
            <input
              type="text"
              value={current.color}
              disabled={playing}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              onBlur={(e) => commitField('color', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitField('color', (e.target as HTMLInputElement).value)
              }}
              aria-label="Color hex"
            />
          </label>
        </div>
      )}
    </section>
  )
}
