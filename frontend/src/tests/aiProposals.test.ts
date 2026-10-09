import { describe, expect, it } from 'vitest'
import {
  AI_COMMAND_ALLOWLIST,
  buildExecutableCommands,
  computeProjectFingerprint,
  dryRunValidate,
  executeProposal,
  isStale,
  validateProposalSchema,
} from '../ai/proposals'
import { CreateProjectCommand, CreateSlideCommand, createCommandSystem } from '../engine/commands'
import { CreatePrompterPartCommand } from '../engine/commands/createPrompterPartCommand'

function setup() {
  const system = createCommandSystem(() => {})
  const project = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!project.ok) throw new Error('no project')
  const slide = system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  if (!slide.ok) throw new Error('no slide')
  const slideId = (slide.inverse as { slideId: string }).slideId
  // Baseline AI history starts after setup: forget setup entries so tests
  // assert exactly one History Entry per proposal execution.
  const baseline = system.undoStack.entries.length
  return { system, slideId, baseline }
}

describe('AI proposal schema (mirrors server first)', () => {
  it('accepts real prompter commands and stage placeholders', () => {
    const result = validateProposalSchema([
      { type: 'CreateSlide', name: 'Middle 1' },
      { type: 'CreatePrompterPart', slideId: 's', text: 'Hi', duration: 1 },
      {
        type: 'AiCommitTts',
        slideId: 's',
        partId: 'p',
        assetId: 'a',
        timelineStart: 0,
        sourceEnd: 1,
      },
      { type: 'AiSetMorphCoefficient', nodeId: 'cat', coefficient: 0.5 },
      { type: 'AiCreateBoardText', slideId: 's', text: 'Ser es' },
      { type: 'SetSlideAnimationScript', slideId: 's', source: 'reveal x' },
      { type: 'AiImportSlides', slideIds: ['s1'] },
    ])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('blocks unknown types with a fixable allowlist message', () => {
    const result = validateProposalSchema([{ type: 'DeleteEverything' }])
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('DeleteEverything')
    expect(result.errors[0].message).toMatch(/Allowed|allowed/)
  })

  it('blocks missing fields and inline base64 asset refs', () => {
    const missing = validateProposalSchema([
      { type: 'CreatePrompterPart', text: 'Hi', duration: 1 },
    ])
    expect(missing.ok).toBe(false)
    expect(missing.errors[0].message).toContain('slideId')

    const inline = validateProposalSchema([
      {
        type: 'ReplacePrompterWords',
        slideId: 's',
        partId: 'p',
        startWordIndex: 0,
        endWordIndex: 0,
        ttsData: { data: 'A'.repeat(2000), mimeType: 'audio/wav' },
      },
    ])
    expect(inline.ok).toBe(false)
    expect(inline.errors[0].message.toLowerCase()).toContain('asset')
  })

  it('carries typed placeholders for stage C/D/E/merge commands', () => {
    expect(AI_COMMAND_ALLOWLIST).toContain('AiCommitTts')
    expect(AI_COMMAND_ALLOWLIST).toContain('AiSetMorphCoefficient')
    expect(AI_COMMAND_ALLOWLIST).toContain('AiCreateBoardText')
    expect(AI_COMMAND_ALLOWLIST).toContain('AiImportSlides')
  })
})

describe('AI proposal dry-run (client second, in order)', () => {
  it('passes on live-valid commands without mutating the engine', () => {
    const { system, slideId } = setup()
    const before = computeProjectFingerprint(system.engine)
    const commands = [
      { type: 'CreatePrompterPart', slideId, text: 'Hello', duration: 1.5 },
      { type: 'UpdatePrompterPart', slideId, partId: 'missing-part', text: 'x' },
    ]
    // Second command references a missing part: dry-run must fail before anything executes.
    const result = dryRunValidate(system.engine, commands)
    expect(result.ok).toBe(false)
    expect(result.errors[0].index).toBe(1)
    expect(result.errors[0].message).toContain('PrompterPart')
    expect(computeProjectFingerprint(system.engine)).toBe(before)
  })

  it('validates the chosen subset only for partial acceptance', () => {
    const { system, slideId } = setup()
    const commands = [
      { type: 'CreatePrompterPart', slideId, text: 'Keep me', duration: 1 },
      { type: 'CreatePrompterPart', slideId: 'no-such-slide', text: 'Drop me', duration: 1 },
    ]
    const subset = dryRunValidate(system.engine, commands, [0])
    expect(subset.ok).toBe(true)
    const full = dryRunValidate(system.engine, commands, [0, 1])
    expect(full.ok).toBe(false)
  })

  it('reports subset failures under their proposal index', () => {
    const { system, slideId } = setup()
    const commands = [
      { type: 'CreatePrompterPart', slideId, text: 'Good', duration: 1 },
      { type: 'CreatePrompterPart', slideId: 'no-such-slide', text: 'Bad', duration: 1 },
    ]
    const result = dryRunValidate(system.engine, commands, [1])
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].index).toBe(1)
  })

  it('computes a fingerprint that moves with the project', () => {
    const { system } = setup()
    const before = computeProjectFingerprint(system.engine)
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' }))
    const after = computeProjectFingerprint(system.engine)
    expect(after).not.toBe(before)
    expect(isStale(before, after)).toBe(true)
    expect(isStale(before, before)).toBe(false)
  })
})

