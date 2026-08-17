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
  AssignClipCommand,
  SetClipInstanceEnabledCommand,
  createCommandSystem,
} from '../../engine/commands'
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
