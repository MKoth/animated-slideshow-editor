import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher } from '../engine/commands/dispatcher'
import { UndoStack } from '../engine/commands/undoStack'
import { AddKeyframeCommand } from '../engine/commands'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { ClipDefinition } from '../engine/clipDefinition'
import type { EnginePublic } from '../engine'
import type { AnimationProperty } from '../engine/animationProperties'
import { buildClipBatchOperations, extractClipBatchBlock } from '../ai/clipBatch'
import { dryRunValidate, executeProposal, validateProposalSchema } from '../ai/proposals'
import type { AnimationAssetOperation } from '../ai/animationAssetOperations'

const BATCH_MESSAGE = [
  'Clip batch for lie-to-stand, 4s of orphans.',
  '',
  '```clip-batch',
  'window: 0 - 1',
  'clip: body lie-to-stand | node: body | semantic: body',
  'clip: head lie-to-stand | node: head | semantic: head',
  '```',
].join('\n')

function setupEngine() {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine as never, undo, () => {})
  ;(engine as unknown as { createProject: (args: { name: string }) => void }).createProject({
    name: 'P',
  })
  ;(engine as unknown as { createSlide: (name: string) => void }).createSlide('S1')
  const slide = (
    engine as unknown as { getActiveSlide: () => { scene: { id: string; root: { id: string } } } }
  ).getActiveSlide()
  const mkNode = (name: string) => {
    const node = (
      engine as unknown as {
        createNode: (
          sceneId: string,
          parentId: string,
          name: string,
        ) => { id: string; name: string }
      }
    ).createNode(slide.scene.id, slide.scene.root.id, name)
    return node
  }
  const addKf = (nodeId: string, property: AnimationProperty, time: number, value: number) => {
    const res = dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }) as never,
    )
    if (!res.ok) throw new Error(`add keyframe failed: ${(res as { error: Error }).error.message}`)
  }
  return { engine: engine as unknown as EnginePublic, mkNode, addKf, dispatcher, undo }
}

describe('extractClipBatchBlock', () => {
  it('parses window and per-step node/semantic lines', () => {
    const plan = extractClipBatchBlock(BATCH_MESSAGE)
    expect(plan).not.toBeNull()
    expect(plan?.from).toBe(0)
    expect(plan?.to).toBe(1)
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps[0]).toMatchObject({
      name: 'body lie-to-stand',
      node: 'body',
      semantic: 'body',
    })
    expect(plan?.steps[1]).toMatchObject({
      name: 'head lie-to-stand',
      node: 'head',
      semantic: 'head',
    })
  })

  it('returns null without a block and skips steps missing a node', () => {
    expect(extractClipBatchBlock('just prose')).toBeNull()
    expect(extractClipBatchBlock('```clip-batch\nclip: nameless\n```')).toBeNull()
    expect(
      extractClipBatchBlock('```clip-batch\nwindow: 5 - 2\nclip: ok | node: n\n```')?.from,
    ).toBeNull()
  })
})

describe('designed keys lines', () => {
  it('parses morph and property tracks with per-point interpolation', () => {
    const plan = extractClipBatchBlock(
      [
        '```clip-batch',
        'window: 0 - 4',
        'clip: body move | node: body | semantic: body',
        'keys: morph standing -> stand = 0@0, 1@4',
        'keys: positionY = 0@0, -20@2:hold, 0@4',
        '```',
      ].join('\n'),
    )
    expect(plan?.steps).toHaveLength(1)
    expect(plan?.steps[0]?.keys).toHaveLength(2)
    expect(plan?.steps[0]?.keys[0]).toMatchObject({
      track: 'morph',
      morphFrom: 'standing',
      morphTo: 'stand',
    })
    expect(plan?.steps[0]?.keys[1]?.points[1]).toMatchObject({
      value: -20,
      time: 2,
      interpolation: 'hold',
    })
  })

  it('ignores malformed keys lines without failing the step', () => {
    const plan = extractClipBatchBlock(
      '```clip-batch\nclip: c | node: n\nkeys: nonsense without equals\n```',
    )
    expect(plan?.steps[0]?.keys).toEqual([])
  })
})

