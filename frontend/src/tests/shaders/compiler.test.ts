import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compileFragmentShader,
  parseCompileErrors,
  setWebGL2ContextFactory,
} from '../../shaders/compiler'
import { createWebGLFake, FakeWebGL2Context } from './webglFake'

const VALID_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  fragColor = texture(uTexture, vUv);
}
`

describe('shader compilation', () => {
  let gl: FakeWebGL2Context

  beforeEach(() => {
    gl = createWebGLFake()
    setWebGL2ContextFactory(() => gl)
  })

  afterEach(() => {
    setWebGL2ContextFactory(null)
  })

  it('reports a shader as Compiled when the context accepts it', () => {
    const result = compileFragmentShader(VALID_SOURCE)

    expect(result).toEqual({ status: 'Compiled', errors: [] })
  })

  it('compiles the source as a fragment shader with the FRAGMENT_SHADER type', () => {
    compileFragmentShader(VALID_SOURCE)

    expect(gl.created).toHaveLength(1)
    expect(gl.compiled).toEqual(gl.created)
    expect(gl.sources.get(gl.created[0])).toBe(VALID_SOURCE)
  })

  it('checks the COMPILE_STATUS parameter after compiling', () => {
    compileFragmentShader(VALID_SOURCE)

    expect(gl.parameterChecks).toEqual([{ shader: gl.created[0], pname: gl.COMPILE_STATUS }])
  })

  it('deletes the shader object after compilation', () => {
    compileFragmentShader(VALID_SOURCE)

    expect(gl.deleted).toEqual(gl.created)
  })

  it('reports Failed with line and message extracted from the info log', () => {
    gl.compileSuccess = false
    gl.infoLog = "ERROR: 0:12: 'vUv' : undeclared identifier"

    const result = compileFragmentShader(VALID_SOURCE)

    expect(result.status).toBe('Failed')
    expect(result.errors).toEqual([{ line: 12, message: "'vUv' : undeclared identifier" }])
  })

  it('parses every ERROR line of a multi-line info log', () => {
    const errors = parseCompileErrors(
      "ERROR: 0:12: 'vUv' : undeclared identifier\nERROR: 0:8: 'main' : function does not return a value",
    )

    expect(errors).toEqual([
      { line: 12, message: "'vUv' : undeclared identifier" },
      { line: 8, message: "'main' : function does not return a value" },
    ])
  })

  it('falls back to line 0 with the raw message when the log has no line info', () => {
    const errors = parseCompileErrors('Fragment shader failed to compile.')

    expect(errors).toEqual([{ line: 0, message: 'Fragment shader failed to compile.' }])
  })

  it('reports a generic failure when the log is empty', () => {
    gl.compileSuccess = false
    gl.infoLog = null

    const result = compileFragmentShader(VALID_SOURCE)

    expect(result.status).toBe('Failed')
    expect(result.errors).toEqual([{ line: 0, message: 'The shader failed to compile.' }])
  })

  it('reports Failed when the shader object cannot be created', () => {
    gl.failShaderCreation = true

    const result = compileFragmentShader(VALID_SOURCE)

    expect(result.status).toBe('Failed')
    expect(result.errors).toEqual([
      { line: 0, message: 'The fragment shader could not be created.' },
    ])
  })

  it('reports Failed when no WebGL2 context is available', () => {
    setWebGL2ContextFactory(() => null)

    const result = compileFragmentShader(VALID_SOURCE)

    expect(result.status).toBe('Failed')
    expect(result.errors).toEqual([{ line: 0, message: 'WebGL2 is not available on this device.' }])
  })

  it('reuses the cached context across compiles', () => {
    let created = 0
    setWebGL2ContextFactory(() => {
      created += 1
      return gl
    })

    compileFragmentShader(VALID_SOURCE)
    compileFragmentShader(VALID_SOURCE)

    expect(created).toBe(1)
  })
})
