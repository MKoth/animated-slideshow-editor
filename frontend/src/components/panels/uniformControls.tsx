import type { ChangeEvent, ReactNode } from 'react'
import { useEffect } from 'react'
import type {
  MaterialParameterDefault,
  MaterialParameterDefaultValue,
} from '../../engine/materialResolution'
import { formatDecimal } from '../../app/inspectorActions'
import type { PropertyState } from '../../app/keyframeActions'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { NumericField } from './inspectorFields'
import { useEditBuffer } from './useEditBuffer'
import { VEC_COMPONENT_LABELS, isColorVectorKey, uniformHasSlider } from './uniforms'
import type { OverrideState } from './uniforms'

export function KeyframeAffordance({
  state,
  onAddKeyframe,
  disabled,
}: {
  state: PropertyState | null
  onAddKeyframe: () => void
  disabled: boolean
}): ReactNode {
  if (state === null || state === 'static') {
    return null
  }
  return (
    <>
      <span
        className="inspector-field__indicator"
        data-state={state}
        title={state === 'animated' ? 'Animated' : 'Playhead on keyframe'}
      >
        {state === 'animated' ? '●' : '◆'}
      </span>
      {state === 'onKeyframe' && (
        <button
          className="inspector-field__clear"
          aria-label="Add keyframe at playhead"
          onClick={onAddKeyframe}
          disabled={disabled}
        >
          Add Keyframe
        </button>
      )}
    </>
  )
}

export function OverrideAffordance({
  state,
  label,
  onClear,
  disabled,
}: {
  state: OverrideState
  label: string
  onClear: () => void
  disabled: boolean
}): ReactNode {
  if (state === 'none') {
    return null
  }
  return (
    <>
      <span
        className="inspector-field__indicator"
        data-state="override"
        title={state === 'all' ? 'Override set' : 'Override set on some'}
      >
        ●
      </span>
      <button
        className="inspector-field__clear"
        aria-label={label}
        onClick={onClear}
        disabled={disabled}
      >
        Clear
      </button>
    </>
  )
}

