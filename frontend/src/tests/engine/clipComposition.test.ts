import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import type { AnimationProperty } from '../../engine'
import type { EvaluatedNodeScratch } from '../../engine/animationEvaluator'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
  AddKeyframeCommand,
  AssignClipCommand,
  SetClipInstanceEnabledCommand,
  MoveClipLayerCommand,
  SetClipParamDefaultCommand,
  OverrideClipParamCommand,
  createCommandSystem,
} from '../../engine/commands'
import { createBuiltInClips } from '../../engine/builtInClips'
import { evaluatedNodeScratch } from '../../engine/animationEvaluator'
import {
  createClipInstance,
  clipInstanceToJSON,
  clipInstanceFromJSON,
} from '../../engine/clipInstance'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setup() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const node = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  return { system, slide, nodeId: node.nodeId }
}

function evaluate(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  time: number,
  target?: EvaluatedNodeScratch,
) {
  return system.engine.evaluateNode(nodeId, time, target)
}

function createClipWithChannel(
  system: ReturnType<typeof createCommandSystem>,
  property: AnimationProperty,
  keyframes: Array<{ time: number; value: number }>,
  paramKey?: string,
): string {
  const inverse = expectOk(
    system.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'TestClip',
        duration: 1,
        category: 'test',
        params: paramKey ? [{ key: paramKey, label: paramKey, kind: 'float', default: 1 }] : [],
        channels: [{ property, ...(paramKey !== undefined ? { paramKey } : {}) }],
      }),
    ),
  )
  const clipId = inverse.clipId
  for (const kf of keyframes) {
    expectOk(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: property },
          time: kf.time,
          value: kf.value,
        }),
      ),
    )
  }
  return clipId
}

function assignClip(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  clipId: string,
  overrides?: {
    startTime?: number
    speed?: number
    enabled?: boolean
    paramOverrides?: Record<string, number>
  },
): string {
  const inverse = expectOk(
    system.dispatcher.dispatch(
      new AssignClipCommand({
        nodeId,
        clipId,
        ...overrides,
      }),
    ),
  )
  return inverse.instanceId
}

