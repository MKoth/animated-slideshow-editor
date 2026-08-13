import { newId } from './ids'
import type { KeyframeJSON } from './json'

export class Keyframe {
  readonly id: string
  time: number
  value: number

  constructor(id: string, time: number, value: number) {
    this.id = id
    this.time = time
    this.value = value
  }

  toJSON(): KeyframeJSON {
    return { id: this.id, time: this.time, value: this.value }
  }
}

export function newKeyframeId(): string {
  return newId('keyframe')
}
