import type { ChangeEvent } from 'react'
import type { EnginePublic, SceneNode } from '../../engine'
import {
  OPACITY_MULTIPLIER_PARAMETER_KEY,
  TINT_PARAMETER_KEY,
  uniformValuesEqual,
} from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  assignMaterialToNodes,
  clearMaterialOverrideOnNodes,
  overrideMaterialParameterOnNodes,
  readMaterial,
} from '../../app/materialInspectorActions'
import { commonValueOf, parseFiniteNumber } from '../../app/inspectorActions'
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore'
import { NumericField } from './inspectorFields'
import { OverrideAffordance, UniformParameterField } from './uniformControls'
import { overrideStateOf } from './uniforms'

function definitionNameOf(engine: EnginePublic, definitionId: string): string {
  try {
    return engine.getMaterialDefinition(definitionId).name
  } catch {
    return definitionId
  }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function MaterialInspectorSection({
  targets,
  engine,
  dispatch,
  notify,
  playing,
}: {
  targets: readonly SceneNode[]
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}) {
  const nodeIds = targets.map((node) => node.id)
  // Definition changes from the library refresh the section so unset
  // uniforms display the current definition defaults.
  useMaterialLibraryStore((state) => state.definitions)
  const readings = targets.map((node) => readMaterial(engine, node))
  const currentDefinitionId = commonValueOf(readings, (reading) => reading.definitionId)
  const commonTint = commonValueOf(readings, (reading) => reading.tint)
  const commonMultiplier = commonValueOf(readings, (reading) => reading.opacityMultiplier)
  const tintOverridden = overrideStateOf(readings.map((reading) => reading.tintOverridden))
  const multiplierOverridden = overrideStateOf(
    readings.map((reading) => reading.opacityMultiplierOverridden),
  )
  const definitions = engine.materialDefinitions
  const tintValue =
    typeof commonTint === 'string' && /^#[0-9a-fA-F]{6}$/.test(commonTint) ? commonTint : '#ffffff'
  const multiplierPercent = typeof commonMultiplier === 'number' ? commonMultiplier * 100 : null

  const runCommand = (action: () => { ok: boolean; error?: Error } | null) => {
    try {
      const result = action()
      if (result && !result.ok) {
        throw result.error
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const handleAssign = (event: ChangeEvent<HTMLSelectElement>) => {
    runCommand(() => assignMaterialToNodes(engine, dispatch, nodeIds, event.target.value))
  }

  const handleTint = (event: ChangeEvent<HTMLInputElement>) => {
    runCommand(() =>
      overrideMaterialParameterOnNodes(
        engine,
        dispatch,
        nodeIds,
        TINT_PARAMETER_KEY,
        event.target.value,
      ),
    )
  }

  const handleClearTint = () => {
    runCommand(() => clearMaterialOverrideOnNodes(engine, dispatch, nodeIds, TINT_PARAMETER_KEY))
  }

  const commitMultiplier = (raw: string) => {
    runCommand(() => {
      const percent = parseFiniteNumber(raw, 'Opacity Multiplier')
      return overrideMaterialParameterOnNodes(
        engine,
        dispatch,
        nodeIds,
        OPACITY_MULTIPLIER_PARAMETER_KEY,
        clampPercent(percent) / 100,
      )
    })
  }

  const handleClearMultiplier = () => {
    runCommand(() =>
      clearMaterialOverrideOnNodes(engine, dispatch, nodeIds, OPACITY_MULTIPLIER_PARAMETER_KEY),
    )
  }

  const knownDefinition =
    currentDefinitionId !== null &&
    definitions.some((definition) => definition.id === currentDefinitionId)

  const firstReading = readings[0]
  const uniformParameters = firstReading?.uniforms ?? []

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Material</h3>
      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="material-picker">
          Material
        </label>
        <select
          id="material-picker"
          className="inspector-field__input inspector-field__select"
          aria-label="Material"
          disabled={playing}
          value={currentDefinitionId ?? ''}
          onChange={handleAssign}
        >
          {currentDefinitionId === null && (
            <option value="" disabled>
              — Mixed
            </option>
          )}
          {!knownDefinition && currentDefinitionId !== null && (
            <option value={currentDefinitionId}>
              {definitionNameOf(engine, currentDefinitionId)}
            </option>
          )}
          {definitions.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.name}
            </option>
          ))}
        </select>
      </div>
      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="material-tint">
          Tint
        </label>
        <input
          id="material-tint"
          className="inspector-field__color"
          type="color"
          aria-label="Tint"
          value={tintValue}
          data-mixed={commonTint === null || undefined}
          title={commonTint === null ? 'Mixed values' : undefined}
          disabled={playing}
          onChange={handleTint}
        />
        <OverrideAffordance
          state={tintOverridden}
          label="Clear Tint override"
          onClear={handleClearTint}
          disabled={playing}
        />
      </div>
      <NumericField
        label="Opacity Multiplier"
        value={multiplierPercent}
        step={1}
        disabled={playing}
        onCommit={commitMultiplier}
        onAdjust={(percent) => commitMultiplier(String(percent))}
        after={
          <OverrideAffordance
            state={multiplierOverridden}
            label="Clear Opacity Multiplier override"
            onClear={handleClearMultiplier}
            disabled={playing}
          />
        }
      />
      {uniformParameters.length > 0 && (
        <h4 className="inspector-section__subtitle">Shader Uniforms</h4>
      )}
      {uniformParameters.map((uniform) => {
        const effective =
          commonValueOf(
            readings,
            (reading) => reading.uniforms.find((entry) => entry.key === uniform.key)?.effective,
            uniformValuesEqual,
          ) ?? null
        const overridden = overrideStateOf(
          readings.map(
            (reading) =>
              reading.uniforms.find((entry) => entry.key === uniform.key)?.overridden ?? false,
          ),
        )
        return (
          <UniformParameterField
            key={uniform.key}
            parameter={uniform}
            effective={effective}
            overridden={overridden}
            disabled={playing}
            onChange={(value) => {
              if (uniform.kind === 'sampler2D' && value === '') {
                runCommand(() =>
                  clearMaterialOverrideOnNodes(engine, dispatch, nodeIds, uniform.key),
                )
                return
              }
              runCommand(() =>
                overrideMaterialParameterOnNodes(engine, dispatch, nodeIds, uniform.key, value),
              )
            }}
            onClear={() =>
              runCommand(() => clearMaterialOverrideOnNodes(engine, dispatch, nodeIds, uniform.key))
            }
          />
        )
      })}
    </section>
  )
}
