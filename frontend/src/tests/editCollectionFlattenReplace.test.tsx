import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { executeSegmentToCollection } from '../engine/timeSegmentExtraction'
import { noopPersistence } from './contextHarness'

function setupRig(engine: Engine) {
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  engine.getActiveSlide()!.duration = 20
  const slide = engine.getActiveSlide()!
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
  const left = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
  const right = engine.createNode(slide.scene.id, parent.id, 'RightHand')
  engine.setSemanticName(left.id, 'left_hand')
  engine.setSemanticName(right.id, 'right_hand')
  for (const [nodeId, times] of [
    [left.id, [1, 2, 3]],
    [right.id, [2, 3, 4]],
  ] as const) {
    for (const t of times) {
      engine.addKeyframe({ kind: 'node', nodeId, property: 'positionX' }, t, t * 10)
    }
  }
  return { parent, left, right }
}

function renderManager(
  engine: Engine,
  undoStack: UndoStack,
  dispatcher: CommandDispatcher,
  parentId: string,
) {
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <AnimationManagerModal open={true} parentNodeId={parentId} onClose={() => {}} />
    </EngineContext.Provider>,
  )
}

describe('Edit Clip Collection fine-grained editing', () => {
  it('shows Flatten and Replace buttons, flatten writes orphans with preview', async () => {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const { parent, left, right } = setupRig(engine)
    const readonlyEngine = toReadOnly(engine)
    // Mint a collection from [1,4] (deletes orphans)
    const leftKfs = engine.getKeyframes(left.id, 'positionX').map((kf) => ({
      target: { kind: 'node', nodeId: left.id, property: 'positionX' } as const,
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: { ...kf.tangentIn },
      tangentOut: { ...kf.tangentOut },
      keyframeId: kf.id,
    }))
    const rightKfs = engine.getKeyframes(right.id, 'positionX').map((kf) => ({
      target: { kind: 'node', nodeId: right.id, property: 'positionX' } as const,
      time: kf.time,
      value: kf.value,
      interpolation: kf.interpolation,
      tangentIn: { ...kf.tangentIn },
      tangentOut: { ...kf.tangentOut },
      keyframeId: kf.id,
    }))
    const created = executeSegmentToCollection(
      readonlyEngine,
      dispatcher.dispatch.bind(dispatcher),
      undoStack,
      {
        parentNodeId: parent.id,
        from: 1,
        to: 4,
        objects: [
          {
            nodeId: left.id,
            nodeName: 'LeftHand',
            semanticName: 'left_hand',
            clipName: 'L',
            category: 'left_hand',
            keyframes: leftKfs,
          },
          {
            nodeId: right.id,
            nodeName: 'RightHand',
            semanticName: 'right_hand',
            clipName: 'R',
            category: 'right_hand',
            keyframes: rightKfs,
          },
        ],
        collectionName: 'Rig',
        deleteOrphans: true,
        keepFirst: false,
        keepLast: false,
      },
    )
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('setup failed')

    renderManager(engine, undoStack, dispatcher, parent.id)

    // Go to Collections tab and open Edit
    fireEvent.click(screen.getByTestId('manager-tab-collections'))
    const colId = created.collectionId
    fireEvent.click(await screen.findByTestId(`collection-edit-${colId}`))
    expect(await screen.findByTestId('edit-collection-modal')).toBeInTheDocument()
    expect(screen.getByTestId('edit-collection-flatten')).toBeInTheDocument()
    expect(screen.getByTestId('edit-collection-replace')).toBeInTheDocument()

    // Open flatten, check preview defaults and confirm
    fireEvent.click(screen.getByTestId('edit-collection-flatten'))
    expect(await screen.findByTestId('flatten-modal')).toBeInTheDocument()
    // Default range inputs exist
    expect(screen.getByTestId('flatten-from-input')).toBeInTheDocument()
    expect(screen.getByTestId('flatten-to-input')).toBeInTheDocument()
    // Set an explicit clean range [5,8]
    fireEvent.change(screen.getByTestId('flatten-from-input'), { target: { value: '5' } })
    fireEvent.change(screen.getByTestId('flatten-to-input'), { target: { value: '8' } })
    const preview = await screen.findByTestId('flatten-preview')
    expect(preview.textContent).toMatch(/6 keyframe\(s\)/)
    fireEvent.click(screen.getByTestId('flatten-confirm'))
    await waitFor(() => {
      expect(screen.queryByTestId('flatten-modal')).not.toBeInTheDocument()
    })
    // Orphans written at natural duration
    const leftTimes = [...engine.getKeyframes(left.id, 'positionX')]
      .map((k) => k.time)
      .sort((a, b) => a - b)
    expect(leftTimes).toEqual([5, 6, 7])

    // Replace button opens the wizard in replace mode (locked name)
    fireEvent.click(screen.getByTestId('edit-collection-replace'))
    expect(await screen.findByTestId('segment-to-collection-modal')).toHaveAttribute(
      'aria-label',
      'Replace collection from time segment',
    )
    expect(screen.getByTestId('segment-collection-name-fixed').textContent).toMatch(/Rig/)
  })
})
