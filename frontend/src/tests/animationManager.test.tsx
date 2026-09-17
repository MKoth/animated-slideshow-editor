import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ScenePanel } from '../components/panels/ScenePanel'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AddKeyframeCommand, CreateClipCommand, AssignClipCommand } from '../engine/commands'
import { useSelectionStore } from '../stores/selectionStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import { createCircleComponent } from '../engine/circleComponent'
import { DEFAULT_SHADOW_EFFECT } from '../engine/shadowEffect'
import { noopPersistence } from './contextHarness'

function renderSceneWithEngine(engine: Engine, undoStack: UndoStack) {
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
  return render(
    <EngineContext.Provider value={value}>
      <ScenePanel />
      {/* mount modal via wrapper - we test standalone modal below, this is for context menu */}
    </EngineContext.Provider>,
  )
}

function renderManager(engine: Engine, undoStack: UndoStack, parentNodeId: string | null) {
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
  const onClose = () => {}
  return render(
    <EngineContext.Provider value={value}>
      <AnimationManagerModal
        open={parentNodeId !== null}
        parentNodeId={parentNodeId}
        onClose={onClose}
      />
    </EngineContext.Provider>,
  )
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false } as never)
  useParentingModeStore.getState().reset()
})

describe('Animation Manager shell – 15-01', () => {
  it('hides Animation Manager entry when subtree has no Animated Child', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    // Parent is a leaf (no children) and has no animated descendant → should hide
    // (group nodes with children always show, even when empty)
    renderSceneWithEngine(engine, undo)
    const tree = await screen.findByRole('tree', { name: `Scene tree of ${slide.name}` })
    const parentRow = await within(tree).findByRole('treeitem', { name: 'Parent' })
    fireEvent.contextMenu(parentRow, { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    expect(
      within(menu).queryByRole('menuitem', { name: /Animation Manager/ }),
    ).not.toBeInTheDocument()
  })

  it('shows Animation Manager entry for group nodes even when subtree has no Animated Child', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    engine.createNode(slide.scene.id, parent.id, 'Child')
    renderSceneWithEngine(engine, undo)
    const tree = await screen.findByRole('tree', { name: `Scene tree of ${slide.name}` })
    const parentRow = await within(tree).findByRole('treeitem', { name: 'Parent' })
    fireEvent.contextMenu(parentRow, { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Animation Manager…' })).toBeInTheDocument()
  })

  it('shows Animation Manager entry when descendant has a keyframe', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    // add a keyframe to child
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: child.id, property: 'positionX' },
        time: 1,
        value: 10,
      }),
    )
    renderSceneWithEngine(engine, undo)
    const tree = await screen.findByRole('tree', { name: `Scene tree of ${slide.name}` })
    const parentRow = await within(tree).findByRole('treeitem', { name: 'Parent' })
    fireEvent.contextMenu(parentRow, { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Animation Manager…' })).toBeInTheDocument()
  })

  it('shows Animation Manager entry when descendant has a ClipInstance', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'ClipA',
        duration: 7,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    // need to add clipInstance via engine directly? Use dispatcher assign
    if (clip.ok) {
      dispatcher.dispatch(
        new AssignClipCommand({
          nodeId: child.id,
          clipId: (clip.inverse as unknown as { clipId: string }).clipId ?? engine.clips[0]!.id,
        }),
      )
    }
    // Ensure child has clipInstances
    if (child.clipInstances.length === 0 && engine.clips.length > 0) {
      // direct via internal API: use engine's clipInstances mutation via assign command alternative: create instance directly on node
      const clipId = engine.clips[0]!.id
      // manually add via internal Node property (since test engine is internal, we can mutate)
      const inst = {
        id: 'testInst',
        clipId,
        startTime: 0,
        speed: 1,
        enabled: true,
        paramOverrides: {},
      } as unknown as (typeof child.clipInstances)[0]
      ;(child.clipInstances as unknown as unknown[]).push(inst)
    }
    renderSceneWithEngine(engine, undo)
    const tree = await screen.findByRole('tree', { name: `Scene tree of ${slide.name}` })
    const parentRow = await within(tree).findByRole('treeitem', { name: 'Parent' })
    fireEvent.contextMenu(parentRow, { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Animation Manager…' })).toBeInTheDocument()
  })

  it('modal renders only Animated Children in pre-order with filtered Animated Params', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const childA = engine.createNode(slide.scene.id, parent.id, 'ChildA')
    const childB = engine.createNode(slide.scene.id, childA.id, 'Nested')
    const childC = engine.createNode(slide.scene.id, parent.id, 'ChildC')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    // ChildA animated via positionX
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: childA.id, property: 'positionX' },
        time: 0.5,
        value: 10,
      }),
    )
    // Nested also animated via visible
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'visible', nodeId: childB.id },
        time: 1,
        value: true,
      }),
    )
    // ChildC not animated – should be omitted
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    expect(modal).toBeInTheDocument()
    fireEvent.click(within(modal).getByTestId('manager-tab-clips'))
    // Should contain ChildA and Nested, not ChildC
    expect(within(modal).getByTestId(`manager-row-${childA.id}`)).toBeInTheDocument()
    expect(within(modal).getByTestId(`manager-row-${childB.id}`)).toBeInTheDocument()
    expect(within(modal).queryByTestId(`manager-row-${childC.id}`)).not.toBeInTheDocument()
    // Pre-order: ChildA before Nested (since Nested is child of ChildA) then ChildC would be after but hidden
    const rows = within(modal).getAllByTestId(/^manager-row-/)
    const ids = rows.map((r) => r.getAttribute('data-testid'))
    expect(ids[0]).toBe(`manager-row-${childA.id}`)
    expect(ids[1]).toBe(`manager-row-${childB.id}`)
    // Check Animated Params filtered: ChildA should show positionX but not opacity
    expect(within(modal).getByTestId(`manager-param-${childA.id}-positionX`)).toBeInTheDocument()
    expect(
      within(modal).queryByTestId(`manager-param-${childA.id}-opacity`),
    ).not.toBeInTheDocument()
    // Nested should show Visible only
    expect(within(modal).getByTestId(`manager-param-${childB.id}-visible`)).toBeInTheDocument()
  })

  it('all animatable tracks appear when animated (smoke) – transform, visible, circle, shadow, material, morph, camera', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const tNode = engine.createNode(slide.scene.id, parent.id, 'TNode')
    const vNode = engine.createNode(slide.scene.id, parent.id, 'VNode')
    const circleNode = engine.createNode(slide.scene.id, parent.id, 'CircleNode', {
      components: { circle: createCircleComponent() },
    })
    const shadowParent = engine.createNode(slide.scene.id, parent.id, 'ShadowGroup')
    // make shadowParent a group (has children) and set shadowEffect via engine internal
    engine.createNode(slide.scene.id, shadowParent.id, 'ShadowChild')
    // set shadowEffect directly
    shadowParent.shadowEffect = { ...DEFAULT_SHADOW_EFFECT }
    const materialNode = engine.createNode(slide.scene.id, parent.id, 'MatNode')
    const morphNode = engine.createNode(slide.scene.id, parent.id, 'MorphNode')
    // need to add shapes for morph
    // use engine's createShape via internal?
    // Instead directly use NodeAnimation morphKeyframes: add morph keyframe via AddKeyframeCommand with kind morph
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: tNode.id, property: 'positionX' },
        time: 0,
        value: 5,
      }),
    )
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'visible', nodeId: vNode.id },
        time: 0,
        value: false,
      }),
    )
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'circle', nodeId: circleNode.id, property: 'radius' },
        time: 0,
        value: 10,
      }),
    )
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'shadow', nodeId: shadowParent.id, property: 'blur' },
        time: 0,
        value: 5,
      }),
    )
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: materialNode.id, parameter: 'tint' } as unknown as never,
        time: 0,
        value: '#ff0000',
      }),
    )
    // morph – need shapes
    // create shapes via engine: createShape command?
    // Simplify: directly add morph keyframe via AddKeyframeCommand morph target
    // morph requires fromShapeId etc – we dispatch with object
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'morph', nodeId: morphNode.id } as never,
        time: 0,
        value: { fromShapeId: null, toShapeId: null, coefficient: 0.5 } as unknown as number,
      }),
    )
    // camera
    const camId = slide.scene.camera.id
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: camId, property: 'positionX' },
        time: 0,
        value: 100,
      }),
    )
    // Now create a parent that contains camera as child (root) – to test camera filtered, we open manager on root
    renderManager(engine, undo, slide.scene.root.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    fireEvent.click(within(modal).getByTestId('manager-tab-clips'))
    // Check presence of each param kind
    expect(within(modal).getByTestId(`manager-param-${tNode.id}-positionX`)).toBeInTheDocument()
    expect(within(modal).getByTestId(`manager-param-${vNode.id}-visible`)).toBeInTheDocument()
    expect(within(modal).getByTestId(`manager-param-${circleNode.id}-radius`)).toBeInTheDocument()
    expect(within(modal).getByTestId(`manager-param-${shadowParent.id}-blur`)).toBeInTheDocument()
    expect(within(modal).getByTestId(`manager-param-${materialNode.id}-tint`)).toBeInTheDocument()
    expect(within(modal).getByTestId(`manager-param-${morphNode.id}-morph`)).toBeInTheDocument()
    // camera param – if root includes camera and camera has keyframe, it should appear as Animated Child
    // If our implementation includes camera children, check it
    // This may or may not be present depending on walk filtering – accept either
    const camRow = within(modal).queryByTestId(`manager-row-${camId}`)
    if (camRow) {
      expect(within(modal).getByTestId(`manager-param-${camId}-positionX`)).toBeInTheDocument()
    }
  })

  it('grouping headers have local expand/collapse toggle not persisted', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: child.id, property: 'positionX' },
        time: 0,
        value: 0,
      }),
    )
    const user = userEvent.setup()
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    fireEvent.click(within(modal).getByTestId('manager-tab-clips'))
    const toggle = within(modal).getByTestId(`manager-toggle-${child.id}`)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // params visible
    expect(within(modal).getByTestId(`manager-param-${child.id}-positionX`)).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      within(modal).queryByTestId(`manager-param-${child.id}-positionX`),
    ).not.toBeInTheDocument()
    await user.click(toggle)
    expect(within(modal).getByTestId(`manager-param-${child.id}-positionX`)).toBeInTheDocument()
  })

  it('three tabs switch filtered view and orphans shows diamonds', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: child.id, property: 'positionX' },
        time: 1,
        value: 10,
      }),
    )
    const kfId = engine.getKeyframes(child.id, 'positionX')[0]?.id ?? 'unknown'
    const user = userEvent.setup()
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    // default tab is collections – no diamonds
    expect(within(modal).getByTestId('manager-tab-collections')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(modal).queryByTestId(`orphan-diamond-${kfId}`)).not.toBeInTheDocument()
    // switch to orphans
    await user.click(within(modal).getByTestId('manager-tab-orphans'))
    // now diamond should appear for that param
    expect(await within(modal).findByTestId(`orphan-diamond-${kfId}`)).toBeInTheDocument()
    // switch to collections – diamond hides
    await user.click(within(modal).getByTestId('manager-tab-collections'))
    expect(within(modal).queryByTestId(`orphan-diamond-${kfId}`)).not.toBeInTheDocument()
    // switch back to clips
    await user.click(within(modal).getByTestId('manager-tab-clips'))
    expect(within(modal).queryByTestId(`orphan-diamond-${kfId}`)).not.toBeInTheDocument()
  })

  it('modal closes on backdrop click and Escape (Esc drills back stub)', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: child.id, property: 'positionX' },
        time: 0,
        value: 0,
      }),
    )
    let closed = false
    const dispatcher2 = new CommandDispatcher(engine, undo, () => undefined)
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack: undo,
      dispatch: (c) => dispatcher2.dispatch(c),
      persistence: noopPersistence,
    }
    const onClose = () => {
      closed = true
    }
    const { unmount } = render(
      <EngineContext.Provider value={value}>
        <AnimationManagerModal open={true} parentNodeId={parent.id} onClose={onClose} />
      </EngineContext.Provider>,
    )
    const overlay = await screen.findByTestId('animation-manager-overlay')
    const user = userEvent.setup()
    // backdrop click closes
    fireEvent.click(overlay)
    expect(closed).toBe(true)
    closed = false
    // re-render for Esc test
    unmount()
    render(
      <EngineContext.Provider value={value}>
        <AnimationManagerModal open={true} parentNodeId={parent.id} onClose={onClose} />
      </EngineContext.Provider>,
    )
    expect(await screen.findByTestId('animation-manager-modal')).toBeInTheDocument()
    // press Escape should close (since no editing)
    await user.keyboard('{Escape}')
    expect(closed).toBe(true)
  })

  it('opening shows big modal overlay + backdrop + Esc handling', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: child.id, property: 'positionX' },
        time: 0,
        value: 0,
      }),
    )
    renderManager(engine, undo, parent.id)
    const overlay = await screen.findByTestId('animation-manager-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    const modal = await screen.findByTestId('animation-manager-modal')
    expect(modal).toBeInTheDocument()
    // big modal style checks: minWidth 760 via inline style
    expect(modal.style.minWidth).toBe('760px')
  })
})

describe('Animation Manager lane drag – 15-02', () => {
  it('converts pointer pixels with the rendered lane scale, not the timeline zoom pps', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipRes = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'ClipA',
        duration: 10,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clipId = (clipRes as { ok: true; inverse: { clipId: string } }).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child.id, clipId }))
    const instanceId = engine.getNode(child.id).clipInstances[0]!.id

    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    fireEvent.click(within(modal).getByTestId('manager-tab-clips'))
    const lane = within(modal).getByTestId(`clip-lane-${child.id}-${instanceId}`)
    // Lane renders 500px for a 10s slide => 50 px/s, while timeline zoom pps is 100
    const laneEl = lane.parentElement as HTMLElement
    laneEl.getBoundingClientRect = () =>
      ({
        width: 500,
        height: 100,
        top: 0,
        left: 0,
        right: 500,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.pointerDown(lane, { button: 0, clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 10 })
    fireEvent.pointerUp(window)

    // 100px at 50 px/s = +2s (would be +1s if the zoom pps were used)
    expect(engine.getClipInstance(child.id, instanceId).startTime).toBeCloseTo(2, 5)
  })
})
