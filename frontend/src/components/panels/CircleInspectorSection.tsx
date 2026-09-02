import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { SceneNode } from '../../engine'
import { NumericField } from './inspectorFields'
import { SetCircleComponentCommand } from '../../engine/commands/setCircleComponentCommand'
import type { CircleComponent } from '../../engine/circleComponent'
import { circleSegmentsForArc, circleArcDegrees } from '../../engine/circleComponent'

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
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

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

  const computedSegments =
    circle.segments ?? circleSegmentsForArc(circleArcDegrees(circle.startAngle, circle.endAngle))

  const commitCircle = (patch: Partial<CircleComponent>) => {
    try {
      const next: CircleComponent = {
        kind: 'circle',
        radius: patch.radius ?? circle.radius,
        startAngle: patch.startAngle ?? circle.startAngle,
        endAngle: patch.endAngle ?? circle.endAngle,
        ...(patch.segments !== undefined || circle.segments !== undefined
          ? { segments: patch.segments ?? circle.segments }
          : {}),
      }
      const result = dispatch(new SetCircleComponentCommand({ nodeId: node.id, circle: next }))
      if (!result.ok) throw result.error
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustRadius = (value: number) => commitCircle({ radius: value })
  const commitRadius = (raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) {
      notify('Radius must be a finite number')
      return
    }
    commitCircle({ radius: v })
  }
  const adjustStart = (value: number) => commitCircle({ startAngle: value })
  const commitStart = (raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) {
      notify('Start angle must be a finite number')
      return
    }
    commitCircle({ startAngle: v })
  }
  const adjustEnd = (value: number) => commitCircle({ endAngle: value })
  const commitEnd = (raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) {
      notify('End angle must be a finite number')
      return
    }
    commitCircle({ endAngle: v })
  }
  const adjustSegments = (value: number) => commitCircle({ segments: Math.round(value) })
  const commitSegments = (raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) {
      notify('Segments must be a finite number')
      return
    }
    commitCircle({ segments: Math.round(v) })
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Circle</h3>
      <NumericField
        label="Radius"
        value={circle.radius}
        step={1}
        disabled={playing}
        onCommit={commitRadius}
        onAdjust={adjustRadius}
      />
      <NumericField
        label="Start Angle"
        value={circle.startAngle}
        step={1}
        disabled={playing}
        onCommit={commitStart}
        onAdjust={adjustStart}
      />
      <NumericField
        label="End Angle"
        value={circle.endAngle}
        step={1}
        disabled={playing}
        onCommit={commitEnd}
        onAdjust={adjustEnd}
      />
      <NumericField
        label="Segments"
        value={computedSegments}
        step={1}
        disabled={playing}
        onCommit={commitSegments}
        onAdjust={adjustSegments}
      />
      {circle.segments === undefined && (
        <p className="inspector-field__hint">Auto: max(16, ceil(arc/10°))</p>
      )}
    </section>
  )
}
