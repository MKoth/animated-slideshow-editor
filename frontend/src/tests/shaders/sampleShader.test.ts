import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compileFragmentShader, setWebGL2ContextFactory } from '../../shaders/compiler'
import { reflectUniforms } from '../../shaders/reflection'
import { createWebGLFake, type FakeWebGL2Context } from '../shaders/webglFake'
import SOURCE from '../../../../samples/radial-repeat.glsl?raw'

let gl: FakeWebGL2Context

beforeEach(() => {
  gl = createWebGLFake()
  setWebGL2ContextFactory(() => gl)
})
afterEach(() => {
  setWebGL2ContextFactory(null)
})

describe('radial-repeat sample shader', () => {
  it('reflects every supported uniform type and excludes the reserved uTexture', () => {
    const reflection = reflectUniforms(SOURCE)

    const uniforms = new Map(reflection.uniforms.map((uniform) => [uniform.key, uniform.type]))
    expect(uniforms.get('uTexture')).toBeUndefined()
    expect(uniforms.get('uMask')).toBe('sampler2D')
    expect(uniforms.get('uRepeatCount')).toBe('int')
    expect(uniforms.get('uIntensity')).toBe('float')
    expect(uniforms.get('uGlow')).toBe('float')
    expect(uniforms.get('uCenter')).toBe('vec2')
    expect(uniforms.get('uColorOdd')).toBe('vec3')
    expect(uniforms.get('uColorEven')).toBe('vec3')
    expect(uniforms.get('uOverlayColor')).toBe('vec4')
    expect(uniforms.get('uSubtract')).toBe('bool')
    expect(reflection.warnings).toEqual([])
  })

  it('passes through the compile path', () => {
    const status = compileFragmentShader(SOURCE)

    expect(status.status).toBe('Compiled')
    expect(gl.compiled).toHaveLength(1)
  })
})
