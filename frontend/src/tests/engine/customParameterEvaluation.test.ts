import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import type { EvaluatedMaterialOverridesScratch } from '../../engine/animationEvaluator'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  AssignMaterialCommand,
  OverrideMaterialParameterCommand,
  AssignClipCommand,
  OverrideClipParamCommand,
  CommandDispatcher,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import type { MaterialParameterDefault } from '../../engine/materialResolution'
import { evaluatedMaterialOverridesScratch } from '../../engine/animationEvaluator'
import { ClipDefinition } from '../../engine/clipDefinition'
import type { ClipChannelDef, ClipParam } from '../../engine/clipDefinition'
import { newKeyframeId, Keyframe as KeyframeModel } from '../../engine/keyframe'

const MATERIAL: { id: string; name: string; parameters: MaterialParameterDefault[] } = {
  id: 'mat-customeval',
  name: 'CustomEval',
  parameters: [
    { key: 'uGlow', kind: 'number', default: 0 },
    { key: 'uIntensity', kind: 'float', default: 0.5 },
    { key: 'uTint', kind: 'color', default: '#000000' },
  ],
}

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  nodeId: string
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setup(): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  engine.registerMaterialDefinition(MATERIAL.id, MATERIAL.name, MATERIAL.parameters)
  expectOk(
    dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: MATERIAL.id })),
  )
  return { engine, dispatcher, undoStack, nodeId }
}

function createMaterialClip(
  engine: Engine,
  name: string,
  duration: number,
  params: ClipParam[],
  channels: ClipChannelDef[],
  materialKeyframes: Record<string, Array<{ time: number; value: number }>>,
): string {
  const clip = new ClipDefinition(
    `clip-${Math.random().toString(36).slice(2)}`,
    name,
    duration,
    'test',
    params,
    channels,
  )
  for (const [paramKey, kfs] of Object.entries(materialKeyframes)) {
    for (const kf of kfs) {
      clip.addMaterialChannelKeyframe(
        paramKey,
        new KeyframeModel(newKeyframeId(), kf.time, kf.value),
      )
    }
  }
  engine.importClip(clip)
  return clip.id
}

function evaluateMaterial(
  s: Setup,
  time: number,
  target: EvaluatedMaterialOverridesScratch = evaluatedMaterialOverridesScratch(),
) {
  return s.engine.evaluateMaterialOverrides(s.nodeId, time, target)
}

function assignClip(
  s: Setup,
  clipId: string,
  overrides?: {
    startTime?: number
    speed?: number
    enabled?: boolean
    paramOverrides?: Record<string, number>
  },
): string {
  const inverse = expectOk(
    s.dispatcher.dispatch(
      new AssignClipCommand({
        nodeId: s.nodeId,
        clipId,
        ...overrides,
      }),
    ),
  )
  return inverse.instanceId
}

function overrideParameter(
  s: Setup,
  parameter: string,
  value: number | string | boolean | readonly number[],
): void {
  expectOk(
    s.dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId: s.nodeId, parameter, value }),
    ),
  )
}

