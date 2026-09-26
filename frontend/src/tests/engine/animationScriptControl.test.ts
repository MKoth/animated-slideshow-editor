import { describe, expect, it } from 'vitest'
import {
  AddClipKeyframeCommand,
  AddKeyframeCommand,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetControlSetCommand,
  SetSlideAnimationScriptCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { createControl, createControlSet, evaluateControlTrack } from '../../engine/control'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'
import { runAnimationScript } from '../../engine/animationScriptRun'

type System = ReturnType<typeof createCommandSystem>

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { system, slideId: slide.id }
}

function dispatchOk<T>(system: System, command: Command<T>): T {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse as T
}

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

function addNode(
  system: System,
  slideId: string,
  name: string,
  options: { semanticName?: string; parentId?: string } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: options.parentId ?? slide.scene.root.id,
      name,
      ...(options.semanticName !== undefined && { semanticName: options.semanticName }),
    }),
  ).nodeId
}

function addHost(
  system: System,
  slideId: string,
  name: string,
  controls: readonly { key: string; default?: number; exposed?: boolean }[],
  semanticName?: string,
): string {
  const nodeId = addNode(system, slideId, name, semanticName === undefined ? {} : { semanticName })
  dispatchOk(
    system,
    new SetControlSetCommand({
      nodeId,
      controlSet: createControlSet(
        nodeId,
        controls.map((control) =>
          createControl({
            key: control.key,
            default: control.default,
            exposed: control.exposed ?? true,
          }),
        ),
      ),
    }),
  )
  return nodeId
}

function check(
  system: System,
  slideId: string,
  lines: readonly string[],
): AnimationScriptCompileResult {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function apply(system: System, result: AnimationScriptCompileResult): void {
  dispatchOk(system, new TransactionCommand([...result.commands]))
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

function errorMessages(result: AnimationScriptCompileResult): string {
  return errors(result)
    .map((diagnostic) => diagnostic.message)
    .join('\n')
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

function controlTrack(system: System, nodeId: string, key: string) {
  return system.engine
    .getKeyframesOf({ kind: 'control', nodeId, controlKey: key })
    .map((keyframe) => ({
      time: keyframe.time,
      value: keyframe.value,
      interpolation: keyframe.interpolation,
    }))
}

function evaluateControl(system: System, nodeId: string, key: string, time: number): number {
  return evaluateControlTrack(
    system.engine.getKeyframesOf({ kind: 'control', nodeId, controlKey: key }),
    time,
    0,
  )
}

describe('Animation Script control writes', () => {
  it('tweens an exposed Control on the host and evaluates through control evaluation', () => {
    const { system, slideId } = setup()
    const hostId = addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness', default: 0 }])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 1, 1, linear)',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Rig.control:Mouth.Openness',
    ])
    expect(result.summary.keyframeCount).toBe(2)
    apply(system, result)

    expect(controlTrack(system, hostId, 'Mouth.Openness')).toEqual([
      { time: 0, value: 0, interpolation: 'linear' },
      { time: 1, value: 1, interpolation: 'linear' },
    ])
    expect(evaluateControl(system, hostId, 'Mouth.Openness', 0.5)).toBeCloseTo(0.5)
    expect(evaluateControl(system, hostId, 'Mouth.Openness', 1)).toBe(1)
  })

  it('drives a bound descendant through the engine control evaluation', () => {
    const { system, slideId } = setup()
    const hostId = addNode(system, slideId, 'Rig')
    const targetId = addNode(system, slideId, 'Target', {
      semanticName: 'target',
      parentId: hostId,
    })
    const clip = dispatchOk(
      system,
      new CreateClipCommand({
        name: 'Normalized X',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    for (const [time, value] of [
      [0, 10],
      [1, 30],
    ] as const) {
      dispatchOk(
        system,
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip.clipId, channel: 'positionX' },
          time,
          value,
        }),
      )
    }
    dispatchOk(
      system,
      new SetControlSetCommand({
        nodeId: hostId,
        controlSet: createControlSet(hostId, [
          createControl({
            key: 'Mouth.Openness',
            bindings: { target: clip.clipId },
            exposed: true,
          }),
        ]),
      }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 1, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    // The Control value 0 → 1 drives the bound clip channel 10 → 30.
    expect(system.engine.evaluateNode(targetId, 0).transform.x).toBe(10)
    expect(system.engine.evaluateNode(targetId, 0.5).transform.x).toBe(20)
    expect(system.engine.evaluateNode(targetId, 1).transform.x).toBe(30)
  })

  it('advances the cursor by each duration and boundary-pins every written Control', () => {
    const { system, slideId } = setup()
    const hostId = addHost(system, slideId, 'Rig', [
      { key: 'Mouth.Openness', default: 0.25 },
      { key: 'Brow.Raise', default: 0.5 },
    ])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 1, 0.5, linear)',
      'rig.control("Brow.Raise", 0, 0.25, hold)',
      'rig.set({ x: 2 })',
    ])

    expect(result.diagnostics).toEqual([])
    expect(result.summary.to).toBe(0.75)
    apply(system, result)

    expect(controlTrack(system, hostId, 'Mouth.Openness')).toEqual([
      { time: 0, value: 0.25, interpolation: 'linear' },
      { time: 0.5, value: 1, interpolation: 'linear' },
    ])
    expect(controlTrack(system, hostId, 'Brow.Raise')).toEqual([
      { time: 0, value: 0.5, interpolation: 'hold' },
      { time: 0.5, value: 0.5, interpolation: 'hold' },
      { time: 0.75, value: 0, interpolation: 'hold' },
    ])
    expect(
      system.engine
        .getKeyframes(hostId, 'positionX')
        .map((keyframe) => [keyframe.time, keyframe.value]),
    ).toEqual([
      [0, 0],
      [0.75, 2],
    ])
  })

  it('pins the pre-clear Control value at from, keeping hand data before the window', () => {
    const { system, slideId } = setup()
    const hostId = addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness', default: 0 }])
    for (const [time, value] of [
      [0, 0.25],
      [1, 1],
    ] as const) {
      dispatchOk(
        system,
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: hostId, controlKey: 'Mouth.Openness' },
          time,
          value,
          interpolation: 'linear',
        }),
      )
    }
    const source = [
      'script "Demo" from 0.5',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 0, 0.5, linear)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)

    expect(controlTrack(system, hostId, 'Mouth.Openness')).toEqual([
      { time: 0, value: 0.25, interpolation: 'linear' },
      { time: 0.5, value: 0.625, interpolation: 'linear' },
      { time: 1, value: 0, interpolation: 'linear' },
    ])
    expect(evaluateControl(system, hostId, 'Mouth.Openness', 0.5)).toBeCloseTo(0.625)
  })

  it('broadcasts a Control write to every group member, pinning each from its own value', () => {
    const { system, slideId } = setup()
    const rigOne = addHost(system, slideId, 'Rig 1', [{ key: 'Open', default: 0.2 }], 'mouth')
    const rigTwo = addHost(system, slideId, 'Rig 2', [{ key: 'Open', default: 0.6 }], 'mouth')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind mouths = group("mouth")',
      'mouths.control("Open", 1, 0.5, linear)',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(controlTrack(system, rigOne, 'Open')).toEqual([
      { time: 0, value: 0.2, interpolation: 'linear' },
      { time: 0.5, value: 1, interpolation: 'linear' },
    ])
    expect(controlTrack(system, rigTwo, 'Open')).toEqual([
      { time: 0, value: 0.6, interpolation: 'linear' },
      { time: 0.5, value: 1, interpolation: 'linear' },
    ])
  })

  it('replaces its own Control output on a re-run instead of duplicating it', () => {
    const { system, slideId } = setup()
    const hostId = addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness', default: 0 }])
    const source = [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 1, 1, linear)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)
    const afterFirst = controlTrack(system, hostId, 'Mouth.Openness')
    runOk(system, slideId, source)

    expect(controlTrack(system, hostId, 'Mouth.Openness')).toEqual(afterFirst)
    expect(controlTrack(system, hostId, 'Mouth.Openness')).toHaveLength(2)
  })
})

