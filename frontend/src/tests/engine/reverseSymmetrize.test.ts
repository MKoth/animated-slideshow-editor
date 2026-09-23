import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import {
  buildReverseSymmetrizeCommands,
  guessMorphShapeMappings,
  guessSymmetricalShape,
  guessSymmetrySibling,
  hasMirrorableKeyframes,
  mirrorFlipsProperty,
  swapVerticalSemanticName,
} from '../../engine/reverseSymmetrize'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import { createDefaultRectangleMesh } from '../../engine/mesh'

interface Setup {
  readonly engine: Engine
  readonly dispatcher: CommandDispatcher
  readonly sceneId: string
  readonly rootId: string
}

function makeSetup(): Setup {
  const engine = createEngine()
  const dispatcher = new CommandDispatcher(engine, new UndoStack())
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('expected a slide')
  return { engine, dispatcher, sceneId: slide.scene.id, rootId: slide.scene.root.id }
}

function makeNode(
  setup: Setup,
  name: string,
  transform: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number } = {},
  semanticName?: string,
): string {
  const node = setup.engine.createNode(setup.sceneId, setup.rootId, name, {
    transform: {
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      rotation: transform.rotation ?? 0,
      scaleX: transform.scaleX ?? 1,
      scaleY: transform.scaleY ?? 1,
    },
    ...(semanticName !== undefined ? { semanticName } : {}),
  })
  return node.id
}

function makeMeshNode(setup: Setup, name: string, width = 10, height = 10): string {
  const node = setup.engine.createNode(setup.sceneId, setup.rootId, name, {
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(width, height) } },
  })
  return node.id
}

function positionKeyframe(engine: Engine, nodeId: string, time: number, value: number): void {
  engine.addKeyframe({ kind: 'node', nodeId, property: 'positionX' }, time, value)
}

function rotationKeyframe(engine: Engine, nodeId: string, time: number, value: number): void {
  engine.addKeyframe({ kind: 'node', nodeId, property: 'rotation' }, time, value)
}

function opacityKeyframe(engine: Engine, nodeId: string, time: number, value: number): void {
  engine.addKeyframe({ kind: 'node', nodeId, property: 'opacity' }, time, value)
}

function zIndexKeyframe(engine: Engine, nodeId: string, time: number, value: number): void {
  engine.addKeyframe({ kind: 'zIndex', nodeId }, time, value)
}

function morphKeyframe(
  engine: Engine,
  nodeId: string,
  time: number,
  fromShapeId: string | null,
  toShapeId: string | null,
  coefficient: number,
): void {
  engine.addKeyframe({ kind: 'morph', nodeId }, time, {
    fromShapeId,
    toShapeId,
    coefficient,
  })
}

function dispatchPlan(setup: Setup, plan: ReturnType<typeof buildReverseSymmetrizeCommands>): void {
  const result = dispatchKeyframeCommands(
    setup.dispatcher.dispatch.bind(setup.dispatcher),
    plan.commands,
  )
  if (result && !result.ok) throw new Error(result.error.message)
}

describe('mirrorFlipsProperty', () => {
  it('negates the axis position and always rotation', () => {
    expect(mirrorFlipsProperty('positionX', 'x')).toBe(true)
    expect(mirrorFlipsProperty('positionY', 'x')).toBe(false)
    expect(mirrorFlipsProperty('positionX', 'y')).toBe(false)
    expect(mirrorFlipsProperty('positionY', 'y')).toBe(true)
    expect(mirrorFlipsProperty('rotation', 'x')).toBe(true)
    expect(mirrorFlipsProperty('rotation', 'y')).toBe(true)
    expect(mirrorFlipsProperty('scaleX', 'x')).toBe(false)
    expect(mirrorFlipsProperty('scaleY', 'y')).toBe(false)
  })
})

describe('guessSymmetrySibling', () => {
  it('guesses the lateral sibling by name', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear')
    const right = makeNode(setup, 'Right Ear')
    expect(guessSymmetrySibling(setup.engine, left)?.id).toBe(right)
    expect(guessSymmetrySibling(setup.engine, right)?.id).toBe(left)
  })

  it('guesses by semantic name and returns null without a lateral match', () => {
    const setup = makeSetup()
    const armA = makeNode(setup, 'arm-a', {}, 'left_hand')
    const armB = makeNode(setup, 'arm-b', {}, 'right_hand')
    const torso = makeNode(setup, 'Torso')
    expect(guessSymmetrySibling(setup.engine, armA)?.id).toBe(armB)
    expect(guessSymmetrySibling(setup.engine, torso)).toBeNull()
  })
})

