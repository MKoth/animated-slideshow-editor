import type { PixiGlProgram, RendererPixi } from './pixi'

export const NODE_SHADER_VERTEX = `in vec2 aPosition;
out vec2 vUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vUv = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`

export class ShaderProgramCache {
  readonly #pixi: RendererPixi
  readonly #programs = new Map<string, PixiGlProgram>()

  constructor(pixi: RendererPixi) {
    this.#pixi = pixi
  }

  get(fragmentSource: string): PixiGlProgram {
    let program = this.#programs.get(fragmentSource)
    if (!program) {
      program = this.#pixi.GlProgram.from({ vertex: NODE_SHADER_VERTEX, fragment: fragmentSource })
      this.#programs.set(fragmentSource, program)
    }
    return program
  }

  dispose(): void {
    this.#programs.clear()
  }
}
