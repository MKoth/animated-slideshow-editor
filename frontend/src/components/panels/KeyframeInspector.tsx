import { useCallback, useMemo } from 'react'
import type { Keyframe } from '../../engine'
import type { AnimationProperty } from '../../engine'
import type { InterpolationType, KeyframeTangent } from '../../engine/keyframe'
import { EASING_PRESETS, findPresetByTangents } from '../../engine/easingPresets'
import type { DispatchCommand } from '../../engine/commands'
import {
  SetKeyframeInterpolationCommand,
  SetKeyframeTangentsCommand,
  SetKeyframeValueCommand,
  SetClipKeyframeInterpolationCommand,
  SetClipKeyframeTangentsCommand,
  SetClipKeyframeValueCommand,
} from '../../engine/commands'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import { NumericField } from './inspectorFields'

function tangentLabel(kind: 'in' | 'out'): string {
  return kind === 'in' ? 'Tangent In' : 'Tangent Out'
}

function TangentFields({
  kind,
  tangent,
  disabled,
  onCommit,
}: {
  kind: 'in' | 'out'
  tangent: KeyframeTangent
  disabled: boolean
  onCommit: (kind: 'in' | 'out', field: 'time' | 'value', raw: string) => void
}) {
  return (
    <div className="keyframe-tangent-row">
      <span className="keyframe-tangent-row__label">{tangentLabel(kind)}</span>
      <NumericField
        label="Time"
        value={tangent.time}
        step={0.01}
        disabled={disabled}
        onCommit={(raw) => onCommit(kind, 'time', raw)}
        onAdjust={() => {}}
      />
      <NumericField
        label="Value"
        value={tangent.value}
        step={0.01}
        disabled={disabled}
        onCommit={(raw) => onCommit(kind, 'value', raw)}
        onAdjust={() => {}}
      />
    </div>
  )
}

export interface KeyframeInspectorProps {
  readonly dispatch: DispatchCommand
  readonly nodeId?: string
  readonly property?: string
  readonly parameter?: string
  readonly morphNodeId?: string
  readonly clipTarget?: { clipId: string; channel: AnimationProperty }
  readonly keyframe: Keyframe
  readonly playing: boolean
  readonly notify: (message: string) => void
}