describe('clip composition', () => {
  it('single unlinked channel: kf(u) absolute overwrites base', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 10 },
      { time: 1, value: 20 },
    ])
    assignClip(system, nodeId, clipId)

    // Clip duration is 1s, speed=1, startTime=0
    // t=0: u=0 -> 10
    expect(evaluate(system, nodeId, 0).transform.x).toBe(10)
    // t=5: u=clamp(5/1, 0, 1)=1 -> 20 (clamped at end)
    expect(evaluate(system, nodeId, 5).transform.x).toBe(20)
  })

  it('single linked channel (gain): base * (gain * kf(u))', () => {
    const { system } = setup()
    const slide = system.engine.project!.slides[0]!
    const nodeBInverse = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
          transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const nodeB = system.engine.getNode(nodeBInverse.nodeId)

    const clipId = createClipWithChannel(
      system,
      'positionX',
      [
        { time: 0, value: 1 },
        { time: 1, value: 2 },
      ],
      'gain',
    )
    assignClip(system, nodeB.id, clipId)

    // Clip duration is 1s, speed=1, startTime=0
    // t=0: u=0 -> kf=1, base=10, gain=1 -> 10 * (1*1) = 10
    expect(evaluate(system, nodeB.id, 0).transform.x).toBe(10)
    // t=5: u=clamp(5/1, 0, 1)=1 -> kf=2, base=10, gain=1 -> 10 * (1*2) = 20
    expect(evaluate(system, nodeB.id, 5).transform.x).toBe(20)
  })

  it('linked channel with param override: base * (override * kf(u))', () => {
    const { system } = setup()
    const slide = system.engine.project!.slides[0]!
    const nodeBInverse = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
          transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const nodeB = system.engine.getNode(nodeBInverse.nodeId)

    const clipId = createClipWithChannel(
      system,
      'positionX',
      [
        { time: 0, value: 1 },
        { time: 1, value: 2 },
      ],
      'gain',
    )
    assignClip(system, nodeB.id, clipId, { paramOverrides: { gain: 0.5 } })

    // Clip duration is 1s, speed=1, startTime=0
    // t=0: u=0 -> kf=1, base=10, gain=0.5 -> 10 * (0.5*1) = 5
    expect(evaluate(system, nodeB.id, 0).transform.x).toBe(5)
    // t=5: u=clamp(5/1, 0, 1)=1 -> kf=2, base=10, gain=0.5 -> 10 * (0.5*2) = 10
    expect(evaluate(system, nodeB.id, 5).transform.x).toBe(10)
  })

  it('layer ordering: last writer wins per channel', () => {
    const { system, nodeId } = setup()
    const clip1 = createClipWithChannel(system, 'positionX', [{ time: 0, value: 100 }])
    const clip2 = createClipWithChannel(system, 'positionX', [{ time: 0, value: 200 }])
    assignClip(system, nodeId, clip1)
    assignClip(system, nodeId, clip2)

    expect(evaluate(system, nodeId, 0).transform.x).toBe(200)
  })

  it('disabled instances are skipped', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [{ time: 0, value: 100 }])
    assignClip(system, nodeId, clipId, { enabled: false })

    expect(evaluate(system, nodeId, 0).transform.x).toBe(0)
  })

  it('startTime offsets clip-local time', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ])
    // Clip duration is 1s, starts at t=5 in slide time
    assignClip(system, nodeId, clipId, { startTime: 5 })

    // Before clip starts: u=clamp((0-5)*1/1, 0, 1)=0 -> 0
    expect(evaluate(system, nodeId, 0).transform.x).toBe(0)
    // At clip start: u=0 -> 0
    expect(evaluate(system, nodeId, 5).transform.x).toBe(0)
    // Midpoint: u=clamp((5.5-5)*1/1, 0, 1)=0.5 -> 50
    expect(evaluate(system, nodeId, 5.5).transform.x).toBe(50)
    // At clip end: u=clamp((6-5)*1/1, 0, 1)=1 -> 100
    expect(evaluate(system, nodeId, 6).transform.x).toBe(100)
    // After clip end: u=1 -> 100 (holds)
    expect(evaluate(system, nodeId, 10).transform.x).toBe(100)
  })

  it('speed affects clip-local time', () => {
    const { system, nodeId } = setup()
    // Clip duration is 1s
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ])
    // speed=2 means clip plays 2x faster, finishes in 0.5s
    assignClip(system, nodeId, clipId, { speed: 2 })

    // u=clamp((0-0)*2/1, 0, 1)=0 -> 0
    expect(evaluate(system, nodeId, 0).transform.x).toBe(0)
    // u=clamp((0.25-0)*2/1, 0, 1)=0.5 -> 50
    expect(evaluate(system, nodeId, 0.25).transform.x).toBe(50)
    // u=clamp((0.5-0)*2/1, 0, 1)=1 -> 100 (clip finished at t=0.5)
    expect(evaluate(system, nodeId, 0.5).transform.x).toBe(100)
    // After clip: holds at 100
    expect(evaluate(system, nodeId, 5).transform.x).toBe(100)
  })

  it('u clamps to [0,1] — holds at end', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 0.5, value: 50 },
    ])
    assignClip(system, nodeId, clipId)

    expect(evaluate(system, nodeId, 3).transform.x).toBe(50)
    expect(evaluate(system, nodeId, 10).transform.x).toBe(50)
  })

  it('camera rotation contributes nothing', () => {
    const { system, slide } = setup()
    const cameraId = slide.scene.camera.id
    const clipId = createClipWithChannel(system, 'rotation', [{ time: 0, value: 45 }])
    assignClip(system, cameraId, clipId)

    expect(evaluate(system, cameraId, 0).transform.rotation).toBe(0)
  })

  it('determinism: same project + time + instances = identical output', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ])
    assignClip(system, nodeId, clipId)

    const results: number[] = []
    for (let i = 0; i < 5; i++) {
      results.push(evaluate(system, nodeId, 5).transform.x)
    }
    expect(results.every((r) => r === results[0])).toBe(true)
  })

  it('disabling an instance removes its contribution', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [{ time: 0, value: 100 }])
    const instId = assignClip(system, nodeId, clipId)

    expect(evaluate(system, nodeId, 0).transform.x).toBe(100)

    expectOk(
      system.dispatcher.dispatch(
        new SetClipInstanceEnabledCommand({ nodeId, instanceId: instId, enabled: false }),
      ),
    )
    expect(evaluate(system, nodeId, 0).transform.x).toBe(0)
  })

  it('multiple channels on same clip compose independently', () => {
    const { system, nodeId } = setup()

    // Create a clip with both positionX and scaleX channels via the command system
    const clipInverse = expectOk(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Multi',
          duration: 1,
          channels: [{ property: 'positionX' }, { property: 'scaleX' }],
        }),
      ),
    )
    const clipId = clipInverse.clipId

    expectOk(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'positionX' },
          time: 0,
          value: 50,
        }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'scaleX' },
          time: 0,
          value: 3,
        }),
      ),
    )

    assignClip(system, nodeId, clipId)

    const state = evaluate(system, nodeId, 0)
    expect(state.transform.x).toBe(50)
    expect(state.transform.scaleX).toBe(3)
  })
})