describe('hasMirrorableKeyframes', () => {
  it('detects transform keyframes on the subtree only', () => {
    const setup = makeSetup()
    const parent = makeNode(setup, 'Head')
    const child = makeNode(setup, 'Left Ear')
    setup.engine.reparentNode(child, parent)
    const idle = makeNode(setup, 'Idle')
    expect(hasMirrorableKeyframes(setup.engine, parent)).toBe(false)
    positionKeyframe(setup.engine, child, 1, 5)
    expect(hasMirrorableKeyframes(setup.engine, parent)).toBe(true)
    expect(hasMirrorableKeyframes(setup.engine, idle)).toBe(false)
  })

  it('detects keyframes on a guessed sibling of the subtree', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear')
    const right = makeNode(setup, 'Right Ear')
    expect(hasMirrorableKeyframes(setup.engine, left)).toBe(false)
    positionKeyframe(setup.engine, right, 1, 5)
    expect(hasMirrorableKeyframes(setup.engine, left)).toBe(true)
  })

  it('detects opacity, zIndex, and morph keyframes', () => {
    const setup = makeSetup()
    const faded = makeNode(setup, 'Faded')
    const ordered = makeNode(setup, 'Ordered')
    const morphed = makeMeshNode(setup, 'Morphed')
    const idle = makeNode(setup, 'Idle')
    expect(hasMirrorableKeyframes(setup.engine, faded)).toBe(false)
    opacityKeyframe(setup.engine, faded, 1, 0.5)
    expect(hasMirrorableKeyframes(setup.engine, faded)).toBe(true)
    zIndexKeyframe(setup.engine, ordered, 1, 3)
    expect(hasMirrorableKeyframes(setup.engine, ordered)).toBe(true)
    const shape = setup.engine.createShape(morphed, 'Blob')
    morphKeyframe(setup.engine, morphed, 1, shape.id, null, 0.5)
    expect(hasMirrorableKeyframes(setup.engine, morphed)).toBe(true)
    expect(hasMirrorableKeyframes(setup.engine, idle)).toBe(false)
  })
})

