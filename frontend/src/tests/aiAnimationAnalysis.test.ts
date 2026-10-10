import { describe, expect, it } from 'vitest'
import {
  analyzeBeats,
  resolveTarget,
  type AnimationAnalysisSnapshot,
  type RequestedBeat,
} from '../ai/animationAnalysis'

function snapshot(): AnimationAnalysisSnapshot {
  return {
    nodes: [
      {
        id: 'root',
        name: 'Room',
        parentId: null,
        depth: 0,
        semanticName: null,
        components: [],
        assetDefinitionId: null,
      },
      {
        id: 'n-cat',
        name: 'Cat',
        parentId: 'root',
        depth: 1,
        semanticName: 'cat',
        components: ['mesh'],
        assetDefinitionId: 'asset-cat',
      },
      {
        id: 'n-tail',
        name: 'Tail',
        parentId: 'n-cat',
        depth: 2,
        semanticName: 'tail',
        components: ['mesh'],
        assetDefinitionId: null,
      },
      {
        id: 'n-sofa-frame',
        name: 'Sofa Frame',
        parentId: 'root',
        depth: 1,
        semanticName: null,
        components: ['mesh'],
        assetDefinitionId: 'asset-room',
      },
      {
        id: 'n-sofa-cushion',
        name: 'Sofa Cushion',
        parentId: 'root',
        depth: 1,
        semanticName: null,
        components: ['mesh'],
        assetDefinitionId: 'asset-room',
      },
      {
        id: 'n-blackboard',
        name: 'Blackboard',
        parentId: 'root',
        depth: 1,
        semanticName: 'blackboard',
        components: [],
        assetDefinitionId: 'asset-room',
      },
    ],
    clips: [
      { id: 'clip-walk', name: 'Walk', channels: ['positionX', 'positionY'] },
      { id: 'clip-sit', name: 'Sit', channels: ['positionY'] },
    ],
    collections: [
      {
        id: 'col-walk',
        name: 'Walk Cycle',
        bindings: { cat: 'clip-walk' },
      },
      {
        id: 'col-dog-walk',
        name: 'Dog Walk',
        bindings: { dog: 'clip-walk' },
      },
    ],
    shapes: [{ nodeId: 'n-cat', shapeCount: 2, shapeNames: ['Sit', 'Stretch'] }],
    hasCamera: false,
  }
}

function beat(overrides: Partial<RequestedBeat> & { id: string }): RequestedBeat {
  return {
    label: overrides.id,
    target: {},
    motion: null,
    requiresCamera: false,
    ...overrides,
  }
}

describe('resolveTarget (stable identity, existing structure/metadata)', () => {
  it('prefers a stable node id over names', () => {
    const resolved = resolveTarget({ nodeId: 'n-cat', name: 'Sofa' }, snapshot())
    expect(resolved.status).toBe('resolved')
    expect(resolved.nodeIds).toEqual(['n-cat'])
  })

  it('resolves an exact Unique Name (case-insensitive)', () => {
    const resolved = resolveTarget({ name: 'blackboard' }, snapshot())
    expect(resolved.status).toBe('resolved')
    expect(resolved.nodeIds).toEqual(['n-blackboard'])
  })

  it('resolves an exact Semantic Name to every carrier without asking', () => {
    const resolved = resolveTarget({ name: 'tail' }, snapshot())
    expect(resolved.status).toBe('resolved')
    expect(resolved.nodeIds).toEqual(['n-tail'])
  })

  it('resolves by asset metadata when names do not match', () => {
    const resolved = resolveTarget({ assetDefinitionId: 'asset-cat' }, snapshot())
    expect(resolved.status).toBe('resolved')
    expect(resolved.nodeIds).toEqual(['n-cat'])
  })

  it('asks when the evidence leaves multiple plausible matches', () => {
    const resolved = resolveTarget({ name: 'sofa' }, snapshot())
    expect(resolved.status).toBe('ambiguous')
    expect(resolved.nodeIds).toEqual([])
    expect(resolved.candidates.map((c) => c.id).sort()).toEqual(
      ['n-sofa-cushion', 'n-sofa-frame'].sort(),
    )
    expect(resolved.question).toMatch(/sofa/i)
    // Candidates carry stable identity so the artist can answer precisely.
    expect(resolved.candidates[0]).toMatchObject({ id: expect.any(String) })
    // ...along with hierarchy evidence for disambiguation.
    expect(resolved.candidates[0].parentName).toBe('Room')
  })

  it('asks on a single partial match instead of animating a look-alike', () => {
    const resolved = resolveTarget({ name: 'cush' }, snapshot())
    expect(resolved.status).toBe('ambiguous')
    expect(resolved.nodeIds).toEqual([])
    expect(resolved.candidates.map((c) => c.id)).toEqual(['n-sofa-cushion'])
    expect(resolved.question).toMatch(/cush/i)
  })

  it('says when a stale asset reference falls through to name matching', () => {
    const resolved = resolveTarget({ name: 'Cat', assetDefinitionId: 'asset-gone' }, snapshot())
    expect(resolved.status).toBe('resolved')
    expect(resolved.nodeIds).toEqual(['n-cat'])
    expect(resolved.warning).toMatch(/asset-gone/i)
  })

  it('reports unresolved targets with zero candidates instead of guessing', () => {
    const resolved = resolveTarget({ name: 'Chandelier' }, snapshot())
    expect(resolved.status).toBe('unresolved')
    expect(resolved.nodeIds).toEqual([])
    expect(resolved.candidates).toEqual([])
  })
})

