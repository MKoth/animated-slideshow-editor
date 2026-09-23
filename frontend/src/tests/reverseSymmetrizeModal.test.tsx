import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import { ReverseSymmetrizeModal } from '../components/panels/ReverseSymmetrizeModal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'

interface Harness {
  readonly engine: import('../engine/internal').Engine
  readonly dispatcher: CommandDispatcher
  readonly headId: string
  readonly leftId: string
  readonly rightId: string
  readonly onClose: ReturnType<typeof vi.fn>
}

function renderModal(options?: {
  readonly leafRoot?: boolean
  readonly rightKeys?: boolean
}): Harness {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  const value: import('../app/engineContext').EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(
      dispatcher,
    ) as import('../app/engineContext').EngineContextValue['dispatch'],
    persistence: noopPersistence,
  }
  engine.createProject({ name: 'P' })
  engine.createSlide()
  const slide = engine.getActiveSlide()!
  const head = engine.createNode(slide.scene.id, slide.scene.root.id, 'Head')
  const left = engine.createNode(slide.scene.id, head.id, 'Left Ear', {
    transform: { x: -50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  })
  const right = engine.createNode(slide.scene.id, head.id, 'Right Ear', {
    transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  })
  engine.addKeyframe({ kind: 'node', nodeId: left.id, property: 'positionX' }, 6, -80)
  engine.addKeyframe({ kind: 'node', nodeId: left.id, property: 'positionX' }, 7, -90)
  if (options?.rightKeys) {
    engine.addKeyframe({ kind: 'node', nodeId: right.id, property: 'positionX' }, 6, 70)
    engine.addKeyframe({ kind: 'node', nodeId: right.id, property: 'positionX' }, 7, 90)
  }
  usePlaybackController.setState({ currentTimes: { [slide.id]: 7 } })

  const onClose = vi.fn()
  render(
    <EngineContext.Provider value={value}>
      <ReverseSymmetrizeModal
        open
        rootNodeId={options?.leafRoot ? left.id : head.id}
        onClose={onClose}
      />
    </EngineContext.Provider>,
  )
  return { engine, dispatcher, headId: head.id, leftId: left.id, rightId: right.id, onClose }
}

interface MorphHarness extends Harness {
  readonly leftShapeId: string
  readonly leftShapeMirrorId: string
}

function renderMorphModal(options?: {
  readonly unmatched?: boolean
  readonly leafRoot?: boolean
  readonly siblingMorph?: boolean
}): MorphHarness {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  const value: import('../app/engineContext').EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(
      dispatcher,
    ) as import('../app/engineContext').EngineContextValue['dispatch'],
    persistence: noopPersistence,
  }
  engine.createProject({ name: 'P' })
  engine.createSlide()
  const slide = engine.getActiveSlide()!
  const head = engine.createNode(slide.scene.id, slide.scene.root.id, 'Head')
  const left = engine.createNode(slide.scene.id, head.id, 'Left Ear', {
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
  })
  const right = engine.createNode(slide.scene.id, head.id, 'Right Ear', {
    components: {
      mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(options?.unmatched ? 20 : 10, 10) },
    },
  })
  const category = engine.createShapeCategory(right.id, 'Ears', null)
  const shape = engine.createShape(left.id, 'ear_L')
  const shapeMirror = options?.unmatched
    ? // Different geometry, different name — nothing can guess this counterpart.
      engine.createShape(right.id, 'blob')
    : engine.copyShapeToNode(left.id, shape.id, right.id, {
        mirrored: true,
        axis: 'x',
        name: 'ear_R',
        categoryId: category.id,
      })
  engine.addKeyframe({ kind: 'morph', nodeId: left.id }, 4, {
    fromShapeId: shape.id,
    toShapeId: null,
    coefficient: 0.5,
  })
  if (options?.siblingMorph) {
    engine.addKeyframe({ kind: 'morph', nodeId: right.id }, 4, {
      fromShapeId: shapeMirror.id,
      toShapeId: null,
      coefficient: 0.25,
    })
  }
  usePlaybackController.setState({ currentTimes: { [slide.id]: 5 } })

  const onClose = vi.fn()
  render(
    <EngineContext.Provider value={value}>
      <ReverseSymmetrizeModal
        open
        rootNodeId={options?.leafRoot ? left.id : head.id}
        onClose={onClose}
      />
    </EngineContext.Provider>,
  )
  return {
    engine,
    dispatcher,
    headId: head.id,
    leftId: left.id,
    rightId: right.id,
    leftShapeId: shape.id,
    leftShapeMirrorId: shapeMirror.id,
    onClose,
  }
}

