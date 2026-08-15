export const RESERVED_TEXTURE_UNIFORM = 'uTexture'

export type ReflectedUniformType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'sampler2D'

export type ReflectedUniformDefault =
  | number
  | boolean
  | [number, number]
  | [number, number, number]
  | [number, number, number, number]
  | null

export interface ReflectedUniform {
  key: string
  type: ReflectedUniformType
  default: ReflectedUniformDefault
}

export interface ShaderReflectionWarning {
  line: number
  message: string
}

export interface ShaderReflection {
  uniforms: ReflectedUniform[]
  warnings: ShaderReflectionWarning[]
}

const UNIFORM_DEFAULTS: Record<ReflectedUniformType, ReflectedUniformDefault> = {
  float: 0,
  int: 0,
  bool: false,
  vec2: [0, 0],
  vec3: [0, 0, 0],
  vec4: [0, 0, 0, 0],
  sampler2D: null,
}

const UNIFORM_DECLARATION =
  /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?([a-zA-Z_]\w*)\s+([a-zA-Z_]\w*)\s*(\[[^\]]*\])?\s*;/g

function stripComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  return withoutBlock.replace(/\/\/[^\n]*/g, '')
}

function lineOf(source: string, index: number): number {
  return (source.slice(0, index).match(/\n/g)?.length ?? 0) + 1
}

export function reflectUniforms(source: string): ShaderReflection {
  const uniforms: ReflectedUniform[] = []
  const warnings: ShaderReflectionWarning[] = []
  const seen = new Set<string>()
  const stripped = stripComments(source)
  let match: RegExpExecArray | null
  while ((match = UNIFORM_DECLARATION.exec(stripped)) !== null) {
    const line = lineOf(stripped, match.index)
    const [, type, name, array] = match
    const fallback = (UNIFORM_DEFAULTS as Record<string, ReflectedUniformDefault>)[type]
    if (fallback === undefined) {
      warnings.push({
        line,
        message: `Uniform type '${type}' is not supported and was skipped.`,
      })
      continue
    }
    if (array !== undefined) {
      warnings.push({
        line,
        message: `Array uniform '${name}' is not supported and was skipped.`,
      })
      continue
    }
    if (name === RESERVED_TEXTURE_UNIFORM) {
      continue
    }
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    uniforms.push({ key: name, type: type as ReflectedUniformType, default: fallback })
  }
  return { uniforms, warnings }
}
