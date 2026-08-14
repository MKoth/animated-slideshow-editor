import { useRef, useState } from 'react'
import type { WorldTransform } from '../../engine/worldTransform'
import { normalizeRotation } from '../../engine'
import {
  applyNodeField,
  applyNodeFieldAutoKey,
  applyNodeName,
  applyNodeOpacity,
  applyNodeOpacityAutoKey,
  degreesOf,
  FIELD_LABELS,
  FIELD_PROPERTY,
  formatDecimal,
  parseFiniteNumber,
  readEvaluatedNodeWorld,
  readStoredNodeWorld,
  resetNodesTransform,
  resetNodesTransformAutoKey,
  roundToStep,
} from '../../app/inspectorActions'
import type { InspectorFieldKind } from '../../app/inspectorActions'
import type { PropertyState } from '../../app/keyframeActions'
import { playheadTimeOf, propertyStateOf } from '../../app/keyframeActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { EnginePublic, SceneNode } from '../../engine'
import type { AnimationProperty } from '../../engine'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useUiStore } from '../../stores/uiStore'

const DRAG_THRESHOLD_PX = 3
const MIXED_MARKER = '—'

const COMING_SOON_SECTIONS = [
  'Material',
  'Animation',
  'Shader',
  'Anchors',
  'Physics',
  'AI Metadata',
]

function inspectedTargets(engine: EnginePublic, selectedIds: readonly string[]): SceneNode[] {
  const targets: SceneNode[] = []
  for (const nodeId of selectedIds) {
    try {
      targets.push(engine.getNode(nodeId))
    } catch {
      // the id is stale (node deleted); skip it
    }
  }
  return targets
}

function commonValueOf<T>(targets: readonly SceneNode[], read: (node: SceneNode) => T): T | null {
  const first = read(targets[0])
  for (const node of targets.slice(1)) {
    if (read(node) !== first) {
      return null
    }
  }
  return first
}

function mixedTransformField(
  readings: readonly (WorldTransform | null)[],
  field: InspectorFieldKind,
): number | null {
  const firstReading = readings[0]
  if (!firstReading) {
    return null
  }
  const comparable = (reading: WorldTransform): number =>
    field === 'rotation' ? normalizeRotation(reading.rotation) : reading[field]
  const first = comparable(firstReading)
  for (const reading of readings) {
    if (!reading || comparable(reading) !== first) {
      return null
    }
  }
  return field === 'rotation' ? degreesOf(firstReading) : first
}

function useEditBuffer(value: string): {
  readonly text: string
  readonly editing: boolean
  setText: (value: string) => void
  begin: () => void
  commit: () => string
  cancel: () => void
} {
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)

  if (!editing && text !== value) {
    setText(value)
  }

  return {
    text,
    editing,
    setText,
    begin: () => {
      setEditing(true)
    },
    commit: () => {
      setEditing(false)
      return text
    },
    cancel: () => {
      setEditing(false)
    },
  }
}

interface NumericFieldProps {
  label: string
  value: number | null
  step: number
  disabled?: boolean
  state?: PropertyState | null
  onCommit: (raw: string) => void
  onAdjust: (value: number) => void
}

function NumericField({
  label,
  value,
  step,
  disabled = false,
  state = null,
  onCommit,
  onAdjust,
}: NumericFieldProps) {
  const display = value === null ? MIXED_MARKER : formatDecimal(value)
  const buffer = useEditBuffer(display)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ startX: number; startValue: number; dragging: boolean } | null>(null)

  const commit = () => {
    onCommit(buffer.commit())
  }

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    const delta = event.clientX - drag.startX
    if (!drag.dragging && Math.abs(delta) < DRAG_THRESHOLD_PX) {
      return
    }
    drag.dragging = true
    event.preventDefault()
    const next = roundToStep(drag.startValue + delta * step, step)
    buffer.setText(formatDecimal(next))
    onAdjust(next)
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    if (!drag || drag.dragging) {
      return
    }
    const input = inputRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    if (value === null || disabled) {
      return
    }
    dragRef.current = { startX: event.clientX, startValue: value, dragging: false }
    event.preventDefault()
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={label}>
        {label}
      </label>
      {state && state !== 'static' && (
        <span
          className="inspector-field__indicator"
          data-state={state}
          title={state === 'animated' ? 'Animated' : 'Playhead on keyframe'}
        >
          {state === 'animated' ? '●' : '◆'}
        </span>
      )}
      <input
        id={label}
        ref={inputRef}
        className="inspector-field__input"
        type={buffer.editing || value !== null ? 'number' : 'text'}
        aria-label={label}
        disabled={disabled}
        value={buffer.text}
        onChange={(event) => {
          buffer.begin()
          buffer.setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            buffer.cancel()
          }
        }}
        onBlur={() => {
          if (buffer.editing) {
            commit()
          }
        }}
        onPointerDown={handlePointerDown}
      />
    </div>
  )
}