describe('ReverseSymmetrizeModal', () => {
  beforeEach(() => {
    usePlaybackController.setState({ currentTimes: {}, status: 'stopped' })
  })

  it('lists the subtree and preselects the guessed sibling', () => {
    const { headId, leftId, rightId } = renderModal()
    expect(screen.getByTestId('reverse-symmetrize-modal')).toBeInTheDocument()
    expect(screen.getByTestId(`reverse-symmetrize-row-${headId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`reverse-symmetrize-row-${leftId}`)).toBeInTheDocument()
    expect(
      (screen.getByTestId(`reverse-symmetrize-type-${leftId}`) as HTMLSelectElement).value,
    ).toBe('sibling')
    expect(
      (screen.getByTestId(`reverse-symmetrize-sibling-${leftId}`) as HTMLSelectElement).value,
    ).toBe(rightId)
    expect(
      (screen.getByTestId(`reverse-symmetrize-type-${headId}`) as HTMLSelectElement).value,
    ).toBe('self')
  })

  it('defaults the center to the playhead and the range to the keyframe span', () => {
    renderModal()
    expect((screen.getByTestId('reverse-symmetrize-center') as HTMLInputElement).value).toBe('7')
    expect((screen.getByTestId('reverse-symmetrize-from') as HTMLInputElement).value).toBe('6')
    expect((screen.getByTestId('reverse-symmetrize-to') as HTMLInputElement).value).toBe('7')
  })

  it('mirrors the source keyframes onto the sibling on confirm', () => {
    const { engine, leftId, rightId, onClose } = renderModal()
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(engine.getKeyframes(rightId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [7, 50],
      [8, 40],
    ])
    expect(engine.getKeyframes(leftId, 'positionX')).toHaveLength(2)
  })

  it('switches a row to self mode and mirrors onto itself', () => {
    const { engine, leftId, onClose } = renderModal()
    fireEvent.change(screen.getByTestId(`reverse-symmetrize-type-${leftId}`), {
      target: { value: 'self' },
    })
    expect(
      (screen.getByTestId(`reverse-symmetrize-sibling-${leftId}`) as HTMLSelectElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(engine.getKeyframes(leftId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [6, -80],
      [7, -90],
      [8, -100],
    ])
  })

  it('requires a sibling when a row is marked as having one', () => {
    const { headId, onClose } = renderModal()
    fireEvent.change(screen.getByTestId(`reverse-symmetrize-type-${headId}`), {
      target: { value: 'sibling' },
    })
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('reverse-symmetrize-error')).toHaveTextContent('Select a sibling')
  })

  it('reports nothing to mirror when the range excludes every keyframe', () => {
    renderModal()
    fireEvent.change(screen.getByTestId('reverse-symmetrize-from'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('reverse-symmetrize-to'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(screen.getByTestId('reverse-symmetrize-error')).toHaveTextContent('Nothing to mirror')
  })

  it('preselects the guessed morph shape (with category groups) and mirrors it on confirm', () => {
    const { engine, leftId, rightId, leftShapeId, leftShapeMirrorId, onClose } = renderMorphModal()
    expect(screen.queryByTestId(`reverse-symmetrize-shapes-${leftId}`)).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId(`reverse-symmetrize-shapes-toggle-${leftId}`))
    const select = screen.getByTestId(
      `reverse-symmetrize-shape-${leftId}-${leftShapeId}`,
    ) as HTMLSelectElement
    expect(select.value).toBe(leftShapeMirrorId)
    const groupLabels = [...select.querySelectorAll('optgroup')].map((group) =>
      group.getAttribute('label'),
    )
    expect(groupLabels).toContain('Ears')

    fireEvent.change(screen.getByTestId('reverse-symmetrize-center'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(engine.getMorphKeyframes(rightId).map((kf) => [kf.time, kf.value])).toEqual([
      [8, { fromShapeId: leftShapeMirrorId, toShapeId: null, coefficient: 0.5 }],
    ])
  })

  it('exchanges mirrored keys in both directions across a sibling pair', () => {
    const { engine, leftId, rightId, onClose } = renderModal({ rightKeys: true })

    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(engine.getKeyframes(leftId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [6, -80],
      [7, -90],
      [8, -70],
    ])
    expect(engine.getKeyframes(rightId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [6, 70],
      [7, 90],
      [8, 80],
    ])
  })

  it('applies the sibling keys to the selected object when only it is selected', () => {
    const { engine, leftId, rightId, onClose } = renderModal({ leafRoot: true, rightKeys: true })

    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(engine.getKeyframes(leftId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [6, -80],
      [7, -90],
      [8, -70],
    ])
    expect(engine.getKeyframes(rightId, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [6, 70],
      [7, 90],
      [8, 80],
    ])
  })

  it('shows the sibling shape group for a leaf selection and mirrors its shapes back', () => {
    const { engine, leftId, rightId, leftShapeId, leftShapeMirrorId, onClose } = renderMorphModal({
      leafRoot: true,
      siblingMorph: true,
    })
    fireEvent.click(screen.getByTestId(`reverse-symmetrize-shapes-toggle-${leftId}`))
    expect(screen.getByTestId(`reverse-symmetrize-shapes-sibling-${leftId}`)).toHaveTextContent(
      'Right Ear',
    )
    expect(
      (
        screen.getByTestId(
          `reverse-symmetrize-shape-${leftId}-${leftShapeMirrorId}`,
        ) as HTMLSelectElement
      ).value,
    ).toBe(leftShapeId)

    fireEvent.change(screen.getByTestId('reverse-symmetrize-center'), { target: { value: '6' } })
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(engine.getMorphKeyframes(leftId).map((kf) => [kf.time, kf.value])).toEqual([
      [4, { fromShapeId: leftShapeId, toShapeId: null, coefficient: 0.5 }],
      [8, { fromShapeId: leftShapeId, toShapeId: null, coefficient: 0.25 }],
    ])
    expect(engine.getMorphKeyframes(rightId).map((kf) => [kf.time, kf.value])).toEqual([
      [4, { fromShapeId: leftShapeMirrorId, toShapeId: null, coefficient: 0.25 }],
      [8, { fromShapeId: leftShapeMirrorId, toShapeId: null, coefficient: 0.5 }],
    ])
  })

  it('blocks confirm when a referenced morph shape has no symmetrical counterpart', () => {
    const { onClose } = renderMorphModal({ unmatched: true })
    fireEvent.click(screen.getByTestId('reverse-symmetrize-confirm'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('reverse-symmetrize-error')).toHaveTextContent(
      'Select a symmetrical shape',
    )
  })

  it('counts opacity, zIndex, and morph keyframes in the range and row summary', () => {
    const { engine, headId, leftId, rightId } = renderMorphModal()
    engine.addKeyframe({ kind: 'node', nodeId: leftId, property: 'opacity' }, 5, 0.5)
    engine.addKeyframe({ kind: 'zIndex', nodeId: rightId }, 3, 2)

    fireEvent.change(screen.getByTestId('reverse-symmetrize-from'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('reverse-symmetrize-to'), { target: { value: '6' } })
    // Pairs exchange both directions, so each row shows the pair's total.
    expect(screen.getByTestId(`reverse-symmetrize-row-${leftId}`)).toHaveTextContent(
      '3 keyframe(s) in range',
    )
    expect(screen.getByTestId(`reverse-symmetrize-row-${rightId}`)).toHaveTextContent(
      '3 keyframe(s) in range',
    )
    expect(screen.getByTestId(`reverse-symmetrize-row-${headId}`)).toHaveTextContent(
      '0 keyframe(s) in range',
    )
  })
})
