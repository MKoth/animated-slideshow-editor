/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { DispatchCommand } from '../engine/commands'
import { useSelectionStore } from '../stores/selectionStore'
import { HandleInteraction } from '../pixi/renderer/handleInteraction'
import { worldTransformOf } from '../engine/worldTransform'
import {
  orientedCornersForSelection,
  rotationHandleForSelection,
} from '../pixi/renderer/selectionOverlay'

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }) as DOMRect
  return canvas
}

function harness(): any {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project!.slides[0]
  const canvas = makeCanvas()
  const sizes = new Map<string, { width: number; height: number }>()
  const getNodeSize = (id: string) => sizes.get(id) ?? null
  const getWorldTransform = (id: string) => {
    return worldTransformOf(slide.scene, id)
  }
  const dispatcher = new CommandDispatcher(engine, new UndoStack(), vi.fn())
  const dispatch: DispatchCommand = (c) => dispatcher.dispatch(c)
  const handle = new HandleInteraction({
    canvas,
    engine: engine as unknown as never,
    getScene: () => slide.scene,
    getCameraTransform: () => ({ x: 0, y: 0, scaleX: 1, scaleY: 1 }),
    getNodeSize,
    getWorldTransform,
    store: useSelectionStore,
    dispatch,
  })
  handle.attach()
  const h: any = {
    engine,
    slide,
    canvas,
    sizes,
    getNodeSize,
    getWorldTransform,
    dispatch,
    handle,
    dispatcher,
  }
  activeHandles.push(h)
  return h
}

function nodeAt(
  h: ReturnType<typeof harness>,
  name: string,
  x = 300,
  y = 200,
  rotation = 0,
  scaleX = 1,
  scaleY = 1,
): string {
  const created = h.engine.createNode(h.slide.scene.id, h.slide.scene.root.id, name, {
    transform: { x, y, rotation, scaleX, scaleY },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  h.sizes.set(created.id, { width: 160, height: 100 })
  return created.id
}

function fireMouse(target: Window | HTMLElement, type: string, opts: MouseEventInit): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...opts })
  target.dispatchEvent(event)
}

let activeHandles: any[] = []
beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})
afterEach(() => {
  for (const h of activeHandles) {
    try {
      h.handle.detach()
    } catch {
      // ignore
    }
  }
  activeHandles = []
})

