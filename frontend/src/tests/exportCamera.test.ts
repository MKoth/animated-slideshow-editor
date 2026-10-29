import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { AddKeyframeCommand, CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import {
  CAMERA_ANIMATION_PROPERTIES,
  slideCameraHasKeyframes,
  slidesMissingCameraKeyframes,
} from '../export/exportCamera'

function animateCamera(
  internal: Engine,
  slideId: string,
  property: 'positionX' | 'positionY' | 'scaleX' | 'scaleY' | 'opacity' = 'positionX',
): void {
  const slide = internal.getSlide(slideId)
  const dispatcher = new CommandDispatcher(internal, new UndoStack(), () => {})
  const result = dispatcher.dispatch(
    new AddKeyframeCommand({
      target: { kind: 'node', nodeId: slide.scene.camera.id, property },
      time: 0,
      value: 0,
    }),
  )
  if (!result.ok) throw result.error
}

describe('export camera keyframes seam', () => {
  it('a camera without keyframes is missing; any transform keyframe satisfies it', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Cam' })
    const slide = engine.createSlide('S1')
    expect(slideCameraHasKeyframes(engine, slide)).toBe(false)

    animateCamera(engine, slide.id, 'scaleX')
    expect(slideCameraHasKeyframes(engine, slide)).toBe(true)
  })

  it('opacity keyframes do not count as camera animation', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Cam' })
    const slide = engine.createSlide('S1')
    const dispatcher = new CommandDispatcher(engine, new UndoStack(), () => {})
    const result = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: slide.scene.camera.id, property: 'opacity' },
        time: 0,
        value: 1,
      }),
    )
    if (!result.ok) throw result.error
    expect(slideCameraHasKeyframes(engine, slide)).toBe(false)
  })

  it('slidesMissingCameraKeyframes filters in project order', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Cam' })
    const s1 = engine.createSlide('S1')
    const s2 = engine.createSlide('S2')
    const s3 = engine.createSlide('S3')
    animateCamera(engine, s2.id)
    const missing = slidesMissingCameraKeyframes(engine, engine.project!.slides)
    expect(missing.map((s) => s.id)).toEqual([s1.id, s3.id])
  })

  it('covers exactly the camera transform tracks', () => {
    expect([...CAMERA_ANIMATION_PROPERTIES].sort()).toEqual(
      ['positionX', 'positionY', 'scaleX', 'scaleY'].sort(),
    )
  })
})
