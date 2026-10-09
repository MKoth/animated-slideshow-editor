import { describe, expect, it, vi } from 'vitest'
import { buildContextSnapshot, filterConversations } from '../ai/contextSnapshot'
import type { EnginePublic } from '../engine'

function mockEngine(): EnginePublic {
  const root = { id: 'root', name: 'Root', children: [{ id: 'n-1', name: 'Cat', children: [] }] }
  return {
    project: {
      id: 'p-1',
      name: 'Cat Lesson',
      slides: [
        { id: 's-1', name: 'Intro', scene: { root } },
        { id: 's-2', name: 'Board', scene: { root } },
      ],
    },
    materialDefinitions: [{ name: 'Chalk' }],
    shaderDefinitions: [{ name: 'Grain' }],
    clips: [{ name: 'Bounce' }],
    getActiveSlide: () => ({
      id: 's-1',
      name: 'Intro',
      duration: 5,
      scene: { root },
    }),
    getNode: (id: string) => {
      if (id === 'root') return root as never
      if (id === 'n-1') return { id: 'n-1', name: 'Cat', children: [] } as never
      throw new Error('missing')
    },
  } as unknown as EnginePublic
}

describe('Context snapshot', () => {
  it('reflects live engine state including unsaved project name', () => {
    const snapshot = buildContextSnapshot(mockEngine(), {
      selection: ['n-1'],
      assetNames: ['cat.png'],
    })

    expect(snapshot.projectName).toBe('Cat Lesson')
    expect(snapshot.activeSlideName).toBe('Intro')
    expect(snapshot.slides.map((s) => s.name)).toEqual(['Intro', 'Board'])
    expect(snapshot.sceneNodes.some((n) => n.includes('Cat') && n.includes('n-1'))).toBe(true)
    expect(snapshot.selection).toEqual(['n-1'])
    expect(snapshot.materials).toEqual(['Chalk'])
    expect(snapshot.clips).toEqual(['Bounce'])
    expect(snapshot.assets).toEqual(['cat.png'])
  })

  it('never mutates the project', () => {
    const engine = mockEngine()
    const before = JSON.stringify(engine.project)
    buildContextSnapshot(engine, {})
    expect(JSON.stringify(engine.project)).toBe(before)
  })

  it('assembles well under 50 ms for typical projects', () => {
    const engine = mockEngine()
    const started = performance.now()
    buildContextSnapshot(engine, {})
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('logs but never throws on slow or broken scenes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const engine = {
      project: null,
      materialDefinitions: [],
      shaderDefinitions: [],
      clips: [],
      getActiveSlide: () => {
        throw new Error('no slide')
      },
      getNode: () => {
        throw new Error('no node')
      },
    } as unknown as EnginePublic
    expect(() => buildContextSnapshot(engine, {})).not.toThrow()
    warn.mockRestore()
  })
})

describe('Conversation search (client-side)', () => {
  const conversations = [
    { id: 'c-1', title: 'Intro ideas' },
    { id: 'c-2', title: 'Board plan' },
  ]
  const messages = {
    'c-1': [{ role: 'user', content: 'hello cat' }],
    'c-2': [{ role: 'assistant', content: 'chalk board steps' }],
  }

  it('filters by title', () => {
    expect(filterConversations(conversations, messages, 'intro')).toHaveLength(1)
  })

  it('filters by user and assistant content', () => {
    expect(filterConversations(conversations, messages, 'cat')[0].id).toBe('c-1')
    expect(filterConversations(conversations, messages, 'chalk')[0].id).toBe('c-2')
  })

  it('returns all on empty query', () => {
    expect(filterConversations(conversations, messages, '   ')).toHaveLength(2)
  })
})
