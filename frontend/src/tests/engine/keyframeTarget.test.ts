import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { SceneNode } from '../../engine/sceneNode'
import {
  isParameterTarget,
  isPropertyTarget,
  requireKeyframeTarget,
  requireTrackKeyframeValue,
  resolveKeyframeTrack,
} from '../../engine/keyframeTarget'

const CUSTOM_MATERIAL = {
  id: 'mat-params',
  name: 'Params',
  parameters: [
    { key: 'uSteps', kind: 'int', default: 2 },
    { key: 'uEnabled', kind: 'bool', default: true },
    { key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] },
    { key: 'uGlow', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'color', default: '#ff0000' },
    { key: 'uMask', kind: 'sampler2D', default: '' },
  ],
}

function setupNode() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
  engine.registerMaterialDefinition(
    CUSTOM_MATERIAL.id,
    CUSTOM_MATERIAL.name,
    CUSTOM_MATERIAL.parameters,
  )
  engine.assignMaterial(node.id, CUSTOM_MATERIAL.id)
  const kindOf = (candidate: SceneNode, parameter: string): string | undefined =>
    engine.getMaterialParameterKind(candidate, parameter)
  return { engine, slide, node, kindOf }
}

describe('keyframe target guards', () => {
  it('distinguishes property targets from parameter targets', () => {
    const property = { kind: 'node', nodeId: 'n1', property: 'positionX' } as const
    const parameter = { kind: 'node', nodeId: 'n1', parameter: 'tint' } as const
    expect(isPropertyTarget(property)).toBe(true)
    expect(isParameterTarget(property)).toBe(false)
    expect(isPropertyTarget(parameter)).toBe(false)
    expect(isParameterTarget(parameter)).toBe(true)
  })

  it('rejects malformed targets', () => {
    expect(() => requireKeyframeTarget({ kind: 'clip', clipId: 'c1' })).toThrow(
      /unknown animation property/i,
    )
    expect(() => requireKeyframeTarget(null)).toThrow(/unknown keyframe target/i)
    expect(() =>
      requireKeyframeTarget({ kind: 'node', nodeId: '', property: 'positionX' }),
    ).toThrow()
    expect(() => requireKeyframeTarget({ kind: 'node', nodeId: 'n1', property: 'bogus' })).toThrow(
      /unknown animation property/i,
    )
    expect(() => requireKeyframeTarget({ kind: 'node', nodeId: 'n1', parameter: '  ' })).toThrow(
      /non-empty/i,
    )
  })

  it('accepts a uniform-six property and a material parameter key', () => {
    expect(requireKeyframeTarget({ kind: 'node', nodeId: 'n1', property: 'opacity' })).toEqual({
      kind: 'node',
      nodeId: 'n1',
      property: 'opacity',
    })
    expect(requireKeyframeTarget({ kind: 'node', nodeId: 'n1', parameter: 'tint' })).toEqual({
      kind: 'node',
      nodeId: 'n1',
      parameter: 'tint',
    })
  })
})

