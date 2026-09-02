import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { SceneNode } from '../../engine'
import { NumericField } from './inspectorFields'
import { SetCircleComponentCommand } from '../../engine/commands/setCircleComponentCommand'
import { AddKeyframeCommand, SetKeyframeValueCommand } from '../../engine/commands'
import type { CircleComponent } from '../../engine/circleComponent'
import { circleSegmentsForArc, circleArcDegrees } from '../../engine/circleComponent'
import { useUiStore } from '../../stores/uiStore'
import { usePlaybackController } from '../../stores/playbackStore'
import type { CircleAnimationProperty } from '../../engine/animationProperties'

export function CircleInspectorSection({
  target,
  dispatch,
  notify,
  playing,
}: {
  target: SceneNode
  dispatch: (
    cmd: import('../../engine/commands').Command<unknown>,
  ) => import('../../engine/commands').CommandResult<unknown>
  notify: (msg: string) => void
  playing: boolean
}) {
  const { engine } = useEngine()
  const animationMode = useUiStore((s) => s.animationMode)
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))
  // subscribe to playback time so evaluated values update on scrub
  usePlaybackController((s) => s.currentTimes)

  const node = (() => {
    try {
      return engine.getNode(target.id)
    } catch {
      return target
    }
  })()

  const circle = node.components.circle
  if (!circle) {
    return null
  }

  const slide = engine.getActiveSlide()
  const slideId = slide?.id ?? null
  const playheadTime = slideId ? (usePlaybackController.getState().getTime(slideId) ?? 0) : 0
  const evaluatedCircle = !playing && !animationMode ? null : slideId ? engine.evaluateCircle(node.id, playheadTime) : null
  const displayRadius = evaluatedCircle?.radius ?? circle.radius
  const displayStart = evaluatedCircle?.startAngle ?? circle.startAngle
  const displayEnd = evaluatedCircle?.endAngle ?? circle.endAngle
  const displaySegments = evaluatedCircle?.segments ?? (circle.segments ?? circleSegmentsForArc(circleArcDegrees(circle.startAngle, circle.endAngle)))

  const isAnimated = (prop: CircleAnimationProperty) => engine.hasCircleTrack(node.id, prop)

  const commitCircleField = (property: CircleAnimationProperty, value: number) => {
    try {
      if (animationMode && slideId) {
        const time = usePlaybackController.getState().getTime(slideId)
        const existing = engine.getCircleKeyframes(node.id, property).find((kf) => kf.time === time)
        if (existing) {
          const result = dispatch(
            new SetKeyframeValueCommand({
              target: { kind: 'circle', nodeId: node.id, property },
              keyframeId: existing.id,
              newValue: value,
            }),
          )
          // fallback: engine expects circle target via AddKeyframeCommand path; SetKeyframeValueCommand currently expects node property target shape but our keyframeTarget supports circle.
          // The command's validate uses requireNodeTarget which now supports circle, so this should work.
          // If SetKeyframeValueCommand is strictly typed for AnimationProperty, we use generic AddKeyframe path via dispatchKeyframeCommands? For now use direct engine method via command.
          if (!result.ok) throw result.error
          return
        }
        const result = dispatch(
          new AddKeyframeCommand({
            target: { kind: 'circle', nodeId: node.id, property },
            time,
            value,
          }),
        )
        if (!result.ok) throw result.error
        return
      }
      // non-animation mode: mutate base component
      const next: CircleComponent = {
        kind: 'circle',
        radius: property === 'radius' ? value : circle.radius,
        startAngle: property === 'startAngle' ? value : circle.startAngle,
        endAngle: property === 'endAngle' ? value : circle.endAngle,
        ...(property === 'segments' || circle.segments !== undefined
          ? { segments: property === 'segments' ? Math.round(value) : circle.segments }
          : {}),
      }
      // if segments was auto and we are setting other prop, keep auto
      if (property !== 'segments' && circle.segments === undefined) {
        // keep auto (no segments field) — will recompute
        const { segments: _omit, ...rest } = next as unknown as Record<string, unknown>
        void _omit
        const autoNext = rest as unknown as CircleComponent
        const result = dispatch(new SetCircleComponentCommand({ nodeId: node.id, circle: autoNext }))
        if (!result.ok) throw result.error
        return
      }
      const result = dispatch(new SetCircleComponentCommand({ nodeId: node.id, circle: next }))
      if (!result.ok) throw result.error
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const computedSegments = displaySegments
  const isAutoSegments = !isAnimated('segments') && circle.segments === undefined

  const fieldDisabled = (prop: CircleAnimationProperty) => playing || (!animationMode && isAnimated(prop))

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Circle</h3>
      <NumericField
        label="Radius"
        value={displayRadius}
        step={1}
        disabled={fieldDisabled('radius')}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v)) {
            notify('Radius must be a finite number')
            return
          }
          commitCircleField('radius', v)
        }}
        onAdjust={(v) => commitCircleField('radius', v)}
      />
      <NumericField
        label="Start Angle"
        value={displayStart}
        step={1}
        disabled={fieldDisabled('startAngle')}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v)) {
            notify('Start angle must be a finite number')
            return
          }
          commitCircleField('startAngle', v)
        }}
        onAdjust={(v) => commitCircleField('startAngle', v)}
      />
      <NumericField
        label="End Angle"
        value={displayEnd}
        step={1}
        disabled={fieldDisabled('endAngle')}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v)) {
            notify('End angle must be a finite number')
            return
          }
          commitCircleField('endAngle', v)
        }}
        onAdjust={(v) => commitCircleField('endAngle', v)}
      />
      <NumericField
        label="Segments"
        value={computedSegments}
        step={1}
        disabled={fieldDisabled('segments')}
        onCommit={(raw) => {
          const v = Number(raw)
          if (!Number.isFinite(v)) {
            notify('Segments must be a finite number')
            return
          }
          commitCircleField('segments', Math.round(v))
        }}
        onAdjust={(v) => commitCircleField('segments', Math.round(v))}
      />
      {isAutoSegments && <p className="inspector-field__hint">Auto: max(16, ceil(arc/10°))</p>}
    </section>
  )
}