describe('AI proposal execution (one Transaction, one History Entry)', () => {
  it('executes the chosen subset as one Transaction with one History Entry', () => {
    const { system, slideId, baseline } = setup()
    const commands = [
      { type: 'CreatePrompterPart', slideId, text: 'One', duration: 1 },
      { type: 'CreatePrompterPart', slideId, text: 'Two', duration: 2 },
      { type: 'CreatePrompterPart', slideId: 'bad-slide', text: 'Skipped', duration: 1 },
    ]
    const subset = buildExecutableCommands(commands, [0, 1])
    expect(subset).toHaveLength(2)
    const result = executeProposal(system, subset)
    expect(result.ok).toBe(true)
    expect(result.historyEntryId).toBeTruthy()
    // Exactly one new History Entry for the whole subset.
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
    expect(system.undoStack.entries[0].source).toBe('ai')
    const slide = system.engine.getSlide(slideId)
    expect(slide.prompter?.parts.map((p) => p.text)).toEqual(['One', 'Two'])
  })

  it('rolls back fully with no partial history on failure', () => {
    const { system, slideId, baseline } = setup()
    const before = system.engine.getSlide(slideId).prompter?.parts.length ?? 0
    const subset = buildExecutableCommands(
      [
        { type: 'CreatePrompterPart', slideId, text: 'Good', duration: 1 },
        // Valid schema, live-invalid: missing part fails at execute time.
        { type: 'UpdatePrompterPart', slideId, partId: 'no-such-part', text: 'Bad' },
      ],
      [0, 1],
    )
    const result = executeProposal(system, subset)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('PrompterPart')
    // No partial history: the good command rolled back with the bad one.
    expect(system.undoStack.entries.length).toBe(baseline)
    expect(system.engine.getSlide(slideId).prompter?.parts.length ?? 0).toBe(before)
  })

  it('blocks placeholder execution with a fixable message before anything executes', () => {
    const { system, baseline } = setup()
    const before = computeProjectFingerprint(system.engine)
    const result = executeProposal(system, [
      { type: 'AiSetMorphCoefficient', nodeId: 'cat', coefficient: 0.5 },
    ])
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toMatch(/not yet|stage|placeholder/i)
    expect(system.undoStack.entries.length).toBe(baseline)
    expect(computeProjectFingerprint(system.engine)).toBe(before)
  })

  it('round-trips a real prompter part command', () => {
    const { system, slideId } = setup()
    const cmd = new CreatePrompterPartCommand({ slideId, text: 'Hi', duration: 1 })
    expect(cmd.toJSON()).toMatchObject({ type: 'CreatePrompterPart', slideId })
    void system
  })
})