function hexToVec(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

function vecToHex(components: readonly number[]): string {
  const byte = (component: number): number => Math.round(Math.min(1, Math.max(0, component)) * 255)
  return (
    '#' +
    [byte(components[0]), byte(components[1]), byte(components[2])]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  )
}

function numericComponents(
  effective: MaterialParameterDefaultValue | null,
): readonly number[] | null {
  return Array.isArray(effective) ? effective : null
}

function SliderInput({
  value,
  disabled,
  onChange,
  label,
}: {
  value: number | null
  disabled: boolean
  onChange: (value: number) => void
  label: string
}) {
  return (
    <input
      className="inspector-field__slider"
      type="range"
      aria-label={`${label} slider`}
      min={0}
      max={1}
      step={0.01}
      disabled={disabled}
      value={value === null ? 0 : value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

function BoolField({
  parameter,
  effective,
  disabled,
  onChange,
  after,
}: {
  parameter: MaterialParameterDefault
  effective: MaterialParameterDefaultValue | null
  disabled: boolean
  onChange: (value: boolean) => void
  after: ReactNode
}) {
  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={parameter.key}>
        {parameter.key}
      </label>
      <input
        id={parameter.key}
        className="inspector-field__checkbox"
        type="checkbox"
        aria-label={parameter.key}
        disabled={disabled || effective === null}
        checked={effective === true}
        onChange={(event) => onChange(event.target.checked)}
      />
      {after}
    </div>
  )
}

function ColorField({
  parameter,
  effective,
  disabled,
  onChange,
  after,
}: {
  parameter: MaterialParameterDefault
  effective: MaterialParameterDefaultValue | null
  disabled: boolean
  onChange: (value: readonly number[]) => void
  after: ReactNode
}) {
  const components = numericComponents(effective)
  const alpha = components !== null ? (components[3] ?? null) : null
  const alphaBuffer = useEditBuffer(alpha === null ? '' : formatDecimal(alpha))
  const commitColor = (event: ChangeEvent<HTMLInputElement>) => {
    const next = hexToVec(event.target.value)
    onChange(alpha === null ? next : [next[0], next[1], next[2], alpha])
  }
  const commitAlpha = (raw: string) => {
    if (components === null) {
      return
    }
    const parsed = Number(raw.trim())
    if (!Number.isFinite(parsed)) {
      return
    }
    const clamped = Math.min(1, Math.max(0, parsed))
    onChange([components[0], components[1], components[2], clamped])
  }
  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={parameter.key}>
        {parameter.key}
      </label>
      <input
        id={parameter.key}
        className="inspector-field__color"
        type="color"
        aria-label={parameter.key}
        disabled={disabled || components === null}
        data-mixed={components === null || undefined}
        title={components === null ? 'Mixed values' : undefined}
        value={components ? vecToHex(components) : '#000000'}
        onChange={commitColor}
      />
      {parameter.kind === 'vec4' && (
        <input
          className="inspector-field__input inspector-field__alpha"
          type="number"
          aria-label={`${parameter.key} alpha`}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled || alpha === null}
          value={alphaBuffer.text}
          onChange={(event) => {
            alphaBuffer.begin()
            alphaBuffer.setText(event.target.value)
          }}
          onBlur={() => {
            if (alphaBuffer.editing) {
              commitAlpha(alphaBuffer.commit())
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitAlpha(alphaBuffer.commit())
            } else if (event.key === 'Escape') {
              alphaBuffer.cancel()
            }
          }}
        />
      )}
      {after}
    </div>
  )
}

function VecComponentInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  disabled: boolean
  onCommit: (raw: string) => void
}) {
  const buffer = useEditBuffer(formatDecimal(value))
  return (
    <input
      className="inspector-field__input inspector-field__component"
      type="number"
      aria-label={label}
      step={0.01}
      disabled={disabled}
      value={buffer.text}
      onChange={(event) => {
        buffer.begin()
        buffer.setText(event.target.value)
      }}
      onBlur={() => {
        if (buffer.editing) {
          onCommit(buffer.commit())
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onCommit(buffer.commit())
        } else if (event.key === 'Escape') {
          buffer.cancel()
        }
      }}
    />
  )
}

function VecComponentsField({
  parameter,
  effective,
  disabled,
  onChange,
  after,
}: {
  parameter: MaterialParameterDefault
  effective: MaterialParameterDefaultValue | null
  disabled: boolean
  onChange: (value: readonly number[]) => void
  after: ReactNode
}) {
  const components = numericComponents(effective)
  const letters = VEC_COMPONENT_LABELS[parameter.kind] ?? 'xyzw'
  const commit = (index: number, raw: string) => {
    if (components === null) {
      return
    }
    const parsed = Number(raw.trim())
    if (!Number.isFinite(parsed)) {
      return
    }
    const next = [...components]
    next[index] = parsed
    onChange(next)
  }
  return (
    <div className="inspector-field">
      <span className="inspector-field__label" title={parameter.key}>
        {parameter.key}
      </span>
      {[...letters].map((letter, index) => (
        <VecComponentInput
          key={letter}
          label={`${parameter.key}.${letter}`}
          value={components === null ? 0 : (components[index] ?? 0)}
          disabled={disabled || components === null}
          onCommit={(raw) => commit(index, raw)}
        />
      ))}
      {after}
    </div>
  )
}

