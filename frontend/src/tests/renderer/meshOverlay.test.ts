import { describe, expect, it, vi } from 'vitest'
import { createEngine } from '../../engine/internal'
import * as mesh from '../../engine/mesh'
import { MeshOverlay } from '../../pixi/renderer/meshOverlay'
import type { PixiContainer, RendererPixi } from '../../pixi/renderer/pixi'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'
import { FakeContainer, FakeGraphics, createPixiFake } from './pixiFake'

describe('MeshOverlay', () => {
  it('draws shared mesh edges once in a batched stroke', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Mesh overlay test' })
    const slide = engine.createSlide('Slide 1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh', {
      components: {
        mesh: { kind: 'mesh', mesh: mesh.createDefaultRectangleMesh(100, 100) },
      },
    })
    useOverlayVisibilityStore.getState().setMeshVisible(true)

    const world = new FakeContainer()
    const overlay = new MeshOverlay({
      pixi: createPixiFake() as unknown as RendererPixi,
      world: world as unknown as PixiContainer,
      engine,
      getScene: () => slide.scene,
    })
    const extractEdges = vi.spyOn(mesh, 'extractEdges')

    try {
      overlay.attach()

      const graphics = world.children.find((child) => child.label === 'mesh-overlay') as
        FakeGraphics | undefined
      expect(graphics).toBeDefined()
      expect(graphics!.calls.filter((call) => call.method === 'lineTo')).toHaveLength(5)
      expect(graphics!.calls.filter((call) => call.method === 'stroke')).toHaveLength(1)
      expect(extractEdges).toHaveBeenCalledTimes(1)

      overlay.redraw()

      expect(extractEdges).toHaveBeenCalledTimes(1)
    } finally {
      overlay.detach()
      extractEdges.mockRestore()
    }
  })
})