describe('handle interaction', () => {
  it('scales uniformly from corner handle (br) dragging', () => {
    const h = harness()
    const id = nodeAt(h, 'Box', 300, 200)
    useSelectionStore.getState().select(id)
    // br handle at 380,250 (300+80,200+50)
    fireMouse(h.canvas, 'mousedown', { button: 0, clientX: 380, clientY: 250, bubbles: true })
    // move to 400,260 (increase width 20, height 10)
    fireMouse(window, 'mousemove', { clientX: 400, clientY: 260 } as unknown as MouseEventInit)
    fireMouse(window, 'mouseup', { clientX: 400, clientY: 260 } as unknown as MouseEventInit)
    const t = h.engine.getNode(id).transform
    // Should have scaled up (uniform, so both scales increase)
    expect(t.scaleX).toBeGreaterThan(1)
    expect(t.scaleY).toBeGreaterThan(1)
    // Uniform: scaleX approx equal scaleY (since corner uniform, factor from hypot)
    expect(Math.abs(t.scaleX - t.scaleY)).toBeLessThan(0.05)
    // Position should have moved to keep opposite corner (tl at 220,150) fixed?
    // tl originally 220,150, after scale, tl should stay near 220,150, so pivot (300,200) should shift?
    // For scale from opposite (tl fixed), br moves, center moves. So pivot moves.
    expect(t.x).not.toBe(300)
  })

  it('scales axially from edge handle (r) without shift', () => {
    const h = harness()
    const id = nodeAt(h, 'Box', 300, 200)
    useSelectionStore.getState().select(id)
    // r handle at 380,200
    fireMouse(h.canvas, 'mousedown', { button: 0, clientX: 380, clientY: 200 })
    fireMouse(window, 'mousemove', { clientX: 420, clientY: 200 })
    fireMouse(window, 'mouseup', { clientX: 420, clientY: 200 })
    const t = h.engine.getNode(id).transform
    expect(t.scaleX).toBeGreaterThan(1)
    expect(t.scaleY).toBeCloseTo(1, 1)
  })

  it('scales uniformly from edge with shift', () => {
    const h = harness()
    const id = nodeAt(h, 'Box', 300, 200)
    useSelectionStore.getState().select(id)
    fireMouse(h.canvas, 'mousedown', { button: 0, clientX: 380, clientY: 200 })
    fireMouse(window, 'mousemove', {
      clientX: 420,
      clientY: 200,
      shiftKey: true,
    } as unknown as MouseEventInit)
    fireMouse(window, 'mouseup', { clientX: 420, clientY: 200 } as unknown as MouseEventInit)
    const t = h.engine.getNode(id).transform
    expect(t.scaleX).toBeGreaterThan(1)
    // Shift makes uniform, so scaleY should also increase
    expect(t.scaleY).toBeGreaterThan(1)
    expect(Math.abs(t.scaleX - t.scaleY)).toBeLessThan(0.1)
  })

  it('scales from center with alt', () => {
    const h = harness()
    const id = nodeAt(h, 'Box', 300, 200)
    useSelectionStore.getState().select(id)
    // br handle 380,250, opposite is tl 220,150, center 300,200
    // With alt, anchor is center, so dragging br 20px out should increase scale half as much as opposite anchor case?
    // We'll test that position stays at center (pivot at 300,200 with pivot 0 => pivot at center, so center = pivot)
    // For alt scaling, center should stay fixed, so pivot should stay at 300,200 (since pivot is center)
    fireMouse(h.canvas, 'mousedown', { button: 0, clientX: 380, clientY: 250 })
    fireMouse(window, 'mousemove', {
      clientX: 400,
      clientY: 260,
      altKey: true,
    } as unknown as MouseEventInit)
    fireMouse(window, 'mouseup', { clientX: 400, clientY: 260 } as unknown as MouseEventInit)
    const t = h.engine.getNode(id).transform
    expect(t.scaleX).toBeGreaterThan(1)
    // With alt, center fixed, so position should stay near 300,200 (since pivot is center)
    expect(t.x).toBeCloseTo(300, 0)
    expect(t.y).toBeCloseTo(200, 0)
  })

  it('rotates via rotation handle', () => {
    const h = harness()
    const id = nodeAt(h, 'Box', 300, 200)
    useSelectionStore.getState().select(id)
    // rotation handle 24px above top center: top center (300,150), handle (300,126)
    fireMouse(h.canvas, 'mousedown', { button: 0, clientX: 300, clientY: 126 })
    // drag to the right 90deg around pivot (300,200): move to (376,200) (to the right)
    fireMouse(window, 'mousemove', { clientX: 376, clientY: 200 })
    fireMouse(window, 'mouseup', { clientX: 376, clientY: 200 })
    const t = h.engine.getNode(id).transform
    // rotation should have changed from 0 to ~90deg (pi/2) or -?
    // Initial angle from pivot to handle: atan2(126-200,300-300)=atan2(-74,0)=-pi/2
    // New angle to (376,200): atan2(0,76)=0 => delta = pi/2
    expect(Math.abs(t.rotation)).toBeCloseTo(Math.PI / 2, 1)
  })

  it('rotation respects pivot', () => {
    const h = harness()
    // create node with pivot at top-left? pivot 0.5,0.5? Actually pivot normalized offset from center. For test, set pivot at -0.5,-0.5 (top-left)
    const id = h.engine.createNode(h.slide.scene.id, h.slide.scene.root.id, 'PivotBox', {
      transform: {
        x: 300,
        y: 200,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        localPivot: { x: -0.5, y: -0.5 },
      },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    }).id
    h.sizes.set(id, { width: 160, height: 100 })
    useSelectionStore.getState().select(id)
    // For pivot at top-left, pivot world is at 300,200 should correspond to top-left corner of bounds (220,150?) Wait compute: pivotOffset -0.5*160=-80, -0.5*100=-50 => pivot at top-left corner. So bounds goes from 300,200 to 460,300.
    // Top center of bounds is at? corners computed with pivot top-left => handle rotation offset etc. But pivot is at 300,200.
    // Rotation should be around 300,200.
    fireMouse(h.canvas, 'mousedown', {
      button: 0,
      clientX: 380,
      clientY: 126,
    } as unknown as MouseEventInit) // approximate top center handle?
    // Instead directly test that after rotation, pivot stays at 300,200
    const world = h.getWorldTransform(id)!
    const corners = orientedCornersForSelection({ width: 160, height: 100 }, world, {
      x: -0.5,
      y: -0.5,
    })!
    const rh = rotationHandleForSelection(corners, world.rotation)!
    fireMouse(h.canvas, 'mousedown', { button: 0, clientX: rh.x, clientY: rh.y })
    fireMouse(window, 'mousemove', { clientX: rh.x + 50, clientY: rh.y })
    fireMouse(window, 'mouseup', { clientX: rh.x + 50, clientY: rh.y })
    const t = h.engine.getNode(id).transform
    expect(t.x).toBeCloseTo(300, 0)
    expect(t.y).toBeCloseTo(200, 0)
    expect(t.rotation).not.toBe(0)
  })
})