function SamplerField({
  parameter,
  effective,
  disabled,
  onChange,
  after,
}: {
  parameter: MaterialParameterDefault
  effective: MaterialParameterDefaultValue | null
  disabled: boolean
  onChange: (value: string) => void
  after: ReactNode
}) {
  const assets = useAssetLibraryStore((state) => state.definitions)
  const loaded = useAssetLibraryStore((state) => state.loaded)
  const loading = useAssetLibraryStore((state) => state.loading)
  const unavailable = useAssetLibraryStore((state) => state.unavailable)
  const loadAssets = useAssetLibraryStore((state) => state.loadLibrary)
  // The Inspector sections render sampler pickers without the Assets tab
  // having loaded the library; request the load so the list is populated as
  // soon as the section opens, degrading to the unavailable state on failure.
  useEffect(() => {
    if (!loaded && !loading && !unavailable) {
      void loadAssets()
    }
  }, [loaded, loading, unavailable, loadAssets])
  const current = typeof effective === 'string' && effective !== '' ? effective : null
  const known = current !== null && assets.some((asset) => asset.id === current)
  const mixed = effective === null
  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={parameter.key}>
        {parameter.key}
      </label>
      <select
        id={parameter.key}
        className="inspector-field__input inspector-field__select"
        aria-label={parameter.key}
        disabled={disabled || unavailable || mixed}
        value={current ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">None</option>
        {!known && current !== null && <option value={current}>{current}</option>}
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
      </select>
      {unavailable && (
        <p className="inspector-section__notice">
          Asset library unavailable — start the backend to pick assets.
        </p>
      )}
      {!unavailable && loaded && assets.length === 0 && (
        <p className="inspector-section__notice">
          No assets in the library — import assets to pick one.
        </p>
      )}
      {after}
    </div>
  )
}

export function UniformParameterField({
  parameter,
  effective,
  overridden,
  disabled = false,
  keyframeState = null,
  onAddKeyframe,
  onChange,
  onClear,
}: {
  parameter: MaterialParameterDefault
  effective: MaterialParameterDefaultValue | null
  overridden: OverrideState
  disabled?: boolean
  keyframeState?: PropertyState | null
  onAddKeyframe?: () => void
  onChange: (value: MaterialParameterDefaultValue) => void
  onClear: () => void
}) {
  const affordance = (
    <OverrideAffordance
      state={overridden}
      label={`Clear ${parameter.key} override`}
      onClear={onClear}
      disabled={disabled}
    />
  )
  const keyframeIndicator =
    keyframeState !== null && keyframeState !== undefined && onAddKeyframe ? (
      <KeyframeAffordance state={keyframeState} onAddKeyframe={onAddKeyframe} disabled={disabled} />
    ) : null
  const kind = parameter.kind
  if (kind === 'bool') {
    return (
      <BoolField
        parameter={parameter}
        effective={effective}
        disabled={disabled}
        onChange={(value) => onChange(value)}
        after={
          <>
            {keyframeIndicator}
            {affordance}
          </>
        }
      />
    )
  }
  if (kind === 'vec2' || kind === 'vec3' || kind === 'vec4') {
    if (isColorVectorKey(parameter.key)) {
      return (
        <ColorField
          parameter={parameter}
          effective={effective}
          disabled={disabled}
          onChange={(value) => onChange(value)}
          after={
            <>
              {keyframeIndicator}
              {affordance}
            </>
          }
        />
      )
    }
    return (
      <VecComponentsField
        parameter={parameter}
        effective={effective}
        disabled={disabled}
        onChange={(value) => onChange(value)}
        after={
          <>
            {keyframeIndicator}
            {affordance}
          </>
        }
      />
    )
  }
  if (kind === 'sampler2D') {
    return (
      <SamplerField
        parameter={parameter}
        effective={effective}
        disabled={disabled}
        onChange={(value) => onChange(value)}
        after={
          <>
            {keyframeIndicator}
            {affordance}
          </>
        }
      />
    )
  }
  const numeric = typeof effective === 'number' ? effective : null
  const step = kind === 'int' ? 1 : 0.01
  return (
    <NumericField
      label={parameter.key}
      value={numeric}
      step={step}
      disabled={disabled}
      after={
        uniformHasSlider(parameter) ? (
          <>
            <SliderInput
              label={parameter.key}
              value={numeric}
              disabled={disabled || numeric === null}
              onChange={(value) => onChange(value)}
            />
            {keyframeIndicator}
            {affordance}
          </>
        ) : (
          <>
            {keyframeIndicator}
            {affordance}
          </>
        )
      }
      onCommit={(raw) => {
        if (raw.trim() === '') {
          return
        }
        const parsed = Number(raw.trim())
        if (Number.isFinite(parsed)) {
          onChange(kind === 'int' ? Math.round(parsed) : parsed)
        }
      }}
      onAdjust={(value) => onChange(kind === 'int' ? Math.round(value) : value)}
    />
  )
}
