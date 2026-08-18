import { useState } from 'react'
import type { EnginePublic, SceneNode } from '../../engine'
import type { ClipInstance } from '../../engine/clipInstance'
import type { ClipDefinition } from '../../engine/clipDefinition'
import type { DispatchCommand } from '../../engine/commands'
import {
  AssignClipCommand,
  RemoveClipCommand,
  MoveClipLayerCommand,
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
  SetClipInstanceEnabledCommand,
  OverrideClipParamCommand,
} from '../../engine/commands'
import { NumericField } from './inspectorFields'
import { parseFiniteNumber } from '../../app/inspectorActions'
import { useEngineEvent } from '../../app/useEngine'

function InstanceRow({
  instance,
  nodeId,
  dispatch,
  notify,
  playing,
  clipDefs,
  index,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  instance: ClipInstance
  nodeId: string
  dispatch: DispatchCommand
  notify: (msg: string) => void
  playing: boolean
  clipDefs: readonly ClipDefinition[]
  index: number
  onDragStart: (e: React.DragEvent, idx: number) => void
  onDragOver: (e: React.DragEvent, idx: number) => void
  onDrop: (e: React.DragEvent, idx: number) => void
}) {
  const clip = clipDefs.find((c) => c.id === instance.clipId)
  const clipName = clip?.name ?? instance.clipId

  const commitStartTime = (raw: string) => {
    try {
      const value = parseFiniteNumber(raw, 'Start Time')
      dispatch(
        new SetClipInstanceStartTimeCommand({ nodeId, instanceId: instance.id, startTime: value }),
      )
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const commitSpeed = (raw: string) => {
    try {
      const value = parseFiniteNumber(raw, 'Speed')
      dispatch(new SetClipInstanceSpeedCommand({ nodeId, instanceId: instance.id, speed: value }))
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      className="clip-instance-row"
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
    >
      <div className="clip-instance-row__header">
        <span className="clip-instance-row__drag-handle" title="Drag to reorder">
          ⠿
        </span>
        <label className="clip-instance-row__name" title={clipName}>
          {clipName}
        </label>
        <label className="clip-instance-row__enabled">
          <input
            type="checkbox"
            checked={instance.enabled}
            disabled={playing}
            onChange={() => {
              dispatch(
                new SetClipInstanceEnabledCommand({
                  nodeId,
                  instanceId: instance.id,
                  enabled: !instance.enabled,
                }),
              )
            }}
          />
        </label>
        <button
          className="clip-instance-row__remove"
          aria-label={`Remove clip ${clipName}`}
          disabled={playing}
          onClick={() => {
            dispatch(new RemoveClipCommand({ nodeId, instanceId: instance.id }))
          }}
        >
          ×
        </button>
      </div>
      <div className="clip-instance-row__fields">
        <NumericField
          label="Start"
          value={instance.startTime}
          step={0.1}
          disabled={playing}
          onCommit={commitStartTime}
          onAdjust={(v) => commitStartTime(String(v))}
        />
        <NumericField
          label="Speed"
          value={instance.speed}
          step={0.1}
          disabled={playing}
          onCommit={commitSpeed}
          onAdjust={(v) => commitSpeed(String(v))}
        />
      </div>
      {clip && clip.params.length > 0 && (
        <div className="clip-instance-row__params">
          {clip.params.map((param) => {
            const effective = instance.paramOverrides[param.key] ?? param.default
            const isOverridden = param.key in instance.paramOverrides
            return (
              <div key={param.key} className="inspector-field clip-param-row">
                <label className="inspector-field__label">{param.label}</label>
                <span className="clip-param-row__default">
                  {isOverridden ? `default: ${param.default}` : ''}
                </span>
                <NumericField
                  label={param.label}
                  value={effective}
                  step={0.01}
                  disabled={playing}
                  onCommit={(raw) => {
                    try {
                      const value = parseFiniteNumber(raw, param.label)
                      dispatch(
                        new OverrideClipParamCommand({
                          nodeId,
                          instanceId: instance.id,
                          paramKey: param.key,
                          value,
                        }),
                      )
                    } catch (error) {
                      notify(error instanceof Error ? error.message : String(error))
                    }
                  }}
                  onAdjust={(v) => {
                    dispatch(
                      new OverrideClipParamCommand({
                        nodeId,
                        instanceId: instance.id,
                        paramKey: param.key,
                        value: v,
                      }),
                    )
                  }}
                  after={
                    isOverridden ? (
                      <button
                        className="inspector-field__clear"
                        aria-label={`Clear ${param.label} override`}
                        disabled={playing}
                        onClick={() => {
                          dispatch(
                            new OverrideClipParamCommand({
                              nodeId,
                              instanceId: instance.id,
                              paramKey: param.key,
                              value: param.default,
                            }),
                          )
                        }}
                      >
                        Clear
                      </button>
                    ) : undefined
                  }
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AnimationsInspectorSection({
  target,
  engine,
  dispatch,
  notify,
  playing,
}: {
  target: SceneNode
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (msg: string) => void
  playing: boolean
}) {
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

  const instances = engine.getClipInstances(target.id)
  const clipDefs = engine.clips

  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const handleAdd = (clipId: string) => {
    if (!clipId) return
    dispatch(new AssignClipCommand({ nodeId: target.id, clipId }))
  }

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.setData('text/plain', String(idx))
    e.dataTransfer.effectAllowed = 'move'
    setDragIndex(idx)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault()
    const fromIdx = dragIndex
    setDragIndex(null)
    if (fromIdx === null || fromIdx === dropIdx) return
    const instance = instances[fromIdx]
    if (!instance) return
    dispatch(
      new MoveClipLayerCommand({ nodeId: target.id, instanceId: instance.id, newIndex: dropIdx }),
    )
  }

  const handleDragEnd = () => {
    setDragIndex(null)
  }

  return (
    <section
      className="inspector-section inspector-section--animations"
      data-testid="animations-section"
    >
      <h3 className="inspector-section__title">Animations</h3>

      {instances.map((instance, idx) => (
        <InstanceRow
          key={instance.id}
          instance={instance}
          nodeId={target.id}
          dispatch={dispatch}
          notify={notify}
          playing={playing}
          clipDefs={clipDefs}
          index={idx}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}

      {instances.length === 0 && <p className="inspector-section__notice">No clips assigned.</p>}

      <div className="clip-add-row" onDragEnd={handleDragEnd}>
        <select
          className="inspector-field__input inspector-field__select clip-add-picker"
          aria-label="Add clip"
          disabled={playing}
          value=""
          onChange={(e) => {
            handleAdd(e.target.value)
            e.target.value = ''
          }}
        >
          <option value="" disabled>
            {clipDefs.length > 0 ? 'Add clip...' : 'No clips available'}
          </option>
          {clipDefs.map((clip) => (
            <option key={clip.id} value={clip.id}>
              {clip.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
