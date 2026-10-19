import { describe, expect, it } from 'vitest'
import {
  briefsFromScenarioVisuals,
  normalizeBridgeKey,
  resolveScenarioReuse,
  SCENARIO_BRIDGE_STYLE_PROFILE,
} from '../../engine/scenarioArtBridge'

describe('scenarioArtBridge', () => {
  it('normalizes keys like the markdown parser', () => {
    expect(normalizeBridgeKey('  Young  Doctor Smiling ')).toBe('young-doctor-smiling')
    expect(normalizeBridgeKey('Clock')).toBe('clock')
  })

  it('resolves reuse by exact name, case-insensitive, and reports missing', () => {
    const visuals = [
      { key: 'cat', alt: 'Cat', reuse: 'Blackboard Cat' },
      { key: 'dog', alt: 'Dog', reuse: '  blackboard cat  ' },
      { key: 'ghost', alt: 'Ghost', reuse: 'No Such Asset' },
      { key: 'brief-only', alt: 'Brief Only', brief: 'A brief' },
    ]
    const definitions = [{ id: 'd-1', name: 'Blackboard Cat' }]
    const { matched, missing } = resolveScenarioReuse(visuals, definitions)
    expect(matched).toHaveLength(2)
    expect(matched[0].definitionId).toBe('d-1')
    expect(missing).toHaveLength(1)
    expect(missing[0].reuse).toBe('No Such Asset')
  })

  it('ignores fuzzy matches for reuse', () => {
    const { matched } = resolveScenarioReuse(
      [{ key: 'chalk-text', alt: 'Chalk Text', reuse: 'chalk' }],
      [{ id: 'd-1', name: 'chalkboard' }],
    )
    expect(matched).toHaveLength(0)
  })

  it('seeds Prompt Variants from visual briefs in the Generation Workflow shape', () => {
    const briefs = briefsFromScenarioVisuals([
      { key: 'young-doctor-smiling', alt: 'Young Doctor Smiling', brief: 'Warm smile.', step: 2 },
      { key: 'cat', alt: 'Cat', reuse: 'Blackboard Cat', brief: 'Ignored.' },
      { key: 'empty', alt: 'Empty' },
    ])
    expect(briefs).toHaveLength(1)
    const brief = briefs[0]!
    expect(brief.hint).toBe('young-doctor-smiling')
    expect(brief.name).toBe('Young Doctor Smiling')
    expect(brief.stepId).toBe('step-2')
    expect(brief.styleProfile).toEqual({ ...SCENARIO_BRIDGE_STYLE_PROFILE })
    expect(Object.keys(brief.variants).sort()).toEqual(['concise', 'detailed', 'stylized'])
    expect(brief.prompt).toContain('Warm smile.')
    expect(brief.wizardEntry.assetName).toBe('Young Doctor Smiling')
    expect(brief.editable).toBe(true)
  })
})
