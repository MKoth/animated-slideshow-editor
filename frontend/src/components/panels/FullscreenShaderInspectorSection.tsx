import type { ChangeEvent } from 'react'
import type { EnginePublic, Slide } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  assignFullscreenShader,
  clearFullscreenUniform,
  overrideFullscreenUniform,
  readFullscreenShader,
} from '../../app/fullscreenShaderInspectorActions'
import { useShaderLibraryStore } from '../../stores/shaderLibraryStore'
import type { ShaderCompileStatus } from '../../shaders/compiler'
import { definitionNameOf, runCommand } from './sectionHelpers'
import { UniformParameterField } from './uniformControls'
import { overrideStateOf } from './uniforms'

function compileLabel(status: ShaderCompileStatus | undefined): string {
  if (!status) {
    return 'Not compiled'
  }
  return status.status === 'Compiled' ? 'Compiled' : 'Failed'
}

export function FullscreenShaderInspectorSection({
  slide,
  engine,
  dispatch,
  notify,
  playing,
}: {
  slide: Slide
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}) {
  // Library refreshes re-render the picker and the definition defaults.
  const definitions = useShaderLibraryStore((state) => state.definitions)
  const compileStatus = useShaderLibraryStore((state) => state.compileStatus)
  const unavailable = useShaderLibraryStore((state) => state.unavailable)

  const reading = readFullscreenShader(engine, slide)
  const currentDefinitionId = reading.shaderDefinitionId
  const currentKnown =
    currentDefinitionId !== null &&
    definitions.some((definition) => definition.id === currentDefinitionId)
  const currentStatus =
    currentDefinitionId !== null ? compileStatus[currentDefinitionId] : undefined
  const disabled = playing || unavailable

  const runSectionCommand = (action: () => { ok: boolean; error?: Error } | null) => {
    if (unavailable) {
      return
    }
    runCommand(notify, action)
  }

  const handleAssign = (event: ChangeEvent<HTMLSelectElement>) => {
    runSectionCommand(() =>
      assignFullscreenShader(engine, dispatch, slide.id, event.target.value || null),
    )
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Fullscreen Shader</h3>
      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="fullscreen-shader-picker">
          Shader
        </label>
        <select
          id="fullscreen-shader-picker"
          className="inspector-field__input inspector-field__select"
          aria-label="Fullscreen Shader"
          disabled={disabled}
          value={currentDefinitionId ?? ''}
          onChange={handleAssign}
        >
          <option value="">None</option>
          {!currentKnown && currentDefinitionId !== null && (
            <option value={currentDefinitionId}>
              {definitionNameOf(engine, currentDefinitionId, 'shader')}
            </option>
          )}
          {definitions.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {`${definition.name} (${compileLabel(compileStatus[definition.id])})`}
            </option>
          ))}
        </select>
      </div>
      {unavailable && (
        <p className="inspector-section__notice">
          Shader library unavailable — start the backend to assign shaders.
        </p>
      )}
      {!unavailable && currentStatus?.status === 'Failed' && (
        <p className="inspector-section__notice">
          Shader failed to compile — the effect will not render.
        </p>
      )}
      {reading.uniforms.length > 0 && (
        <h4 className="inspector-section__subtitle">Shader Uniforms</h4>
      )}
      {reading.uniforms.map((uniform) => (
        <UniformParameterField
          key={uniform.key}
          parameter={uniform}
          effective={uniform.effective}
          overridden={overrideStateOf([uniform.overridden])}
          disabled={disabled}
          onChange={(value) => {
            if (uniform.kind === 'sampler2D' && value === '') {
              runSectionCommand(() =>
                clearFullscreenUniform(engine, dispatch, slide.id, uniform.key),
              )
              return
            }
            runSectionCommand(() =>
              overrideFullscreenUniform(engine, dispatch, slide.id, uniform.key, value),
            )
          }}
          onClear={() =>
            runSectionCommand(() => clearFullscreenUniform(engine, dispatch, slide.id, uniform.key))
          }
        />
      ))}
    </section>
  )
}
