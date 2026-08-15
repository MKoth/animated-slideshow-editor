export interface ShaderCompileError {
  line: number
  message: string
}

export interface ShaderCompileStatus {
  status: 'Compiled' | 'Failed'
  errors: ShaderCompileError[]
}

export interface WebGL2CompileContext {
  readonly FRAGMENT_SHADER: number
  readonly COMPILE_STATUS: number
  createShader(type: number): unknown
  shaderSource(shader: unknown, source: string): void
  compileShader(shader: unknown): void
  getShaderParameter(shader: unknown, pname: number): unknown
  getShaderInfoLog(shader: unknown): string | null
  deleteShader(shader: unknown): void
}

const ERROR_LINE = /^ERROR:\s*\d+:(\d+):\s*(.*)$/

function defaultContextFactory(): WebGL2CompileContext | null {
  const canvas = document.createElement('canvas')
  return canvas.getContext('webgl2')
}

let contextFactory: () => WebGL2CompileContext | null = defaultContextFactory
let cachedContext: WebGL2CompileContext | null | undefined

export function setWebGL2ContextFactory(factory: (() => WebGL2CompileContext | null) | null): void {
  contextFactory = factory ?? defaultContextFactory
  cachedContext = undefined
}

function getContext(): WebGL2CompileContext | null {
  if (cachedContext === undefined) {
    cachedContext = contextFactory()
  }
  return cachedContext
}

export function parseCompileErrors(log: string | null): ShaderCompileError[] {
  const lines = (log ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return [{ line: 0, message: 'The shader failed to compile.' }]
  }
  const errors: ShaderCompileError[] = []
  for (const line of lines) {
    const match = ERROR_LINE.exec(line)
    if (match) {
      errors.push({ line: Number(match[1]), message: match[2] })
    } else {
      errors.push({ line: 0, message: line })
    }
  }
  return errors
}

export function compileFragmentShader(source: string): ShaderCompileStatus {
  const gl = getContext()
  if (!gl) {
    return {
      status: 'Failed',
      errors: [{ line: 0, message: 'WebGL2 is not available on this device.' }],
    }
  }
  const shader = gl.createShader(gl.FRAGMENT_SHADER)
  if (shader === null || shader === undefined) {
    return {
      status: 'Failed',
      errors: [{ line: 0, message: 'The fragment shader could not be created.' }],
    }
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  const compiled = Boolean(gl.getShaderParameter(shader, gl.COMPILE_STATUS))
  const log = gl.getShaderInfoLog(shader)
  gl.deleteShader(shader)
  if (compiled) {
    return { status: 'Compiled', errors: [] }
  }
  return { status: 'Failed', errors: parseCompileErrors(log) }
}