describe('buildReverseSymmetrizeCommands — sibling mode', () => {
  it('reflects the source delta against the center pose of both siblings', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear', { x: -50 })
    const right = makeNode(setup, 'Right Ear', { x: 50 })
    positionKeyframe(setup.engine, left, 6, -80)
    positionKeyframe(setup.engine, left, 7, -90)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: left,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: left, targetNodeId: right }],
    })
    expect(plan.summary.added).toBe(2)
    expect(plan.summary.updated).toBe(0)
    dispatchPlan(setup, plan)

    expect(setup.engine.getKeyframes(right, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [7, 50],
      [8, 40],
    ])
  })

  it('always negates rotation and copies the perpendicular axis as a delta', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear', { rotation: 0.2, y: 10 })
    const right = makeNode(setup, 'Right Ear', { rotation: 0.1, y: 20 })
    rotationKeyframe(setup.engine, left, 6, 0.5)
    rotationKeyframe(setup.engine, left, 7, 0.2)
    setup.engine.addKeyframe({ kind: 'node', nodeId: left, property: 'positionY' }, 6, 15)
    setup.engine.addKeyframe({ kind: 'node', nodeId: left, property: 'positionY' }, 7, 12)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: left,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: left, targetNodeId: right }],
    })
    dispatchPlan(setup, plan)

    const rotations = setup.engine.getKeyframes(right, 'rotation')
    expect(rotations.map((kf) => kf.time)).toEqual([7, 8])
    expect(rotations[0]!.value).toBeCloseTo(0.1)
    expect(rotations[1]!.value).toBeCloseTo(-0.2)
    expect(setup.engine.getKeyframes(right, 'positionY').map((kf) => [kf.time, kf.value])).toEqual([
      [7, 20],
      [8, 23],
    ])
  })

  it('overwrites an existing keyframe at the mirrored time', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear', { x: -50 })
    const right = makeNode(setup, 'Right Ear', { x: 50 })
    positionKeyframe(setup.engine, left, 6, -80)
    positionKeyframe(setup.engine, left, 7, -90)
    positionKeyframe(setup.engine, right, 7, 50)
    positionKeyframe(setup.engine, right, 8, 999)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: left,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: left, targetNodeId: right }],
    })
    expect(plan.summary.added).toBe(0)
    expect(plan.summary.updated).toBe(1)
    expect(plan.summary.unchanged).toBe(1)
    dispatchPlan(setup, plan)

    expect(setup.engine.getKeyframes(right, 'positionX').map((kf) => [kf.time, kf.value])).toEqual([
      [7, 50],
      [8, 40],
    ])
  })

  it('preserves interpolation and mirrors bezier tangents', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear', { x: -50 })
    const right = makeNode(setup, 'Right Ear', { x: 50 })
    const target = { kind: 'node' as const, nodeId: left, property: 'positionX' as const }
    const keyframe = setup.engine.addKeyframe(target, 6, -80)
    setup.engine.setKeyframeInterpolation(target, keyframe.id, 'bezier')
    setup.engine.setKeyframeTangents(
      target,
      keyframe.id,
      { time: -0.5, value: 2 },
      { time: 0.5, value: 3 },
    )

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: left,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: left, targetNodeId: right }],
    })
    dispatchPlan(setup, plan)

    const mirrored = setup.engine.getKeyframes(right, 'positionX')
    expect(mirrored).toHaveLength(1)
    expect(mirrored[0]!.time).toBe(8)
    expect(mirrored[0]!.interpolation).toBe('bezier')
    expect(mirrored[0]!.tangentIn).toEqual({ time: -0.5, value: 3 })
    expect(mirrored[0]!.tangentOut).toEqual({ time: 0.5, value: 2 })
  })

  it('rejects a camera target', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left Ear')
    positionKeyframe(setup.engine, left, 1, 5)
    const slide = setup.engine.getActiveSlide()!
    expect(() =>
      buildReverseSymmetrizeCommands(setup.engine, {
        rootNodeId: left,
        centerTime: 2,
        axis: 'x',
        from: 0,
        to: 3,
        rows: [{ sourceNodeId: left, targetNodeId: slide.scene.camera.id }],
      }),
    ).toThrow(/camera/i)
  })
})

describe('buildReverseSymmetrizeCommands — self mode', () => {
  it('reflects flipped channels about the center-time pose and leaves the rest alone', () => {
    const setup = makeSetup()
    const spinner = makeNode(setup, 'Windmill')
    rotationKeyframe(setup.engine, spinner, 4, 0.4)
    rotationKeyframe(setup.engine, spinner, 7, 0.5)
    setup.engine.addKeyframe({ kind: 'node', nodeId: spinner, property: 'positionY' }, 4, 5)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: spinner,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: spinner, targetNodeId: null }],
    })
    expect(plan.commands).toHaveLength(1)
    expect(plan.summary.added).toBe(1)
    expect(plan.summary.unchanged).toBe(1)
    dispatchPlan(setup, plan)

    expect(setup.engine.getKeyframes(spinner, 'rotation').map((kf) => [kf.time, kf.value])).toEqual(
      [
        [4, 0.4],
        [7, 0.5],
        [10, 0.6],
      ],
    )
    expect(setup.engine.getKeyframes(spinner, 'positionY')).toHaveLength(1)
  })
})

