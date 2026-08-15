import type {
  EffectiveShaderScratch,
  MaterialParameterDefaultValue,
} from '../../engine/materialResolution'
import type { PixiFilter, RendererPixi } from './pixi'
import type { ShaderProgramCache } from './programCache'

const UNIFORM_GLSL_TYPES: Record<string, string> = {
  float: 'f32',
  int: 'i32',
  bool: 'i32',
  vec2: 'vec2<f32>',
  vec3: 'vec3<f32>',
  vec4: 'vec4<f32>',
}

export function uniformStructures(
  scratch: EffectiveShaderScratch,
): Record<string, { value: MaterialParameterDefaultValue; type: string }> {
  const structures: Record<string, { value: MaterialParameterDefaultValue; type: string }> = {}
  for (let index = 0; index < scratch.keys.length; index++) {
    const type = UNIFORM_GLSL_TYPES[scratch.kinds[index]]
    const value = scratch.values[index]
    if (!type || value === undefined) {
      continue
    }
    structures[scratch.keys[index]] = { value, type }
  }
  return structures
}

export function createNodeShaderFilter(
  pixi: RendererPixi,
  cache: ShaderProgramCache,
  source: string,
  scratch: EffectiveShaderScratch,
): PixiFilter {
  return new pixi.Filter({
    glProgram: cache.get(source),
    resources: { uniforms: uniformStructures(scratch) },
  })
}

export function nodeFilterUniforms(filter: PixiFilter): Record<string, unknown> {
  return (filter.resources.uniforms as { uniforms: Record<string, unknown> }).uniforms
}