describe('analyzeBeats (reusable motion, gaps, prerequisites, invalid beats)', () => {
  it('marks binding-compatible reusable motion as ready', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-walk',
          label: 'Walk across the room',
          target: { name: 'Cat' },
          motion: 'walk',
        }),
      ],
      snapshot(),
    )
    expect(result.beats).toHaveLength(1)
    expect(result.beats[0].status).toBe('ready')
    expect(result.beats[0].resolvedNodeIds).toEqual(['n-cat'])
    expect(result.beats[0].reusable.map((c) => c.collectionId)).toContain('col-walk')
  })

  it('does not infer reuse from names alone when rig bindings disagree', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-dog',
          label: 'Dog walk on the cat',
          target: { name: 'Cat' },
          motion: 'dog walk',
        }),
      ],
      snapshot(),
    )
    expect(result.beats[0].status).toBe('missing-motion')
    expect(result.beats[0].resolvedNodeIds).toEqual(['n-cat'])
    // The name match is preserved as evidence — but explicitly not trusted.
    expect(result.beats[0].warnings.join(' ').toLowerCase()).toMatch(/binding/)
  })

  it('reports missing motion with a closest-fit shape suggestion', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-sleep',
          label: 'Sleep on the sofa',
          target: { name: 'Cat' },
          motion: 'sleep',
        }),
      ],
      snapshot(),
    )
    const analysis = result.beats[0]
    expect(analysis.status).toBe('missing-motion')
    expect(analysis.geometry.state).toBe('missing-with-suggestion')
    expect(typeof analysis.geometry.closestFit).toBe('string')
  })

  it('surfaces a missing camera as a human-authored prerequisite', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-camera',
          label: 'Turn and move toward the camera',
          target: { name: 'Cat' },
          motion: 'turn',
          requiresCamera: true,
        }),
      ],
      snapshot(),
    )
    expect(result.beats[0].status).toBe('missing-prerequisite')
    expect(result.beats[0].prerequisites.join(' ').toLowerCase()).toMatch(/camera/)
    expect(result.beats[0].actions.join(' ').toLowerCase()).toMatch(/camera/)
  })

  it('marks a text-inferred camera dependency as an assumption to confirm', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-camera-hint',
          label: 'Move toward the camera',
          target: { name: 'Cat' },
          motion: 'walk',
        }),
      ],
      snapshot(),
    )
    expect(result.beats[0].status).toBe('missing-prerequisite')
    expect(result.beats[0].warnings.join(' ').toLowerCase()).toMatch(/inferr.*camera|confirm/)
  })

  it('flags invalid beats with the precise action to take', () => {
    const result = analyzeBeats(
      [beat({ id: 'b-bad', label: '  ', target: {}, motion: null })],
      snapshot(),
    )
    expect(result.beats[0].status).toBe('invalid')
    expect(result.beats[0].actions.length).toBeGreaterThan(0)
  })

  it('asks for clarification instead of animating the wrong object', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-sofa',
          label: 'Get down from the sofa',
          target: { name: 'sofa' },
          motion: 'get-down',
        }),
      ],
      snapshot(),
    )
    expect(result.beats[0].status).toBe('needs-clarification')
    expect(result.beats[0].question).toMatch(/sofa/i)
    expect(result.beats[0].resolvedNodeIds).toEqual([])
  })
})

describe('analyzeBeats independence', () => {
  it('keeps analyzing independent beats when another beat is blocked', () => {
    const result = analyzeBeats(
      [
        beat({
          id: 'b-blocked',
          label: 'Get down from the sofa',
          target: { name: 'sofa' },
          motion: 'get-down',
        }),
        beat({
          id: 'b-ready',
          label: 'Walk across the room',
          target: { name: 'Cat' },
          motion: 'walk',
        }),
      ],
      snapshot(),
    )
    expect(result.beats).toHaveLength(2)
    expect(result.beats[0].status).toBe('needs-clarification')
    expect(result.beats[1].status).toBe('ready')
    expect(result.summary.ready).toBe(1)
    expect(result.summary.blocked).toBe(1)
  })

  it('never mutates the snapshot or the requested beats', () => {
    const snap = snapshot()
    const beats = [beat({ id: 'b-walk', target: { name: 'Cat' }, motion: 'walk' })]
    const beforeSnap = JSON.stringify(snap)
    const beforeBeats = JSON.stringify(beats)
    analyzeBeats(beats, snap)
    expect(JSON.stringify(snap)).toBe(beforeSnap)
    expect(JSON.stringify(beats)).toBe(beforeBeats)
  })
})
