import { describe, expect, it } from 'vitest'
import { ClipDefinition, type ClipParam, type ClipChannelDef } from '../../engine/clipDefinition'

function makeClip(
  overrides: Partial<{ params: ClipParam[]; channels: ClipChannelDef[] }> = {},
): ClipDefinition {
  return new ClipDefinition(
    'test-clip',
    'Test',
    1,
    'test',
    overrides.params ?? [],
    overrides.channels ?? [],
  )
}

function makeParam(key: string, kind = 'number'): ClipParam {
  return { key, label: key, kind, default: 0 }
}

function makeChannel(property: string, paramKey?: string): ClipChannelDef {
  const ch: ClipChannelDef = { property: property as ClipChannelDef['property'] }
  if (paramKey !== undefined) {
    return { ...ch, paramKey }
  }
  return ch
}

describe('ClipParamKind', () => {
  it('accepts recognised kinds', () => {
    const clip = makeClip({
      params: [makeParam('a', 'number'), makeParam('b', 'color'), makeParam('c', 'vec2')],
    })
    expect(clip.getParam('a')?.kind).toBe('number')
    expect(clip.getParam('b')?.kind).toBe('color')
    expect(clip.getParam('c')?.kind).toBe('vec2')
  })

  it('accepts custom kind strings', () => {
    const clip = makeClip({ params: [makeParam('a', 'custom-kind')] })
    expect(clip.getParam('a')?.kind).toBe('custom-kind')
  })
})

describe('ClipDefinition.addParam', () => {
  it('adds a param to the clip', () => {
    const clip = makeClip()
    clip.addParam(makeParam('gain', 'number'))
    expect(clip.params).toHaveLength(1)
    expect(clip.getParam('gain')).toEqual({
      key: 'gain',
      label: 'gain',
      kind: 'number',
      default: 0,
    })
  })

  it('rejects empty key', () => {
    const clip = makeClip()
    expect(() => clip.addParam(makeParam(''))).toThrow('must not be empty')
  })

  it('rejects duplicate key', () => {
    const clip = makeClip({ params: [makeParam('gain')] })
    expect(() => clip.addParam(makeParam('gain'))).toThrow('already exists')
  })
})

describe('ClipDefinition.removeParam', () => {
  it('removes a param and returns it', () => {
    const clip = makeClip({ params: [makeParam('gain'), makeParam('offset')] })
    const removed = clip.removeParam('gain')
    expect(removed).toEqual({ key: 'gain', label: 'gain', kind: 'number', default: 0 })
    expect(clip.params).toHaveLength(1)
    expect(clip.getParam('gain')).toBeUndefined()
  })

  it('returns undefined for unknown key', () => {
    const clip = makeClip()
    expect(clip.removeParam('ghost')).toBeUndefined()
  })

  it('unlinks channels that reference the removed param', () => {
    const clip = makeClip({
      params: [makeParam('gain')],
      channels: [{ property: 'positionX', paramKey: 'gain' }],
    })
    clip.removeParam('gain')
    expect(clip.getChannel('positionX')?.paramKey).toBeUndefined()
  })
})

describe('ClipDefinition.addChannel', () => {
  it('adds a channel and its animation', () => {
    const clip = makeClip()
    clip.addChannel(makeChannel('positionX'))
    expect(clip.hasChannel('positionX')).toBe(true)
    expect(clip.channelAnimation('positionX')).toBeDefined()
  })

  it('rejects duplicate channel', () => {
    const clip = makeClip({ channels: [makeChannel('positionX')] })
    expect(() => clip.addChannel(makeChannel('positionX'))).toThrow('already exists')
  })
})

describe('ClipDefinition.removeChannel', () => {
  it('removes channel definition and animation', () => {
    const clip = makeClip({
      channels: [makeChannel('positionX'), makeChannel('opacity')],
    })
    clip.removeChannel('positionX')
    expect(clip.hasChannel('positionX')).toBe(false)
    expect(clip.channelAnimation('positionX')).toBeUndefined()
    expect(clip.hasChannel('opacity')).toBe(true)
  })

  it('is a no-op for non-existent channel', () => {
    const clip = makeClip()
    clip.removeChannel('rotation')
    expect(clip.channels).toHaveLength(0)
  })
})

describe('ClipDefinition custom params serialization round-trip', () => {
  it('serializes and deserializes custom params', () => {
    const clip = makeClip({
      params: [
        { key: 'gain', label: 'Gain', kind: 'number', default: 1 },
        { key: 'tint', label: 'Tint Color', kind: 'color', default: 0xff0000 },
      ],
      channels: [{ property: 'positionX', paramKey: 'gain' }, { property: 'opacity' }],
    })

    const json = clip.toJSON()
    expect(json.params).toHaveLength(2)
    expect(json.params[0]).toEqual({ key: 'gain', label: 'Gain', kind: 'number', default: 1 })
    expect(json.params[1]).toEqual({
      key: 'tint',
      label: 'Tint Color',
      kind: 'color',
      default: 0xff0000,
    })

    const restored = ClipDefinition.fromJSON(json)
    expect(restored.params).toHaveLength(2)
    expect(restored.getParam('gain')?.kind).toBe('number')
    expect(restored.getParam('tint')?.kind).toBe('color')
    expect(restored.getChannel('positionX')?.paramKey).toBe('gain')
  })

  it('deserializes rejects duplicate param keys', () => {
    const json = {
      id: 'c',
      name: 'C',
      duration: 1,
      category: '',
      params: [
        { key: 'x', label: 'X', kind: 'number', default: 0 },
        { key: 'x', label: 'X2', kind: 'color', default: 0 },
      ],
      channels: [],
    }
    expect(() => ClipDefinition.fromJSON(json)).toThrow('Duplicate clip param key')
  })
})
