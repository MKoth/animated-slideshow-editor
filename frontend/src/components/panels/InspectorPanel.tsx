import { useRef, useState } from 'react'
import type { CommandResult } from '../../engine/commands'
import type { EngineContextValue } from '../../app/engineContext'
import type { WorldTransform } from '../../engine/worldTransform'
import {
  applyNodePosition,
  applyNodeRotationDegrees,
  applyNodeScale,
  degreesOf,
  formatDecimal,
  parseFiniteNumber,
  readNodeWorld,
  resetNodeTransform,
  roundToStep,
} from '../../app/inspectorActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { EngineReadOnly, SceneNode } from '../../engine'
import { useNotificationStore } from '../../stores/notificationStore'
import { useSelectionStore } from '../../stores/selectionStore'

const DRAG_THRESHOLD_PX = 3

const COMING_SOON_SECTIONS = [
  'Material',
  'Animation',
  'Shader',
  'Anchors',
  'Physics',
  'AI Metadata',
]

type TransformField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'

const FIELD_LABELS: Record<TransformField, string> = {
  x: 'X',
  y: 'Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
}

function inspectedNode(engine: EngineReadOnly, selectedIds: readonly string[]): SceneNode | null {
  for (const nodeId of selectedIds) {
    try {
      const node = engine.getNode(nodeId)
      if (!node.components.camera) {
        return node
      }
    } catch {
      // the id is stale (node deleted); try the next selected id
    }
  }
  return null
}

function applyField(
  engine: EngineReadOnly,
  dispatch: EngineContextValue['dispatch'],
  node: SceneNode,
  world: WorldTransform,
  field: TransformField,
  value: number,
): CommandResult<unknown> | null {
  switch (field) {
    case 'x':
      return applyNodePosition(engine, dispatch, node.id, value, world.y)
    case 'y':
      return applyNodePosition(engine, dispatch, node.id, world.x, value)
    case 'rotation':
      return applyNodeRotationDegrees(engine, dispatch, node.id, value)
    case 'scaleX':
      return applyNodeScale(engine, dispatch, node.id, value, world.scaleY)
    case 'scaleY':
      return applyNodeScale(engine, dispatch, node.id, world.scaleX, value)
  }
}

interface NumericFieldProps {
  label: string
  value: number
  step: number
  onCommit: (raw: string) => void
  onAdjust: (value: number) => void
}

function NumericField({ label, value, step, onCommit, onAdjust }: NumericFieldProps) {
  const [text, setText] = useState(formatDecimal(value))
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ startX: number; startValue: number; dragging: boolean } | null>(null)

  if (!editing && text !== formatDecimal(value)) {
    setText(formatDecimal(value))
  }

  const commit = () => {
    setEditing(false)
    onCommit(text)
  }

  const cancel = () => {
    setEditing(false)
    setText(formatDecimal(value))
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
    setText(formatDecimal(next))
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
      <input
        id={label}
        ref={inputRef}
        className="inspector-field__input"
        type="number"
        aria-label={label}
        value={text}
        onChange={(event) => {
          setEditing(true)
          setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            cancel()
          }
        }}
        onBlur={() => {
          if (editing) {
            commit()
          }
        }}
        onPointerDown={handlePointerDown}
      />
    </div>
  )
}

function PlaceholderField({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={label}>
        {label}
      </label>
      <input
        id={label}
        className="inspector-field__input"
        type="number"
        aria-label={label}
        value={value}
        disabled
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
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))

  const target = inspectedNode(engine, selectedIds)
  const reading = target ? readNodeWorld(engine, target.id) : null

  if (!target || !reading) {
    return (
      <div className="inspector-panel" style={{ width }}>
        <div className="panel-empty-state">
          <p>Nothing selected. Select an object to edit its properties.</p>
        </div>
      </div>
    )
  }

  const world = reading.world

  const commitField = (field: TransformField, raw: string) => {
    try {
      const value = parseFiniteNumber(raw, FIELD_LABELS[field])
      const result = applyField(engine, dispatch, target, world, field, value)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const adjustField = (field: TransformField, value: number) => {
    try {
      const result = applyField(engine, dispatch, target, world, field, value)
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const handleResetTransform = () => {
    const result = resetNodeTransform(engine, dispatch, target.id)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  return (
    <div className="inspector-panel" style={{ width }}>
      <div className="inspector-scroll">
        <InspectorSection title="General">
          <div className="inspector-field">
            <label className="inspector-field__label" htmlFor="Name">
              Name
            </label>
            <input
              id="Name"
              className="inspector-field__input"
              type="text"
              aria-label="Name"
              value={target.name}
              disabled
            />
          </div>
        </InspectorSection>

        <InspectorSection title="Transform">
          <NumericField
            label="X"
            value={world.x}
            step={1}
            onCommit={(raw) => commitField('x', raw)}
            onAdjust={(value) => adjustField('x', value)}
          />
          <NumericField
            label="Y"
            value={world.y}
            step={1}
            onCommit={(raw) => commitField('y', raw)}
            onAdjust={(value) => adjustField('y', value)}
          />
          <NumericField
            label="Rotation"
            value={degreesOf(world)}
            step={1}
            onCommit={(raw) => commitField('rotation', raw)}
            onAdjust={(value) => adjustField('rotation', value)}
          />
          <NumericField
            label="Scale X"
            value={world.scaleX}
            step={0.01}
            onCommit={(raw) => commitField('scaleX', raw)}
            onAdjust={(value) => adjustField('scaleX', value)}
          />
          <NumericField
            label="Scale Y"
            value={world.scaleY}
            step={0.01}
            onCommit={(raw) => commitField('scaleY', raw)}
            onAdjust={(value) => adjustField('scaleY', value)}
          />
          <button className="inspector-reset" onClick={handleResetTransform}>
            Reset Transform
          </button>
        </InspectorSection>

        <InspectorSection title="Appearance">
          <PlaceholderField label="Opacity" value={String(Math.round(target.opacity * 100))} />
        </InspectorSection>

        {COMING_SOON_SECTIONS.map((title) => (
          <ComingSoonSection key={title} title={title} />
        ))}
      </div>
    </div>
  )
}