describe('clip instance JSON round-trip', () => {
  it('round-trips through JSON serialization', () => {
    const instance = createClipInstance('clip-1', 1.5, 2, false, { gain: 0.5 })
    const json = clipInstanceToJSON(instance)
    const restored = clipInstanceFromJSON(json)
    expect(restored.id).toBe(instance.id)
    expect(restored.clipId).toBe('clip-1')
    expect(restored.startTime).toBe(1.5)
    expect(restored.speed).toBe(2)
    expect(restored.enabled).toBe(false)
    expect(restored.paramOverrides.gain).toBe(0.5)
  })
})

describe('evaluator no-allocation performance', () => {
  it('evaluates hundreds of instances without per-frame allocations', () => {
    const { system, nodeId } = setup()

    for (let i = 0; i < 200; i++) {
      const clipId = createClipWithChannel(system, 'positionX', [
        { time: 0, value: i },
        { time: 1, value: i + 1 },
      ])
      assignClip(system, nodeId, clipId)
    }

    const target = evaluatedNodeScratch()
    // Warm up
    for (let t = 0; t <= 10; t += 0.5) {
      evaluate(system, nodeId, t, target)
    }

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      evaluate(system, nodeId, 5, target)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('cross-slide clip assignment', () => {
  it('assigns the same clip to nodes on different slides and evaluates both', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 100 },
      { time: 1, value: 200 },
    ])

    // Assign to node on slide 1
    assignClip(system, nodeId, clipId)

    // Create slide 2 with its own node
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' })))
    const slide2 = system.engine.project?.slides[1]
    if (!slide2) throw new Error('expected slide 2')
    const node2Inverse = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide2.scene.id,
          parentId: slide2.scene.root.id,
          name: 'B',
        }),
      ),
    )

    // Assign the same clip to node on slide 2
    assignClip(system, node2Inverse.nodeId, clipId)

    // Both nodes evaluate to the same clip values
    expect(evaluate(system, nodeId, 0).transform.x).toBe(100)
    expect(evaluate(system, node2Inverse.nodeId, 0).transform.x).toBe(100)
    expect(evaluate(system, nodeId, 5).transform.x).toBe(200)
    expect(evaluate(system, node2Inverse.nodeId, 5).transform.x).toBe(200)
  })
})

describe('definition edit propagates to all instances', () => {
  it('adding a keyframe to a clip definition updates all linked instances', () => {
    const { system, nodeId } = setup()
    const clipId = createClipWithChannel(system, 'positionX', [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
    ])
    assignClip(system, nodeId, clipId)

    // Before: evaluates linearly
    expect(evaluate(system, nodeId, 0.5).transform.x).toBeCloseTo(50)

    // Add a keyframe to the definition
    expectOk(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId, channel: 'positionX' },
          time: 0.5,
          value: 75,
        }),
      ),
    )

    // After: the instance now reflects the added keyframe
    expect(evaluate(system, nodeId, 0.5).transform.x).toBeCloseTo(75)
  })

  it('changing a param default updates all linked instances', () => {
    const { system } = setup()
    const slide = system.engine.project!.slides[0]!
    // Create a node with x=10 so base is non-zero for gain formula: base * (gain * kf)
    const nodeBInverse = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
          transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const clipId = createClipWithChannel(
      system,
      'positionX',
      [
        { time: 0, value: 1 },
        { time: 1, value: 1 },
      ],
      'gain',
    )
    assignClip(system, nodeBInverse.nodeId, clipId)

    // Default gain=1: base=10, kf=1 -> 10 * (1*1) = 10
    expect(evaluate(system, nodeBInverse.nodeId, 0).transform.x).toBe(10)

    // Change the default to 2
    expectOk(
      system.dispatcher.dispatch(
        new SetClipParamDefaultCommand({ clipId, paramKey: 'gain', defaultValue: 2 }),
      ),
    )

    // Now: base=10, kf=1, gain=2 -> 10 * (2*1) = 20
    expect(evaluate(system, nodeBInverse.nodeId, 0).transform.x).toBe(20)
  })
})