describe('buildReverseSymmetrizeCommands — verbatim channels', () => {
  it('copies opacity verbatim in self mode (no center-pose delta)', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Fade')
    opacityKeyframe(setup.engine, node, 4, 0.2)
    opacityKeyframe(setup.engine, node, 7, 0.6)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: node, targetNodeId: null }],
    })
    dispatchPlan(setup, plan)

    expect(setup.engine.getKeyframes(node, 'opacity').map((kf) => [kf.time, kf.value])).toEqual([
      [4, 0.2],
      [7, 0.6],
      [10, 0.2],
    ])
  })

  it('copies opacity verbatim onto a sibling even when the center poses differ', () => {
    const setup = makeSetup()
    const left = makeNode(setup, 'Left')
    const right = makeNode(setup, 'Right')
    setup.engine.setOpacity(right, 0.3)
    opacityKeyframe(setup.engine, left, 4, 0.2)
    opacityKeyframe(setup.engine, left, 7, 0.6)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: left,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: left, targetNodeId: right }],
    })
    dispatchPlan(setup, plan)

    expect(setup.engine.getKeyframes(right, 'opacity').map((kf) => [kf.time, kf.value])).toEqual([
      [7, 0.6],
      [10, 0.2],
    ])
  })

  it('mirrors opacity bezier tangents temporally (negate both, swap in/out)', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Fade')
    const target = { kind: 'node' as const, nodeId: node, property: 'opacity' as const }
    const keyframe = setup.engine.addKeyframe(target, 4, 0.2)
    setup.engine.setKeyframeInterpolation(target, keyframe.id, 'bezier')
    setup.engine.setKeyframeTangents(
      target,
      keyframe.id,
      { time: -0.3, value: 1 },
      { time: 0.3, value: 2 },
    )

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 7,
      axis: 'x',
      from: 0,
      to: 7,
      rows: [{ sourceNodeId: node, targetNodeId: null }],
    })
    dispatchPlan(setup, plan)

    const mirrored = setup.engine.getKeyframes(node, 'opacity').find((kf) => kf.time === 10)!
    expect(mirrored.interpolation).toBe('bezier')
    expect(mirrored.tangentIn).toEqual({ time: -0.3, value: -2 })
    expect(mirrored.tangentOut).toEqual({ time: 0.3, value: -1 })
  })

  it('copies zIndex verbatim with hold interpolation and overwrites collisions', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Card')
    zIndexKeyframe(setup.engine, node, 3, 5)
    zIndexKeyframe(setup.engine, node, 7, 9)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 5,
      axis: 'x',
      from: 0,
      to: 5,
      rows: [{ sourceNodeId: node, targetNodeId: null }],
    })
    dispatchPlan(setup, plan)

    expect(
      setup.engine.getZIndexKeyframes(node).map((kf) => [kf.time, kf.value, kf.interpolation]),
    ).toEqual([
      [3, 5, 'hold'],
      [7, 5, 'hold'],
    ])
  })

  it('remaps morph shapes verbatim onto the sibling', () => {
    const setup = makeSetup()
    const left = makeMeshNode(setup, 'Left Ear')
    const right = makeMeshNode(setup, 'Right Ear')
    const from = setup.engine.createShape(left, 'ear from')
    const to = setup.engine.createShape(left, 'ear to')
    const fromMirror = setup.engine.copyShapeToNode(left, from.id, right, {
      mirrored: true,
      axis: 'x',
    })
    const toMirror = setup.engine.copyShapeToNode(left, to.id, right, {
      mirrored: true,
      axis: 'x',
    })
    morphKeyframe(setup.engine, left, 4, from.id, to.id, 0.5)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: left,
      centerTime: 5,
      axis: 'x',
      from: 0,
      to: 5,
      rows: [
        {
          sourceNodeId: left,
          targetNodeId: right,
          shapeMappings: [
            { sourceShapeId: from.id, targetShapeId: fromMirror.id },
            { sourceShapeId: to.id, targetShapeId: toMirror.id },
          ],
        },
      ],
    })
    dispatchPlan(setup, plan)

    const mirrored = setup.engine.getMorphKeyframes(right)
    expect(mirrored).toHaveLength(1)
    expect(mirrored[0]!.time).toBe(6)
    expect(mirrored[0]!.value).toEqual({
      fromShapeId: fromMirror.id,
      toShapeId: toMirror.id,
      coefficient: 0.5,
    })
  })

  it('remaps morph shapes in self mode through the same node mappings', () => {
    const setup = makeSetup()
    const node = makeMeshNode(setup, 'Mouth')
    const smile = setup.engine.createShape(node, 'smile')
    const smileMirror = setup.engine.duplicateShape(node, smile.id, {
      mirrored: true,
      axis: 'x',
    })
    morphKeyframe(setup.engine, node, 4, smile.id, null, 0.5)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 5,
      axis: 'x',
      from: 0,
      to: 5,
      rows: [
        {
          sourceNodeId: node,
          targetNodeId: null,
          shapeMappings: [{ sourceShapeId: smile.id, targetShapeId: smileMirror.id }],
        },
      ],
    })
    dispatchPlan(setup, plan)

    const mirrored = setup.engine.getMorphKeyframes(node).find((kf) => kf.time === 6)!
    expect(mirrored.value).toEqual({
      fromShapeId: smileMirror.id,
      toShapeId: null,
      coefficient: 0.5,
    })
  })

  it('blocks sibling morph mirroring when a referenced shape has no mapping', () => {
    const setup = makeSetup()
    const left = makeMeshNode(setup, 'Left Ear')
    const right = makeMeshNode(setup, 'Right Ear')
    const shape = setup.engine.createShape(left, 'ear')
    morphKeyframe(setup.engine, left, 4, shape.id, null, 0.5)

    expect(() =>
      buildReverseSymmetrizeCommands(setup.engine, {
        rootNodeId: left,
        centerTime: 5,
        axis: 'x',
        from: 0,
        to: 5,
        rows: [
          {
            sourceNodeId: left,
            targetNodeId: right,
            shapeMappings: [],
          },
        ],
      }),
    ).toThrow(/no symmetrical counterpart/)

    expect(() =>
      buildReverseSymmetrizeCommands(setup.engine, {
        rootNodeId: left,
        centerTime: 5,
        axis: 'x',
        from: 0,
        to: 5,
        rows: [{ sourceNodeId: left, targetNodeId: right }],
      }),
    ).toThrow(/Shape mappings are required/)
  })

  it('copies self morph keyframes as-is and warns when a referenced shape has no mapping', () => {
    const setup = makeSetup()
    const node = makeMeshNode(setup, 'Mouth')
    const smile = setup.engine.createShape(node, 'smile')
    const frown = setup.engine.createShape(node, 'frown')
    morphKeyframe(setup.engine, node, 4, smile.id, frown.id, 0.5)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 5,
      axis: 'x',
      from: 0,
      to: 5,
      rows: [
        {
          sourceNodeId: node,
          targetNodeId: null,
          shapeMappings: [{ sourceShapeId: smile.id, targetShapeId: smile.id }],
        },
      ],
    })
    dispatchPlan(setup, plan)

    const mirrored = setup.engine.getMorphKeyframes(node).find((kf) => kf.time === 6)!
    expect(mirrored.value).toEqual({
      fromShapeId: smile.id,
      toShapeId: frown.id,
      coefficient: 0.5,
    })
    expect(plan.warnings.some((warning) => warning.includes('no symmetrical counterpart'))).toBe(
      true,
    )
  })
})