describe('buildClipBatchOperations', () => {
  it('extracts real orphan keyframes into canonical duration-1 clips', () => {
    const { engine, mkNode, addKf } = setupEngine()
    const body = mkNode('body')
    const head = mkNode('head')
    addKf(body.id, 'positionY', 0, 10)
    addKf(body.id, 'positionY', 1, 30)
    addKf(head.id, 'positionX', 0, 5)
    addKf(head.id, 'positionX', 1, 15)

    const plan = extractClipBatchBlock(BATCH_MESSAGE)
    expect(plan).not.toBeNull()
    const built = buildClipBatchOperations({
      engine,
      nodes: [
        { id: body.id, name: 'body' },
        { id: head.id, name: 'head' },
      ],
      plan: { ...plan!, collection: { name: 'test collection', source: 'body', category: null } },
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.build.operations).toHaveLength(3)
    expect(built.build.from).toBe(0)
    expect(built.build.to).toBe(1)

    const [bodyOp, headOp] = built.build.operations as Extract<
      AnimationAssetOperation,
      { kind: 'upsertClip' }
    >[]
    // One single-operation command per step; nodeId lives on the operation,
    // never inside the reusable clip.
    expect(bodyOp.kind).toBe('upsertClip')
    expect(bodyOp.action).toBe('create')
    expect(bodyOp.nodeId).toBe(body.id)
    const bodyClip = bodyOp.clip as unknown as Record<string, unknown>
    expect(bodyClip.duration).toBe(1)
    expect(bodyClip.channels).toEqual([{ property: 'positionY' }])
    expect('nodeId' in bodyClip).toBe(false)
    const anim = bodyClip.channelAnimations as Record<
      string,
      { keyframes: { time: number; value: unknown }[] }
    >
    expect(Object.keys(anim)).toEqual(['positionY'])
    expect(anim.positionY!.keyframes.map((kf) => kf.time)).toEqual([0, 1])
    // Real orphan values survive — nothing invented.
    expect(anim.positionY!.keyframes.map((kf) => kf.value)).toEqual([10, 30])
    const headClip = headOp.clip as unknown as Record<string, unknown>
    const headAnim = headClip.channelAnimations as Record<
      string,
      { keyframes: { value: unknown }[] }
    >
    expect(headAnim.positionX!.keyframes.map((kf) => kf.value)).toEqual([5, 15])
  })

  it('derives a shared window from orphan min/max when the block omits it', () => {
    const { engine, mkNode, addKf } = setupEngine()
    const body = mkNode('body')
    addKf(body.id, 'positionY', 2, 10)
    addKf(body.id, 'positionY', 6, 30)
    const plan = extractClipBatchBlock('```clip-batch\nclip: c | node: body\n```')
    const built = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: { ...plan!, collection: { name: 'test collection', source: 'body', category: null } },
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.build.from).toBe(2)
    expect(built.build.to).toBe(6)
    const op = built.build.operations[0] as Extract<AnimationAssetOperation, { kind: 'upsertClip' }>
    const anim = (
      op.clip as unknown as Record<string, Record<string, { keyframes: { time: number }[] }>>
    ).channelAnimations
    expect(anim.positionY!.keyframes.map((kf) => kf.time)).toEqual([0, 1])
  })

  it('fails loudly on unknown nodes and keyframe-less steps', () => {
    const { engine, mkNode, addKf } = setupEngine()
    const body = mkNode('body')
    const empty = mkNode('empty')
    addKf(body.id, 'positionY', 0, 1)
    addKf(body.id, 'positionY', 1, 2)

    const ghost = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: {
        from: 0,
        to: 1,
        steps: [{ name: 'c', node: 'ghost', semantic: null, category: null, keys: [] }],
        collection: { name: 'test collection', source: 'body', category: null },
        collectionError: null,
      },
    })
    expect(ghost.ok).toBe(false)

    const bare = buildClipBatchOperations({
      engine,
      nodes: [
        { id: body.id, name: 'body' },
        { id: empty.id, name: 'empty' },
      ],
      plan: {
        from: 0,
        to: 1,
        steps: [{ name: 'c', node: 'empty', semantic: null, category: null, keys: [] }],
        collection: { name: 'test collection', source: 'body', category: null },
        collectionError: null,
      },
    })
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.error).toMatch(/no orphan keyframes/i)
  })

  it('fails loudly when the collection line is missing', () => {
    const { engine, mkNode, addKf } = setupEngine()
    const body = mkNode('body')
    addKf(body.id, 'positionY', 0, 1)
    addKf(body.id, 'positionY', 1, 2)
    const plan = extractClipBatchBlock('```clip-batch\nwindow: 0 - 1\nclip: c | node: body\n```')
    expect(plan?.collection).toBeNull()
    const built = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: plan!,
    })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toMatch(/no collection line/i)
  })

  it('built clips pass the proposal schema gate and parse back losslessly', () => {
    const { engine, mkNode, addKf } = setupEngine()
    const body = mkNode('body')
    addKf(body.id, 'positionY', 0, 10)
    addKf(body.id, 'positionY', 1, 30)
    const plan = extractClipBatchBlock('```clip-batch\nclip: c | node: body | semantic: body\n```')
    const built = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: { ...plan!, collection: { name: 'test collection', source: 'body', category: null } },
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const commands = built.build.operations.map((operation) => ({
      type: 'AiAnimationAssetBatch',
      operations: [operation],
    }))
    const schema = validateProposalSchema(commands)
    expect(schema.ok).toBe(true)

    const op = built.build.operations[0] as Extract<AnimationAssetOperation, { kind: 'upsertClip' }>
    const roundTripped = ClipDefinition.fromJSON(op.clip as never)
    expect(roundTripped.getChannelKeyframes('positionY' as never)).toHaveLength(2)
  })

  it('authors motion for orphan-less nodes from keys lines', () => {
    const { engine, mkNode } = setupEngine()
    const body = mkNode('body')
    // No keyframes anywhere on body — extraction would fail loudly.
    const plan = extractClipBatchBlock(
      [
        '```clip-batch',
        'window: 0 - 4',
        'clip: body designed | node: body | semantic: body',
        'keys: positionY = 0@0, -20@2, 0@4',
        'collection: test collection | source: body',
        '```',
      ].join('\n'),
    )
    const built = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: plan!,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const op = built.build.operations[0] as Extract<AnimationAssetOperation, { kind: 'upsertClip' }>
    const clip = op.clip as unknown as {
      duration: number
      channels: { property: string }[]
      channelAnimations: Record<string, { keyframes: { time: number; value: unknown }[] }>
    }
    expect(clip.duration).toBe(1)
    expect(clip.channels).toEqual([{ property: 'positionY' }])
    // Window seconds normalized onto [0, 1]; values authored verbatim.
    expect(clip.channelAnimations.positionY!.keyframes.map((kf) => kf.time)).toEqual([0, 0.5, 1])
    expect(clip.channelAnimations.positionY!.keyframes.map((kf) => kf.value)).toEqual([0, -20, 0])
    const schema = validateProposalSchema([{ type: 'AiAnimationAssetBatch', operations: [op] }])
    expect(schema.ok).toBe(true)
    expect(
      ClipDefinition.fromJSON(op.clip as never).getChannelKeyframes('positionY' as never),
    ).toHaveLength(3)
  })

  it('rejects designed morphs with unknown shape names, listing inventory', () => {
    const { engine } = setupEngine()
    const slide = (
      engine as unknown as { getActiveSlide: () => { scene: { id: string; root: { id: string } } } }
    ).getActiveSlide()
    const mesh = createDefaultRectangleMesh(10, 10)
    const node = (
      engine as unknown as {
        createNode: (
          sceneId: string,
          parentId: string,
          name: string,
          opts: unknown,
        ) => { id: string; name: string }
      }
    ).createNode(slide.scene.id, slide.scene.root.id, 'meshnode', {
      components: { mesh: { kind: 'mesh', mesh } },
    })
    ;(
      engine as unknown as { createShape: (nodeId: string, name: string) => { id: string } }
    ).createShape(node.id, 'standing')
    const plan = extractClipBatchBlock(
      [
        '```clip-batch',
        'window: 0 - 4',
        'clip: body move | node: meshnode | semantic: body',
        'keys: morph lying -> stand = 0@0, 1@4',
        'collection: test collection | source: meshnode',
        '```',
      ].join('\n'),
    )
    const built = buildClipBatchOperations({
      engine,
      nodes: [{ id: node.id, name: 'meshnode' }],
      plan: plan!,
    })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toMatch(/unknown morph shape/i)
    expect(built.error).toMatch(/standing/)
  })

  it('requires an explicit window for designed steps and window-bound times', () => {
    const { engine, mkNode } = setupEngine()
    const body = mkNode('body')
    const testCollection = { name: 'test collection', source: 'body', category: null } as const
    const noWindow = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: {
        from: null,
        to: null,
        steps: [
          {
            name: 'c',
            node: 'body',
            semantic: null,
            category: null,
            keys: [
              {
                track: 'positionY',
                morphFrom: null,
                morphTo: null,
                points: [{ value: 1, time: 0, interpolation: 'linear' as const }],
              },
            ],
          },
        ],
        collection: { ...testCollection },
        collectionError: null,
      },
    })
    expect(noWindow.ok).toBe(false)

    const outside = buildClipBatchOperations({
      engine,
      nodes: [{ id: body.id, name: 'body' }],
      plan: {
        from: 0,
        to: 4,
        steps: [
          {
            name: 'c',
            node: 'body',
            semantic: null,
            category: null,
            keys: [
              {
                track: 'positionY',
                morphFrom: null,
                morphTo: null,
                points: [{ value: 1, time: 9, interpolation: 'linear' as const }],
              },
            ],
          },
        ],
        collection: { ...testCollection },
        collectionError: null,
      },
    })
    expect(outside.ok).toBe(false)
    if (!outside.ok) expect(outside.error).toMatch(/outside the window/)
  })

  it('mixes extracted and designed steps in one batch', () => {
    const { engine, mkNode, addKf } = setupEngine()
    const body = mkNode('body')
    const head = mkNode('head')
    addKf(body.id, 'positionY', 0, 10)
    addKf(body.id, 'positionY', 1, 30)
    const plan = extractClipBatchBlock(
      [
        '```clip-batch',
        'window: 0 - 1',
        'clip: body real | node: body | semantic: body',
        'clip: head authored | node: head | semantic: head',
        'keys: positionY = 5@0, 15@1',
        'collection: test collection | source: body',
        '```',
      ].join('\n'),
    )
    const built = buildClipBatchOperations({
      engine,
      nodes: [
        { id: body.id, name: 'body' },
        { id: head.id, name: 'head' },
      ],
      plan: plan!,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.build.operations).toHaveLength(3)
    expect(built.build.summary).toMatch(/extracted/)
    expect(built.build.summary).toMatch(/designed/)
  })

  describe('clip batch closing collection', () => {
    const COLLECTION_MESSAGE = [
      '```clip-batch',
      'window: 0 - 1',
      'clip: body move | node: body | semantic: body',
      'clip: head move | node: head | semantic: head',
      'collection: lie to stand | source: cat',
      '```',
    ].join('\n')

    function setupRig() {
      const { engine, mkNode, addKf, dispatcher, undo } = setupEngine()
      const cat = mkNode('cat')
      const body = mkNode('body')
      const head = mkNode('head')
      addKf(body.id, 'positionY', 0, 10)
      addKf(body.id, 'positionY', 1, 30)
      addKf(head.id, 'positionX', 0, 5)
      addKf(head.id, 'positionX', 1, 15)
      return { engine, dispatcher, undo, cat, body, head }
    }

    function buildBatch(engine: EnginePublic, nodes: { id: string; name: string }[]) {
      const plan = extractClipBatchBlock(COLLECTION_MESSAGE)
      expect(plan?.collection).toMatchObject({ name: 'lie to stand', source: 'cat' })
      const built = buildClipBatchOperations({ engine, nodes, plan: plan! })
      expect(built.ok).toBe(true)
      if (!built.ok) throw new Error('batch build failed')
      return built.build
    }

    it('parses the collection line and appends the binding op last', () => {
      const { engine, cat, body, head } = setupRig()
      const build = buildBatch(engine, [
        { id: cat.id, name: 'cat' },
        { id: body.id, name: 'body' },
        { id: head.id, name: 'head' },
      ])
      expect(build.operations).toHaveLength(3)
      expect(build.collection).not.toBeNull()
      const last = build.operations[2] as Extract<
        AnimationAssetOperation,
        { kind: 'upsertCollection' }
      >
      expect(last.kind).toBe('upsertCollection')
      expect(last.collection.name).toBe('lie to stand')
      expect(last.collection.sourceNodeId).toBe(cat.id)
      const bindings = last.collection.bindings as Record<string, string>
      expect(Object.keys(bindings).sort()).toEqual(['body', 'head'])
      expect(bindings.body).toBe(build.steps[0]!.clipId)
      expect(bindings.head).toBe(build.steps[1]!.clipId)
      expect(build.summary).toMatch(/Collection “lie to stand” \(2 bindings\)/)
    })

    it('fails loudly on unknown sources, duplicate semantics, and second collections', () => {
      const { engine, cat, body, head } = setupRig()
      const nodes = [
        { id: cat.id, name: 'cat' },
        { id: body.id, name: 'body' },
        { id: head.id, name: 'head' },
      ]
      const ghostSource = buildClipBatchOperations({
        engine,
        nodes,
        plan: {
          from: 0,
          to: 1,
          steps: [{ name: 'c', node: 'body', semantic: 'body', category: null, keys: [] }],
          collection: { name: 'col', source: 'ghost', category: null },
          collectionError: null,
        },
      })
      expect(ghostSource.ok).toBe(false)
      if (!ghostSource.ok) expect(ghostSource.error).toMatch(/Collection source/)

      const dupes = buildClipBatchOperations({
        engine,
        nodes,
        plan: {
          from: 0,
          to: 1,
          steps: [
            { name: 'a', node: 'body', semantic: 'body', category: null, keys: [] },
            { name: 'b', node: 'head', semantic: 'body', category: null, keys: [] },
          ],
          collection: { name: 'col', source: 'cat', category: null },
          collectionError: null,
        },
      })
      expect(dupes.ok).toBe(false)
      if (!dupes.ok) expect(dupes.error).toMatch(/Duplicate Semantic Name/)

      const two = extractClipBatchBlock(
        '```clip-batch\nclip: c | node: body\ncollection: one | source: cat\ncollection: two | source: cat\n```',
      )
      expect(two?.collectionError).toMatch(/one collection per batch/i)
      const twoBuilt = buildClipBatchOperations({ engine, nodes, plan: two! })
      expect(twoBuilt.ok).toBe(false)
    })

    it('dry-runs clips plus closing collection cumulatively without touching live state', () => {
      const { engine, cat, body, head } = setupRig()
      const build = buildBatch(engine, [
        { id: cat.id, name: 'cat' },
        { id: body.id, name: 'body' },
        { id: head.id, name: 'head' },
      ])
      const commands = build.operations.map((operation) => ({
        type: 'AiAnimationAssetBatch',
        operations: [operation],
      }))
      const clipsBefore = engine.clips.length
      const dry = dryRunValidate(engine, commands)
      expect(dry.ok).toBe(true)
      // Live engine untouched by the dry-run.
      expect(engine.clips).toHaveLength(clipsBefore)
      // Approving only the collection (dropping its clips) fails with the missing clip named.
      const dangling = dryRunValidate(engine, commands, [2])
      expect(dangling.ok).toBe(false)
      expect(dangling.errors[0]!.message).toMatch(/unknown clip id/)
    })

    it('executes the whole batch as one Transaction: clips plus bound collection', () => {
      const { engine, dispatcher, undo, cat, body, head } = setupRig()
      const build = buildBatch(engine, [
        { id: cat.id, name: 'cat' },
        { id: body.id, name: 'body' },
        { id: head.id, name: 'head' },
      ])
      const commands = build.operations.map((operation) => ({
        type: 'AiAnimationAssetBatch',
        operations: [operation],
      }))
      const historyBefore = undo.entries.length
      const result = executeProposal({ dispatcher, undoStack: undo }, commands)
      expect(result.ok).toBe(true)
      expect(undo.entries.length).toBe(historyBefore + 1)
      const collection = engine.getClipCollection(build.collection!.id)
      expect(collection.name).toBe('lie to stand')
      expect(collection.getBindingsObject()).toEqual({
        body: build.steps[0]!.clipId,
        head: build.steps[1]!.clipId,
      })
      expect(engine.getClip(build.steps[0]!.clipId).name).toBe('body move')
      expect(engine.getClip(build.steps[1]!.clipId).name).toBe('head move')
    })
  })

  it('converts morph orphans to name-based clip values', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = (
      engine as unknown as { getActiveSlide: () => { scene: { id: string; root: { id: string } } } }
    ).getActiveSlide()
    const mesh = createDefaultRectangleMesh(10, 10)
    const node = (
      engine as unknown as {
        createNode: (
          sceneId: string,
          parentId: string,
          name: string,
          opts: unknown,
        ) => { id: string; name: string }
      }
    ).createNode(slide.scene.id, slide.scene.root.id, 'meshnode', {
      components: { mesh: { kind: 'mesh', mesh } },
    })
    const shapeA = (
      engine as unknown as { createShape: (nodeId: string, name: string) => { id: string } }
    ).createShape(node.id, 'A')
    const shapeB = (
      engine as unknown as { createShape: (nodeId: string, name: string) => { id: string } }
    ).createShape(node.id, 'B')
    ;(
      engine as unknown as {
        setMorphBinding: (nodeId: string, binding: unknown) => void
      }
    ).setMorphBinding(node.id, { fromShapeId: shapeA.id, toShapeId: shapeB.id })
    for (const [time, value] of [
      [0, 0],
      [1, 1],
    ] as const) {
      const res = dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'morph', nodeId: node.id },
          time,
          value,
        }) as never,
      )
      if (!res.ok) throw new Error('morph keyframe failed')
    }
    const plan = extractClipBatchBlock(
      '```clip-batch\nclip: m | node: meshnode | semantic: body\ncollection: test collection | source: meshnode\n```',
    )
    const built = buildClipBatchOperations({
      engine,
      nodes: [{ id: node.id, name: 'meshnode' }],
      plan: plan!,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const op = built.build.operations[0] as Extract<AnimationAssetOperation, { kind: 'upsertClip' }>
    const clip = op.clip as unknown as {
      channels: unknown[]
      morphAnimation: {
        keyframes: { value: { fromShapeName: string | null; coefficient: number } }[]
      }
    }
    // Morph is implicit — no channel definition, name-based values.
    expect(clip.channels).toEqual([])
    expect(clip.morphAnimation.keyframes).toHaveLength(2)
    expect(clip.morphAnimation.keyframes[0]!.value).toMatchObject({ coefficient: 0 })
    const roundTripped = ClipDefinition.fromJSON(op.clip as never)
    expect(roundTripped.getMorphKeyframes()).toHaveLength(2)
  })

  describe('category-qualified morph refs', () => {
    function setupCategorizedMesh() {
      const { engine } = setupEngine()
      const slide = (
        engine as unknown as {
          getActiveSlide: () => { scene: { id: string; root: { id: string } } }
        }
      ).getActiveSlide()
      const mesh = createDefaultRectangleMesh(10, 10)
      const node = (
        engine as unknown as {
          createNode: (
            sceneId: string,
            parentId: string,
            name: string,
            opts: unknown,
          ) => { id: string; name: string }
        }
      ).createNode(slide.scene.id, slide.scene.root.id, 'paw', {
        components: { mesh: { kind: 'mesh', mesh } },
      })
      const internal = engine as unknown as {
        createShapeCategory: (nodeId: string, name: string, parent: null) => { id: string }
        createShape: (nodeId: string, name: string, categoryId: string | null) => { id: string }
      }
      const front = internal.createShapeCategory(node.id, 'front', null)
      const rear = internal.createShapeCategory(node.id, 'rear', null)
      internal.createShape(node.id, 'straight', front.id)
      internal.createShape(node.id, 'straight', rear.id)
      internal.createShape(node.id, 'half raised', front.id)
      return { engine, node }
    }

    function buildMorphBatch(
      engine: EnginePublic,
      node: { id: string; name: string },
      morphLine: string,
    ) {
      const plan = extractClipBatchBlock(
        [
          '```clip-batch',
          'window: 0 - 4',
          `clip: paw move | node: ${node.name} | semantic: paw`,
          morphLine,
          `collection: test collection | source: ${node.name}`,
          '```',
        ].join('\n'),
      )
      return buildClipBatchOperations({
        engine,
        nodes: [{ id: node.id, name: node.name }],
        plan: plan!,
      })
    }

    it('resolves Category/Name refs to the exact shape and stores paths', () => {
      const { engine, node } = setupCategorizedMesh()
      const built = buildMorphBatch(
        engine,
        node,
        'keys: morph front/straight -> front/half raised = 0@0, 1@4',
      )
      expect(built.ok).toBe(true)
      if (!built.ok) return
      const op = built.build.operations[0] as Extract<
        AnimationAssetOperation,
        { kind: 'upsertClip' }
      >
      const clip = op.clip as unknown as {
        morphAnimation: { keyframes: { value: Record<string, unknown> }[] }
      }
      expect(clip.morphAnimation.keyframes[0]!.value).toMatchObject({
        fromShapeName: 'straight',
        toShapeName: 'half raised',
        fromCategoryPath: ['front'],
        toCategoryPath: ['front'],
      })
      // Path-exact values round-trip through the canonical clip schema.
      expect(() => ClipDefinition.fromJSON(op.clip as never)).not.toThrow()
    })

    it('fails loudly on bare ambiguous names, naming qualified options', () => {
      const { engine, node } = setupCategorizedMesh()
      const built = buildMorphBatch(
        engine,
        node,
        'keys: morph straight -> front/half raised = 0@0, 1@4',
      )
      expect(built.ok).toBe(false)
      if (built.ok) return
      expect(built.error).toMatch(/matches several shapes/i)
      expect(built.error).toMatch(/front\/straight/)
      expect(built.error).toMatch(/rear\/straight/)
    })

    it('lists qualified names for unknown shapes', () => {
      const { engine, node } = setupCategorizedMesh()
      const built = buildMorphBatch(
        engine,
        node,
        'keys: morph front/bent -> front/half raised = 0@0, 1@4',
      )
      expect(built.ok).toBe(false)
      if (built.ok) return
      expect(built.error).toMatch(/unknown morph shape/i)
      expect(built.error).toMatch(/front\/straight/)
    })

    it('exposes qualified names in the context snapshot', async () => {
      const { engine, node } = setupCategorizedMesh()
      const { buildContextSnapshot } = await import('../ai/contextSnapshot')
      const snapshot = buildContextSnapshot(engine, {})
      const entry = snapshot.animation.rig.shapeInventory.find((row) => row.nodeId === node.id)
      expect(entry?.qualifiedShapeNames).toEqual(
        expect.arrayContaining(['front/straight', 'rear/straight', 'front/half raised']),
      )
      const geometry = snapshot.animation.shapeGeometry?.find((row) => row.nodeId === node.id)
      expect(geometry?.shapes.find((shape) => shape.name === 'straight')?.categoryPath).toEqual([
        'front',
      ])
    })
  })
})