describe('custom parameter channel evaluation', () => {
  it('unlinked material channel: kf(u) overwrites base value', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'GlowFade',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      {
        uGlow: [
          { time: 0, value: 0 },
          { time: 1, value: 1 },
        ],
      },
    )
    assignClip(s, clipId)

    // t=0: u=0 -> kf=0
    expect(evaluateMaterial(s, 0).uGlow).toBe(0)
    // t=0.5: u=0.5 -> kf=0.5
    expect(evaluateMaterial(s, 0.5).uGlow).toBeCloseTo(0.5)
    // t=1: u=1 -> kf=1
    expect(evaluateMaterial(s, 1).uGlow).toBe(1)
    // After clip ends, holds at last kf
    expect(evaluateMaterial(s, 5).uGlow).toBe(1)
  })

  it('linked material channel with gain: base * (gain * kf(u))', () => {
    const s = setup()

    // Set a static base override of 10
    overrideParameter(s, 'uGlow', 10)

    const clipId = createMaterialClip(
      s.engine,
      'GainGlow',
      1,
      [{ key: 'gain', label: 'Gain', kind: 'number', default: 1 }],
      [
        {
          property: 'opacity',
          materialParameter: 'uGlow',
          paramKey: 'gain',
          linkMode: 'gain',
        },
      ],
      {
        uGlow: [
          { time: 0, value: 1 },
          { time: 1, value: 2 },
        ],
      },
    )
    assignClip(s, clipId)

    // t=0: u=0 -> kf=1, base=10, gain=1 -> 10 * (1*1) = 10
    expect(evaluateMaterial(s, 0).uGlow).toBe(10)
    // t=5: u=1 -> kf=2, base=10, gain=1 -> 10 * (1*2) = 20
    expect(evaluateMaterial(s, 5).uGlow).toBe(20)
  })

  it('linked material channel with offset: base + (offset * kf(u))', () => {
    const s = setup()

    // Set a static base override of 5
    overrideParameter(s, 'uGlow', 5)

    const clipId = createMaterialClip(
      s.engine,
      'OffsetGlow',
      1,
      [{ key: 'amount', label: 'Amount', kind: 'number', default: 1 }],
      [
        {
          property: 'opacity',
          materialParameter: 'uGlow',
          paramKey: 'amount',
          linkMode: 'offset',
        },
      ],
      {
        uGlow: [
          { time: 0, value: 1 },
          { time: 1, value: 3 },
        ],
      },
    )
    assignClip(s, clipId)

    // t=0: u=0 -> kf=1, base=5, offset=1 -> 5 + (1*1) = 6
    expect(evaluateMaterial(s, 0).uGlow).toBe(6)
    // t=5: u=1 -> kf=3, base=5, offset=1 -> 5 + (1*3) = 8
    expect(evaluateMaterial(s, 5).uGlow).toBe(8)
  })

  it('param override on instance modifies gain/offset composition', () => {
    const s = setup()

    // Set base override of 10
    overrideParameter(s, 'uGlow', 10)

    const clipId = createMaterialClip(
      s.engine,
      'GainGlow',
      1,
      [{ key: 'gain', label: 'Gain', kind: 'number', default: 1 }],
      [
        {
          property: 'opacity',
          materialParameter: 'uGlow',
          paramKey: 'gain',
          linkMode: 'gain',
        },
      ],
      {
        uGlow: [
          { time: 0, value: 1 },
          { time: 1, value: 2 },
        ],
      },
    )
    const instId = assignClip(s, clipId, {
      paramOverrides: { gain: 0.5 },
    })

    // t=0: u=0 -> kf=1, base=10, gain=0.5 -> 10 * (0.5*1) = 5
    expect(evaluateMaterial(s, 0).uGlow).toBe(5)
    // t=5: u=1 -> kf=2, base=10, gain=0.5 -> 10 * (0.5*2) = 10
    expect(evaluateMaterial(s, 5).uGlow).toBe(10)

    // Override gain to 2
    expectOk(
      s.dispatcher.dispatch(
        new OverrideClipParamCommand({
          nodeId: s.nodeId,
          instanceId: instId,
          paramKey: 'gain',
          value: 2,
        }),
      ),
    )

    // t=0: u=0 -> kf=1, base=10, gain=2 -> 10 * (2*1) = 20
    expect(evaluateMaterial(s, 0).uGlow).toBe(20)
  })

  it('material parameter channels are evaluated after standard material tracks', () => {
    const s = setup()

    // Set static override
    overrideParameter(s, 'uGlow', 5)

    // Create a clip that also targets uGlow
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      { uGlow: [{ time: 0, value: 100 }] },
    )
    assignClip(s, clipId)

    // Clip overrides the static value: 100
    expect(evaluateMaterial(s, 0).uGlow).toBe(100)
  })

  it('material parameter channel layer ordering: last writer wins', () => {
    const s = setup()
    const clip1 = createMaterialClip(
      s.engine,
      'Clip1',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      { uGlow: [{ time: 0, value: 10 }] },
    )
    const clip2 = createMaterialClip(
      s.engine,
      'Clip2',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      { uGlow: [{ time: 0, value: 20 }] },
    )
    assignClip(s, clip1)
    assignClip(s, clip2)

    // Clip2 is last, so it wins
    expect(evaluateMaterial(s, 0).uGlow).toBe(20)
  })

  it('disabled clip instances are skipped for material channels', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      { uGlow: [{ time: 0, value: 99 }] },
    )
    assignClip(s, clipId, { enabled: false })

    // Disabled clip does not contribute
    expect(evaluateMaterial(s, 0).uGlow).toBeUndefined()
  })

  it('material channel with startTime offsets clip-local time', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      {
        uGlow: [
          { time: 0, value: 0 },
          { time: 1, value: 100 },
        ],
      },
    )
    assignClip(s, clipId, { startTime: 5 })

    // Before clip starts: no contribution
    expect(evaluateMaterial(s, 0).uGlow).toBeUndefined()
    // At clip start: u=0 -> 0
    expect(evaluateMaterial(s, 5).uGlow).toBe(0)
    // Midpoint: u=0.5 -> 50
    expect(evaluateMaterial(s, 5.5).uGlow).toBe(50)
    // At clip end: u=1 -> 100
    expect(evaluateMaterial(s, 6).uGlow).toBe(100)
    // After clip end: holds at 100
    expect(evaluateMaterial(s, 10).uGlow).toBe(100)
  })

  it('speed affects material channel clip-local time', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      {
        uGlow: [
          { time: 0, value: 0 },
          { time: 1, value: 100 },
        ],
      },
    )
    // speed=2 means clip plays 2x faster, finishes in 0.5s
    assignClip(s, clipId, { speed: 2 })

    expect(evaluateMaterial(s, 0).uGlow).toBe(0)
    // u=clamp((0.25-0)*2/1, 0, 1)=0.5 -> 50
    expect(evaluateMaterial(s, 0.25).uGlow).toBe(50)
    // u=clamp((0.5-0)*2/1, 0, 1)=1 -> 100 (clip finished at t=0.5)
    expect(evaluateMaterial(s, 0.5).uGlow).toBe(100)
    // After clip: holds at 100
    expect(evaluateMaterial(s, 5).uGlow).toBe(100)
  })

  it('end-to-end: clip with custom material param channel changes material param during evaluation', () => {
    const s = setup()

    // Verify initial material param is at default (0)
    expect(evaluateMaterial(s, 0).uGlow).toBeUndefined()

    // Create a clip that animates uGlow
    const clipId = createMaterialClip(
      s.engine,
      'GlowPulse',
      2,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      {
        uGlow: [
          { time: 0, value: 0 },
          { time: 0.5, value: 1 },
          { time: 1, value: 0 },
        ],
      },
    )
    assignClip(s, clipId)

    // Evaluate at different times
    // Clip duration=2, u = (time - 0) * 1 / 2
    // Keyframes: u=0→0, u=0.5→1, u=1→0
    expect(evaluateMaterial(s, 0).uGlow).toBe(0) // u=0 → 0
    expect(evaluateMaterial(s, 0.5).uGlow).toBe(0.5) // u=0.25 → 0.5 (linear interp between 0→1)
    expect(evaluateMaterial(s, 1).uGlow).toBe(1) // u=0.5 → 1
    expect(evaluateMaterial(s, 1.5).uGlow).toBe(0.5) // u=0.75 → 0.5 (linear interp between 1→0)
    expect(evaluateMaterial(s, 2).uGlow).toBe(0) // u=1 → 0
    // After clip ends, holds at 0
    expect(evaluateMaterial(s, 5).uGlow).toBe(0)
  })

  it('material channel with default param value (no override)', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [{ key: 'intensity', label: 'Intensity', kind: 'number', default: 2 }],
      [
        {
          property: 'opacity',
          materialParameter: 'uGlow',
          paramKey: 'intensity',
          linkMode: 'gain',
        },
      ],
      {
        uGlow: [
          { time: 0, value: 1 },
          { time: 1, value: 3 },
        ],
      },
    )
    assignClip(s, clipId)

    // t=0: u=0 -> kf=1, base=0, gain=2 (default) -> 0 * (2*1) = 0
    expect(evaluateMaterial(s, 0).uGlow).toBe(0)
    // t=5: u=1 -> kf=3, base=0, gain=2 (default) -> 0 * (2*3) = 0
    expect(evaluateMaterial(s, 5).uGlow).toBe(0)
  })

  it('material channel with base override and default param value', () => {
    const s = setup()

    // Set static override
    overrideParameter(s, 'uGlow', 5)

    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [{ key: 'intensity', label: 'Intensity', kind: 'number', default: 2 }],
      [
        {
          property: 'opacity',
          materialParameter: 'uGlow',
          paramKey: 'intensity',
          linkMode: 'gain',
        },
      ],
      {
        uGlow: [
          { time: 0, value: 1 },
          { time: 1, value: 3 },
        ],
      },
    )
    assignClip(s, clipId)

    // t=0: u=0 -> kf=1, base=5, gain=2 -> 5 * (2*1) = 10
    expect(evaluateMaterial(s, 0).uGlow).toBe(10)
    // t=5: u=1 -> kf=3, base=5, gain=2 -> 5 * (2*3) = 30
    expect(evaluateMaterial(s, 5).uGlow).toBe(30)
  })

  it('material channel target scratch reuse — same object returned', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [],
      [{ property: 'opacity', materialParameter: 'uGlow' }],
      { uGlow: [{ time: 0, value: 42 }] },
    )
    assignClip(s, clipId)

    const target = evaluatedMaterialOverridesScratch()
    const first = s.engine.evaluateMaterialOverrides(s.nodeId, 0, target)
    expect(first).toBe(target.values)
    expect(first.uGlow).toBe(42)

    const second = s.engine.evaluateMaterialOverrides(s.nodeId, 0, target)
    expect(second).toBe(target.values)
  })

  it('determinism — repeated evaluations produce identical results', () => {
    const s = setup()
    overrideParameter(s, 'uGlow', 5)
    const clipId = createMaterialClip(
      s.engine,
      'ClipGlow',
      1,
      [{ key: 'gain', label: 'Gain', kind: 'number', default: 1 }],
      [
        {
          property: 'opacity',
          materialParameter: 'uGlow',
          paramKey: 'gain',
          linkMode: 'gain',
        },
      ],
      {
        uGlow: [
          { time: 0, value: 1 },
          { time: 1, value: 2 },
        ],
      },
    )
    assignClip(s, clipId)

    const results: number[] = []
    for (let i = 0; i < 10; i++) {
      results.push(evaluateMaterial(s, 0.5).uGlow as number)
    }
    expect(results.every((r) => r === results[0])).toBe(true)
  })

  it('multiple material parameter channels on same clip compose independently', () => {
    const s = setup()
    const clipId = createMaterialClip(
      s.engine,
      'MultiParam',
      1,
      [],
      [
        { property: 'opacity', materialParameter: 'uGlow' },
        { property: 'scaleX', materialParameter: 'uIntensity' },
      ],
      {
        uGlow: [{ time: 0, value: 42 }],
        uIntensity: [{ time: 0, value: 0.75 }],
      },
    )
    assignClip(s, clipId)

    const result = evaluateMaterial(s, 0)
    expect(result.uGlow).toBe(42)
    expect(result.uIntensity).toBeCloseTo(0.75)
  })
})
