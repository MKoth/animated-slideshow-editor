import { describe, expect, it } from 'vitest'
import { buildBlackboardFocus } from '../ai/blackboardFocus'
import { buildContextSnapshot } from '../ai/contextSnapshot'
import type { EnginePublic } from '../engine'

const SOURCE = [
  'script "Step 1 — Who you are" from 0',
  'let slideLen = 4',
  'create group "Board" as board',
  'mark("part-0")',
  'create text "text1" as text1 inside board { content: "Ser is identity.", fontSize: 26, alignment: "center" }',
  'reveal(text1, over: 2.50, visual: chalkHand, sound: writeSfx)',
  'carry(oaktree, to: { x: 545, y: 360 }, over: 1.50, visual: emptyHand)',
].join('\n')

function focusSlide() {
  return {
    id: 's-1',
    name: 'Step 1 — Who you are',
    duration: 4,
    prompter: {
      parts: [
        { id: 'pp-1', text: 'Ser is for who you are.', startTime: 0, endTime: 4, duration: 4 },
      ],
    },
    animationScript: { source: SOURCE },
  }
}

describe('blackboard focus (issue #472)', () => {
  it('carries active slide id plus length with prompt blocks and fractions', () => {
    const focus = buildBlackboardFocus(focusSlide() as never)
    expect(focus?.slideId).toBe('s-1')
    expect(focus?.slideName).toBe('Step 1 — Who you are')
    expect(focus?.duration).toBeCloseTo(4)
    expect(focus?.promptBlocks).toHaveLength(1)
    expect(focus?.promptBlocks[0]).toMatchObject({
      id: 'pp-1',
      start: 0,
      end: 4,
    })
    expect(focus?.promptBlocks[0]?.text).toContain('Ser is for who you are')
    // Sequential overs: reveal 2.5 then carry 1.5; midpoints 1.25 and 3.25.
    expect(focus?.actions.map((a) => a.action)).toEqual(['reveal(text1)', 'carry(oaktree)'])
    for (const action of focus?.actions ?? []) {
      expect(action.block).toBe('pp-1')
      expect(action.fraction).toBeGreaterThanOrEqual(0)
      expect(action.fraction).toBeLessThanOrEqual(1)
    }
    expect(focus?.actions[0]?.fraction).toBeCloseTo(1.25 / 4)
    expect(focus?.actions[1]?.fraction).toBeCloseTo(3.25 / 4)
  })

  it('returns null without an active slide and empty actions without a script', () => {
    expect(buildBlackboardFocus(null)).toBeNull()
    const focus = buildBlackboardFocus({
      id: 's-9',
      name: 'Empty',
      duration: 2,
      prompter: {
        parts: [{ id: 'pp-9', text: 'Hi.', startTime: 0, endTime: 2, duration: 2 }],
      },
      animationScript: null,
    } as never)
    expect(focus?.promptBlocks).toHaveLength(1)
    expect(focus?.actions).toEqual([])
  })

  it('ties each action to its owning prompt block window', () => {
    const focus = buildBlackboardFocus({
      id: 's-2',
      name: 'Two blocks',
      duration: 6,
      prompter: {
        parts: [
          { id: 'pp-a', text: 'First.', startTime: 0, endTime: 2, duration: 2 },
          { id: 'pp-b', text: 'Second.', startTime: 2, endTime: 6, duration: 4 },
        ],
      },
      animationScript: {
        source: ['script "Two blocks" from 0', 'reveal(a, over: 2)', 'reveal(b, over: 4)'].join(
          '\n',
        ),
      },
    } as never)
    expect(focus?.actions.map((a) => a.block)).toEqual(['pp-a', 'pp-b'])
  })
})

function mockEngine(): EnginePublic {
  const root = { id: 'root', name: 'Root', children: [] }
  return {
    project: { id: 'p-1', name: 'Lesson', slides: [{ id: 's-1', name: 'Intro' }] },
    materialDefinitions: [],
    shaderDefinitions: [],
    clips: [],
    getActiveSlide: () => ({
      id: 's-1',
      name: 'Intro',
      duration: 5,
      scene: { root },
      prompter: {
        parts: [{ id: 'pp-1', text: 'Hello world.', startTime: 0, endTime: 5, duration: 5 }],
      },
      animationScript: {
        source: ['script "Intro" from 0', 'reveal(line0, over: 5)'].join('\n'),
      },
    }),
    getNode: () => {
      throw new Error('missing')
    },
  } as unknown as EnginePublic
}

describe('context snapshot blackboard focus', () => {
  it('exposes active slide id plus length with prompt blocks and fractions', () => {
    const snapshot = buildContextSnapshot(mockEngine(), {})
    expect(snapshot.activeSlideId).toBe('s-1')
    expect(snapshot.activeSlideName).toBe('Intro')
    expect(snapshot.activeSlideDuration).toBe(5)
    expect(snapshot.blackboardFocus?.slideId).toBe('s-1')
    expect(snapshot.blackboardFocus?.duration).toBe(5)
    expect(snapshot.blackboardFocus?.promptBlocks[0]?.id).toBe('pp-1')
    expect(snapshot.blackboardFocus?.promptBlocks[0]?.text).toContain('Hello world')
    expect(snapshot.blackboardFocus?.actions[0]?.action).toBe('reveal(line0)')
    expect(snapshot.blackboardFocus?.actions[0]?.block).toBe('pp-1')
  })

  it('omits the focus in blackboard-only snapshots', () => {
    const snapshot = buildContextSnapshot(mockEngine(), { blackboardOnly: true })
    expect(snapshot.activeSlideId).toBeNull()
    expect(snapshot.activeSlideDuration).toBeNull()
    expect(snapshot.blackboardFocus).toBeUndefined()
  })
})
