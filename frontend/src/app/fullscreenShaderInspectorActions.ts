import type { EnginePublic, Slide } from '../engine'
import { uniformValuesEqual } from '../engine'
import type {
  MaterialOverrideValue,
  MaterialParameterDefault,
  MaterialParameterDefaultValue,
} from '../engine'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import { OverrideFullscreenUniformCommand, SetFullscreenShaderCommand } from '../engine/commands'
import { RESERVED_TEXTURE_UNIFORM } from '../shaders/reflection'
import { readUniformReadings } from './uniformReadings'
import type { UniformReading } from './uniformReadings'

export type { UniformReading } from './uniformReadings'

export interface FullscreenShaderReading {
  readonly shaderDefinitionId: string | null
  readonly uniforms: readonly UniformReading[]
}

function definitionParametersOf(
  engine: EnginePublic,
  slide: Slide,
): readonly MaterialParameterDefault[] {
  const reference = slide.fullscreenShader
  if (!reference) {
    return []
  }
  try {
    return engine.getShaderDefinition(reference.shaderDefinitionId).parameters
  } catch {
    // unknown definition: resolve overrides against the definition defaults
    return []
  }
}

export function readFullscreenShader(engine: EnginePublic, slide: Slide): FullscreenShaderReading {
  const reference = slide.fullscreenShader
  if (!reference) {
    return { shaderDefinitionId: null, uniforms: [] }
  }
  return {
    shaderDefinitionId: reference.shaderDefinitionId,
    uniforms: readUniformReadings(definitionParametersOf(engine, slide), reference.overrides, [
      RESERVED_TEXTURE_UNIFORM,
    ]),
  }
}

export function assignFullscreenShader(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  shaderDefinitionId: string | null,
): CommandResult<unknown> | null {
  const slide = engine.project?.slides.find((entry) => entry.id === slideId)
  if (!slide || slide.fullscreenShader?.shaderDefinitionId === shaderDefinitionId) {
    return null
  }
  return dispatch(new SetFullscreenShaderCommand({ slideId, shaderDefinitionId }))
}

function effectiveValueOf(
  engine: EnginePublic,
  slide: Slide,
  uniform: string,
): MaterialParameterDefaultValue | undefined {
  for (const entry of readFullscreenShader(engine, slide).uniforms) {
    if (entry.key === uniform) {
      return entry.effective
    }
  }
  return undefined
}

export function overrideFullscreenUniform(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  uniform: string,
  value: MaterialOverrideValue,
): CommandResult<unknown> | null {
  const slide = engine.project?.slides.find((entry) => entry.id === slideId)
  if (!slide?.fullscreenShader) {
    return null
  }
  const current = slide.fullscreenShader.overrides[uniform]
  const effective = effectiveValueOf(engine, slide, uniform)
  if (uniformValuesEqual(current ?? effective, value)) {
    return null
  }
  return dispatch(new OverrideFullscreenUniformCommand({ slideId, uniform, value }))
}

export function clearFullscreenUniform(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  uniform: string,
): CommandResult<unknown> | null {
  const slide = engine.project?.slides.find((entry) => entry.id === slideId)
  if (
    !slide?.fullscreenShader ||
    !Object.prototype.hasOwnProperty.call(slide.fullscreenShader.overrides, uniform)
  ) {
    return null
  }
  return dispatch(new OverrideFullscreenUniformCommand({ slideId, uniform, value: null }))
}