function NameField({
  value,
  onCommit,
  disabled = false,
}: {
  value: string | null
  onCommit: (raw: string) => void
  disabled?: boolean
}) {
  const display = value === null ? MIXED_MARKER : value
  const buffer = useEditBuffer(display)

  const commit = () => {
    onCommit(buffer.commit())
  }

  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor="Name">
        Name
      </label>
      <input
        id="Name"
        className="inspector-field__input"
        type="text"
        aria-label="Name"
        disabled={disabled}
        value={buffer.text}
        onChange={(event) => {
          buffer.begin()
          buffer.setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            buffer.cancel()
          }
        }}
        onBlur={() => {
          if (buffer.editing) {
            commit()
          }
        }}
      />
    </div>
  )
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">{title}</h3>
      {children}
    </section>
  )
}

function ComingSoonSection({ title }: { title: string }) {
  return (
    <section className="inspector-section inspector-section--coming-soon">
      <h3 className="inspector-section__title">{title}</h3>
      <p className="inspector-section__notice">Coming in future versions.</p>
    </section>
  )
}

export function InspectorPanel({ width }: { width: number }) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const animationMode = useUiStore((state) => state.animationMode)
  const cameraAnimationMode = useUiStore((state) => state.cameraAnimationMode)
  usePlaybackController((state) => state.currentTimes)
  const playing = usePlaybackController((state) => state.status === 'playing')
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))

  const targets = inspectedTargets(engine, selectedIds)
  const cameraSelected = targets.length === 1 && Boolean(targets[0]?.components.camera)
  const animatingCamera = cameraAnimationMode && cameraSelected
  const transformAutoKey = animationMode || animatingCamera
  const opacityAutoKey = animationMode
  const evaluatedDisplay = transformAutoKey || playing
  const modeActions = {
    readWorld: evaluatedDisplay ? readEvaluatedNodeWorld : readStoredNodeWorld,
    opacityOf: evaluatedDisplay
      ? (node: SceneNode) =>
          engine.evaluateNode(node.id, playheadTimeOf(engine, node.id) ?? 0).opacity
      : (node: SceneNode) => node.opacity,
    applyField: transformAutoKey ? applyNodeFieldAutoKey : applyNodeField,
    applyOpacity: opacityAutoKey ? applyNodeOpacityAutoKey : applyNodeOpacity,
    resetTransform: transformAutoKey ? resetNodesTransformAutoKey : resetNodesTransform,
  }
  const readTarget = targets.length > 0 ? modeActions.readWorld(engine, targets[0].id) : null

  if (targets.length === 0 || !readTarget) {
    return (
      <div className="inspector-panel" style={{ width }}>
        <div className="panel-empty-state">
          <p>Nothing selected. Select an object to edit its properties.</p>
        </div>
      </div>
    )
  }

  const multi = targets.length > 1
  const targetIds = targets.map((node) => node.id)
  const cameraTarget = targets.some((node) => Boolean(node.components.camera))
  const world = readTarget.world
  const indicatorTime = playheadTimeOf(engine, targets[0].id) ?? 0
  const indicatorOf = (field: InspectorFieldKind): PropertyState | null =>
    propertyStateOf(engine, targets[0].id, FIELD_PROPERTY[field], indicatorTime)
  const opacityIndicator = propertyStateOf(engine, targets[0].id, 'opacity', indicatorTime)
  const commonName = commonValueOf(targets, (node) => node.name)
  const commonOpacity = commonValueOf(targets, modeActions.opacityOf)
  const transformReadings = targets.map(
    (node) => modeActions.readWorld(engine, node.id)?.world ?? null,
  )
  const opacityPercent = commonOpacity === null ? null : Math.round(commonOpacity * 100)
  const animatedPropertyOf = (property: AnimationProperty): boolean =>
    targets.some((node) => engine.getKeyframes(node.id, property).length > 0)
  const fieldDisabledOf = (field: InspectorFieldKind): boolean =>
    playing || (!transformAutoKey && animatedPropertyOf(FIELD_PROPERTY[field]))
  const opacityDisabled = playing || (!opacityAutoKey && animatedPropertyOf('opacity'))

  const commitField = (field: InspectorFieldKind, raw: string) => {
    try {
      const value = parseFiniteNumber(raw, FIELD_LABELS[field])
      const result = modeActions.applyField(engine, dispatch, targetIds, field, value)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustField = (field: InspectorFieldKind, value: number) => {
    try {
      const result = modeActions.applyField(engine, dispatch, targetIds, field, value)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitName = (raw: string) => {
    try {
      const result = applyNodeName(engine, dispatch, targetIds, raw)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitOpacity = (raw: string) => {
    try {
      const percent = parseFiniteNumber(raw, 'Opacity')
      const result = modeActions.applyOpacity(engine, dispatch, targetIds, percent / 100)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustOpacity = (percent: number) => {
    try {
      const result = modeActions.applyOpacity(engine, dispatch, targetIds, percent / 100)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const handleResetTransform = () => {
    const result = modeActions.resetTransform(engine, dispatch, targetIds)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  return (
    <div className="inspector-panel" style={{ width }}>
      <div className="inspector-scroll">
        <InspectorSection title={multi ? `${targets.length} Objects Selected` : 'General'}>
          <NameField value={commonName} onCommit={commitName} disabled={playing} />
        </InspectorSection>

        <InspectorSection title="Transform">
          <NumericField
            label="X"
            value={multi ? mixedTransformField(transformReadings, 'x') : world.x}
            step={1}
            disabled={fieldDisabledOf('x')}
            state={indicatorOf('x')}
            onCommit={(raw) => commitField('x', raw)}
            onAdjust={(value) => adjustField('x', value)}
          />
          <NumericField
            label="Y"
            value={multi ? mixedTransformField(transformReadings, 'y') : world.y}
            step={1}
            disabled={fieldDisabledOf('y')}
            state={indicatorOf('y')}
            onCommit={(raw) => commitField('y', raw)}
            onAdjust={(value) => adjustField('y', value)}
          />
          <NumericField
            label="Rotation"
            value={multi ? mixedTransformField(transformReadings, 'rotation') : degreesOf(world)}
            step={1}
            disabled={cameraTarget || fieldDisabledOf('rotation')}
            state={indicatorOf('rotation')}
            onCommit={(raw) => commitField('rotation', raw)}
            onAdjust={(value) => adjustField('rotation', value)}
          />
          <NumericField
            label="Scale X"
            value={multi ? mixedTransformField(transformReadings, 'scaleX') : world.scaleX}
            step={0.01}
            disabled={fieldDisabledOf('scaleX')}
            state={indicatorOf('scaleX')}
            onCommit={(raw) => commitField('scaleX', raw)}
            onAdjust={(value) => adjustField('scaleX', value)}
          />
          <NumericField
            label="Scale Y"
            value={multi ? mixedTransformField(transformReadings, 'scaleY') : world.scaleY}
            step={0.01}
            disabled={fieldDisabledOf('scaleY')}
            state={indicatorOf('scaleY')}
            onCommit={(raw) => commitField('scaleY', raw)}
            onAdjust={(value) => adjustField('scaleY', value)}
          />
          <button className="inspector-reset" onClick={handleResetTransform} disabled={playing}>
            Reset Transform
          </button>
        </InspectorSection>

        <InspectorSection title="Appearance">
          <NumericField
            label="Opacity"
            value={opacityPercent}
            step={1}
            disabled={opacityDisabled}
            state={opacityIndicator}
            onCommit={commitOpacity}
            onAdjust={adjustOpacity}
          />
        </InspectorSection>

        {COMING_SOON_SECTIONS.map((title) => (
          <ComingSoonSection key={title} title={title} />
        ))}
      </div>
    </div>
  )
}
