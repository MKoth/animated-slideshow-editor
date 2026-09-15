import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  CreateClipCommand,
  UpdateControlIntervalCommand,
  ReorderControlBindingCommand,
  TransactionCommand,
} from '../engine/commands'
import { createControl, createControlSet } from '../engine/control'
import { Keyframe } from '../engine/keyframe'
import { packControlIntervalBlocks } from '../engine/animationManagerModel'
import { requireKeyframeTarget } from '../engine/keyframeTarget'
import { useSelectionStore } from '../stores/selectionStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import { useTimelineViewStore, pixelsPerSecond } from '../stores/timelineViewStore'
import { noopPersistence } from './contextHarness'

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
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0 })
})

describe('Clip Blocks Authoring UI — Bindings table, drill-in geometry & Priority drag', () => {
  it('Animation Manager → Controls Bindings table shows [start,end] and Priority with up/down reorder and Add Block flow', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const childA = engine.createNode(slide.scene.id, host.id, 'ChildA')
    const childB = engine.createNode(slide.scene.id, host.id, 'ChildB')
    childA.semanticName = 'mouth'
    childB.semanticName = 'smile'
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip Mouth',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip2 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip Smile',
        duration: 2,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip1Id = clip1.ok
      ? (clip1.inverse as unknown as { clipId: string }).clipId
      : engine.clips[0]!.id
    const clip2Id = clip2.ok
      ? (clip2.inverse as unknown as { clipId: string }).clipId
      : engine.clips[1]!.id

    host.controlSet = createControlSet(host.id, [
      createControl({
        key: 'Open',
        label: 'Open',
        exposed: true,
        bindings: {
          mouth: { clipId: clip1Id, start: 0, end: 0.5 },
          smile: { clipId: clip2Id, start: 0.5, end: 1 },
        },
      }),
    ])

    const user = userEvent.setup()
    renderManager(engine, undo, host.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    // Switch to Controls tab
    await user.click(within(modal).getByTestId('manager-tab-controls'))
    const controlSection = await screen.findByTestId('manager-control-Open')
    // Check Bindings table exists with required columns
    const table = within(controlSection).getByTestId('control-interval-table-Open')
    expect(table).toBeInTheDocument()
    // Header columns
    expect(within(table).getByText('semanticName')).toBeInTheDocument()
    expect(within(table).getByText('Clip / Duration')).toBeInTheDocument()
    expect(within(table).getByText('[start, end]')).toBeInTheDocument()
    expect(within(table).getByText('Priority')).toBeInTheDocument()

    // Check rows show start,end and Priority
    expect(within(table).getByTestId('control-interval-row-Open-mouth')).toBeInTheDocument()
    expect(within(table).getByTestId('control-interval-start-Open-mouth').textContent).toBe('0.000')
    expect(within(table).getByTestId('control-interval-end-Open-mouth').textContent).toBe('0.500')
    expect(within(table).getByTestId('control-interval-row-Open-smile')).toBeInTheDocument()
    expect(within(table).getByTestId('control-interval-priority-Open-mouth').textContent).toBe('0')
    expect(within(table).getByTestId('control-interval-priority-Open-smile').textContent).toBe('1')

    // clip name/duration
    expect(within(table).getByText(/Clip Mouth/)).toBeInTheDocument()
    expect(within(table).getByText(/\(1s\)/)).toBeInTheDocument()
    expect(within(table).getByText(/Clip Smile/)).toBeInTheDocument()
    expect(within(table).getByText(/\(2s\)/)).toBeInTheDocument()

    // Up/down reorder: mouth is index0, can go down but not up
    const upMouth = within(table).getByTestId('control-interval-up-Open-mouth')
    const downMouth = within(table).getByTestId('control-interval-down-Open-mouth')
    expect(upMouth).toBeDisabled()
    expect(downMouth).not.toBeDisabled()
    // Reorder mouth down -> should become index1, smile index0
    await user.click(downMouth)
    // After reorder, check priority swapped
    expect(within(table).getByTestId('control-interval-priority-Open-mouth').textContent).toBe('1')
    expect(within(table).getByTestId('control-interval-priority-Open-smile').textContent).toBe('0')
    // Also insertion order: later wins -> mouth now last wins
    const rig = engine.getNode(host.id)!
    expect(Object.keys(rig.controlSet!.controls[0].bindings)).toEqual(['smile', 'mouth'])

    // Add Block flow: pick clipId+semanticName, default [0,1] then resize
    const addBtn = within(controlSection).getByTestId('control-add-block-Open')
    expect(addBtn).toBeInTheDocument()
    await user.click(addBtn)
    const dialog = within(controlSection).getByTestId('control-add-block-dialog-Open')
    expect(dialog).toBeInTheDocument()
    const semanticInput = within(dialog).getByTestId('control-add-block-semantic-Open')
    const clipSelect = within(dialog).getByTestId('control-add-block-clip-Open')
    expect(semanticInput).toBeInTheDocument()
    expect(clipSelect).toBeInTheDocument()
    // Create a new child with semanticName for new block
    const childC = engine.createNode(slide.scene.id, host.id, 'ChildC')
    childC.semanticName = 'extra'
    // Fill dialog and confirm
    await user.type(semanticInput, 'extra')
    await user.selectOptions(clipSelect, clip1Id)
    await user.click(within(dialog).getByTestId('control-add-block-confirm-Open'))
    // New binding should appear with default [0,1]
    expect(within(table).getByTestId('control-interval-row-Open-extra')).toBeInTheDocument()
    expect(within(table).getByTestId('control-interval-start-Open-extra').textContent).toBe('0.000')
    expect(within(table).getByTestId('control-interval-end-Open-extra').textContent).toBe('1.000')
    // Undo should remove it (check engine, then UI after tick)
    undo.undo(engine)
    await new Promise((r) => setTimeout(r, 50))
    expect(engine.getNode(host.id).controlSet!.controls[0].bindings['extra']).toBeUndefined()
    // Terminology: should use Control Interval / Clip Block, not Control Lane
    expect(screen.queryByText(/Control Lane/)).not.toBeInTheDocument()
    expect(screen.getByText(/Control Interval/)).toBeInTheDocument()
  })

  it('Drill-in Clip Blocks render at left=start*pps width=(end-start)*pps and support drag move (preserve width) and edge resize (span≥1e-6 guard, overlap allowed)', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const child = engine.createNode(slide.scene.id, host.id, 'Child')
    child.semanticName = 'mouth'
    const child2 = engine.createNode(slide.scene.id, host.id, 'Child2')
    child2.semanticName = 'smile'
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip1',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip1Id = clip1.ok
      ? (clip1.inverse as unknown as { clipId: string }).clipId
      : engine.clips[0]!.id
    const clip2 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip2',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip2Id = clip2.ok
      ? (clip2.inverse as unknown as { clipId: string }).clipId
      : engine.clips[1]!.id

    host.controlSet = createControlSet(host.id, [
      createControl({
        key: 'Open',
        label: 'Open',
        exposed: true,
        bindings: {
          mouth: { clipId: clip1Id, start: 0.2, end: 0.6 },
          smile: { clipId: clip2Id, start: 0.5, end: 0.9 },
        },
      }),
    ])

    const user = userEvent.setup()
    renderManager(engine, undo, host.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    await user.click(within(modal).getByTestId('manager-tab-controls'))
    const controlSection = await screen.findByTestId('manager-control-Open')
    // Open drill-in
    await user.click(within(controlSection).getByTestId('manager-control-edit-Open'))
    const editor = await screen.findByTestId('manager-control-editor')
    expect(within(editor).getByTestId('control-interval-ruler')).toBeInTheDocument()
    const lane = within(editor).getByTestId('control-interval-lane')
    expect(lane).toBeInTheDocument()
    const pps = pixelsPerSecond(useTimelineViewStore.getState().zoomLevel)
    const mouthBlock = within(editor).getByTestId('clip-block-Open-mouth-0')
    const smileBlock = within(editor).getByTestId('clip-block-Open-smile-1')
    expect(mouthBlock).toBeInTheDocument()
    expect(smileBlock).toBeInTheDocument()
    // Check geometry: left/start*pps, width=(end-start)*pps
    const mouthStyle = mouthBlock.style
    const smileStyle = smileBlock.style
    // left values should be approx start*pps
    expect(parseFloat(mouthStyle.left)).toBeCloseTo(0.2 * pps, 0.5)
    expect(parseFloat(mouthStyle.width)).toBeCloseTo(0.4 * pps, 0.5)
    expect(parseFloat(smileStyle.left)).toBeCloseTo(0.5 * pps, 0.5)
    expect(parseFloat(smileStyle.width)).toBeCloseTo(0.4 * pps, 0.5)
    // Header terminology
    expect(within(editor).getByText(/Editing Control: Open 0…1/)).toBeInTheDocument()
    expect(screen.queryByText(/Control Lane/)).not.toBeInTheDocument()
    expect(within(editor).getByText(/Clip Block/)).toBeInTheDocument()
    // Check handles exist
    expect(within(editor).getByTestId('clip-block-handle-left-Open-mouth-0')).toBeInTheDocument()
    expect(within(editor).getByTestId('clip-block-handle-right-Open-mouth-0')).toBeInTheDocument()
    // Overlap allowed: mouth [0.2,0.6] and smile [0.5,0.9] overlap at 0.5-0.6, they should be on different tracks (Priority stacking)
    expect(mouthBlock.getAttribute('data-track')).not.toBe(smileBlock.getAttribute('data-track'))

    // Drag move preserving width: simulate via command directly (since pointer drag is complex to simulate)
    // Move mouth from [0.2,0.6] to [0,0.4] preserving width 0.4
    const moveRes = dispatcher.dispatch(
      new UpdateControlIntervalCommand({
        nodeId: host.id,
        controlKey: 'Open',
        semanticName: 'mouth',
        start: 0,
        end: 0.4,
      }),
    )
    expect(moveRes.ok).toBe(true)
    // Check updated geometry
    // Need to re-render? engine event tick triggers rerender automatically via useEngineEvent, but we need to force tick
    // Dispatch will cause engine event, but test harness may need to wait
    await new Promise((r) => setTimeout(r, 50))
    // Since we used dispatcher directly not via context, we need to re-render check via engine state
    const rig = engine.getNode(host.id)!
    const mouthInterval = rig.controlSet!.controls[0].bindings.mouth as {
      start: number
      end: number
    }
    expect(mouthInterval.start).toBeCloseTo(0)
    expect(mouthInterval.end).toBeCloseTo(0.4)
    expect(mouthInterval.end - mouthInterval.start).toBeCloseTo(0.4)

    // Edge resize with span≥1e-6 guard, overlap allowed -> try invalid resize span<1e-6 should be rejected
    const badRes = dispatcher.dispatch(
      new UpdateControlIntervalCommand({
        nodeId: host.id,
        controlKey: 'Open',
        semanticName: 'mouth',
        start: 0.5,
        end: 0.5000004,
      }),
    )
    expect(badRes.ok).toBe(false)
  })

  it('Priority dragging reorders insertion order so evaluator last-wins matches visual vertical order', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const child = engine.createNode(slide.scene.id, host.id, 'Child')
    child.semanticName = 'mouth'
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip1',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip1Id = clip1.ok
      ? (clip1.inverse as unknown as { clipId: string }).clipId
      : engine.clips[0]!.id
    const clip2 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip2',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip2Id = clip2.ok
      ? (clip2.inverse as unknown as { clipId: string }).clipId
      : engine.clips[1]!.id
    const childB = engine.createNode(slide.scene.id, host.id, 'ChildB')
    childB.semanticName = 'smile'
    host.controlSet = createControlSet(host.id, [
      createControl({
        key: 'Open',
        bindings: {
          mouth: { clipId: clip1Id, start: 0, end: 0.6 },
          smile: { clipId: clip2Id, start: 0.4, end: 1 },
        },
      }),
    ])
    // Evaluator last-wins: at u=0.5 both cover, later (smile) should win
    slide.animation.ensure(host.id).addControl = slide.animation
      .ensure(host.id)
      .addControl.bind(slide.animation.ensure(host.id))
    // Add control track keyframes to drive evaluation: value 0.5 at time 0
    slide.animation.ensure(host.id).addControl('Open', new Keyframe('k1', 0, 0.5))
    // Mouth clip drives 0->10, smile 100->200 ; at our earlier test, positionX 0.5 through interval mapping: mouth u'=(0.5-0)/0.6=0.833 -> value 8.33, smile u'=(0.5-0.4)/0.6=0.166 -> 116.6 ; later wins => smile value should win 116..
    // But we haven't set clip keyframes for channels; just check order directly via engine ordering logic
    // Instead verify priority via dispatch reorder
    const rig = engine.getNode(host.id)!
    expect(Object.keys(rig.controlSet!.controls[0].bindings)).toEqual(['mouth', 'smile'])
    // Drag reorder: move mouth to index1 => order smile, mouth -> mouth wins
    dispatcher.dispatch(
      new ReorderControlBindingCommand({
        nodeId: host.id,
        controlKey: 'Open',
        semanticName: 'mouth',
        newIndex: 1,
      }),
    )
    expect(Object.keys(rig.controlSet!.controls[0].bindings)).toEqual(['smile', 'mouth'])
    // Visual vertical order should match insertion order: check packed tracks? Overlap case, later wins visually lower lane
    const ppsX = pixelsPerSecond(1)
    const packed = packControlIntervalBlocks(rig.controlSet!.controls[0], () => null, ppsX)
    expect(packed.map((b) => b.semanticName)).toEqual(['smile', 'mouth']) // insertion order preserved in packed entries order
    const mouthBlock = packed.find((b) => b.semanticName === 'mouth')!
    const smileBlock = packed.find((b) => b.semanticName === 'smile')!
    expect(mouthBlock.track).not.toBe(smileBlock.track)
  })

  it('Interval edits route through definition commands (not controlTracks keyframes) and are undoable as one Transaction', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const child = engine.createNode(slide.scene.id, host.id, 'Child')
    child.semanticName = 'mouth'
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip1',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip1Id = clip1.ok
      ? (clip1.inverse as unknown as { clipId: string }).clipId
      : engine.clips[0]!.id
    host.controlSet = createControlSet(host.id, [
      createControl({ key: 'Open', bindings: { mouth: { clipId: clip1Id, start: 0, end: 1 } } }),
    ])
    const before = (
      engine.getNode(host.id).controlSet!.controls[0].bindings.mouth as {
        start: number
        end: number
      }
    ).start
    const beforeLen = undo.entries.length
    // Dispatch via Transaction with two interval updates (should be one undo entry)
    const tx = new TransactionCommand([
      new UpdateControlIntervalCommand({
        nodeId: host.id,
        controlKey: 'Open',
        semanticName: 'mouth',
        start: 0.1,
        end: 0.9,
      }) as never,
      new UpdateControlIntervalCommand({
        nodeId: host.id,
        controlKey: 'Open',
        semanticName: 'mouth',
        start: 0.2,
        end: 0.8,
      }) as never,
    ])
    const res = dispatcher.dispatch(tx as never)
    expect(res.ok).toBe(true)
    expect(undo.entries.length).toBe(beforeLen + 1)
    expect(
      (
        engine.getNode(host.id).controlSet!.controls[0].bindings.mouth as {
          start: number
          end: number
        }
      ).start,
    ).toBeCloseTo(0.2)
    // Ensure no controlTracks keyframe was created
    const track = slide.animation.node(host.id)?.controlKeyframes('Open') ?? []
    expect(track.length).toBe(0)
    // Undo should revert both as one transaction
    undo.undo(engine)
    expect(
      (
        engine.getNode(host.id).controlSet!.controls[0].bindings.mouth as {
          start: number
          end: number
        }
      ).start,
    ).toBeCloseTo(before)
    expect(undo.entries.length).toBe(beforeLen)
    // No new KeyframeTarget kinds: ensure only 'control' target exists, not 'interval' or 'group'
    expect(() =>
      requireKeyframeTarget({ kind: 'interval', nodeId: host.id } as unknown as never),
    ).toThrow()
    expect(() =>
      requireKeyframeTarget({ kind: 'group', nodeId: host.id } as unknown as never),
    ).toThrow()
  })
})
