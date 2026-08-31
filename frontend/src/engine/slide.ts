import type { Scene } from './scene'
import type { SlideJSON } from './json'
import type { SlideAnimation } from './animation'
import { fullscreenShaderToJSON, type FullscreenShaderReference } from './fullscreenShader'
import type { Prompter } from './prompter'
import { prompterToJSON } from './prompter'
import type { AudioClip } from './audioClip'
import { audioClipToJSON } from './audioClip'

export const DEFAULT_SLIDE_DURATION = 10
export const MIN_SLIDE_DURATION = 0.1
export const MAX_SLIDE_DURATION = 3600

export class Slide {
  readonly id: string
  name: string
  duration: number
  readonly scene: Scene
  readonly animation: SlideAnimation
  fullscreenShader: FullscreenShaderReference | null
  prompter: Prompter | null
  audio: { clips: AudioClip[] }

  constructor(
    id: string,
    name: string,
    duration: number,
    scene: Scene,
    animation: SlideAnimation,
    fullscreenShader: FullscreenShaderReference | null = null,
    prompter: Prompter | null = null,
    audio?: { clips: AudioClip[] },
  ) {
    this.id = id
    this.name = name
    this.duration = duration
    this.scene = scene
    this.animation = animation
    this.fullscreenShader = fullscreenShader
    this.prompter = prompter
    this.audio = audio ?? { clips: [] }
  }

  toJSON(): SlideJSON {
    return {
      id: this.id,
      name: this.name,
      duration: this.duration,
      scene: this.scene.toJSON(),
      animation: this.animation.toJSON(),
      ...(this.fullscreenShader !== null
        ? { fullscreenShader: fullscreenShaderToJSON(this.fullscreenShader) }
        : {}),
      ...(this.prompter !== null ? { prompter: prompterToJSON(this.prompter) } : {}),
      ...(this.audio.clips.length > 0
        ? { audio: { clips: this.audio.clips.map(audioClipToJSON) } }
        : {}),
    }
  }
}