describe('guessSymmetricalShape / swapVerticalSemanticName', () => {
  it('swaps vertical words and delimited markers', () => {
    expect(swapVerticalSemanticName('lid_up')).toBe('lid_down')
    expect(swapVerticalSemanticName('Top Lid')).toBe('Bottom Lid')
    expect(swapVerticalSemanticName('arm_T')).toBe('arm_B')
    expect(swapVerticalSemanticName('arm.U_end')).toBe('arm.D_end')
    expect(swapVerticalSemanticName('torso')).toBe('torso')
    expect(swapVerticalSemanticName('_Torso')).toBe('_Torso')
  })

  it('prefers a mirrored geometry duplicate over a same-named copy', () => {
    const setup = makeSetup()
    const left = makeMeshNode(setup, 'Left')
    const right = makeMeshNode(setup, 'Right')
    const source = setup.engine.createShape(left, 'ear')
    const decoy = setup.engine.createShape(right, 'ear')
    const mirrored = setup.engine.copyShapeToNode(left, source.id, right, {
      mirrored: true,
      axis: 'x',
      name: 'ear mirrored',
    })
    const guess = guessSymmetricalShape(source, setup.engine.getShapes(right), 'x', false)
    expect(guess?.id).toBe(mirrored.id)
    expect(guess?.id).not.toBe(decoy.id)
  })

  it('falls back to the lateral name swap on X', () => {
    const setup = makeSetup()
    const left = makeMeshNode(setup, 'Left', 10, 10)
    const right = makeMeshNode(setup, 'Right', 20, 10)
    const source = setup.engine.createShape(left, 'arm_L')
    const swapped = setup.engine.createShape(right, 'arm_R')
    const guess = guessSymmetricalShape(source, setup.engine.getShapes(right), 'x', false)
    expect(guess?.id).toBe(swapped.id)
  })

  it('falls back to the vertical name swap on Y', () => {
    const setup = makeSetup()
    const top = makeMeshNode(setup, 'Top', 10, 10)
    const bottom = makeMeshNode(setup, 'Bottom', 20, 10)
    const source = setup.engine.createShape(top, 'lid_up')
    const swapped = setup.engine.createShape(bottom, 'lid_down')
    const guess = guessSymmetricalShape(source, setup.engine.getShapes(bottom), 'y', false)
    expect(guess?.id).toBe(swapped.id)
  })

  it('falls back to an exact geometry copy and never returns the source itself in self mode', () => {
    const setup = makeSetup()
    const node = makeMeshNode(setup, 'Mouth')
    const source = setup.engine.createShape(node, 'smile')
    const copy = setup.engine.duplicateShape(node, source.id)
    const guess = guessSymmetricalShape(source, setup.engine.getShapes(node), 'x', true)
    expect(guess?.id).toBe(copy.id)
  })
})

