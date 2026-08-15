import { describe, expect, it } from 'vitest'
import { reflectUniforms, RESERVED_TEXTURE_UNIFORM } from '../../shaders/reflection'

const SUPPORTED_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uIntensity;
uniform int uCount;
uniform bool uFlip;
uniform vec2 uOffset;
uniform vec3 uColor;
uniform vec4 uTint;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor, uIntensity);
}
`

describe('uniform reflection', () => {
  it('detects every supported uniform type with its default value', () => {
    const reflection = reflectUniforms(SUPPORTED_SOURCE)

    expect(reflection.uniforms).toEqual([
      { key: 'uIntensity', type: 'float', default: 0 },
      { key: 'uCount', type: 'int', default: 0 },
      { key: 'uFlip', type: 'bool', default: false },
      { key: 'uOffset', type: 'vec2', default: [0, 0] },
      { key: 'uColor', type: 'vec3', default: [0, 0, 0] },
      { key: 'uTint', type: 'vec4', default: [0, 0, 0, 0] },
    ])
  })

  it('recognizes uTexture as the reserved source sampler and never reflects it', () => {
    const reflection = reflectUniforms(SUPPORTED_SOURCE)

    expect(reflection.uniforms.map((uniform) => uniform.key)).not.toContain(
      RESERVED_TEXTURE_UNIFORM,
    )
    expect(reflection.warnings).toEqual([])
  })

  it('reflects user sampler2D uniforms with an empty default', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform sampler2D uBrush;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([{ key: 'uBrush', type: 'sampler2D', default: null }])
  })

  it('reflects uniforms in source order and handles precision qualifiers', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform highp float uA;
uniform mediump int uB;
uniform lowp float uC;
void main() {}
`,
    )

    expect(reflection.uniforms.map((uniform) => uniform.key)).toEqual(['uA', 'uB', 'uC'])
    expect(reflection.uniforms[0].type).toBe('float')
    expect(reflection.uniforms[1].type).toBe('int')
  })

  it('reflects indented declarations', () => {
    const reflection = reflectUniforms(
      `#version 300 es
  uniform float uIndented;
  void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([{ key: 'uIndented', type: 'float', default: 0 }])
  })

  it('reflects declarations split across lines', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform vec3
    uColor;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([{ key: 'uColor', type: 'vec3', default: [0, 0, 0] }])
  })

  it('warns when the reserved name is declared with an unsupported type', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform mat4 uTexture;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([])
    expect(reflection.warnings).toEqual([
      { line: 2, message: "Uniform type 'mat4' is not supported and was skipped." },
    ])
  })

  it('warns about array declarations of a supported type', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform float uWeights[4];
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([])
    expect(reflection.warnings).toEqual([
      { line: 2, message: "Array uniform 'uWeights' is not supported and was skipped." },
    ])
  })

  it('warns about matrix declarations', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform mat3 uMatrix;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([])
    expect(reflection.warnings).toEqual([
      { line: 2, message: "Uniform type 'mat3' is not supported and was skipped." },
    ])
  })

  it('warns about struct-typed declarations', () => {
    const reflection = reflectUniforms(
      `#version 300 es
struct Light { vec3 position; };
uniform Light uLight;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([])
    expect(reflection.warnings).toEqual([
      { line: 3, message: "Uniform type 'Light' is not supported and was skipped." },
    ])
  })

  it('continues reflecting supported uniforms after a warning', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform float uGood;
uniform mat4 uMatrix;
uniform vec2 uAlsoGood;
void main() {}
`,
    )

    expect(reflection.uniforms.map((uniform) => uniform.key)).toEqual(['uGood', 'uAlsoGood'])
    expect(reflection.warnings).toHaveLength(1)
    expect(reflection.warnings[0].line).toBe(3)
  })

  it('ignores uniforms inside line comments', () => {
    const reflection = reflectUniforms(
      `#version 300 es
// uniform float uCommented;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([])
  })

  it('ignores uniforms inside block comments while keeping line numbers intact', () => {
    const reflection = reflectUniforms(
      `#version 300 es
/*
uniform float uCommented;
*/
uniform float uReal;
void main() {}
`,
    )

    expect(reflection.uniforms.map((uniform) => uniform.key)).toEqual(['uReal'])
    expect(reflection.uniforms[0].default).toBe(0)
  })

  it('keeps the first declaration when a uniform name repeats', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform float uA;
uniform float uA;
void main() {}
`,
    )

    expect(reflection.uniforms).toHaveLength(1)
    expect(reflection.uniforms[0].key).toBe('uA')
  })

  it('reports line numbers of the declarations', () => {
    const reflection = reflectUniforms(
      `#version 300 es
precision highp float;

uniform float uDepth;
void main() {}
`,
    )

    expect(reflection.uniforms[0]).toEqual({ key: 'uDepth', type: 'float', default: 0 })
    expect(reflection.warnings).toEqual([])
  })

  it('returns no uniforms and no warnings for a source without declarations', () => {
    const reflection = reflectUniforms(`#version 300 es
void main() {}
`)

    expect(reflection.uniforms).toEqual([])
    expect(reflection.warnings).toEqual([])
  })

  it('defaults are 0 / false / zero vectors / empty samplers per type', () => {
    const reflection = reflectUniforms(
      `#version 300 es
uniform float uF;
uniform int uI;
uniform bool uB;
uniform vec2 uV2;
uniform vec3 uV3;
uniform vec4 uV4;
uniform sampler2D uS;
void main() {}
`,
    )

    expect(reflection.uniforms).toEqual([
      { key: 'uF', type: 'float', default: 0 },
      { key: 'uI', type: 'int', default: 0 },
      { key: 'uB', type: 'bool', default: false },
      { key: 'uV2', type: 'vec2', default: [0, 0] },
      { key: 'uV3', type: 'vec3', default: [0, 0, 0] },
      { key: 'uV4', type: 'vec4', default: [0, 0, 0, 0] },
      { key: 'uS', type: 'sampler2D', default: null },
    ])
  })
})
