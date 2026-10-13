import { describe, expect, it } from 'vitest'
import {
  buildShapeStepOperation,
  extractShapeStepBlock,
  hasAppliableShapeStep,
  mintShapeId,
} from '../ai/shapeStep'

const CREATE_MESSAGE = [
  'A lying left-side body shape can be drafted for review.',
  '',
  '```shape-step',
  'action: create',
  'node: node-body-1',
  'source: sitting_facing_profile',
  'name: lying_left_side',
  '```',
].join('\n')

const LIVE = [
  {
    id: 'shape-sit',
    name: 'sitting_facing_profile',
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
  },
  { id: 'shape-stand', name: 'standing', vertices: [{ x: 5, y: 5 }] },
]

describe('shapeStep', () => {
  it('extracts a create step with node, source, and name', () => {
    const step = extractShapeStepBlock(CREATE_MESSAGE)
    expect(step).not.toBeNull()
    expect(step?.action).toBe('create')
    expect(step?.node).toBe('node-body-1')
    expect(step?.source).toBe('sitting_facing_profile')
    expect(step?.name).toBe('lying_left_side')
    expect(hasAppliableShapeStep(CREATE_MESSAGE)).toBe(true)
  })

  it('extracts update and delete steps', () => {
    const update = extractShapeStepBlock(
      '```shape-step\naction: update\nnode: n-1\ntarget: shape-old\nsource: sitting\nname: fixed\n```',
    )
    expect(update?.action).toBe('update')
    expect(update?.target).toBe('shape-old')
    const del = extractShapeStepBlock(
      '```shape-step\naction: delete\nnode: n-1\nshape: shape-old\n```',
    )
    expect(del?.action).toBe('delete')
    expect(del?.shape).toBe('shape-old')
  })

  it('rejects prose, flat pseudo-formats, and incomplete blocks', () => {
    expect(extractShapeStepBlock('action: create shape, target node id: n-1')).toBeNull()
    expect(extractShapeStepBlock('```json\n{"action": "shape.create"}\n```')).toBeNull()
    expect(extractShapeStepBlock('```shape-step\naction: create\nnode: n-1\n```')).toBeNull()
    expect(extractShapeStepBlock('```shape-step\naction: freeze\nnode: n-1\n```')).toBeNull()
    expect(hasAppliableShapeStep('just prose')).toBe(false)
  })

  it('builds a create operation duplicating source vertices verbatim', () => {
    const step = extractShapeStepBlock(CREATE_MESSAGE)
    expect(step).not.toBeNull()
    const built = buildShapeStepOperation({
      step: step!,
      nodeId: 'node-body-1',
      liveShapes: LIVE,
    })
    expect('error' in built).toBe(false)
    if ('error' in built) return
    expect(built.operation).toMatchObject({
      kind: 'upsertShape',
      action: 'create',
      nodeId: 'node-body-1',
      sourceShapeId: 'shape-sit',
    })
    expect(built.operation.kind).toBe('upsertShape')
    if (built.operation.kind !== 'upsertShape') return
    const shape = built.operation.shape
    expect(shape.name).toBe('lying_left_side')
    expect(shape.id).toBeTruthy()
    // Vertex count preserved by construction — same positions, same length.
    expect(shape.vertices).toEqual(LIVE[0]!.vertices)
  })

  it('mints a non-colliding shape id', () => {
    expect(mintShapeId('Lying Left', [])).toBe('lying-left')
    expect(
      mintShapeId('Lying Left', [{ id: 'lying-left', name: 'Lying Left', vertices: [] }]),
    ).toBe('lying-left-2')
    expect(mintShapeId('sitting_facing_profile', LIVE)).toBe('sitting-facing-profile')
  })

  it('parses transform lines on create steps', () => {
    const step = extractShapeStepBlock(
      '```shape-step\naction: create\nnode: n-1\nsource: sitting\nname: lying\ntransform: rotate\ndegrees: -80\npivot: 100, 200\n```',
    )
    expect(step?.transform).toBe('rotate')
    expect(step?.params).toMatchObject({ degrees: '-80', pivot: '100, 200' })
  })

  it('rejects unknown transform names', () => {
    expect(
      extractShapeStepBlock(
        '```shape-step\naction: create\nnode: n-1\nsource: sitting\nname: lying\ntransform: twist\n```',
      ),
    ).toBeNull()
  })

  it('builds a rotated create whose count still matches the mesh', () => {
    const step = extractShapeStepBlock(
      '```shape-step\naction: create\nnode: n-1\nsource: sitting_facing_profile\nname: lying\ntransform: rotate\ndegrees: 90\n```',
    )!
    const built = buildShapeStepOperation({ step, nodeId: 'n-1', liveShapes: LIVE })
    expect('error' in built).toBe(false)
    if ('error' in built) return
    expect(built.operation.kind).toBe('upsertShape')
    if (built.operation.kind !== 'upsertShape') return
    const shape = built.operation.shape
    expect(shape.vertices).toHaveLength(LIVE[0]!.vertices.length)
    // Rotation about the centroid moves points but keeps the count.
    expect(shape.vertices).not.toEqual(LIVE[0]!.vertices)
    expect(built.summary).toBe('rotate 90°')
  })

  it('blends toward a second donor and rejects bad factors', () => {
    const step = extractShapeStepBlock(
      '```shape-step\naction: create\nnode: n-1\nsource: sitting_facing_profile\nname: mid\ntransform: blend\nblend: standing, 0.5\n```',
    )!
    const built = buildShapeStepOperation({ step, nodeId: 'n-1', liveShapes: LIVE })
    // Donors differ in count here (3 vs 1) — must refuse, not invent.
    expect(built).toMatchObject({ error: expect.stringContaining('different vertex counts') })
    const badFactor = extractShapeStepBlock(
      '```shape-step\naction: create\nnode: n-1\nsource: sitting_facing_profile\nname: mid\ntransform: blend\nblend: standing, 2\n```',
    )!
    expect(
      buildShapeStepOperation({ step: badFactor, nodeId: 'n-1', liveShapes: LIVE }),
    ).toMatchObject({ error: expect.stringContaining('0–1') })
  })

  it('rejects transforms with missing or non-numeric params', () => {
    const missing = extractShapeStepBlock(
      '```shape-step\naction: create\nnode: n-1\nsource: sitting_facing_profile\nname: lying\ntransform: rotate\n```',
    )!
    expect(
      buildShapeStepOperation({ step: missing, nodeId: 'n-1', liveShapes: LIVE }),
    ).toMatchObject({ error: expect.stringContaining('degrees') })
  })

  it('reports stale sources, targets, and name collisions instead of guessing', () => {
    const step = extractShapeStepBlock(CREATE_MESSAGE)!
    expect(buildShapeStepOperation({ step, nodeId: 'n-1', liveShapes: [] })).toMatchObject({
      error: expect.stringContaining('Source Shape'),
    })
    const renamed = { ...step, name: 'standing' }
    expect(
      buildShapeStepOperation({ step: renamed, nodeId: 'n-1', liveShapes: LIVE }),
    ).toMatchObject({ error: expect.stringContaining('already exists') })
    const del = extractShapeStepBlock(
      '```shape-step\naction: delete\nnode: n-1\nshape: ghost\n```',
    )!
    expect(buildShapeStepOperation({ step: del, nodeId: 'n-1', liveShapes: LIVE })).toMatchObject({
      error: expect.stringContaining('not found'),
    })
  })
})
