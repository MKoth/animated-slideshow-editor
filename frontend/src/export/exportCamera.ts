import type { AnimationProperty } from '../engine/animationProperties'
import type { EnginePublic } from '../engine/engine'
import type { Slide } from '../engine/slide'

/**
 * Camera transform tracks that define the camera's desired position for export.
 * Rotation is locked for cameras and opacity is meaningless on them, so only
 * pan (positionX/positionY) and zoom (scaleX/scaleY) count.
 */
export const CAMERA_ANIMATION_PROPERTIES: readonly AnimationProperty[] = [
  'positionX',
  'positionY',
  'scaleX',
  'scaleY',
]

/**
 * Whether the slide's camera has at least one keyframe on a transform track.
 * A single keyframe fixes the camera; no keyframe means its desired position
 * is unknown and export must refuse the slide.
 */
export function slideCameraHasKeyframes(engine: EnginePublic, slide: Slide): boolean {
  const cameraId = slide.scene.camera.id
  return CAMERA_ANIMATION_PROPERTIES.some(
    (property) => engine.getKeyframes(cameraId, property).length > 0,
  )
}

/** Selected slides (project order) whose camera has no keyframes. */
export function slidesMissingCameraKeyframes(
  engine: EnginePublic,
  slides: readonly Slide[],
): Slide[] {
  return slides.filter((slide) => !slideCameraHasKeyframes(engine, slide))
}
