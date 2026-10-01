import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { Renderer } from '../../pixi/renderer/renderer'
import { SceneRenderer } from '../../pixi/renderer/sceneRenderer'
import type { CurrentTimeSource } from '../../pixi/renderer/sceneRenderer'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'
import { pixiRegistry } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

describe('Renderer playback time updates', () => {
  it('refreshes deformed mesh sizes once and applies mesh deformation', async () => {
    const system = createCommandSystem()
    const listeners = new Set<() => void>()
    const currentTime: CurrentTimeSource = {
      getTime: () => 0,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const renderer = new Renderer(
      document.createElement('div'),
      system.engine,
      undefined,
      undefined,
      undefined,
      currentTime,
    )
    const refreshSizes = vi.spyOn(SceneRenderer.prototype, 'refreshDeformedMeshSizes')
    const evaluateMeshDeformation = vi.spyOn(system.engine, 'evaluateMeshDeformation')
    useOverlayVisibilityStore.getState().setMeshVisible(false)

    try {
      await renderer.start()
      system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Playback refresh test' }))
      system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
      const slide = system.engine.project?.slides[0]
      if (!slide) throw new Error('Slide was not created')
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Mesh',
          components: {
            mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(100, 100) },
          },
        }),
      )

      const callsBeforePlaybackFrame = refreshSizes.mock.calls.length
      const deformationCallsBeforePlaybackFrame = evaluateMeshDeformation.mock.calls.length
      for (const listener of listeners) listener()

      expect(refreshSizes.mock.calls.length - callsBeforePlaybackFrame).toBe(1)
      expect(evaluateMeshDeformation.mock.calls.length).toBeGreaterThan(
        deformationCallsBeforePlaybackFrame,
      )
    } finally {
      renderer.dispose()
      refreshSizes.mockRestore()
      evaluateMeshDeformation.mockRestore()
      useOverlayVisibilityStore.getState().setMeshVisible(true)
    }
  })
})
