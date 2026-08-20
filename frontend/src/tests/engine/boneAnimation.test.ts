import { describe, expect, it } from 'vitest'
import type { AnimationProperty } from '../../engine'
import { ANIMATABLE_PROPERTIES, BONE_ANIMATABLE_PROPERTIES } from '../../engine'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import { animatablePropertiesOf } from '../../app/keyframeActions'
import { createEngineInternal } from '../../engine/internal'
import type { SceneNode } from '../../engine'

function expectOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error?.message}`)
  }
  return result.inverse as T
}

function createBoneNode(
  system: ReturnType<typeof createCommandSystem>,
  sceneId: string,
  parentId: string,
  name: string,
): string {
  const node = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId,
        parentId,
        name,
        components: { bone: { kind: 'bone', length: 100 } },
      }),
    ),
  )
  return node.nodeId
}

function addKeyframe(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  property: AnimationProperty,
  time: number,
  value: number,
): string {
  const inverse = expectOk(
    system.dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
    ),
  )
  return inverse.keyframe.keyframeId
}

function setup() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return { system, slide }
}

describe('Bone Animation', () => {
  describe('animatable properties', () => {
    it('bone nodes have 5 animatable properties (no opacity)', () => {
      const boneNode: SceneNode = {
        id: 'test',
        name: 'Bone',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        visible: true,
        opacity: 1,
        parent: null,
        children: [],
        material: { materialDefinitionId: 'default', overrides: {} },
        components: { bone: { kind: 'bone', length: 100 } },
        clipInstances: [],
        _worldTransformDirty: true,
        _cachedWorldTransform: null,
        markDirty: () => {},
        toJSON: () => ({}) as never,
      } as unknown as SceneNode

      const props = animatablePropertiesOf(boneNode)
      expect(props).toEqual([...BONE_ANIMATABLE_PROPERTIES])
      expect(props).not.toContain('opacity')
    })

    it('regular nodes have 6 animatable properties including opacity', () => {
      const regularNode: SceneNode = {
        id: 'test',
        name: 'Regular',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        visible: true,
        opacity: 1,
        parent: null,
        children: [],
        material: { materialDefinitionId: 'default', overrides: {} },
        components: {},
        clipInstances: [],
        _worldTransformDirty: true,
        _cachedWorldTransform: null,
        markDirty: () => {},
        toJSON: () => ({}) as never,
      } as unknown as SceneNode

      const props = animatablePropertiesOf(regularNode)
      expect(props).toEqual([...ANIMATABLE_PROPERTIES])
      expect(props).toContain('opacity')
    })

    it('camera nodes exclude rotation from animatable properties', () => {
      const cameraNode: SceneNode = {
        id: 'test',
        name: 'Camera',
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        visible: true,
        opacity: 1,
        parent: null,
        children: [],
        material: { materialDefinitionId: 'default', overrides: {} },
        components: { camera: { kind: 'camera' } },
        clipInstances: [],
        _worldTransformDirty: true,
        _cachedWorldTransform: null,
        markDirty: () => {},
        toJSON: () => ({}) as never,
      } as unknown as SceneNode

      const props = animatablePropertiesOf(cameraNode)
      expect(props).not.toContain('rotation')
      expect(props).toContain('opacity')
    })
  })

  describe('bone keyframe creation', () => {
    it('adding keyframes to a bone rotation property animates the bone', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'UpperArm')

      addKeyframe(system, boneId, 'rotation', 0, 0)
      addKeyframe(system, boneId, 'rotation', 5, 45)

      const state = system.engine.evaluateNode(boneId, 2.5)
      expect(state.transform.rotation).toBe(22.5)
    })

    it('bone nodes support all 5 transform properties', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Bone')

      addKeyframe(system, boneId, 'positionX', 0, 10)
      addKeyframe(system, boneId, 'positionY', 0, 20)
      addKeyframe(system, boneId, 'rotation', 0, 30)
      addKeyframe(system, boneId, 'scaleX', 0, 2)
      addKeyframe(system, boneId, 'scaleY', 0, 0.5)

      const state = system.engine.evaluateNode(boneId, 0)
      expect(state.transform.x).toBe(10)
      expect(state.transform.y).toBe(20)
      expect(state.transform.rotation).toBe(30)
      expect(state.transform.scaleX).toBe(2)
      expect(state.transform.scaleY).toBe(0.5)
    })

    it('bone opacity keyframe is rejected', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Bone')

      const result = system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'node', nodeId: boneId, property: 'opacity' },
          time: 0,
          value: 0.5,
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toContain('Bone opacity is not animatable')
      }
    })
  })

  describe('bone keyframe persistence', () => {
    it('bone keyframes persist in .lesson round-trip', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'UpperArm')

      addKeyframe(system, boneId, 'rotation', 0, 0)
      addKeyframe(system, boneId, 'rotation', 5, 90)
      addKeyframe(system, boneId, 'positionX', 0, 100)

      const json = system.engine.toJSON()
      const restored = createEngineInternal()
      restored.restoreFromJSON(json)

      const slide2 = restored.project?.slides[0]
      expect(slide2).toBeDefined()

      const keyframes = restored.getKeyframes(boneId, 'rotation')
      expect(keyframes.length).toBe(2)
      expect(keyframes[0].time).toBe(0)
      expect(keyframes[0].value).toBe(0)
      expect(keyframes[1].time).toBe(5)
      expect(keyframes[1].value).toBe(90)

      const posXKeyframes = restored.getKeyframes(boneId, 'positionX')
      expect(posXKeyframes.length).toBe(1)
      expect(posXKeyframes[0].value).toBe(100)
    })

    it('bone keyframes evaluate correctly after round-trip', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Bone')

      addKeyframe(system, boneId, 'rotation', 0, 0)
      addKeyframe(system, boneId, 'rotation', 10, 180)

      const beforeState = system.engine.evaluateNode(boneId, 5)
      expect(beforeState.transform.rotation).toBe(90)

      const json = system.engine.toJSON()
      const restored = createEngineInternal()
      restored.restoreFromJSON(json)

      const afterState = restored.evaluateNode(boneId, 5)
      expect(afterState.transform.rotation).toBe(90)
    })
  })

  describe('bone world transform propagation', () => {
    it('animating a bone rotation causes child image nodes to move in world space', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Arm')

      // Create an image node as a child of the bone
      const imageNode = expectOk(
        system.dispatcher.dispatch(
          new CreateNodeCommand({
            sceneId: slide.scene.id,
            parentId: boneId,
            name: 'Image',
            transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          }),
        ),
      )

      // Add rotation keyframes to the bone
      addKeyframe(system, boneId, 'rotation', 0, 0)
      addKeyframe(system, boneId, 'rotation', 10, 90)

      // evaluateNode returns the local transform, not world transform.
      // The image's local transform is always (100, 0) regardless of bone rotation.
      const localState = system.engine.evaluateNode(imageNode.nodeId, 5)
      expect(localState.transform.x).toBe(100)
      expect(localState.transform.y).toBe(0)

      // The bone's rotation is animated correctly
      const boneState = system.engine.evaluateNode(boneId, 5)
      expect(boneState.transform.rotation).toBe(45)
    })

    it('bone child nodes inherit parent bone transforms', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Bone')

      const childId = expectOk(
        system.dispatcher.dispatch(
          new CreateNodeCommand({
            sceneId: slide.scene.id,
            parentId: boneId,
            name: 'Child',
            transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          }),
        ),
      )

      // Set bone position
      addKeyframe(system, boneId, 'positionX', 0, 100)
      addKeyframe(system, boneId, 'positionX', 10, 200)

      // Child local transform is unchanged
      const childLocal = system.engine.evaluateNode(childId.nodeId, 5)
      expect(childLocal.transform.x).toBe(50)
    })
  })

  describe('batch keyframe commands', () => {
    it('multiple bone keyframes can be added in sequence', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Bone')

      addKeyframe(system, boneId, 'rotation', 0, 0)
      addKeyframe(system, boneId, 'rotation', 2, 45)
      addKeyframe(system, boneId, 'rotation', 4, 90)
      addKeyframe(system, boneId, 'rotation', 6, 135)
      addKeyframe(system, boneId, 'rotation', 8, 180)

      const keyframes = system.engine.getKeyframes(boneId, 'rotation')
      expect(keyframes.length).toBe(5)

      expect(system.engine.evaluateNode(boneId, 1).transform.rotation).toBe(22.5)
      expect(system.engine.evaluateNode(boneId, 3).transform.rotation).toBe(67.5)
      expect(system.engine.evaluateNode(boneId, 5).transform.rotation).toBe(112.5)
      expect(system.engine.evaluateNode(boneId, 7).transform.rotation).toBe(157.5)
    })

    it('bone keyframes on different properties are independent', () => {
      const { system, slide } = setup()
      const boneId = createBoneNode(system, slide.scene.id, slide.scene.root.id, 'Bone')

      addKeyframe(system, boneId, 'rotation', 0, 0)
      addKeyframe(system, boneId, 'rotation', 10, 180)
      addKeyframe(system, boneId, 'scaleX', 0, 1)
      addKeyframe(system, boneId, 'scaleX', 10, 3)

      const state = system.engine.evaluateNode(boneId, 5)
      expect(state.transform.rotation).toBe(90)
      expect(state.transform.scaleX).toBe(2)
    })
  })
})
