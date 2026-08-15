import type { WebGL2CompileContext } from '../../shaders/compiler'

export interface FakeWebGLShader {
  readonly id: number
}

export class FakeWebGL2Context implements WebGL2CompileContext {
  readonly FRAGMENT_SHADER = 0x8b30
  readonly COMPILE_STATUS = 0x8b81

  compileSuccess = true
  infoLog: string | null = null
  failShaderCreation = false

  readonly created: FakeWebGLShader[] = []
  readonly compiled: FakeWebGLShader[] = []
  readonly deleted: FakeWebGLShader[] = []
  readonly sources = new Map<FakeWebGLShader, string>()
  readonly parameterChecks: Array<{ shader: FakeWebGLShader; pname: number }> = []

  createShader(): FakeWebGLShader | null {
    if (this.failShaderCreation) {
      return null
    }
    const shader = { id: this.created.length + 1 }
    this.created.push(shader)
    return shader
  }

  shaderSource(shader: FakeWebGLShader, source: string): void {
    this.sources.set(shader, source)
  }

  compileShader(shader: FakeWebGLShader): void {
    this.compiled.push(shader)
  }

  getShaderParameter(shader: FakeWebGLShader, pname: number): boolean {
    this.parameterChecks.push({ shader, pname })
    return this.compileSuccess
  }

  getShaderInfoLog(): string | null {
    return this.infoLog
  }

  deleteShader(shader: FakeWebGLShader): void {
    this.deleted.push(shader)
  }
}

export function createWebGLFake(): FakeWebGL2Context {
  return new FakeWebGL2Context()
}