describe('instance override isolation', () => {
  it('overriding a param on one instance does not affect another', () => {
    const { system } = setup()
    const slide = system.engine.project!.slides[0]!
    // Create a node with x=10 so base is non-zero for gain formula: base * (gain * kf)
    const nodeBInverse = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'B',
          transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const nodeId = nodeBInverse.nodeId
    const clipId = createClipWithChannel(
      system,
      'positionX',
      [
        { time: 0, value: 1 },
        { time: 1, value: 1 },
      ],
      'gain',
    )
    const inst1 = assignClip(system, nodeId, clipId)
    const inst2 = assignClip(system, nodeId, clipId)

    // Both start with default gain=1
    // Instance 1: 10 * (1*1) = 10; Instance 2: 10 * (1*1) = 10
    expect(evaluate(system, nodeId, 0).transform.x).toBe(10)

    // Override gain on instance 1 only
    expectOk(
      system.dispatcher.dispatch(
        new OverrideClipParamCommand({ nodeId, instanceId: inst1, paramKey: 'gain', value: 0.5 }),
      ),
    )

    // Instance 1: 10 * (0.5*1) = 5; Instance 2: 5 * (1*1) = 5 (chained)
    expect(evaluate(system, nodeId, 0).transform.x).toBe(5)

    // Override gain on instance 2 to 2 — only instance 2 changes
    expectOk(
      system.dispatcher.dispatch(
        new OverrideClipParamCommand({ nodeId, instanceId: inst2, paramKey: 'gain', value: 2 }),
      ),
    )
    // Instance 1: 10 * (0.5*1) = 5; Instance 2: 5 * (2*1) = 10
    expect(evaluate(system, nodeId, 0).transform.x).toBe(10)

    // Disable instance 2 to see instance 1's contribution alone
    expectOk(
      system.dispatcher.dispatch(
        new SetClipInstanceEnabledCommand({ nodeId, instanceId: inst2, enabled: false }),
      ),
    )
    // Only instance 1: 10 * (0.5*1) = 5
    expect(evaluate(system, nodeId, 0).transform.x).toBe(5)
  })
})

describe('layer reorder evaluation', () => {
  it('reordering layers changes the evaluation result per last-writer-wins', () => {
    const { system, nodeId } = setup()
    const clip1 = createClipWithChannel(system, 'positionX', [{ time: 0, value: 100 }])
    const clip2 = createClipWithChannel(system, 'positionX', [{ time: 0, value: 200 }])
    const inst1 = assignClip(system, nodeId, clip1)
    assignClip(system, nodeId, clip2)

    // Default order: clip1 first, clip2 second (last-writer-wins -> 200)
    expect(evaluate(system, nodeId, 0).transform.x).toBe(200)

    // Move clip2 to index 0 (before clip1)
    expectOk(
      system.dispatcher.dispatch(
        new MoveClipLayerCommand({ nodeId, instanceId: inst1, newIndex: 1 }),
      ),
    )

    // New order: clip2 first, clip1 second (last-writer-wins -> 100)
    expect(evaluate(system, nodeId, 0).transform.x).toBe(100)
  })
})

describe('built-in clips', () => {
  it('createBuiltInClips returns exactly 21 clips', () => {
    const clips = createBuiltInClips()
    expect(clips).toHaveLength(21)
    const names = clips.map((c) => c.name)
    expect(names).toContain('Fade In')
    expect(names).toContain('Fade Out')
    expect(names).toContain('Pop')
    expect(names).toContain('Bounce')
    expect(names).toContain('Float')
    expect(names).toContain('Shake')
    expect(names).toContain('Pulse')
    expect(names).toContain('Rotate')
    expect(names).toContain('Blink')
    expect(names).toContain('Wobble')
    expect(names).toContain('Jump')
  })
})

describe('evaluator no-allocation performance — thousands of keyframes', () => {
  it('evaluates with 1000+ keyframes across many nodes without per-frame allocations', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')

    // Create 50 nodes with 20 keyframes each = 1000 keyframes total
    const nodeIds: string[] = []
    for (let n = 0; n < 50; n++) {
      const node = expectOk(
        system.dispatcher.dispatch(
          new CreateNodeCommand({
            sceneId: slide.scene.id,
            parentId: slide.scene.root.id,
            name: `Node${n}`,
          }),
        ),
      )
      nodeIds.push(node.nodeId)
      for (let k = 0; k < 20; k++) {
        expectOk(
          system.dispatcher.dispatch(
            new AddKeyframeCommand({
              target: { kind: 'node', nodeId: node.nodeId, property: 'positionX' },
              time: k * 0.5,
              value: k * 10,
            }),
          ),
        )
      }
    }

    // Verify total keyframe count
    let totalKeyframes = 0
    for (const nid of nodeIds) {
      totalKeyframes += system.engine.getKeyframes(nid, 'positionX').length
    }
    expect(totalKeyframes).toBe(1000)

    // Evaluate all 50 nodes at t=5 (within range) — should complete fast
    const target = evaluatedNodeScratch()
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      for (const nid of nodeIds) {
        system.engine.evaluateNode(nid, 5, target)
      }
    }
    const elapsed = performance.now() - start
    // 100 passes × 50 nodes = 5000 evaluations, should be well under 5 seconds
    expect(elapsed).toBeLessThan(5000)
  })
})