export function KeyframeInspector({
  dispatch,
  nodeId,
  property,
  parameter,
  morphNodeId,
  clipTarget,
  keyframe,
  playing,
  notify,
}: KeyframeInspectorProps) {
  const isClip = clipTarget !== undefined
  const isMorph = morphNodeId !== undefined
  const target = useMemo(() => {
    if (isClip && clipTarget) {
      return { kind: 'clip' as const, clipId: clipTarget.clipId, channel: clipTarget.channel }
    }
    if (isMorph && morphNodeId) {
      return { kind: 'morph' as const, nodeId: morphNodeId }
    }
    if (parameter) {
      return { kind: 'node' as const, nodeId: nodeId!, parameter }
    }
    return { kind: 'node' as const, nodeId: nodeId!, property: property as 'positionX' }
  }, [nodeId, property, parameter, morphNodeId, clipTarget, isClip, isMorph])

  const handleInterpolationChange = useCallback(
    (newInterpolation: InterpolationType) => {
      if (isClip && clipTarget) {
        const result = dispatch(
          new SetClipKeyframeInterpolationCommand({
            target: { kind: 'clip', clipId: clipTarget.clipId, channel: clipTarget.channel },
            keyframeId: keyframe.id,
            interpolation: newInterpolation,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      } else {
        const result = dispatch(
          new SetKeyframeInterpolationCommand({
            target: target as
              | import('../../engine/keyframeTarget').NodePropertyTarget
              | import('../../engine/keyframeTarget').NodeParameterTarget
              | import('../../engine/keyframeTarget').NodeMorphTarget,
            keyframeId: keyframe.id,
            interpolation: newInterpolation,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      }
    },
    [dispatch, target, keyframe.id, notify, isClip, clipTarget],
  )

  const handlePresetApply = useCallback(
    (presetIndex: number) => {
      const preset = EASING_PRESETS[presetIndex]
      if (!preset) {
        return
      }
      if (isClip && clipTarget) {
        const commands = [
          new SetClipKeyframeInterpolationCommand({
            target: { kind: 'clip', clipId: clipTarget.clipId, channel: clipTarget.channel },
            keyframeId: keyframe.id,
            interpolation: 'bezier',
          }),
          new SetClipKeyframeTangentsCommand({
            target: { kind: 'clip', clipId: clipTarget.clipId, channel: clipTarget.channel },
            keyframeId: keyframe.id,
            tangentIn: { ...preset.tangentIn },
            tangentOut: { ...preset.tangentOut },
          }),
        ]
        const result = dispatchKeyframeCommands(dispatch, commands)
        if (result && !result.ok) {
          notify(result.error.message)
        }
      } else {
        const commands = [
          new SetKeyframeInterpolationCommand({
            target: target as
              | import('../../engine/keyframeTarget').NodePropertyTarget
              | import('../../engine/keyframeTarget').NodeParameterTarget
              | import('../../engine/keyframeTarget').NodeMorphTarget,
            keyframeId: keyframe.id,
            interpolation: 'bezier',
          }),
          new SetKeyframeTangentsCommand({
            target: target as
              | import('../../engine/keyframeTarget').NodePropertyTarget
              | import('../../engine/keyframeTarget').NodeParameterTarget
              | import('../../engine/keyframeTarget').NodeMorphTarget,
            keyframeId: keyframe.id,
            tangentIn: { ...preset.tangentIn },
            tangentOut: { ...preset.tangentOut },
          }),
        ]
        const result = dispatchKeyframeCommands(dispatch, commands)
        if (result && !result.ok) {
          notify(result.error.message)
        }
      }
    },
    [dispatch, target, keyframe.id, notify, isClip, clipTarget],
  )

  const handleTangentCommit = useCallback(
    (kind: 'in' | 'out', field: 'time' | 'value', raw: string) => {
      const num = Number(raw)
      if (!Number.isFinite(num)) {
        return
      }
      const current = kind === 'in' ? keyframe.tangentIn : keyframe.tangentOut
      const updated = { ...current, [field]: num }
      const tangentIn = kind === 'in' ? updated : keyframe.tangentIn
      const tangentOut = kind === 'out' ? updated : keyframe.tangentOut
      if (isClip && clipTarget) {
        const result = dispatch(
          new SetClipKeyframeTangentsCommand({
            target: { kind: 'clip', clipId: clipTarget.clipId, channel: clipTarget.channel },
            keyframeId: keyframe.id,
            tangentIn,
            tangentOut,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      } else {
        const result = dispatch(
          new SetKeyframeTangentsCommand({
            target: target as
              | import('../../engine/keyframeTarget').NodePropertyTarget
              | import('../../engine/keyframeTarget').NodeParameterTarget
              | import('../../engine/keyframeTarget').NodeMorphTarget,
            keyframeId: keyframe.id,
            tangentIn,
            tangentOut,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      }
    },
    [
      dispatch,
      target,
      keyframe.id,
      keyframe.tangentIn,
      keyframe.tangentOut,
      notify,
      isClip,
      clipTarget,
    ],
  )

  const currentPreset = findPresetByTangents(keyframe.tangentIn, keyframe.tangentOut)

  const handleValueCommit = useCallback(
    (raw: string) => {
      const num = Number(raw)
      if (!Number.isFinite(num)) {
        return
      }
      if (isClip && clipTarget) {
        const result = dispatch(
          new SetClipKeyframeValueCommand({
            target: { kind: 'clip', clipId: clipTarget.clipId, channel: clipTarget.channel },
            keyframeId: keyframe.id,
            newValue: num,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      } else {
        const result = dispatch(
          new SetKeyframeValueCommand({
            target: target as
              | import('../../engine/keyframeTarget').NodePropertyTarget
              | import('../../engine/keyframeTarget').NodeParameterTarget
              | import('../../engine/keyframeTarget').NodeMorphTarget,
            keyframeId: keyframe.id,
            newValue: num,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      }
    },
    [dispatch, target, keyframe.id, notify, isClip, clipTarget],
  )

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Keyframe</h3>
      <div className="inspector-field">
        <NumericField
          label="Value"
          value={typeof keyframe.value === 'number' ? keyframe.value : null}
          step={0.1}
          disabled={playing}
          onCommit={handleValueCommit}
          onAdjust={() => {}}
        />
      </div>
      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="interpolation-picker">
          Interpolation
        </label>
        <select
          id="interpolation-picker"
          className="inspector-field__input inspector-field__select"
          aria-label="Interpolation"
          disabled={playing}
          value={keyframe.interpolation}
          onChange={(event) => {
            handleInterpolationChange(event.target.value as InterpolationType)
          }}
        >
          <option value="hold">Hold</option>
          <option value="linear">Linear</option>
          <option value="bezier">Bezier</option>
          <optgroup label="Parametric">
            <option value="bounce">Bounce</option>
            <option value="elastic">Elastic</option>
            <option value="spring">Spring</option>
          </optgroup>
        </select>
      </div>
      {keyframe.interpolation === 'bezier' && (
        <div className="keyframe-presets">
          <label className="inspector-field__label">Preset</label>
          <div className="keyframe-presets__grid" role="radiogroup" aria-label="Easing preset">
            {EASING_PRESETS.map((preset, index) => (
              <button
                key={preset.label}
                className={`keyframe-presets__button${currentPreset?.label === preset.label ? ' keyframe-presets__button--active' : ''}`}
                aria-pressed={currentPreset?.label === preset.label}
                disabled={playing}
                onClick={() => handlePresetApply(index)}
                title={preset.label}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {keyframe.interpolation === 'bezier' && (
        <div className="keyframe-tangents">
          <TangentFields
            kind="in"
            tangent={keyframe.tangentIn}
            disabled={playing}
            onCommit={handleTangentCommit}
          />
          <TangentFields
            kind="out"
            tangent={keyframe.tangentOut}
            disabled={playing}
            onCommit={handleTangentCommit}
          />
        </div>
      )}
    </section>
  )
}
