import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  MirrorCollectionCommand,
} from '../../engine/commands'
import { ClipDefinition, newClipId } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from '../../engine/keyframe'
import {
  createMirroredClipDefinition,
  mirrorMorphGeometry,
  type MirrorAxis,
} from '../../engine/clipMirror'
import { resolveMorphedVertices } from '../../engine/shape'

function setupEngine(): { engine: Engine; dispatcher: CommandDispatcher; undoStack: UndoStack } {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  const res = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!res.ok) throw new Error('create project failed')
  const slideRes = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  if (!slideRes.ok) throw new Error('create slide failed')
  return { engine, dispatcher, undoStack }
}

function morphKf(
  time: number,
  value: unknown,
  interpolation: 'hold' | 'linear' | 'bezier' = 'linear',
  tangentIn = { time: 0, value: 0 },
  tangentOut = { time: 0, value: 0 },
): KeyframeModel {
  return new KeyframeModel(
    newKeyframeId(),
    time,
    value as never,
    interpolation,
    tangentIn,
    tangentOut,
  )
}

function buildMorphClip(name = 'MorphSmile'): ClipDefinition {
  const src = new ClipDefinition(newClipId(), name, 2, '', [], [])
  src.addMorphKeyframe(
    morphKf(
      0,
      { fromShapeName: 'mouthLeft', toShapeName: 'mouthLeft', coefficient: 0 },
      'bezier',
      { time: -0.1, value: -0.5 },
      { time: 0.2, value: 0.7 },
    ),
  )
  src.addMorphKeyframe(
    morphKf(1, { fromShapeName: 'mouthLeft', toShapeName: 'mouthLeft', coefficient: 1 }, 'linear'),
  )
  return src
}