describe('resolveKeyframeTrack', () => {
  it('resolves a property target to its property track', () => {
    const { node, kindOf } = setupNode()
    expect(
      resolveKeyframeTrack(
        node,
        { kind: 'node', nodeId: node.id, property: 'rotation' },
        kindOf,
        () => false,
      ),
    ).toEqual({ kind: 'property', property: 'rotation' })
  })

  it('rejects the camera rotation property', () => {
    const { engine, kindOf } = setupNode()
    const camera = engine.getNode(engine.getActiveSlide()?.scene.camera.id ?? '')
    expect(() =>
      resolveKeyframeTrack(
        camera,
        { kind: 'node', nodeId: camera.id, property: 'rotation' },
        kindOf,
        () => false,
      ),
    ).toThrow(/rotation/i)
  })

  it('rejects a property outside the uniform six', () => {
    const { node, kindOf } = setupNode()
    expect(() =>
      resolveKeyframeTrack(
        node,
        { kind: 'node', nodeId: node.id, property: 'bogus' as never },
        kindOf,
        () => false,
      ),
    ).toThrow(/unknown animation property/i)
  })

  it('resolves a parameter target to its material track with the parameter kind', () => {
    const { node, kindOf } = setupNode()
    expect(
      resolveKeyframeTrack(
        node,
        { kind: 'node', nodeId: node.id, parameter: 'uSteps' },
        kindOf,
        () => false,
      ),
    ).toEqual({ kind: 'parameter', parameter: 'uSteps', kindOf: 'int' })
  })

  it('rejects an unknown parameter with no existing track', () => {
    const { node, kindOf } = setupNode()
    expect(() =>
      resolveKeyframeTrack(
        node,
        { kind: 'node', nodeId: node.id, parameter: 'uGhost' },
        kindOf,
        () => false,
      ),
    ).toThrow(/unknown material parameter/i)
  })

  it('keeps resolving a parameter whose material no longer defines it while its track survives', () => {
    const { node, kindOf } = setupNode()
    const track = resolveKeyframeTrack(
      node,
      { kind: 'node', nodeId: node.id, parameter: 'uSteps' },
      kindOf,
      () => false,
    )
    expect(track.kind).toBe('parameter')
    const orphan = resolveKeyframeTrack(
      node,
      { kind: 'node', nodeId: node.id, parameter: 'uRetired' },
      kindOf,
      (parameter) => parameter === 'uRetired',
    )
    expect(orphan).toEqual({ kind: 'parameter', parameter: 'uRetired', kindOf: undefined })
  })

  it('resolves built-in tint and opacityMultiplier parameters of the default material', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    const kindOf = (candidate: SceneNode, parameter: string): string | undefined =>
      engine.getMaterialParameterKind(candidate, parameter)
    expect(
      resolveKeyframeTrack(
        node,
        { kind: 'node', nodeId: node.id, parameter: 'tint' },
        kindOf,
        () => false,
      ),
    ).toEqual({ kind: 'parameter', parameter: 'tint', kindOf: 'color' })
    expect(
      resolveKeyframeTrack(
        node,
        { kind: 'node', nodeId: node.id, parameter: 'opacityMultiplier' },
        kindOf,
        () => false,
      ),
    ).toEqual({ kind: 'parameter', parameter: 'opacityMultiplier', kindOf: 'number' })
  })
})

describe('requireTrackKeyframeValue', () => {
  it('validates property values per property (opacity in [0, 1])', () => {
    expect(requireTrackKeyframeValue({ kind: 'property', property: 'opacity' }, 0.5)).toBe(0.5)
    expect(() => requireTrackKeyframeValue({ kind: 'property', property: 'opacity' }, 1.5)).toThrow(
      /opacity/i,
    )
    expect(requireTrackKeyframeValue({ kind: 'property', property: 'positionX' }, 100)).toBe(100)
    expect(() =>
      requireTrackKeyframeValue({ kind: 'property', property: 'positionX' }, Number.NaN),
    ).toThrow(/finite/i)
  })

  it('validates material values per kind', () => {
    const int = { kind: 'parameter', parameter: 'uSteps', kindOf: 'int' } as const
    const bool = { kind: 'parameter', parameter: 'uEnabled', kindOf: 'bool' } as const
    const vec2 = { kind: 'parameter', parameter: 'uOffset', kindOf: 'vec2' } as const
    const float = { kind: 'parameter', parameter: 'uGlow', kindOf: 'float' } as const
    const color = { kind: 'parameter', parameter: 'uColor', kindOf: 'color' } as const
    const sampler = { kind: 'parameter', parameter: 'uMask', kindOf: 'sampler2D' } as const

    expect(requireTrackKeyframeValue(int, 3)).toBe(3)
    expect(() => requireTrackKeyframeValue(int, 2.5)).toThrow(/integer/i)
    expect(requireTrackKeyframeValue(bool, false)).toBe(false)
    expect(() => requireTrackKeyframeValue(bool, 'yes')).toThrow(/boolean/i)
    expect(requireTrackKeyframeValue(vec2, [0.1, 0.2])).toEqual([0.1, 0.2])
    expect(() => requireTrackKeyframeValue(vec2, [0.1, 0.2, 0.3])).toThrow(/length 2/i)
    expect(requireTrackKeyframeValue(float, 0.5)).toBe(0.5)
    expect(requireTrackKeyframeValue(color, '#00ff00')).toBe('#00ff00')
    expect(() => requireTrackKeyframeValue(color, 'green')).toThrow(/hex/i)
    expect(requireTrackKeyframeValue(sampler, 'asset-1')).toBe('asset-1')
    expect(() => requireTrackKeyframeValue(sampler, '')).toThrow(/asset id/i)
  })

  it('falls back to the generic override shape for an orphaned parameter track', () => {
    const orphan = { kind: 'parameter', parameter: 'uRetired', kindOf: undefined } as const
    expect(requireTrackKeyframeValue(orphan, '#ff0000')).toBe('#ff0000')
    expect(() => requireTrackKeyframeValue(orphan, '')).toThrow(/non-empty/i)
  })
})