describe('guessMorphShapeMappings', () => {
  it('guesses a mirrored twin on the same node in self mode', () => {
    const setup = makeSetup()
    const node = makeMeshNode(setup, 'Mouth')
    const smile = setup.engine.createShape(node, 'smile')
    const twin = setup.engine.duplicateShape(node, smile.id, { mirrored: true, axis: 'x' })
    morphKeyframe(setup.engine, node, 4, smile.id, null, 0.5)

    const guesses = guessMorphShapeMappings(setup.engine, node, node, 'x')
    expect(guesses).toEqual([
      { sourceShapeId: smile.id, sourceShapeName: 'smile', targetShapeId: twin.id },
    ])
  })

  it('guesses the sibling counterpart and returns null when nothing matches', () => {
    const setup = makeSetup()
    const left = makeMeshNode(setup, 'Left Ear')
    const right = makeMeshNode(setup, 'Right Ear', 20, 10)
    const ear = setup.engine.createShape(left, 'ear_L')
    const other = setup.engine.createShape(left, 'other')
    const counterpart = setup.engine.createShape(right, 'ear_R')
    morphKeyframe(setup.engine, left, 4, ear.id, other.id, 0.5)

    const guesses = guessMorphShapeMappings(setup.engine, left, right, 'x')
    expect(guesses).toEqual([
      { sourceShapeId: ear.id, sourceShapeName: 'ear_L', targetShapeId: counterpart.id },
      { sourceShapeId: other.id, sourceShapeName: 'other', targetShapeId: null },
    ])
  })
})

describe('buildReverseSymmetrizeCommands — range handling', () => {
  it('only mirrors source keyframes inside [from, to]', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Dot')
    rotationKeyframe(setup.engine, node, 3, 0.1)
    rotationKeyframe(setup.engine, node, 5, 0.2)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 6,
      axis: 'x',
      from: 4,
      to: 7,
      rows: [{ sourceNodeId: node, targetNodeId: null }],
    })
    expect(plan.summary.rows[0]!.keyframesInRange).toBe(1)
    dispatchPlan(setup, plan)
    expect(setup.engine.getKeyframes(node, 'rotation').map((kf) => [kf.time, kf.value])).toEqual([
      [3, 0.1],
      [5, 0.2],
      [7, 0.2],
    ])
  })

  it('drops mirrored times outside the slide and warns', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Dot')
    rotationKeyframe(setup.engine, node, 4, 0.4)

    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 1,
      axis: 'x',
      from: 2,
      to: 5,
      rows: [{ sourceNodeId: node, targetNodeId: null }],
    })
    expect(plan.commands).toHaveLength(0)
    expect(plan.summary.droppedOutOfRange).toBe(1)
    expect(plan.warnings.some((warning) => warning.includes('outside'))).toBe(true)
  })

  it('warns when a row has no keyframes in range', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Dot')
    rotationKeyframe(setup.engine, node, 1, 0.4)
    const plan = buildReverseSymmetrizeCommands(setup.engine, {
      rootNodeId: node,
      centerTime: 5,
      axis: 'x',
      from: 3,
      to: 4,
      rows: [{ sourceNodeId: node, targetNodeId: null }],
    })
    expect(plan.warnings).toEqual(['"Dot" has no keyframes in [3, 4]'])
  })

  it('rejects an inverted range', () => {
    const setup = makeSetup()
    const node = makeNode(setup, 'Dot')
    expect(() =>
      buildReverseSymmetrizeCommands(setup.engine, {
        rootNodeId: node,
        centerTime: 5,
        axis: 'x',
        from: 6,
        to: 4,
        rows: [{ sourceNodeId: node, targetNodeId: null }],
      }),
    ).toThrow(/From time/)
  })
})
