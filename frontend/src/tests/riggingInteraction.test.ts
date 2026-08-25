import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CreateNodeCommand } from '../engine/commands'
import { RiggingInteraction } from '../pixi/renderer/riggingInteraction'
import { useEditingModeStore } from '../stores/editingModeStore'

function setup(): { engine: Engine; canvas: HTMLCanvasElement; sceneId: string } {
  const engine = createEngine()
  engine.createProject({ name: 'Test Project' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')

  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect
  return { engine, canvas, sceneId: slide.scene.id }
}

function click(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  canvas.dispatchEvent(new MouseEvent('click', { button: 0, clientX, clientY }))
}

function createInteraction(
  engine: Engine,
  canvas: HTMLCanvasElement,
  sceneId: string,
  commands: unknown[],
): RiggingInteraction {
  return new RiggingInteraction({
    canvas,
    engine,
    getScene: () => engine.getScene(sceneId),
    getCameraTransform: () => ({ x: 0, y: 0, scaleX: 1, scaleY: 1 }),
    dispatch: (command) => {
      commands.push(command)
      return undefined as never
    },
  })
}

describe('rigging interaction', () => {
  beforeEach(() => {
    useEditingModeStore.getState().setMode('boneCreation')
  })

  afterEach(() => {
    useEditingModeStore.getState().exitMode()
  })

  it('creates a bone from two points with matching length and rotation', () => {
    const { engine, canvas, sceneId } = setup()
    const commands: unknown[] = []
    const interaction = createInteraction(engine, canvas, sceneId, commands)
    interaction.attach()

    click(canvas, 10, 20)
    expect(commands).toHaveLength(0)

    click(canvas, 40, 60)

    expect(commands).toHaveLength(1)
    expect((commands[0] as CreateNodeCommand).toJSON()).toMatchObject({
      type: 'CreateNode',
      transform: {
        x: 10,
        y: 20,
        rotation: Math.atan2(40, 30),
        scaleX: 1,
        scaleY: 1,
      },
      components: { bone: { kind: 'bone', length: 50 } },
    })
    interaction.detach()
  })

  it('cancels the pending first point on Escape', () => {
    const { engine, canvas, sceneId } = setup()
    const commands: unknown[] = []
    const interaction = createInteraction(engine, canvas, sceneId, commands)
    interaction.attach()

    click(canvas, 10, 20)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    click(canvas, 40, 60)

    expect(commands).toHaveLength(0)
    interaction.detach()
  })
})