describe('morph coefficient curves are copied verbatim with lateral name remap (#357)', () => {
  it('copies times, coefficients, tangents, interpolation verbatim; remaps lateral names', () => {
    const src = buildMorphClip()
    for (const axis of ['X', 'Y'] as const) {
      const { clip } = createMirroredClipDefinition(src, axis)
      const s = src.getMorphKeyframes()
      const m = clip.getMorphKeyframes()
      expect(m.map((k) => k.time)).toEqual(s.map((k) => k.time))
      expect(m.map((k) => k.interpolation)).toEqual(s.map((k) => k.interpolation))
      expect(m.map((k) => (k.value as unknown as { coefficient: number }).coefficient)).toEqual(
        s.map((k) => (k.value as unknown as { coefficient: number }).coefficient),
      )
      // tangents verbatim (coefficient not negated, unlike positionX)
      expect(m[0]!.tangentIn).toEqual(s[0]!.tangentIn)
      expect(m[0]!.tangentOut).toEqual(s[0]!.tangentOut)
      // lateral remap through the same dictionary as bindings
      expect(m.map((k) => k.value)).toEqual([
        { fromShapeName: 'mouthRight', toShapeName: 'mouthRight', coefficient: 0 },
        { fromShapeName: 'mouthRight', toShapeName: 'mouthRight', coefficient: 1 },
      ])
      // fresh ids, new identity
      expect(m.map((k) => k.id)).not.toEqual(s.map((k) => k.id))
    }
  })

  it('passes unpaired shape names through; nulls and numeric scalars stay verbatim', () => {
    const src = new ClipDefinition(newClipId(), 'Mixed', 1, '', [], [])
    src.addMorphKeyframe(
      morphKf(0, { fromShapeName: 'Smile', toShapeName: null, coefficient: 0.3 }),
    )
    src.addMorphKeyframe(morphKf(0.5, { fromShapeName: null, toShapeName: null, coefficient: 0.6 }))
    src.addMorphKeyframe(
      new KeyframeModel(
        newKeyframeId(),
        1,
        0.8 as never,
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.getMorphKeyframes().map((k) => k.value)).toEqual([
      { fromShapeName: 'Smile', toShapeName: null, coefficient: 0.3 },
      { fromShapeName: null, toShapeName: null, coefficient: 0.6 },
      0.8,
    ])
  })

  it('remaps arm_L / LeftArm style names with the same dictionary as bindings', () => {
    const src = new ClipDefinition(newClipId(), 'Lateral', 1, '', [], [])
    src.addMorphKeyframe(
      morphKf(0, { fromShapeName: 'arm_L', toShapeName: 'LeftArm', coefficient: 0.5 }),
    )
    const { clip } = createMirroredClipDefinition(src, 'X')
    expect(clip.getMorphKeyframes().map((k) => k.value)).toEqual([
      { fromShapeName: 'arm_R', toShapeName: 'RightArm', coefficient: 0.5 },
    ])
  })

  it('leaves the source clip untouched', () => {
    const src = buildMorphClip()
    const before = JSON.stringify(src.toJSON())
    createMirroredClipDefinition(src, 'X')
    expect(JSON.stringify(src.toJSON())).toBe(before)
  })

  it('passes legacy id-based morph values through verbatim (ids stay stable)', () => {
    const src = new ClipDefinition(newClipId(), 'LegacyIds', 1, '', [], [])
    src.addMorphKeyframe(
      morphKf(0, { fromShapeId: 'shape-left-1', toShapeId: 'shape-2', coefficient: 0.4 }),
    )
    const { clip } = createMirroredClipDefinition(src, 'X')
    // ids are node-local random handles kept stable by the same-ids geometry
    // invariant — the lateral dictionary applies to names only
    expect(clip.getMorphKeyframes().map((k) => k.value)).toEqual([
      { fromShapeId: 'shape-left-1', toShapeId: 'shape-2', coefficient: 0.4 },
    ])
  })
})

describe('mirrorMorphGeometry index-preserving auto-mirror (#357)', () => {
  const mesh = {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
    ],
    faces: [{ v0: 0, v1: 1, v2: 2 }],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
    ],
  }
  const shapes = [
    {
      id: 's-a',
      name: 'A',
      categoryId: null,
      vertices: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 8 },
      ],
    },
    {
      id: 's-b',
      name: 'mouthLeft',
      categoryId: null,
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
      ],
    },
  ]

  it('mirrors rest + every shape index-preservingly, same ids/names/order, winding flipped once', () => {
    const out = mirrorMorphGeometry(mesh as never, shapes as never, 'X')
    expect(out.warnings).toEqual([])
    // rest verts negated on X, y untouched
    expect(out.mesh.vertices).toEqual([
      { x: 0, y: 0 },
      { x: -10, y: 0 },
      { x: -10, y: 8 },
    ])
    // same count/order, winding corrected once on shared topology
    expect(out.mesh.faces).toEqual([{ v0: 0, v1: 2, v2: 1 }])
    // UVs stay attached to their vertices (no UV mirror)
    expect(out.mesh.uvs).toEqual(mesh.uvs)
    // shapes keep identity, verts mirrored
    expect(out.shapes.map((s) => [s.id, s.name])).toEqual([
      ['s-a', 'A'],
      ['s-b', 'mouthLeft'],
    ])
    expect(out.shapes[0]!.vertices).toEqual([
      { x: 0, y: 0 },
      { x: -12, y: 0 },
      { x: -12, y: 8 },
    ])
    expect(out.shapes[1]!.vertices).toEqual([
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: -8, y: 8 },
    ])
    // does not mutate inputs
    expect(mesh.vertices[1]).toEqual({ x: 10, y: 0 })
  })

  it('mirrors bind-pose coordinates while preserving weights', () => {
    const skinnedMesh = {
      ...mesh,
      boneWeights: [[{ boneId: 'root', weight: 1 }], [], []],
      bindPose: {
        root: { x: 10, y: 4, rotation: 0.25, scaleX: 1, scaleY: 1 },
      },
    }
    const out = mirrorMorphGeometry(skinnedMesh as never, undefined, 'X')
    expect(out.mesh.boneWeights).toEqual(skinnedMesh.boneWeights)
    expect(out.mesh.bindPose).toEqual({
      root: { x: -10, y: 4, rotation: -0.25, scaleX: 1, scaleY: 1 },
    })
  })

  it('Y-mirror negates y only', () => {
    const out = mirrorMorphGeometry(mesh as never, shapes as never, 'Y')
    expect(out.mesh.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: -8 },
    ])
    expect(out.mesh.faces).toEqual([{ v0: 0, v1: 2, v2: 1 }])
  })

  it('double mirror returns to the original (involution)', () => {
    const once = mirrorMorphGeometry(mesh as never, shapes as never, 'X')
    const twice = mirrorMorphGeometry(once.mesh as never, once.shapes as never, 'X')
    expect(twice.mesh.vertices).toEqual(mesh.vertices)
    expect(twice.mesh.faces).toEqual(mesh.faces)
    expect(twice.shapes.map((s) => s.vertices)).toEqual(shapes.map((s) => s.vertices))
  })

  it('vertex-count mismatch warns and leaves that shape unmirrored, never throws', () => {
    const bad = [
      ...shapes,
      { id: 's-bad', name: 'Bad', categoryId: null, vertices: [{ x: 1, y: 1 }] },
    ]
    const out = mirrorMorphGeometry(mesh as never, bad as never, 'X')
    expect(out.warnings.length).toBeGreaterThan(0)
    expect(out.warnings.join(' ')).toMatch(/Bad/)
    // rest still mirrored, good shapes mirrored, bad shape left as-is
    expect(out.mesh.vertices[1]).toEqual({ x: -10, y: 0 })
    expect(out.shapes[0]!.vertices[1]).toEqual({ x: -12, y: 0 })
    expect(out.shapes[2]!.vertices).toEqual([{ x: 1, y: 1 }])
  })

  it('mirror commutes with morph lerp: mirrored morphed == morphed mirrored', () => {
    const axis: MirrorAxis = 'X'
    const out = mirrorMorphGeometry(mesh as never, shapes as never, axis)
    const base = mesh.vertices as { x: number; y: number }[]
    const coeff = 0.5
    const origMorphed = resolveMorphedVertices(base, shapes as never, {
      binding: { fromShapeId: 's-a', toShapeId: 's-b' },
      coefficient: coeff,
    })
    const mirroredMorphed = resolveMorphedVertices(out.mesh.vertices, out.shapes as never, {
      binding: { fromShapeId: 's-a', toShapeId: 's-b' },
      coefficient: coeff,
    })
    // mirroring the original morphed result directly must equal morphing on mirrored geometry
    const directlyMirrored = origMorphed.map((v) => ({ x: -v.x || 0, y: v.y }))
    expect(mirroredMorphed).toEqual(directlyMirrored)
  })
})

