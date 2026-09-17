import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  MirrorCollectionCommand,
  SetShadowEffectCommand,
} from '../../engine/commands'
import { ClipDefinition, newClipId } from '../../engine/clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from '../../engine/keyframe'
import { createMirroredClipDefinition, mirrorCollectionDefaultName } from '../../engine/clipMirror'
import { createReversedClipDefinition } from '../../engine/clipReverse'
import { DEFAULT_SHADOW_EFFECT } from '../../engine/shadowEffect'
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

function kf(time: number, value: unknown): KeyframeModel {
  return new KeyframeModel(
    newKeyframeId(),
    time,
    value as never,
    'linear',
    { time: 0, value: 0 },
    { time: 0, value: 0 },
  )
}

/**
 * Acceptance spine for #359: a collection holding transform + shadow + morph
 * + material clips mirrors end-to-end onto a bilaterally-named rig.
 */
function buildSourceCollection(engine: Engine): string {
  // Transform clip with a circle lane (out-of-scope skip notice path).
  const transform = new ClipDefinition(
    newClipId(),
    'GestureLeft',
    2,
    'gesture',
    [],
    [{ property: 'positionX' }, { property: 'positionY' }, { property: 'rotation' }],
  )
  transform.addChannelKeyframe('positionX', kf(0, 10))
  transform.addChannelKeyframe('positionX', kf(1, 30))
  transform.addChannelKeyframe('positionY', kf(0, 5))
  transform.addChannelKeyframe('rotation', kf(0, 90))
  transform.addCircleKeyframe('radius', kf(0, 10))
  transform.addTableKeyframe('borderRadius', kf(0, 4))

  // Auto-derived shadow clip: azimuth only, projection re-derives downstream.
  // A stale manual offset lane rides along to prove no double application.
  const shadow = new ClipDefinition(newClipId(), 'ShadowRight', 2, '', [], [])
  shadow.addShadowChannelKeyframe('lightAzimuth', kf(0, 30))
  shadow.addShadowChannelKeyframe('lightAzimuth', kf(1, 30))
  shadow.addShadowChannelKeyframe('offsetX', kf(0, 10))

  // Morph clip with a lateral shape-name pair.
  const morph = new ClipDefinition(newClipId(), 'SmileFace', 2, '', [], [])
  morph.addMorphKeyframe(kf(0, { fromShapeName: 'Base', toShapeName: 'mouthLeft', coefficient: 0 }))
  morph.addMorphKeyframe(kf(1, { fromShapeName: 'Base', toShapeName: 'mouthLeft', coefficient: 1 }))

  // Material clip: scalar surface appearance passes through unchanged.
  const material = new ClipDefinition(
    newClipId(),
    'GlowTorso',
    2,
    '',
    [],
    [{ property: 'scaleY', materialParameter: 'glow' }],
  )
  material.addMaterialChannelKeyframe('glow', kf(0, 0.75))
  material.addMaterialChannelKeyframe('glow', kf(1, 0.25))

  engine.importClip(transform)
  engine.importClip(shadow)
  engine.importClip(morph)
  engine.importClip(material)
  const col = engine.createClipCollection('Scene', {
    left_hand: transform.id,
    right_hand: shadow.id,
    face: morph.id,
    torso: material.id,
  })
  return col.id
}