describe('Animation Script control write diagnostics', () => {
  it('reports a hidden Control with the key, the host and the exposed rule', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Secret', exposed: false }])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Secret", 1, 0.5, linear)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/Control "Secret" on "Rig" is hidden/)
    expect(errorMessages(result)).toMatch(/exposed/)
  })

  it('reports a missing Control with a near-miss candidate', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness' }])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openess", 1, 0.5, linear)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/No Control "Mouth.Openess" on "Rig"/)
    expect(errorMessages(result)).toContain('"Mouth.Openness"')
  })

  it('reports a broadcast member missing the Control by name', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig 1', [{ key: 'Open' }], 'mouth')
    addHost(system, slideId, 'Rig 2', [], 'mouth')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind mouths = group("mouth")',
      'mouths.control("Open", 1, 0.5, linear)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/Member "Rig 2" has no Control "Open"/)
  })

  it('rejects values outside 0…1', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness' }])

    const tooHigh = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 1.5, 0.5, linear)',
    ])
    const negative = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", -0.5, 0.5, linear)',
    ])

    expect(tooHigh.runnable).toBe(false)
    expect(errorMessages(tooHigh)).toMatch(/Control "Mouth.Openness" value must be between 0 and 1/)
    expect(negative.runnable).toBe(false)
    expect(errorMessages(negative)).toMatch(/between 0 and 1/)
  })

  it('rejects parametric eases and accepts hold, linear and bezier eases', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness' }])
    const script = (ease: string) =>
      check(system, slideId, [
        'script "Demo" from 0',
        'bind rig = node("Rig")',
        `rig.control("Mouth.Openness", 1, 0.5, ${ease})`,
      ])

    for (const ease of ['bounce', 'elastic', 'spring']) {
      const result = script(ease)
      expect(result.runnable).toBe(false)
      expect(errorMessages(result)).toMatch(
        new RegExp(`Parametric interpolation "${ease}" is not supported on Control Tracks`),
      )
    }
    for (const ease of ['hold', 'linear', 'easeInOut', 'quadratic']) {
      expect(script(ease).diagnostics).toEqual([])
    }
  })

  it('rejects a missing value, a non-string key and a duration-suffixed value', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness' }])

    const missingValue = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness")',
    ])
    const nonStringKey = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control(1, 0.5, 0.5)',
    ])
    const suffixedValue = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.control("Mouth.Openness", 1s, 0.5)',
    ])

    expect(missingValue.runnable).toBe(false)
    expect(errorMessages(missingValue)).toMatch(/Expected "," after the Control key/)
    expect(nonStringKey.runnable).toBe(false)
    expect(errorMessages(nonStringKey)).toMatch(/Control key/)
    expect(suffixedValue.runnable).toBe(false)
    expect(errorMessages(suffixedValue)).toMatch(/duration suffix/)
  })
})
