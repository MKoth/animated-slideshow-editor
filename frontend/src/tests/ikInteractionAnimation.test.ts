import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { IkInteraction } from '../pixi/renderer/ikInteraction'
import { IkOverlay } from '../pixi/renderer/ikOverlay'
import { useEditingModeStore } from '../stores/editingModeStore'
import { useUiStore } from '../stores/uiStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useIKSelectionStore } from '../stores/ikSelectionStore'
import { useNotificationStore } from '../stores/notificationStore'
import { BLOCKED_ANIMATED_MOVE_MESSAGE } from '../pixi/renderer/animatedMove'

function setup(): {
  engine: Engine
  dispatcher: CommandDispatcher
  canvas: HTMLCanvasElement
  slideId: string
  sceneId: string
} {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const log = () => {}
  const dispatcher = new CommandDispatcher(engine, undoStack, log)

  engine.createProject({ name: 'Test Project' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')

  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect
  return { engine, dispatcher, canvas, slideId: slide.id, sceneId: slide.scene.id }
}

function createBoneNode(engine: Engine, name: string, parentId: string, x = 0, y = 0) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { bone: { kind: 'bone', length: 100 } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function createInteraction(
  engine: Engine,
  dispatcher: CommandDispatcher,
  canvas: HTMLCanvasElement,
  sceneId: string,
): IkInteraction {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')

  const ikOverlay = new IkOverlay({
    pixi: {} as never,
    world: {} as never,
    engine,
    getScene: () => engine.getScene(sceneId),
  })

  return new IkInteraction({
    canvas,
    engine,
    getCameraTransform: () => ({ x: 0, y: 0, scaleX: 1, scaleY: 1 }),
    dispatch: (command) => dispatcher.dispatch(command),
    ikOverlay,
    onIKChanged: () => {},
  })
}

describe('IK interaction in Animation Mode', () => {
  beforeEach(() => {
    useEditingModeStore.getState().exitMode()
    useUiStore.setState({ animationMode: false, cameraAnimationMode: false })
    usePlaybackController.setState({ currentTimes: {} })
    useNotificationStore.setState({ notifications: [] })
  })

  afterEach(() => {
    useEditingModeStore.getState().exitMode()
    useUiStore.setState({ animationMode: false, cameraAnimationMode: false })
    usePlaybackController.setState({ currentTimes: {} })
    useNotificationStore.setState({ notifications: [] })
  })

  it('updates ghost node position when dragging IK handle in non-Animation Mode', () => {
    const { engine, dispatcher, canvas, slideId, sceneId } = setup()
    const root = createBoneNode(engine, 'Root', engine.project!.slides[0].scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    // Create IK chain with ghost node
    const chain = engine.createIKChain(slideId, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })
    const ghostNodeId = chain.ghostNodeId!

    // Select the chain for IK interaction
    useIKSelectionStore.getState().selectChain(chain.id)

    const interaction = createInteraction(engine, dispatcher, canvas, sceneId)
    interaction.attach()

    // Simulate mousedown on the IK handle position
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        clientX: 200,
        clientY: 0,
      }),
    )

    // Simulate mousemove to new position
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 300,
        clientY: 100,
      }),
    )

    // Simulate mouseup
    window.dispatchEvent(new MouseEvent('mouseup'))

    // Check that the ghost node was moved
    const ghostNode = engine.getNode(ghostNodeId)
    expect(ghostNode.transform.x).toBe(300)
    expect(ghostNode.transform.y).toBe(100)

    interaction.detach()
  })

  it('creates keyframes when dragging IK handle in Animation Mode', () => {
    const { engine, dispatcher, canvas, slideId, sceneId } = setup()
    const root = createBoneNode(engine, 'Root', engine.project!.slides[0].scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    // Create IK chain with ghost node
    const chain = engine.createIKChain(slideId, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })
    const ghostNodeId = chain.ghostNodeId!

    // Select the chain for IK interaction
    useIKSelectionStore.getState().selectChain(chain.id)

    // Enable Animation Mode
    useUiStore.setState({ animationMode: true, cameraAnimationMode: false })

    // Set playhead time
    const slide = engine.project!.slides[0]
    usePlaybackController.getState().setCurrentTime(slideId, 1.0, slide.duration)

    const interaction = createInteraction(engine, dispatcher, canvas, sceneId)
    interaction.attach()

    // Simulate mousedown on the IK handle position
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        clientX: 200,
        clientY: 0,
      }),
    )

    // Simulate mousemove to new position
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 300,
        clientY: 100,
      }),
    )

    // Simulate mouseup
    window.dispatchEvent(new MouseEvent('mouseup'))

    // Check that keyframes were created for positionX and positionY
    const positionXKeyframes = engine.getKeyframes(ghostNodeId, 'positionX')
    const positionYKeyframes = engine.getKeyframes(ghostNodeId, 'positionY')

    expect(positionXKeyframes.length).toBe(1)
    expect(positionYKeyframes.length).toBe(1)

    expect(positionXKeyframes[0].time).toBe(1.0)
    expect(positionXKeyframes[0].value).toBe(300)

    expect(positionYKeyframes[0].time).toBe(1.0)
    expect(positionYKeyframes[0].value).toBe(100)
    expect(engine.getIKChain(chain.id).target.nodeId).toBe(ghostNodeId)

    interaction.detach()
  })

  it('evaluates the animated IK target while scrubbing', () => {
    const { engine, dispatcher, canvas, slideId, sceneId } = setup()
    const root = createBoneNode(engine, 'Root', engine.project!.slides[0].scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)
    const chain = engine.createIKChain(slideId, [root.id, child.id], { position: { x: 200, y: 0 } })
    const ghostNodeId = chain.ghostNodeId!
    useIKSelectionStore.getState().selectChain(chain.id)
    useUiStore.setState({ animationMode: true, cameraAnimationMode: false })

    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionX' }, 0, 200)
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionX' }, 2, 400)
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionY' }, 0, 0)
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionY' }, 2, 200)

    const interaction = createInteraction(engine, dispatcher, canvas, sceneId)
    interaction.attach()
    usePlaybackController.getState().setCurrentTime(slideId, 1, engine.project!.slides[0].duration)

    expect(engine.evaluateNode(ghostNodeId, 1).transform).toMatchObject({ x: 300, y: 100 })
    expect(engine.getIKChain(chain.id).target.nodeId).toBe(ghostNodeId)
    interaction.detach()
  })

  it('blocks moving an animated IK target outside Animation Mode', () => {
    const { engine, dispatcher, canvas, slideId, sceneId } = setup()
    const root = createBoneNode(engine, 'Root', engine.project!.slides[0].scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)
    const chain = engine.createIKChain(slideId, [root.id, child.id], { position: { x: 200, y: 0 } })
    const ghostNodeId = chain.ghostNodeId!
    useIKSelectionStore.getState().selectChain(chain.id)
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionX' }, 0, 200)

    const interaction = createInteraction(engine, dispatcher, canvas, sceneId)
    interaction.attach()
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 200, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      BLOCKED_ANIMATED_MOVE_MESSAGE,
    ])
    expect(engine.getNode(ghostNodeId).transform).toMatchObject({ x: 200, y: 0 })
    expect(engine.getIKChain(chain.id).target.position).toEqual({ x: 200, y: 0 })
    interaction.detach()
  })

  it('blocks placing an animated IK target outside Animation Mode', () => {
    const { engine, dispatcher, canvas, slideId, sceneId } = setup()
    const root = createBoneNode(engine, 'Root', engine.project!.slides[0].scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)
    const chain = engine.createIKChain(slideId, [root.id, child.id], { position: { x: 200, y: 0 } })
    const ghostNodeId = chain.ghostNodeId!
    useIKSelectionStore.getState().selectChain(chain.id)
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionX' }, 0, 200)

    useEditingModeStore.getState().setMode('ikTarget')
    const interaction = createInteraction(engine, dispatcher, canvas, sceneId)
    interaction.attach()
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 300, clientY: 100 }))

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      BLOCKED_ANIMATED_MOVE_MESSAGE,
    ])
    expect(engine.getNode(ghostNodeId).transform).toMatchObject({ x: 200, y: 0 })
    interaction.detach()
  })

  it('updates existing keyframes when dragging at same time in Animation Mode', () => {
    const { engine, dispatcher, canvas, slideId, sceneId } = setup()
    const root = createBoneNode(engine, 'Root', engine.project!.slides[0].scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    // Create IK chain with ghost node
    const chain = engine.createIKChain(slideId, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })
    const ghostNodeId = chain.ghostNodeId!

    // Select the chain for IK interaction
    useIKSelectionStore.getState().selectChain(chain.id)

    // Enable Animation Mode
    useUiStore.setState({ animationMode: true, cameraAnimationMode: false })

    // Set playhead time
    const slide = engine.project!.slides[0]
    usePlaybackController.getState().setCurrentTime(slideId, 1.0, slide.duration)

    // Create initial keyframes
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionX' }, 1.0, 200)
    engine.addKeyframe({ kind: 'node', nodeId: ghostNodeId, property: 'positionY' }, 1.0, 0)

    const interaction = createInteraction(engine, dispatcher, canvas, sceneId)
    interaction.attach()

    // Simulate mousedown on the IK handle position
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        clientX: 200,
        clientY: 0,
      }),
    )

    // Simulate mousemove to new position
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 350,
        clientY: 150,
      }),
    )

    // Simulate mouseup
    window.dispatchEvent(new MouseEvent('mouseup'))

    // Check that keyframes were updated
    const positionXKeyframes = engine.getKeyframes(ghostNodeId, 'positionX')
    const positionYKeyframes = engine.getKeyframes(ghostNodeId, 'positionY')

    expect(positionXKeyframes.length).toBe(1)
    expect(positionYKeyframes.length).toBe(1)

    expect(positionXKeyframes[0].time).toBe(1.0)
    expect(positionXKeyframes[0].value).toBe(350)

    expect(positionYKeyframes[0].time).toBe(1.0)
    expect(positionYKeyframes[0].value).toBe(150)

    interaction.detach()
  })
})
