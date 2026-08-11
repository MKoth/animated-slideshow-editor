import { describe, expect, it } from 'vitest'
import type { Engine } from '../../engine/engine'
import { createEngine } from '../../engine/internal'

function cameraSetup(secondSlide = false): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  if (secondSlide) {
    engine.createSlide('S2')
  }
  return engine
}

describe('camera node', () => {
  it('is born with every slide as a child of the scene root', () => {
    const engine = cameraSetup(true)
    const slides = engine.project?.slides ?? []

    for (const slide of slides) {
      const camera = slide.scene.camera
      expect(camera).toBeDefined()
      expect(camera?.name).toBe('Camera')
      expect(camera?.parent).toBe(slide.scene.root)
      expect(slide.scene.root.children[0]).toBe(camera)
      expect(camera?.components.camera?.kind).toBe('camera')
    }
  })

  it('owns an identity transform by default', () => {
    const engine = cameraSetup()
    const camera = engine.project?.slides[0]?.scene.camera

    expect(camera?.transform).toEqual({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    expect(camera?.visible).toBe(true)
  })

  it('creates exactly one camera per scene and rejects a second', () => {
    const engine = cameraSetup()
    const slide = engine.project?.slides[0]
    if (!slide) return

    expect(() =>
      engine.createNode(slide.scene.id, slide.scene.root.id, 'Second Camera', {
        components: { camera: { kind: 'camera' } },
      }),
    ).toThrow(/camera/i)
    expect(slide.scene.root.children).toHaveLength(1)
  })

  it('cannot be deleted', () => {
    const engine = cameraSetup()
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) return

    expect(() => engine.removeNode(camera.id)).toThrow(/camera/i)
    expect(engine.getNode(camera.id)).toBe(camera)
  })

  it('cannot change its rotation', () => {
    const engine = cameraSetup()
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) return
    const before = camera.transform

    expect(() => engine.setTransform(camera.id, { ...before, rotation: 1 })).toThrow(
      /rotation.*locked/i,
    )
    expect(camera.transform).toEqual(before)
  })

  it('pan and zoom update the camera transform', () => {
    const engine = cameraSetup()
    const camera = engine.project?.slides[0]?.scene.camera
    if (!camera) return

    engine.setTransform(camera.id, { x: 120, y: 60, rotation: 0, scaleX: 2, scaleY: 2 })

    expect(camera.transform).toEqual({ x: 120, y: 60, rotation: 0, scaleX: 2, scaleY: 2 })
  })

  it('rejects an unknown node id when transforming', () => {
    const engine = cameraSetup()

    expect(() =>
      engine.setTransform('ghost', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
    ).toThrow(/node.*not found/i)
  })
})
