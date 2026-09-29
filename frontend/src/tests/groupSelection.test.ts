import { beforeEach, describe, expect, it } from 'vitest'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { SceneNode } from '../engine'
import { groupSizeOf } from '../pixi/renderer/groupBounds'
import type { NodeSizeSource } from '../pixi/renderer/hitTest'
import { nodesAtSorted, nodesIntersectingRect, topmostNodeAt } from '../pixi/renderer/hitTest'
import { worldTransformOf } from '../engine/worldTransform'
import { CanvasSelection } from '../pixi/renderer/canvasSelection'
import type { ViewportTransform, WorldPoint } from '../pixi/renderer/worldGeometry'
import { getShortcutHandler } from '../shortcuts/shortcutRegistry'
import { useSelectionStore } from '../stores/selectionStore'

const LEAF = { width: 100, height: 60 }

function setup(): { engine: Engine; scene: SceneNode['parent'] } {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return { engine, scene: slide.scene as unknown as SceneNode['parent'] }
}

function leaf(
  engine: Engine,
  name: string,
  parentId: string,
  transform: SceneNode['transform'],
  known: Set<string>,
): SceneNode {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const created = engine.createNode(slide.scene.id, parentId, name, {
    transform,
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  known.add(created.id)
  return created
}

function group(engine: Engine, name: string, parentId: string, x = 0, y = 0): SceneNode {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return engine.createNode(slide.scene.id, parentId, name, {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function sceneOf(engine: Engine) {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return slide.scene
}

function baseSizes(known: Set<string>): NodeSizeSource {
  return (nodeId) => (known.has(nodeId) ? LEAF : null)
}

function groupAwareSizes(engine: Engine, known: Set<string>): NodeSizeSource {
  const base = baseSizes(known)
  return (nodeId) => {
    const direct = base(nodeId)
    if (direct) {
      return direct
    }
    const scene = sceneOf(engine)
    return groupSizeOf(scene, nodeId, base, (id) => worldTransformOf(scene, id))
  }
}

const IDENTITY = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

describe('groupSizeOf', () => {
  it('returns null for non-groups and empty groups', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const single = leaf(engine, 'Single', scene.root.id, { ...IDENTITY }, known)
    const empty = group(engine, 'Empty', scene.root.id)

    const sizes = baseSizes(known)
    const transformOf = (id: string) => worldTransformOf(scene, id)
    expect(groupSizeOf(scene, single.id, sizes, transformOf)).toBeNull()
    expect(groupSizeOf(scene, empty.id, sizes, transformOf)).toBeNull()
  })

  it('derives the union bounds of scattered children with center offset', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const parent = group(engine, 'Group', scene.root.id)
    leaf(engine, 'Left', parent.id, { ...IDENTITY, x: -100, y: 0 }, known)
    leaf(engine, 'Right', parent.id, { ...IDENTITY, x: 100, y: 0 }, known)

    const size = groupSizeOf(scene, parent.id, baseSizes(known), (id) =>
      worldTransformOf(scene, id),
    )
    // Children span [-150, 150] x [-30, 30] in group-local space.
    expect(size?.width).toBeCloseTo(300)
    expect(size?.height).toBeCloseTo(60)
    expect(size?.offsetX).toBeCloseTo(0)
    expect(size?.offsetY).toBeCloseTo(0)
  })

  it('offsets the union when children sit away from the group origin', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const parent = group(engine, 'Group', scene.root.id)
    leaf(engine, 'Child', parent.id, { ...IDENTITY, x: 200, y: 100 }, known)

    const size = groupSizeOf(scene, parent.id, baseSizes(known), (id) =>
      worldTransformOf(scene, id),
    )
    expect(size?.width).toBeCloseTo(100)
    expect(size?.height).toBeCloseTo(60)
    expect(size?.offsetX).toBeCloseTo(200)
    expect(size?.offsetY).toBeCloseTo(100)
  })

  it('includes nested group leaves through the top group', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const outer = group(engine, 'Outer', scene.root.id)
    const inner = group(engine, 'Inner', outer.id)
    leaf(engine, 'Deep', inner.id, { ...IDENTITY, x: 50, y: 0 }, known)

    const size = groupSizeOf(scene, outer.id, baseSizes(known), (id) => worldTransformOf(scene, id))
    expect(size?.width).toBeCloseTo(100)
    expect(size?.offsetX).toBeCloseTo(50)
  })
})

describe('nodesAtSorted', () => {
  it('prefers an explicitly higher zIndex over later tree order', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const behind = leaf(engine, 'Behind', scene.root.id, { ...IDENTITY }, known)
    const front = leaf(engine, 'Front', scene.root.id, { ...IDENTITY }, known)
    engine.setZIndex(front.id, 10)

    const sizes = baseSizes(known)
    // Without z info the later sibling wins; with evaluated z the front wins
    // regardless of insertion order.
    expect(topmostNodeAt(scene, { x: 0, y: 0 }, sizes)).toBe(front.id)
    engine.setZIndex(front.id, 0)
    engine.setZIndex(behind.id, 5)
    expect(
      topmostNodeAt(scene, { x: 0, y: 0 }, sizes, undefined, null, (id) => engine.getZIndex(id)),
    ).toBe(behind.id)
  })

  it('prefers the smaller area when stacking is equal', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const big = engine.createNode(scene.id, scene.root.id, 'Big', {
      transform: { ...IDENTITY },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    known.add(big.id)
    const small = engine.createNode(scene.id, scene.root.id, 'Small', {
      transform: { ...IDENTITY, scaleX: 0.2, scaleY: 0.2 },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    known.add(small.id)

    // Big was inserted first so legacy last-wins pre-order picks Small here
    // too — but the point is the contract: smallest wins on equal stacking.
    expect(topmostNodeAt(scene, { x: 0, y: 0 }, baseSizes(known))).toBe(small.id)
  })

  it('ranks a leaf above its ancestor group so cycling can reach the group', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const parent = group(engine, 'Group', scene.root.id)
    const child = leaf(engine, 'Child', parent.id, { ...IDENTITY }, known)

    const sorted = nodesAtSorted(scene, { x: 0, y: 0 }, groupAwareSizes(engine, known))
    expect(sorted[0]).toBe(child.id)
    expect(sorted).toContain(parent.id)
  })

  it('marquee selection stays leaf-only around grouped content', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const parent = group(engine, 'Group', scene.root.id)
    const child = leaf(engine, 'Child', parent.id, { ...IDENTITY, x: 300, y: 200 }, known)

    const ids = nodesIntersectingRect(
      scene,
      { minX: 200, minY: 150, maxX: 400, maxY: 250 },
      groupAwareSizes(engine, known),
    )
    expect(ids).toContain(child.id)
    expect(ids).not.toContain(parent.id)
  })
})

describe('canvas group interactions', () => {
  function mountCanvas(engine: Engine, sizes: NodeSizeSource) {
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const viewport: ViewportTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
    const canvas = document.createElement('canvas')
    const selection = new CanvasSelection({
      canvas,
      getScene: () => slide.scene,
      getCameraTransform: () => viewport,
      getNodeSize: sizes,
      store: { ...useSelectionStore.getState() },
    })
    selection.attach()
    return { canvas, selection }
  }

  function click(canvas: HTMLCanvasElement, point: WorldPoint, options = {}): void {
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: point.x,
        clientY: point.y,
        ...options,
      }),
    )
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: point.x, clientY: point.y }),
    )
  }

  function mouseDown(canvas: HTMLCanvasElement, point: WorldPoint): void {
    canvas.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: point.x, clientY: point.y }),
    )
  }

  function mouseMove(point: WorldPoint): void {
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: point.x, clientY: point.y }),
    )
  }

  function mouseUp(point: WorldPoint): void {
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: point.x, clientY: point.y }),
    )
  }

  function mountMovable(engine: Engine, sizes: NodeSizeSource) {
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const viewport: ViewportTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
    const canvas = document.createElement('canvas')
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const previewPositions = new Map<string, WorldPoint>()
    const selection = new CanvasSelection({
      canvas,
      getScene: () => slide.scene,
      getCameraTransform: () => viewport,
      getNodeSize: sizes,
      store: { ...useSelectionStore.getState() },
      dispatch: (command) => dispatcher.dispatch(command),
      preview: {
        setPosition: (nodeId, x, y) => {
          previewPositions.set(nodeId, { x, y })
        },
        clear: () => {
          previewPositions.clear()
        },
      },
      getWorldTransform: (nodeId) => worldTransformOf(slide.scene, nodeId),
    })
    selection.attach()
    return { canvas, selection }
  }

  beforeEach(() => {
    useSelectionStore.setState({ selectedIds: [] })
  })

  it('repeat-clicks cycle through stacked objects', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    leaf(engine, 'Behind', scene.root.id, { ...IDENTITY }, known)
    const frontId = leaf(engine, 'Front', scene.root.id, { ...IDENTITY }, known).id
    const { canvas, selection } = mountCanvas(engine, baseSizes(known))

    click(canvas, { x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([frontId])

    click(canvas, { x: 0, y: 0 })
    const second = useSelectionStore.getState().selectedIds
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(frontId)

    selection.detach()
  })

  it('slow repeat-clicks on the same spot still cycle (deliberate pace)', async () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    leaf(engine, 'Behind', scene.root.id, { ...IDENTITY }, known)
    const frontId = leaf(engine, 'Front', scene.root.id, { ...IDENTITY }, known).id
    const { canvas, selection } = mountCanvas(engine, baseSizes(known))

    click(canvas, { x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([frontId])

    // A user clicks, looks at the result, then clicks again — well past a
    // double-click interval.
    await new Promise((resolve) => setTimeout(resolve, 900))

    click(canvas, { x: 0, y: 0 })
    const second = useSelectionStore.getState().selectedIds
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(frontId)

    selection.detach()
  })

  it('escape climbs from a grouped child to its parent group', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const parent = group(engine, 'Group', scene.root.id)
    const child = leaf(engine, 'Child', parent.id, { ...IDENTITY }, known)
    const { selection } = mountCanvas(engine, groupAwareSizes(engine, known))

    useSelectionStore.getState().select(child.id)
    getShortcutHandler('escape')?.(new KeyboardEvent('keydown', { key: 'Escape' }) as KeyboardEvent)

    expect(useSelectionStore.getState().selectedIds).toEqual([parent.id])
    selection.detach()
  })

  it('mousedown alone selects nothing; the click applies on mouse-up', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const id = leaf(engine, 'Hero', scene.root.id, { ...IDENTITY }, known).id
    const { canvas, selection } = mountCanvas(engine, baseSizes(known))

    mouseDown(canvas, { x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([])

    mouseUp({ x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([id])

    selection.detach()
  })

  it('press-drag on a cycled (covered) selection moves it without re-picking', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const behindId = leaf(engine, 'Behind', scene.root.id, { ...IDENTITY }, known).id
    const frontId = leaf(engine, 'Front', scene.root.id, { ...IDENTITY }, known).id
    const { canvas, selection } = mountMovable(engine, baseSizes(known))

    // Cycle down to the covered object.
    click(canvas, { x: 0, y: 0 })
    click(canvas, { x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([behindId])

    // Pressing to drag must not re-pick the topmost object...
    mouseDown(canvas, { x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([behindId])

    // ...and the drag moves the selected (covered) object, not the front one.
    mouseMove({ x: 60, y: 40 })
    mouseUp({ x: 60, y: 40 })

    expect(useSelectionStore.getState().selectedIds).toEqual([behindId])
    expect(engine.getNode(behindId).transform.x).toBe(60)
    expect(engine.getNode(behindId).transform.y).toBe(40)
    expect(engine.getNode(frontId).transform.x).toBe(0)
    expect(engine.getNode(frontId).transform.y).toBe(0)

    selection.detach()
  })

  it('press-drag on an unselected node grabs and moves the topmost one', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    leaf(engine, 'Behind', scene.root.id, { ...IDENTITY }, known)
    const frontId = leaf(engine, 'Front', scene.root.id, { ...IDENTITY }, known).id
    const { canvas, selection } = mountMovable(engine, baseSizes(known))

    mouseDown(canvas, { x: 0, y: 0 })
    expect(useSelectionStore.getState().selectedIds).toEqual([])
    mouseMove({ x: 60, y: 40 })
    mouseUp({ x: 60, y: 40 })

    expect(useSelectionStore.getState().selectedIds).toEqual([frontId])
    expect(engine.getNode(frontId).transform.x).toBe(60)

    selection.detach()
  })

  it('clicking the empty interior of a selected group keeps the group', () => {
    const { engine } = setup()
    const known = new Set<string>()
    const scene = sceneOf(engine)
    const parent = group(engine, 'Group', scene.root.id)
    // Small child at origin; group interior extends beyond it.
    leaf(engine, 'Child', parent.id, { ...IDENTITY, x: -200, y: 0 }, known)
    leaf(engine, 'Other', parent.id, { ...IDENTITY, x: 200, y: 0 }, known)
    const sizes = groupAwareSizes(engine, known)
    const { canvas, selection } = mountCanvas(engine, sizes)

    useSelectionStore.getState().select(parent.id)
    // Middle of the group bounds: no leaf covers (0, 0) since children sit at ±200.
    click(canvas, { x: 0, y: 0 })

    expect(useSelectionStore.getState().selectedIds).toEqual([parent.id])
    selection.detach()
  })
})
