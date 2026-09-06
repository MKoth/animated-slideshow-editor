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
  type ShadowAnchor,
  SHADOW_ANCHORS,
  normalizeAzimuth,
  deriveShadowProjection,
} from '../../engine/shadowEffect'
import {
  SetCastShadowCommand,
  SetShadowEffectCommand,
  SetShadowParamCommand,
  TransactionCommand,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { useUiStore } from '../../stores/uiStore'
import type { EnginePublic } from '../../engine'
import { autoKeyEdit, shadowPropertyStateOf, playheadTimeOf } from '../../app/keyframeActions'
import type { EnginePublic as EnginePublicType } from '../../engine/engine'
import { AddKeyframeCommand } from '../../engine/commands'
import { usePlaybackController } from '../../stores/playbackStore'

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
  anchor: 'Anchor',
  lightAzimuth: 'Azimuth',
  lightElevation: 'Elevation',
  lightDistance: 'Distance',
  auto: 'Auto',
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
  const enginePublic = _engine as unknown as EnginePublicType | undefined
  const animationMode = useUiStore((s) => s.animationMode)
  const [draft, setDraft] = useState<Partial<ShadowEffect>>({})
  const [isEditingSource, setIsEditingSource] = useState(false)
  const [showSilhouette, setShowSilhouette] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const dragRef = useRef<{ property: ShadowProperty; startValue: number } | null>(null)
  const playheadTick = usePlaybackController((s) => s.currentTimes[target.id] ?? 0)
  void playheadTick

  if (!isGroupNode(target)) return null
  const effect = target.shadowEffect
  const enabled = !!effect
  const isAuto = !!effect?.auto

  const current: ShadowEffect = effect
    ? { ...effect, ...draft }
    : { ...DEFAULT_SHADOW_EFFECT, ...draft }

  // For display when auto, show derived values for raw fields (read-only)
  const evaluatedForDisplay: ShadowEffect | null = (() => {
    if (!effect || !isAuto || !enginePublic) return null
    try {
      const time = playheadTimeOf(enginePublic as unknown as EnginePublic, target.id) ?? 0
      // Try to get bounds estimate? Use 0 for now, inspector snapshot will use derived directly
      const ev = enginePublic.evaluateShadow(target.id, time) as unknown as ShadowEffect | null
      return ev ?? null
    } catch {
      return null
    }
  })()

  const displayRaw: ShadowEffect = (() => {
    if (isAuto && evaluatedForDisplay)
      return { ...current, ...evaluatedForDisplay, ...draft } as ShadowEffect
    return current
  })()

  const playheadTime = enginePublic
    ? (playheadTimeOf(enginePublic as unknown as EnginePublic, target.id) ?? 0)
    : 0
  const shadowStateOf = (prop: ShadowProperty) => {
    if (!enginePublic) return null
    try {
      return shadowPropertyStateOf(
        enginePublic as unknown as EnginePublic,
        target.id,
        prop,
        playheadTime,
      )
    } catch {
      return null
    }
  }
  const isFieldDisabled = (prop: ShadowProperty) => {
    if (playing) return true
    const state = shadowStateOf(prop)
    const animated = state !== null && state !== 'static'
    return !animationMode && animated
  }
  const handleAddShadowKeyframe = (prop: ShadowProperty) => {
    if (!enginePublic || !effect) return
    try {
      const time = playheadTime
      const evaluated = enginePublic.evaluateShadow(target.id, time)
      const rawVal = evaluated
        ? (evaluated as unknown as Record<string, unknown>)[prop]
        : (effect as unknown as Record<string, unknown>)[prop]
      let value: unknown = rawVal
      if (value === undefined) {
        if (prop === 'color') value = '#000000'
        else if (prop === 'opacity') value = 0.35
        else if (prop === 'blur') value = 8
        else if ((prop as string).startsWith('scale')) value = 1
        else if ((prop as string).startsWith('light')) {
          if (prop === 'lightAzimuth') value = 135
          else if (prop === 'lightElevation') value = 45
          else value = 28
        } else value = 0
      }
      const result = dispatch(
        new AddKeyframeCommand({
          target: { kind: 'shadow', nodeId: target.id, property: prop },
          time,
          value: value as unknown as import('../../engine/keyframe').KeyframeValue,
        }),
      )
      if (result && !result.ok) throw result.error
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleEnabled = () => {
    if (playing) {
      notify('Cannot edit shadow while playing')
      return
    }
    try {
      const next = enabled
        ? null
        : {
            ...DEFAULT_SHADOW_EFFECT,
            auto: true,
            anchor: 'bottom' as ShadowAnchor,
            lightAzimuth: 135,
            lightElevation: 45,
            lightDistance: 28,
          }
      const result = dispatch(new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }))
      if (result && !result.ok) throw result.error
      setDraft({})
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleAuto = () => {
    if (!effect) return
    if (playing) {
      notify('Cannot edit shadow while playing')
      return
    }
    try {
      const currentlyAuto = !!effect.auto
      if (currentlyAuto) {
        // Auto -> manual: snapshot derived into raw so pose doesn't jump
        let derived: ShadowEffect | null = null
        try {
          if (enginePublic) {
            const time = playheadTimeOf(enginePublic as unknown as EnginePublic, target.id) ?? 0
            derived = enginePublic.evaluateShadow(target.id, time) as unknown as ShadowEffect | null
          }
        } catch (_e) {
          void _e
        }
        // Also try pure derive with defaults for bounds 100x100 if no engine
        let fallbackDerived: ShadowEffect | null = derived
        if (!derived) {
          const anchor = (effect.anchor ?? 'bottom') as ShadowAnchor
          const az = effect.lightAzimuth ?? 135
          const el = effect.lightElevation ?? 45
          const dist = effect.lightDistance ?? 28
          const d = deriveShadowProjection({ w: 100, h: 100 }, anchor, az, el, dist)
          fallbackDerived = { ...effect, ...d } as ShadowEffect
        } else {
          fallbackDerived = derived
        }
        const next: ShadowEffect = {
          ...effect,
          auto: false,
          offsetX: fallbackDerived.offsetX,
          offsetY: fallbackDerived.offsetY,
          scaleX: fallbackDerived.scaleX,
          scaleY: fallbackDerived.scaleY,
          skewX: fallbackDerived.skewX,
          skewY: fallbackDerived.skewY,
          rotation: fallbackDerived.rotation,
        }
        const result = dispatch(
          new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }),
        )
        if (result && !result.ok) throw result.error
        setDraft({})
        notify('Auto off — snapshot derived → raw')
      } else {
        // Manual -> auto: keep pose via defaults (reverse-derive not implemented, keep defaults)
        const next: ShadowEffect = {
          ...effect,
          auto: true,
          anchor: (effect.anchor as ShadowAnchor) ?? 'bottom',
          lightAzimuth: effect.lightAzimuth ?? 135,
          lightElevation: effect.lightElevation ?? 45,
          lightDistance: effect.lightDistance ?? 28,
        }
        // Ensure anchor valid
        if (!SHADOW_ANCHORS.includes(next.anchor as ShadowAnchor)) next.anchor = 'bottom'
        const result = dispatch(
          new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }),
        )
        if (result && !result.ok) throw result.error
        setDraft({})
        notify('Auto on — using light defaults')
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const commitParam = (property: ShadowProperty, rawValue: string | number) => {
    if (!effect) return
    // If editing raw while auto, snap auto off first
    const isRawProp =
      property === 'offsetX' ||
      property === 'offsetY' ||
      property === 'scaleX' ||
      property === 'scaleY' ||
      property === 'skewX' ||
      property === 'skewY' ||
      property === 'rotation'
    if (isAuto && isRawProp) {
      // Snap off then set
      try {
        let derived: ShadowEffect | null = null
        try {
          if (enginePublic) {
            const time = playheadTimeOf(enginePublic as unknown as EnginePublic, target.id) ?? 0
            derived = enginePublic.evaluateShadow(target.id, time) as unknown as ShadowEffect | null
          }
        } catch (_e) {
          void _e
        }
        const d = derived
          ? derived
          : (() => {
              const anchor = (effect.anchor ?? 'bottom') as ShadowAnchor
              const az = effect.lightAzimuth ?? 135
              const el = effect.lightElevation ?? 45
              const dist = effect.lightDistance ?? 28
              return {
                ...effect,
                ...deriveShadowProjection({ w: 100, h: 100 }, anchor, az, el, dist),
              } as ShadowEffect
            })()
        // Prepare next with auto false and derived snapshot plus edited value
        // isRawProp guarantees numeric raw prop, not color
        const nRaw = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        const val: number = nRaw
        const next: ShadowEffect = {
          ...effect,
          auto: false,
          offsetX: (d as ShadowEffect).offsetX,
          offsetY: (d as ShadowEffect).offsetY,
          scaleX: (d as ShadowEffect).scaleX,
          scaleY: (d as ShadowEffect).scaleY,
          skewX: (d as ShadowEffect).skewX,
          skewY: (d as ShadowEffect).skewY,
          rotation: (d as ShadowEffect).rotation,
          [property]: val,
        } as ShadowEffect
        const res = dispatch(new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }))
        if (res && !res.ok) throw res.error
        setDraft({})
        notify('Auto off — snapshot derived → raw')
        return
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e))
        return
      }
    }
    try {
      let value: number | string
      if (property === 'color') {
        value = String(rawValue).trim().toLowerCase()
      } else if (property === 'opacity') {
        const rawNum = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        if (!Number.isFinite(rawNum)) {
          value = rawNum
        } else if (typeof rawValue === 'string') {
          const p = Number(String(rawValue).trim())
          value = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) / 100 : p
        } else {
          value = rawNum > 1 ? rawNum / 100 : rawNum
        }
      } else if (property === 'blur') {
        const n = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        value = n
      } else if (
        property === 'lightAzimuth' ||
        property === 'lightElevation' ||
        property === 'lightDistance'
      ) {
        const n = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        if (!Number.isFinite(n)) {
          notify(
            `Shadow ${LABELS[property as keyof typeof LABELS] ?? property} must be a finite number`,
          )
          return
        }
        if (property === 'lightAzimuth') value = normalizeAzimuth(n)
        else if (property === 'lightElevation') value = Math.max(0, Math.min(90, n))
        else value = Math.max(0, Math.min(400, n))
      } else {
        const n = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
        if (!Number.isFinite(n)) {
          notify(
            `Shadow ${LABELS[property as keyof typeof LABELS] ?? property} must be a finite number`,
          )
          return
        }
        value = n
      }
      if (animationMode && enginePublic) {
        const res = autoKeyEdit(enginePublic as unknown as EnginePublic, dispatch, [
          {
            target: { kind: 'shadow', nodeId: target.id, property },
            value: value as unknown as import('../../engine/keyframe').KeyframeValue,
          },
        ])
        void res
        setDraft({})
        return
      }
      const result = dispatch(new SetShadowParamCommand({ nodeId: target.id, property, value }))
      if (result && !result.ok) throw result.error
      setDraft({})
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

  const commitParamAsTransaction = (property: ShadowProperty, value: number | string) => {
    if (!effect) return
    // Same auto snap logic for raw
    const isRawProp =
      property === 'offsetX' ||
      property === 'offsetY' ||
      property === 'scaleX' ||
      property === 'scaleY' ||
      property === 'skewX' ||
      property === 'skewY' ||
      property === 'rotation'
    if (isAuto && isRawProp) {
      // Delegate to commitParam which handles snap
      commitParam(property, value)
      return
    }
    try {
      let v: number | string = value
      if (property === 'opacity') {
        const num = typeof value === 'number' ? value : Number(String(value).trim())
        if (!Number.isFinite(num)) v = num
        else v = num > 1 ? num / 100 : num
      }
      if (property === 'color' && typeof v === 'string') v = v.toLowerCase()
      if (
        property === 'lightAzimuth' ||
        property === 'lightElevation' ||
        property === 'lightDistance'
      ) {
        const num = typeof v === 'number' ? v : Number(String(v).trim())
        if (property === 'lightAzimuth') v = normalizeAzimuth(num)
        else if (property === 'lightElevation') v = Math.max(0, Math.min(90, num))
        else v = Math.max(0, Math.min(400, num))
      }
      if (animationMode && enginePublic) {
        const res = autoKeyEdit(enginePublic as unknown as EnginePublic, dispatch, [
          {
            target: { kind: 'shadow', nodeId: target.id, property },
            value: v as unknown as import('../../engine/keyframe').KeyframeValue,
          },
        ])
        void res
        setDraft({})
        return
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

  const commitAnchor = (anchor: ShadowAnchor) => {
    if (!effect) return
    if (playing) {
      notify('Cannot edit shadow while playing')
      return
    }
    try {
      const next: ShadowEffect = { ...effect, anchor }
      const result = dispatch(new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }))
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
    // Spec 305 Ground becomes light preset: auto=true, anchor=bottom, azimuth=135, elevation=30, distance=22, blur=11, opacity=0.25
    if (animationMode && enginePublic) {
      try {
        // Try to set anchor/auto via direct effect, then keyframe light/blur/opacity
        const nextEffect: ShadowEffect = {
          ...effect,
          auto: true,
          anchor: 'bottom',
          lightAzimuth: 135,
          lightElevation: 30,
          lightDistance: 22,
          blur: 11,
          opacity: 0.25,
        }
        // Apply anchor/auto directly as one command (will be separate history from keyframes, but we try to keep one transaction via direct SetShadowEffect for those)
        // For simplicity, dispatch SetShadowEffect for anchor/auto then autoKeyEdit for keyframes
        const res1 = dispatch(
          new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: nextEffect }),
        )
        if (res1 && !res1.ok) throw res1.error
        const edits: {
          target: { kind: 'shadow'; nodeId: string; property: ShadowProperty }
          value: import('../../engine/keyframe').KeyframeValue
        }[] = [
          {
            target: {
              kind: 'shadow',
              nodeId: target.id,
              property: 'lightAzimuth' as ShadowProperty,
            },
            value: 135 as unknown as import('../../engine/keyframe').KeyframeValue,
          },
          {
            target: {
              kind: 'shadow',
              nodeId: target.id,
              property: 'lightElevation' as ShadowProperty,
            },
            value: 30 as unknown as import('../../engine/keyframe').KeyframeValue,
          },
          {
            target: {
              kind: 'shadow',
              nodeId: target.id,
              property: 'lightDistance' as ShadowProperty,
            },
            value: 22 as unknown as import('../../engine/keyframe').KeyframeValue,
          },
          {
            target: { kind: 'shadow', nodeId: target.id, property: 'blur' },
            value: 11 as unknown as import('../../engine/keyframe').KeyframeValue,
          },
          {
            target: { kind: 'shadow', nodeId: target.id, property: 'opacity' },
            value: 0.25 as unknown as import('../../engine/keyframe').KeyframeValue,
          },
        ]
        const res = autoKeyEdit(enginePublic as unknown as EnginePublic, dispatch, edits)
        void res
        return
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e))
        return
      }
    }
    try {
      const next: ShadowEffect = {
        ...effect,
        auto: true,
        anchor: 'bottom',
        lightAzimuth: 135,
        lightElevation: 30,
        lightDistance: 22,
        blur: 11,
        opacity: 0.25,
      }
      const result = dispatch(new SetShadowEffectCommand({ nodeId: target.id, shadowEffect: next }))
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
    const casters = collectShadowCasters(
      target as unknown as { children: readonly unknown[] },
    ) as SceneNode[]
    return new Set<string>(casters.map((c) => c.id))
  })()

  const toggleCastShadow = (node: SceneNode) => {
    const isBoneOrGhost = !!(
      node.components.bone ||
      node.components.ghost ||
      node.components.camera
    )
    if (isBoneOrGhost) {
      notify('Bone / Ghost / Camera nodes cannot cast shadows')
      return
    }
    const currentCast = getCastShadow(
      node as unknown as { components: Record<string, unknown>; castShadow?: boolean },
    )
    try {
      const result = dispatch(
        new SetCastShadowCommand({ nodeId: node.id, castShadow: !currentCast }),
      )
      if (result && !result.ok) throw result.error
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }

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
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={isAuto}
                onChange={toggleAuto}
                disabled={playing}
                title={playing ? 'Cannot edit while playing' : 'Auto derive transform'}
                aria-label="Auto"
              />
              Auto
            </label>
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
          </>
        )}
      </h3>
      {enabled && effect && (
        <div className="inspector-shadow-fields" style={{ display: 'grid', gap: 8 }}>
          {/* Anchor pills — only when auto */}
          {isAuto && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#aaa' }}>Anchor:</span>
              {(['top', 'bottom', 'left', 'right', 'center'] as ShadowAnchor[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => commitAnchor(a)}
                  disabled={playing}
                  aria-pressed={current.anchor === a}
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: current.anchor === a ? '1px solid #60a5fa' : '1px solid #555',
                    background: current.anchor === a ? 'rgba(96,165,250,0.2)' : 'transparent',
                    color: current.anchor === a ? '#bfdbfe' : '#ccc',
                    cursor: playing ? 'not-allowed' : 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          {/* Light controls — only when auto */}
          {isAuto && (
            <>
              {/* Azimuth */}
              <label className="inspector-field">
                <span className="inspector-field__label">Azimuth</span>
                {(() => {
                  const s = shadowStateOf('lightAzimuth' as ShadowProperty)
                  return s && s !== 'static' ? (
                    <span
                      className="inspector-field__indicator"
                      data-state={s}
                      title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                    >
                      {s === 'animated' ? '●' : '◆'}
                    </span>
                  ) : null
                })()}
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={String(current.lightAzimuth ?? 135)}
                  disabled={isFieldDisabled('lightAzimuth' as ShadowProperty)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      lightAzimuth: normalizeAzimuth(
                        parseNumber(e.target.value, current.lightAzimuth ?? 135),
                      ),
                    }))
                  }
                  onPointerUp={(e) => {
                    const v = normalizeAzimuth(
                      parseNumber(
                        (e.target as HTMLInputElement).value,
                        current.lightAzimuth ?? 135,
                      ),
                    )
                    commitParamAsTransaction('lightAzimuth' as ShadowProperty, v)
                  }}
                  aria-label="Azimuth"
                />
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={360}
                  value={String(current.lightAzimuth ?? 135)}
                  disabled={isFieldDisabled('lightAzimuth' as ShadowProperty)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      lightAzimuth: normalizeAzimuth(
                        parseNumber(e.target.value, current.lightAzimuth ?? 135),
                      ),
                    }))
                  }
                  onBlur={(e) => commitParam('lightAzimuth' as ShadowProperty, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      commitParam(
                        'lightAzimuth' as ShadowProperty,
                        (e.target as HTMLInputElement).value,
                      )
                  }}
                  aria-label="Azimuth value"
                  style={{ width: 60 }}
                />
                <span style={{ fontSize: 11 }}>°</span>
                {animationMode && !playing && (
                  <button
                    type="button"
                    className="inspector-field__add"
                    aria-label="Add Keyframe to Azimuth"
                    title="Add keyframe at playhead"
                    onClick={() => handleAddShadowKeyframe('lightAzimuth' as ShadowProperty)}
                    style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
                  >
                    +
                  </button>
                )}
              </label>
              {/* Elevation */}
              <label className="inspector-field">
                <span className="inspector-field__label">Elevation</span>
                {(() => {
                  const s = shadowStateOf('lightElevation' as ShadowProperty)
                  return s && s !== 'static' ? (
                    <span
                      className="inspector-field__indicator"
                      data-state={s}
                      title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                    >
                      {s === 'animated' ? '●' : '◆'}
                    </span>
                  ) : null
                })()}
                <input
                  type="range"
                  min={0}
                  max={90}
                  step={1}
                  value={String(current.lightElevation ?? 45)}
                  disabled={isFieldDisabled('lightElevation' as ShadowProperty)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      lightElevation: parseNumber(e.target.value, current.lightElevation ?? 45),
                    }))
                  }
                  onPointerUp={(e) => {
                    const v = parseNumber(
                      (e.target as HTMLInputElement).value,
                      current.lightElevation ?? 45,
                    )
                    commitParamAsTransaction(
                      'lightElevation' as ShadowProperty,
                      Math.max(0, Math.min(90, v)),
                    )
                  }}
                  aria-label="Elevation"
                />
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={90}
                  value={String(current.lightElevation ?? 45)}
                  disabled={isFieldDisabled('lightElevation' as ShadowProperty)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      lightElevation: parseNumber(e.target.value, current.lightElevation ?? 45),
                    }))
                  }
                  onBlur={(e) => commitParam('lightElevation' as ShadowProperty, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      commitParam(
                        'lightElevation' as ShadowProperty,
                        (e.target as HTMLInputElement).value,
                      )
                  }}
                  aria-label="Elevation value"
                  style={{ width: 60 }}
                />
                <span style={{ fontSize: 11 }}>°</span>
                {animationMode && !playing && (
                  <button
                    type="button"
                    className="inspector-field__add"
                    aria-label="Add Keyframe to Elevation"
                    title="Add keyframe at playhead"
                    onClick={() => handleAddShadowKeyframe('lightElevation' as ShadowProperty)}
                    style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
                  >
                    +
                  </button>
                )}
              </label>
              {/* Distance */}
              <label className="inspector-field">
                <span className="inspector-field__label">Distance</span>
                {(() => {
                  const s = shadowStateOf('lightDistance' as ShadowProperty)
                  return s && s !== 'static' ? (
                    <span
                      className="inspector-field__indicator"
                      data-state={s}
                      title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                    >
                      {s === 'animated' ? '●' : '◆'}
                    </span>
                  ) : null
                })()}
                <input
                  type="range"
                  min={0}
                  max={400}
                  step={1}
                  value={String(current.lightDistance ?? 28)}
                  disabled={isFieldDisabled('lightDistance' as ShadowProperty)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      lightDistance: parseNumber(e.target.value, current.lightDistance ?? 28),
                    }))
                  }
                  onPointerUp={(e) => {
                    const v = parseNumber(
                      (e.target as HTMLInputElement).value,
                      current.lightDistance ?? 28,
                    )
                    commitParamAsTransaction(
                      'lightDistance' as ShadowProperty,
                      Math.max(0, Math.min(400, v)),
                    )
                  }}
                  aria-label="Distance"
                />
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={400}
                  value={String(current.lightDistance ?? 28)}
                  disabled={isFieldDisabled('lightDistance' as ShadowProperty)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      lightDistance: parseNumber(e.target.value, current.lightDistance ?? 28),
                    }))
                  }
                  onBlur={(e) => commitParam('lightDistance' as ShadowProperty, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      commitParam(
                        'lightDistance' as ShadowProperty,
                        (e.target as HTMLInputElement).value,
                      )
                  }}
                  aria-label="Distance value"
                  style={{ width: 60 }}
                />
                <span style={{ fontSize: 11 }}>px</span>
                {animationMode && !playing && (
                  <button
                    type="button"
                    className="inspector-field__add"
                    aria-label="Add Keyframe to Distance"
                    title="Add keyframe at playhead"
                    onClick={() => handleAddShadowKeyframe('lightDistance' as ShadowProperty)}
                    style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
                  >
                    +
                  </button>
                )}
              </label>
            </>
          )}
          {/* Shared: Blur, Opacity, Color — always visible */}
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.blur}</span>
            {(() => {
              const s = shadowStateOf('blur')
              return s && s !== 'static' ? (
                <span
                  className="inspector-field__indicator"
                  data-state={s}
                  title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                >
                  {s === 'animated' ? '●' : '◆'}
                </span>
              ) : null
            })()}
            <input
              type="range"
              min={0}
              max={32}
              step={1}
              value={String(current.blur)}
              disabled={isFieldDisabled('blur')}
              onPointerDown={() => {
                if (!isFieldDisabled('blur'))
                  dragRef.current = { property: 'blur', startValue: current.blur }
              }}
              onPointerUp={(e) => {
                const drag = dragRef.current
                dragRef.current = null
                if (drag && playing) return
                const v = parseNumber((e.target as HTMLInputElement).value, current.blur)
                const clamped = Math.max(0, Math.min(32, Math.round(v)))
                commitParamAsTransaction('blur', clamped)
              }}
              onChange={(e) => {
                const v = parseNumber(e.target.value, current.blur)
                setDraft((d) => ({ ...d, blur: v }))
              }}
              aria-label={LABELS.blur}
            />
            <input
              type="number"
              step={1}
              min={0}
              max={32}
              value={String(current.blur)}
              disabled={isFieldDisabled('blur')}
              onChange={(e) =>
                setDraft((d) => ({ ...d, blur: parseNumber(e.target.value, current.blur) }))
              }
              onBlur={(e) => commitParam('blur', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('blur', (e.target as HTMLInputElement).value)
              }}
              aria-label="Blur value"
            />
            {animationMode && !playing && (
              <button
                type="button"
                className="inspector-field__add"
                aria-label={`Add Keyframe to ${LABELS.blur}`}
                title="Add keyframe at playhead"
                onClick={() => handleAddShadowKeyframe('blur')}
                style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
              >
                +
              </button>
            )}
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.opacity}</span>
            {(() => {
              const s = shadowStateOf('opacity')
              return s && s !== 'static' ? (
                <span
                  className="inspector-field__indicator"
                  data-state={s}
                  title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                >
                  {s === 'animated' ? '●' : '◆'}
                </span>
              ) : null
            })()}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={String(Math.round(current.opacity * 100))}
              disabled={isFieldDisabled('opacity')}
              onPointerDown={() => {
                if (!isFieldDisabled('opacity'))
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
              disabled={isFieldDisabled('opacity')}
              onChange={(e) =>
                setDraft((d) => ({ ...d, opacity: parseNumber(e.target.value, 0) / 100 }))
              }
              onBlur={(e) => commitParam('opacity', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('opacity', (e.target as HTMLInputElement).value)
              }}
              aria-label="Opacity value"
            />
            {animationMode && !playing && (
              <button
                type="button"
                className="inspector-field__add"
                aria-label={`Add Keyframe to ${LABELS.opacity}`}
                title="Add keyframe at playhead"
                onClick={() => handleAddShadowKeyframe('opacity')}
                style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
              >
                +
              </button>
            )}
          </label>
          <label className="inspector-field">
            <span className="inspector-field__label">{LABELS.color}</span>
            {(() => {
              const s = shadowStateOf('color')
              return s && s !== 'static' ? (
                <span
                  className="inspector-field__indicator"
                  data-state={s}
                  title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                >
                  {s === 'animated' ? '●' : '◆'}
                </span>
              ) : null
            })()}
            <input
              type="color"
              value={current.color}
              disabled={isFieldDisabled('color')}
              onChange={(e) => {
                setDraft((d) => ({ ...d, color: e.target.value }))
                commitParam('color', e.target.value)
              }}
              aria-label={LABELS.color}
            />
            <input
              type="text"
              value={current.color}
              disabled={isFieldDisabled('color')}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              onBlur={(e) => commitParam('color', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitParam('color', (e.target as HTMLInputElement).value)
              }}
              aria-label="Color hex"
            />
            {animationMode && !playing && (
              <button
                type="button"
                className="inspector-field__add"
                aria-label={`Add Keyframe to ${LABELS.color}`}
                title="Add keyframe at playhead"
                onClick={() => handleAddShadowKeyframe('color')}
                style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
              >
                +
              </button>
            )}
          </label>

          {/* Advanced — collapsed, read-only when Auto */}
          <details
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
            style={{ border: '1px solid #333', borderRadius: 4, padding: 6 }}
          >
            <summary style={{ fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
              ▸ Advanced (offset/scale/skew/rotation) {isAuto ? '— read-only when Auto' : ''}
            </summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8, opacity: isAuto ? 0.6 : 1 }}>
              {(
                [
                  'offsetX',
                  'offsetY',
                  'scaleX',
                  'scaleY',
                  'skewX',
                  'skewY',
                  'rotation',
                ] as ShadowProperty[]
              ).map((prop) => (
                <label key={prop} className="inspector-field">
                  <span className="inspector-field__label">
                    {LABELS[prop as keyof typeof LABELS] ?? prop}
                  </span>
                  {(() => {
                    const s = shadowStateOf(prop)
                    return s && s !== 'static' ? (
                      <span
                        className="inspector-field__indicator"
                        data-state={s}
                        title={s === 'animated' ? 'Animated' : 'Playhead on keyframe'}
                      >
                        {s === 'animated' ? '●' : '◆'}
                      </span>
                    ) : null
                  })()}
                  <input
                    type="number"
                    step={prop.startsWith('scale') ? 0.05 : 1}
                    value={String(
                      (displayRaw as unknown as Record<string, unknown>)[prop] as number,
                    )}
                    disabled={isAuto || isFieldDisabled(prop)}
                    title={
                      isAuto
                        ? 'Read-only when Auto — editing snaps Auto off'
                        : isFieldDisabled(prop)
                          ? playing
                            ? 'Cannot edit while playing'
                            : 'Enter animation mode to edit animated property'
                          : undefined
                    }
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [prop]: parseNumber(
                          e.target.value,
                          (displayRaw as unknown as Record<string, number>)[prop],
                        ),
                      }))
                    }
                    onBlur={(e) => commitParam(prop, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitParam(prop, (e.target as HTMLInputElement).value)
                    }}
                    aria-label={LABELS[prop as keyof typeof LABELS] ?? prop}
                  />
                  {animationMode && !playing && !isAuto && (
                    <button
                      type="button"
                      className="inspector-field__add"
                      aria-label={`Add Keyframe to ${LABELS[prop as keyof typeof LABELS] ?? prop}`}
                      title="Add keyframe at playhead"
                      onClick={() => handleAddShadowKeyframe(prop)}
                      style={{ marginLeft: 4, fontSize: 11, padding: '1px 4px' }}
                    >
                      +
                    </button>
                  )}
                </label>
              ))}
            </div>
          </details>
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
            <div
              style={{
                display: 'grid',
                gap: 4,
                border: '1px solid #555',
                padding: 8,
                borderRadius: 4,
              }}
            >
              <div style={{ fontSize: 11, color: '#aaa' }}>
                Click descendant to toggle Cast Shadow. Bone / Ghost / Camera cannot cast
                (disabled). Non-casters dimmed to 30%, casters amber 2px outline.
              </div>
              {allDescendants.length === 0 && <div style={{ fontSize: 12 }}>No descendants</div>}
              {allDescendants.map((node) => {
                const isBoneOrGhost = !!(
                  node.components.bone ||
                  node.components.ghost ||
                  node.components.camera
                )
                const isCaster = casterSet.has(node.id)
                const castShadowVal = getCastShadow(
                  node as unknown as { components: Record<string, unknown>; castShadow?: boolean },
                )
                const isPrunedByAncestor = (() => {
                  let cur: SceneNode | null = node.parent
                  while (cur && cur.id !== target.id) {
                    if (
                      !getCastShadow(
                        cur as unknown as {
                          components: Record<string, unknown>
                          castShadow?: boolean
                        },
                      )
                    )
                      return true
                    cur = cur.parent
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
                      {isBoneOrGhost
                        ? 'Bone/Ghost'
                        : isCasterRenderable(
                              node as unknown as { components: Record<string, unknown> },
                            )
                          ? ''
                          : ' (group)'}
                      {isCaster ? ' ● caster' : ' ○ non-caster'}
                    </span>
                  </div>
                )
              })}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={showSilhouette}
                  onChange={(e) => setShowSilhouette(e.target.checked)}
                />
                Show silhouette
              </label>
              {showSilhouette && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#aaa',
                    border: '1px dashed #555',
                    padding: 4,
                    borderRadius: 3,
                  }}
                >
                  Silhouette preview (untransformed alpha, BBox-sized) — not yet implemented for
                  auto-derived shadows.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