describe('MirrorCollectionCommand shape auto-mirror in a single History Entry (#357)', () => {
  function buildRig(engine: Engine) {
    const slide = engine.getActiveSlide()!
    const root = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
    const node = engine.createNode(slide.scene.id, root.id, 'Face', { semanticName: 'face' })
    engine.setMeshData(node.id, {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
      ],
    } as never)
    const sA = engine.createShape(node.id, 'A')
    const sB = engine.createShape(node.id, 'mouthLeft')
    const category = engine.createShapeCategory(node.id, 'Expressions', null)
    engine.moveShapeToCategory(node.id, sB.id, category.id)
    // sculpt asymmetric offsets
    for (let i = 0; i < 3; i++) {
      const a = engine.getShapes(node.id).find((s) => s.id === sA.id)!.vertices[i]!
      engine.setShapeVertex(node.id, sA.id, i, a.x + 2, a.y)
      const b = engine.getShapes(node.id).find((s) => s.id === sB.id)!.vertices[i]!
      engine.setShapeVertex(node.id, sB.id, i, b.x - 3, b.y)
    }
    return { root, node }
  }

  function buildCollection(engine: Engine): string {
    const clip = new ClipDefinition(newClipId(), 'Smile', 2, '', [], [])
    clip.addMorphKeyframe(
      morphKf(0, { fromShapeName: 'A', toShapeName: 'mouthLeft', coefficient: 0 }),
    )
    clip.addMorphKeyframe(
      morphKf(1, { fromShapeName: 'A', toShapeName: 'mouthLeft', coefficient: 1 }),
    )
    engine.importClip(clip)
    return engine.createClipCollection('Smiles', { face: clip.id }).id
  }

  it('mints remapped morph clips and appends mirrored Shapes atomically', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const { root, node } = buildRig(engine)
    const sourceId = buildCollection(engine)
    const beforeCategories = engine.getShapeCategories(node.id)
    const beforeVerts = engine
      .getNode(node.id)
      .components.mesh!.mesh.vertices.map((v) => ({ ...v }))
    const beforeShapeIds = engine.getShapes(node.id).map((s) => s.id)
    const entriesBefore = undoStack.entries.length

    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Smiles Mirrored (X)',
        axis: 'X',
        targetParentNodeId: root.id,
        startTime: 0,
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    // single History Entry
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    // morph names remapped in the minted clip
    const mirroredCol = engine.getClipCollection(res.inverse.newCollectionId)
    const mirroredClipId = Object.values(mirroredCol.getBindingsObject())[0]!
    expect(
      engine
        .getClip(mirroredClipId)
        .getMorphKeyframes()
        .map((k) => k.value),
    ).toEqual([
      { fromShapeName: 'A Mirrored (X)', toShapeName: 'mouthRight', coefficient: 0 },
      { fromShapeName: 'A Mirrored (X)', toShapeName: 'mouthRight', coefficient: 1 },
    ])
    // Existing rest geometry and Shapes remain untouched.
    const afterMesh = engine.getNode(node.id).components.mesh!.mesh
    expect(afterMesh.vertices).toEqual(beforeVerts)
    expect(afterMesh.faces).toEqual([{ v0: 0, v1: 1, v2: 2 }])
    expect(
      engine
        .getShapes(node.id)
        .map((s) => s.id)
        .slice(0, 2),
    ).toEqual(beforeShapeIds)
    expect(engine.getShapes(node.id).map((s) => s.name)).toEqual([
      'A',
      'mouthLeft',
      'A Mirrored (X)',
      'mouthRight',
    ])
    expect(engine.getShapeCategories(node.id)).toEqual(beforeCategories)

    // single undo restores clips, collection, placement, AND geometry
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClipCollection(res.inverse.newCollectionId)).toThrow()
    expect(engine.getNode(node.id).components.mesh!.mesh.vertices).toEqual(beforeVerts)
    expect(engine.getNode(node.id).components.mesh!.mesh.faces).toEqual([{ v0: 0, v1: 1, v2: 2 }])
    // redo restores the additive mirrored Shape as well
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getShapes(node.id).map((s) => s.name)).toEqual([
      'A',
      'mouthLeft',
      'A Mirrored (X)',
      'mouthRight',
    ])
    expect(engine.getClipCollection(res.inverse.newCollectionId).name).toBe('Smiles Mirrored (X)')
  })

  it('library-only mirror (no target) mints remapped clips without touching geometry', () => {
    const { engine, dispatcher } = setupEngine()
    const { node } = buildRig(engine)
    const sourceId = buildCollection(engine)
    const beforeVerts = JSON.stringify(engine.getNode(node.id).components.mesh!.mesh.vertices)
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Smiles Mirrored (X)',
        axis: 'X',
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(JSON.stringify(engine.getNode(node.id).components.mesh!.mesh.vertices)).toBe(beforeVerts)
  })

  it('mismatched shapes warn and fall back to base instead of failing', () => {
    const { engine, dispatcher } = setupEngine()
    const { root, node } = buildRig(engine)
    // corrupt one shape to mismatch counts via wholesale restore
    const shapes = engine.getShapes(node.id).map((s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.categoryId ?? null,
      vertices: s.vertices.map((v) => ({ ...v })),
    }))
    shapes[0] = { ...shapes[0]!, vertices: [{ x: 0, y: 0 }] }
    engine.restoreShapes(node.id, shapes as never)
    const sourceId = buildCollection(engine)
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Smiles Mirrored (X)',
        axis: 'X',
        targetParentNodeId: root.id,
        startTime: 0,
      }),
    )
    // never fails the collection mirror
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect((res.inverse.morphWarnings ?? []).length).toBeGreaterThan(0)
    // mirrored collection still created and placed
    expect(engine.getClipCollection(res.inverse.newCollectionId).name).toBe('Smiles Mirrored (X)')
  })

  it('creates the missing lateral Shape on an asymmetric target', () => {
    const { engine, dispatcher } = setupEngine()
    // buildRig creates only A + mouthLeft — the remapped mouthRight is absent
    const { root, node } = buildRig(engine)
    const sourceId = buildCollection(engine)
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Smiles Mirrored (X)',
        axis: 'X',
        targetParentNodeId: root.id,
        startTime: 0,
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(res.inverse.morphWarnings ?? []).toEqual([])
    expect(engine.getShapes(node.id).map((s) => s.name)).toContain('mouthRight')
  })

  it('stays quiet when a symmetric target already holds both lateral shapes', () => {
    const { engine, dispatcher } = setupEngine()
    const { root, node } = buildRig(engine)
    engine.createShape(node.id, 'mouthRight')
    const sourceId = buildCollection(engine)
    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: 'Smiles Mirrored (X)',
        axis: 'X',
        targetParentNodeId: root.id,
        startTime: 0,
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')
    expect(res.inverse.morphWarnings ?? []).toEqual([])
  })
})