function buildBilateralRig(engine: Engine) {
  const slide = engine.getActiveSlide()!
  const root = engine.createNode(slide.scene.id, slide.scene.root.id, 'Rig')
  const left = engine.createNode(slide.scene.id, root.id, 'L', { semanticName: 'left_hand' })
  const right = engine.createNode(slide.scene.id, root.id, 'R', { semanticName: 'right_hand' })
  const face = engine.createNode(slide.scene.id, root.id, 'Face', { semanticName: 'face' })
  engine.createNode(slide.scene.id, root.id, 'Torso', { semanticName: 'torso' })
  // Face mesh with symmetric lateral shapes: mouthRight starts identical to
  // mouthLeft so the remapped morph resolves to the same morphed vertices
  // that direct mirroring produces (mirror commutes with morph lerp).
  const rest = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
  ]
  engine.setMeshData(face.id, {
    vertices: rest.map((v) => ({ ...v })),
    faces: [{ v0: 0, v1: 1, v2: 2 }],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
    ],
  } as never)
  const base = engine.createShape(face.id, 'Base')
  const mouthLeft = engine.createShape(face.id, 'mouthLeft')
  const mouthRight = engine.createShape(face.id, 'mouthRight')
  // Sculpt Base +2x, lateral pair -3x (identical on both sides).
  for (let i = 0; i < 3; i++) {
    const b = engine.getShapes(face.id).find((s) => s.id === base.id)!.vertices[i]!
    engine.setShapeVertex(face.id, base.id, i, b.x + 2, b.y)
    const l = engine.getShapes(face.id).find((s) => s.id === mouthLeft.id)!.vertices[i]!
    engine.setShapeVertex(face.id, mouthLeft.id, i, l.x - 3, l.y)
    const r = engine.getShapes(face.id).find((s) => s.id === mouthRight.id)!.vertices[i]!
    engine.setShapeVertex(face.id, mouthRight.id, i, r.x - 3, r.y)
  }
  return { root, left, right, face }
}

