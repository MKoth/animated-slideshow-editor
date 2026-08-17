import type {
  EffectiveShaderScratch,
  MaterialParameterDefaultValue,
} from '../../engine/materialResolution'
import type { PixiFilter, RendererPixi } from './pixi'
import type { ShaderProgramCache } from './programCache'
import type { TextureCache } from './textureCache'

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

/**
 * Every sampler uniform key is registered as a bind-group texture resource so
 * pixi uploads it through its sampler path. The value is a placeholder source
 * swapped by `bindFilterSamplers`; the keys must exist here because pixi's
 * resource accessor is fixed at construction.
 */
export function createNodeShaderFilter(
  pixi: RendererPixi,
  cache: ShaderProgramCache,
  source: string,
  scratch: EffectiveShaderScratch,
  textures?: TextureCache,
): PixiFilter {
  const resources: Record<string, unknown> = { uniforms: uniformStructures(scratch) }
  if (source.includes('uniform float uTime')) {
    ;(resources.uniforms as Record<string, { value: MaterialParameterDefaultValue; type: string }>)[
      'uTime'
    ] = { value: scratch.uTimeValue ?? 0, type: 'f32' }
  }
  if (textures) {
    for (const sampler of scratch.samplers) {
      resources[sampler.key] = textures.get(sampler.key).source
    }
  }
  return new pixi.Filter({ glProgram: cache.get(source), resources })
}

export function nodeFilterUniforms(filter: PixiFilter): Record<string, unknown> {
  return (filter.resources.uniforms as { uniforms: Record<string, unknown> }).uniforms
}

/** Write a resolved uniform state into a filter's uniform resources. */
export function applyFilterUniforms(filter: PixiFilter, scratch: EffectiveShaderScratch): void {
  const uniforms = nodeFilterUniforms(filter)
  for (let index = 0; index < scratch.keys.length; index++) {
    uniforms[scratch.keys[index]] = scratch.values[index]
  }
  if ('uTime' in uniforms) {
    uniforms['uTime'] = scratch.uTimeValue ?? 0
  }
}
