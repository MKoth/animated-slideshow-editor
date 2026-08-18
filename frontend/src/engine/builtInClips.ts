import type { ClipParam } from './clipDefinition'
import type { ClipChannelDef } from './clipDefinition'
import { ClipDefinition } from './clipDefinition'
import { newClipId } from './clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { AnimationProperty } from './animationProperties'

export interface BuiltInClipDefinition {
  readonly name: string
  readonly duration: number
  readonly category: string
  readonly params: ClipParam[]
  readonly channels: ClipChannelDef[]
  readonly keyframes: ReadonlyArray<{
    readonly property: AnimationProperty
    readonly time: number
    readonly value: number
  }>
}

const BUILT_IN_CLIPS: readonly BuiltInClipDefinition[] = [
  {
    name: 'Fade In',
    duration: 1,
    category: 'transition',
    params: [],
    channels: [{ property: 'opacity' }],
    keyframes: [
      { property: 'opacity', time: 0, value: 0 },
      { property: 'opacity', time: 1, value: 1 },
    ],
  },
  {
    name: 'Fade Out',
    duration: 1,
    category: 'transition',
    params: [],
    channels: [{ property: 'opacity' }],
    keyframes: [
      { property: 'opacity', time: 0, value: 1 },
      { property: 'opacity', time: 1, value: 0 },
    ],
  },
  {
    name: 'Pop',
    duration: 0.5,
    category: 'motion',
    params: [],
    channels: [{ property: 'scaleX' }, { property: 'scaleY' }],
    keyframes: [
      { property: 'scaleX', time: 0, value: 0 },
      { property: 'scaleX', time: 0.5, value: 1.2 },
      { property: 'scaleX', time: 1, value: 1 },
      { property: 'scaleY', time: 0, value: 0 },
      { property: 'scaleY', time: 0.5, value: 1.2 },
      { property: 'scaleY', time: 1, value: 1 },
    ],
  },
  {
    name: 'Scale Up',
    duration: 0.75,
    category: 'motion',
    params: [],
    channels: [{ property: 'scaleX' }, { property: 'scaleY' }],
    keyframes: [
      { property: 'scaleX', time: 0, value: 1 },
      { property: 'scaleX', time: 1, value: 1.5 },
      { property: 'scaleY', time: 0, value: 1 },
      { property: 'scaleY', time: 1, value: 1.5 },
    ],
  },
  {
    name: 'Scale Down',
    duration: 0.75,
    category: 'motion',
    params: [],
    channels: [{ property: 'scaleX' }, { property: 'scaleY' }],
    keyframes: [
      { property: 'scaleX', time: 0, value: 1 },
      { property: 'scaleX', time: 1, value: 0.5 },
      { property: 'scaleY', time: 0, value: 1 },
      { property: 'scaleY', time: 1, value: 0.5 },
    ],
  },
  {
    name: 'Bounce',
    duration: 1,
    category: 'motion',
    params: [],
    channels: [{ property: 'positionY' }],
    keyframes: [
      { property: 'positionY', time: 0, value: 0 },
      { property: 'positionY', time: 0.25, value: -50 },
      { property: 'positionY', time: 0.5, value: 0 },
      { property: 'positionY', time: 0.75, value: -25 },
      { property: 'positionY', time: 1, value: 0 },
    ],
  },
  {
    name: 'Float',
    duration: 2,
    category: 'motion',
    params: [],
    channels: [{ property: 'positionY' }],
    keyframes: [
      { property: 'positionY', time: 0, value: 0 },
      { property: 'positionY', time: 0.25, value: -10 },
      { property: 'positionY', time: 0.5, value: 0 },
      { property: 'positionY', time: 0.75, value: 10 },
      { property: 'positionY', time: 1, value: 0 },
    ],
  },
  {
    name: 'Shake',
    duration: 0.5,
    category: 'motion',
    params: [],
    channels: [{ property: 'positionX' }],
    keyframes: [
      { property: 'positionX', time: 0, value: 0 },
      { property: 'positionX', time: 0.1, value: 5 },
      { property: 'positionX', time: 0.2, value: -5 },
      { property: 'positionX', time: 0.3, value: 5 },
      { property: 'positionX', time: 0.4, value: -5 },
      { property: 'positionX', time: 0.5, value: 0 },
    ],
  },
  {
    name: 'Pulse',
    duration: 1,
    category: 'motion',
    params: [],
    channels: [{ property: 'scaleX' }, { property: 'scaleY' }],
    keyframes: [
      { property: 'scaleX', time: 0, value: 1 },
      { property: 'scaleX', time: 0.5, value: 1.1 },
      { property: 'scaleX', time: 1, value: 1 },
      { property: 'scaleY', time: 0, value: 1 },
      { property: 'scaleY', time: 0.5, value: 1.1 },
      { property: 'scaleY', time: 1, value: 1 },
    ],
  },
  {
    name: 'Rotate',
    duration: 1,
    category: 'motion',
    params: [],
    channels: [{ property: 'rotation' }],
    keyframes: [
      { property: 'rotation', time: 0, value: 0 },
      { property: 'rotation', time: 1, value: 360 },
    ],
  },
  {
    name: 'Blink',
    duration: 0.8,
    category: 'motion',
    params: [],
    channels: [{ property: 'opacity' }],
    keyframes: [
      { property: 'opacity', time: 0, value: 1 },
      { property: 'opacity', time: 0.1, value: 0 },
      { property: 'opacity', time: 0.2, value: 1 },
      { property: 'opacity', time: 0.3, value: 0 },
      { property: 'opacity', time: 0.4, value: 1 },
    ],
  },
  {
    name: 'Wobble',
    duration: 1,
    category: 'motion',
    params: [],
    channels: [{ property: 'rotation' }],
    keyframes: [
      { property: 'rotation', time: 0, value: 0 },
      { property: 'rotation', time: 0.25, value: 10 },
      { property: 'rotation', time: 0.5, value: -10 },
      { property: 'rotation', time: 0.75, value: 5 },
      { property: 'rotation', time: 1, value: 0 },
    ],
  },
  {
    name: 'Slide Left',
    duration: 0.75,
    category: 'motion',
    params: [],
    channels: [{ property: 'positionX' }],
    keyframes: [
      { property: 'positionX', time: 0, value: 100 },
      { property: 'positionX', time: 1, value: 0 },
    ],
  },
  {
    name: 'Slide Right',
    duration: 0.75,
    category: 'motion',
    params: [],
    channels: [{ property: 'positionX' }],
    keyframes: [
      { property: 'positionX', time: 0, value: -100 },
      { property: 'positionX', time: 1, value: 0 },
    ],
  },
  {
    name: 'Appear',
    duration: 0.01,
    category: 'transition',
    params: [],
    channels: [{ property: 'opacity' }],
    keyframes: [{ property: 'opacity', time: 0, value: 1 }],
  },
  {
    name: 'Disappear',
    duration: 0.01,
    category: 'transition',
    params: [],
    channels: [{ property: 'opacity' }],
    keyframes: [{ property: 'opacity', time: 0, value: 0 }],
  },
  {
    name: 'Speech Bubble Pop',
    duration: 0.5,
    category: 'ui',
    params: [],
    channels: [{ property: 'scaleX' }, { property: 'scaleY' }, { property: 'opacity' }],
    keyframes: [
      { property: 'scaleX', time: 0, value: 0 },
      { property: 'scaleX', time: 0.5, value: 1.2 },
      { property: 'scaleX', time: 1, value: 1 },
      { property: 'scaleY', time: 0, value: 0 },
      { property: 'scaleY', time: 0.5, value: 1.2 },
      { property: 'scaleY', time: 1, value: 1 },
      { property: 'opacity', time: 0, value: 0 },
      { property: 'opacity', time: 0.5, value: 1 },
    ],
  },
  {
    name: 'Clock Tick',
    duration: 0.5,
    category: 'ui',
    params: [],
    channels: [{ property: 'rotation' }],
    keyframes: [
      { property: 'rotation', time: 0, value: 0 },
      { property: 'rotation', time: 0.5, value: 30 },
    ],
  },
  {
    name: 'Point',
    duration: 0.5,
    category: 'ui',
    params: [],
    channels: [{ property: 'rotation' }],
    keyframes: [
      { property: 'rotation', time: 0, value: 0 },
      { property: 'rotation', time: 0.25, value: -20 },
      { property: 'rotation', time: 0.5, value: 0 },
    ],
  },
  {
    name: 'Wave',
    duration: 1.5,
    category: 'motion',
    params: [],
    channels: [{ property: 'rotation' }],
    keyframes: [
      { property: 'rotation', time: 0, value: 0 },
      { property: 'rotation', time: 0.1667, value: 20 },
      { property: 'rotation', time: 0.3333, value: -20 },
      { property: 'rotation', time: 0.5, value: 20 },
      { property: 'rotation', time: 0.6667, value: -20 },
      { property: 'rotation', time: 0.8333, value: 10 },
      { property: 'rotation', time: 1, value: 0 },
    ],
  },
  {
    name: 'Jump',
    duration: 0.75,
    category: 'motion',
    params: [],
    channels: [{ property: 'positionY' }, { property: 'scaleY' }],
    keyframes: [
      { property: 'positionY', time: 0, value: 0 },
      { property: 'positionY', time: 0.25, value: -80 },
      { property: 'positionY', time: 0.5, value: 0 },
      { property: 'scaleY', time: 0, value: 1 },
      { property: 'scaleY', time: 0.125, value: 0.8 },
      { property: 'scaleY', time: 0.25, value: 1.2 },
      { property: 'scaleY', time: 0.5, value: 1 },
    ],
  },
]

export function createBuiltInClips(): ClipDefinition[] {
  return BUILT_IN_CLIPS.map((def) => {
    const id = newClipId()
    const clip = new ClipDefinition(
      id,
      def.name,
      def.duration,
      def.category,
      def.params,
      def.channels,
    )
    for (const kf of def.keyframes) {
      clip.addChannelKeyframe(
        kf.property,
        new KeyframeModel(newKeyframeId(), kf.time, kf.value, 'linear'),
      )
    }
    return clip
  })
}