describe('mirror round-trip acceptance spine (#359)', () => {
  it('mirrors transform+shadow+morph+material onto a bilateral rig with swapped bindings', () => {
    const { engine, dispatcher, undoStack } = setupEngine()
    const sourceId = buildSourceCollection(engine)
    const { root, left, right, face } = buildBilateralRig(engine)
    // Shadow host: left node (mirrored shadow lands here after the swap).
    engine.createNode(engine.getActiveSlide()!.scene.id, left.id, 'ShadowChild', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    dispatcher.dispatch(
      new SetShadowEffectCommand({
        nodeId: left.id,
        shadowEffect: { ...DEFAULT_SHADOW_EFFECT, auto: true, anchor: 'center', lightAzimuth: 30 },
      }),
    )
    const beforeShadow = engine.evaluateShadow(left.id, 0, { w: 100, h: 50 })!

    const beforeVerts = engine
      .getNode(face.id)
      .components.mesh!.mesh.vertices.map((v) => ({ ...v }))
    const beforeFaces = JSON.parse(
      JSON.stringify(engine.getNode(face.id).components.mesh!.mesh.faces),
    )
    const entriesBefore = undoStack.entries.length

    const res = dispatcher.dispatch(
      new MirrorCollectionCommand({
        sourceCollectionId: sourceId,
        newName: mirrorCollectionDefaultName('Scene', 'X'),
        axis: 'X',
        targetParentNodeId: root.id,
        startTime: 0,
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mirror failed')

    // Single History Entry for mint clips + auto-mirror shapes + create collection.
    expect(undoStack.entries.length).toBe(entriesBefore + 1)

    const collection = engine.getClipCollection(res.inverse.newCollectionId)
    expect(collection.name).toBe('Scene Mirrored (X)')
    const bindings = collection.getBindingsObject()
    const source = engine.getClipCollection(sourceId)
    const sourceBindings = source.getBindingsObject()

    // Lateral swap: mirrored left motion drives the right side and vice versa.
    const mirroredTransformId = bindings['right_hand']!
    const mirroredShadowId = bindings['left_hand']!
    expect(mirroredTransformId).toBeDefined()
    expect(mirroredShadowId).toBeDefined()
    // Non-destructive: originals keep working exactly as before.
    expect(
      engine
        .getClip(sourceBindings['left_hand']!)
        .getChannelKeyframes('positionX')
        .map((k) => k.value),
    ).toEqual([10, 30])
    expect(
      engine
        .getClip(sourceBindings['right_hand']!)
        .getShadowChannelKeyframes('lightAzimuth')
        .map((k) => k.value),
    ).toEqual([30, 30])
    expect(engine.getClipCollection(sourceId).getBindingsObject()).toEqual(sourceBindings)

    // Mirrored transform values (X-mirror negates positionX + rotation).
    const mirroredTransform = engine.getClip(mirroredTransformId)
    expect(mirroredTransform.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([
      -10, -30,
    ])
    expect(mirroredTransform.getChannelKeyframes('positionY').map((k) => k.value)).toEqual([5])
    expect(mirroredTransform.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-90])
    expect(mirroredTransform.isReversed).toBe(false)

    // Circle/table lanes skipped with a visible notice, never silently dropped.
    expect(mirroredTransform.circleTrackKeys).toEqual([])
    expect(mirroredTransform.tableTrackKeys).toEqual([])
    expect(res.inverse.skipped.join(' ')).toMatch(/circle/i)
    expect(res.inverse.skipped.join(' ')).toMatch(/table/i)

    // Unpaired bindings pass through under the same key.
    expect(bindings['face']).toBeDefined()
    expect(bindings['torso']).toBeDefined()

    // Shadow: azimuth maps 30 -> 150 (auto re-derives); the stale manual
    // offset lane passes through untouched — exactly one mirroring path.
    const mirroredShadow = engine.getClip(mirroredShadowId)
    expect(mirroredShadow.getShadowChannelKeyframes('lightAzimuth').map((k) => k.value)).toEqual([
      150, 150,
    ])
    expect(mirroredShadow.getShadowChannelKeyframes('offsetX').map((k) => k.value)).toEqual([10])

    // Material scalar tracks pass through unchanged.
    const mirroredMaterial = engine.getClip(bindings['torso']!)
    expect(mirroredMaterial.getMaterialChannelKeyframes('glow').map((k) => k.value)).toEqual([
      0.75, 0.25,
    ])

    // Morph coefficient curves verbatim with lateral name remap.
    const mirroredMorph = engine.getClip(bindings['face']!)
    expect(mirroredMorph.getMorphKeyframes().map((k) => k.value)).toEqual([
      { fromShapeName: 'Base Mirrored (X)', toShapeName: 'mouthRight', coefficient: 0 },
      { fromShapeName: 'Base Mirrored (X)', toShapeName: 'mouthRight', coefficient: 1 },
    ])

    // Existing rest geometry stays intact; the lateral Shape is additive.
    const afterMesh = engine.getNode(face.id).components.mesh!.mesh
    expect(afterMesh.vertices).toEqual(beforeVerts)
    expect(afterMesh.faces).toEqual(beforeFaces)

    // The remapped morph resolves to the additive mirrored Shape.
    const afterShapes = engine.getShapes(face.id)
    const afterByName = new Map(afterShapes.map((s) => [s.name, s] as const))
    // The remapped lateral shape resolves on the mirrored target (no
    // missing-shape fallback in the happy path).
    expect(afterByName.has('Base Mirrored (X)')).toBe(true)
    expect(afterByName.has('mouthRight')).toBe(true)
    const mirroredEval = resolveMorphedVertices(afterMesh.vertices, afterShapes, {
      binding: {
        fromShapeId: afterByName.get('Base Mirrored (X)')!.id,
        toShapeId: afterByName.get('mouthRight')!.id,
      },
      coefficient: 1,
    })
    expect(mirroredEval).toEqual(afterByName.get('mouthRight')!.vertices)

    // Mirrored performance plays back on the bilateral rig:
    // right node runs the mirrored left transform; left shadow re-derives.
    expect(engine.evaluateNode(right.id, 0).transform.x).toBeCloseTo(-10)
    const afterShadow = engine.evaluateShadow(left.id, 0, { w: 100, h: 50 })!
    expect(afterShadow.offsetX).toBeCloseTo(-beforeShadow.offsetX, 8)
    expect(afterShadow.offsetY).toBeCloseTo(beforeShadow.offsetY, 8)

    // Single undo restores clips, collection, placement, and removes only the
    // additive Shape.
    expect(dispatcher.undo()).toBe(true)
    expect(() => engine.getClipCollection(res.inverse.newCollectionId)).toThrow()
    expect(engine.getNode(face.id).components.mesh!.mesh.vertices).toEqual(beforeVerts)
    expect(engine.getNode(face.id).components.mesh!.mesh.faces).toEqual(beforeFaces)
    expect(engine.getClipCollection(sourceId).name).toBe('Scene')
    // Redo restores the mirrored collection, placement, and additive Shape.
    expect(dispatcher.redo()).toBe(true)
    expect(engine.getClipCollection(res.inverse.newCollectionId).name).toBe('Scene Mirrored (X)')
    expect(engine.getNode(face.id).components.mesh!.mesh.vertices).toEqual(beforeVerts)
    expect(engine.getShapes(face.id).map((s) => s.name)).toContain('mouthRight')
    expect(engine.evaluateNode(right.id, 0).transform.x).toBeCloseTo(-10)
    const redoShadow = engine.evaluateShadow(left.id, 0, { w: 100, h: 50 })!
    expect(redoShadow.offsetX).toBeCloseTo(-beforeShadow.offsetX, 8)
  })
})

describe('mirror/reverse composition (#359)', () => {
  function buildLinearClip(): ClipDefinition {
    const src = new ClipDefinition(
      newClipId(),
      'Wave',
      2,
      'gesture',
      [],
      [{ property: 'positionX' }, { property: 'rotation' }],
    )
    src.addChannelKeyframe('positionX', kf(0, 10))
    src.addChannelKeyframe('positionX', kf(1, 30))
    src.addChannelKeyframe('rotation', kf(0, 90))
    return src
  }

  it('mirror implies space (values) without implying time; reverse implies time without implying space', () => {
    const src = buildLinearClip()
    const mirrored = createMirroredClipDefinition(src, 'X').clip
    // Space only: values negated, times untouched, not flagged reversed.
    expect(mirrored.getChannelKeyframes('positionX').map((k) => k.value)).toEqual([-10, -30])
    expect(mirrored.getChannelKeyframes('positionX').map((k) => k.time)).toEqual([0, 1])
    expect(mirrored.isReversed).toBe(false)

    const reversed = createReversedClipDefinition(src, 'Wave Reversed')
    // Time only: (time, value) pairs flip end-for-end, values otherwise
    // untouched, flagged reversed. Keyframes read back time-sorted.
    expect(reversed.getChannelKeyframes('positionX').map((k) => [k.time, k.value])).toEqual([
      [0, 30],
      [1, 10],
    ])
    expect(reversed.isReversed).toBe(true)
  })

  it('mirrored-then-reversed and reversed-then-mirrored both carry space+time without collapsing', () => {
    const src = buildLinearClip()
    const mirroredThenReversed = createReversedClipDefinition(
      createMirroredClipDefinition(src, 'X').clip,
      'Wave Mirrored (X) Reversed',
    )
    expect(
      mirroredThenReversed.getChannelKeyframes('positionX').map((k) => [k.time, k.value]),
    ).toEqual([
      [0, -30],
      [1, -10],
    ])
    expect(mirroredThenReversed.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-90])

    const reversedThenMirrored = createMirroredClipDefinition(
      createReversedClipDefinition(src, 'Wave Reversed'),
      'X',
    ).clip
    expect(
      reversedThenMirrored.getChannelKeyframes('positionX').map((k) => [k.time, k.value]),
    ).toEqual([
      [0, -30],
      [1, -10],
    ])
    expect(reversedThenMirrored.getChannelKeyframes('rotation').map((k) => k.value)).toEqual([-90])
  })
})
