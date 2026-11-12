import { useState } from 'react'
import { useEngine } from '../../app/useEngine'
import type { Command } from '../../engine/commands/command'
import {
  CreatePrompterPartCommand,
  DeletePrompterPartCommand,
  TransactionCommand,
  UpdatePrompterPartCommand,
} from '../../engine/commands'
import {
  estimatePrompterDuration,
  getPrompterSecondsPerCharacter,
  hasPrompterPartAudio,
  newPrompterPartId,
} from '../../engine/prompter'
import { AiMarkdown } from '../../ai/markdown'
import { toLessonJSON } from '../../engine/lessonSerializer'
import { validateAndApplyInOrder } from '../../engine/aiPreview'
import { computeProjectFingerprint } from '../../ai/proposals'

interface ProposedBlock {
  readonly sourcePartIds: readonly string[]
  readonly text: string
  readonly language?: 'en' | 'es'
}

interface Proposal {
  readonly slideId: string
  readonly sourcePartIds: readonly string[]
  readonly blocks: readonly ProposedBlock[]
}

function extractProposal(content: string): {
  proposal: Proposal | null
  error: string | null
  found: boolean
} {
  const match = content.match(/```prompter-edit\s*([\s\S]*?)```/i)
  if (!match) return { proposal: null, error: null, found: false }
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>
    if (typeof parsed.slideId !== 'string' || !Array.isArray(parsed.blocks))
      return {
        proposal: null,
        error: 'The prompter-edit data needs slideId and blocks.',
        found: true,
      }
    const blocks: ProposedBlock[] = []
    for (const raw of parsed.blocks) {
      if (!raw || typeof raw !== 'object')
        return { proposal: null, error: 'Each proposed block must be a JSON object.', found: true }
      const block = raw as Record<string, unknown>
      if (
        typeof block.text !== 'string' ||
        (block.language !== 'en' && block.language !== 'es') ||
        !block.text.trim()
      ) {
        return {
          proposal: null,
          error: 'Each block needs non-empty text and an explicit language ("en" or "es").',
          found: true,
        }
      }
      blocks.push({
        sourcePartIds: [],
        text: block.text.trim(),
        language: block.language,
      })
    }
    if (blocks.length === 0)
      return { proposal: null, error: 'The proposal must contain at least one block.', found: true }
    return {
      proposal: {
        slideId: parsed.slideId,
        sourcePartIds: [],
        blocks,
      },
      error: null,
      found: true,
    }
  } catch {
    return { proposal: null, error: 'The prompter-edit fence contains invalid JSON.', found: true }
  }
}

function spokenWords(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Model-supplied IDs are advisory; derive attribution from the preserved word order. */
function mapBlocksToLiveSources(
  proposal: Proposal,
  liveParts: readonly import('../../engine/prompter').PrompterPart[],
): Proposal {
  const sourceRanges: Array<{ id: string; start: number; end: number }> = []
  let sourceCursor = 0
  for (const part of liveParts) {
    const end = sourceCursor + spokenWords(part.text).length
    sourceRanges.push({ id: part.id, start: sourceCursor, end })
    sourceCursor = end
  }

  let outputCursor = 0
  const blocks = proposal.blocks.map((block) => {
    const wordCount = spokenWords(block.text).length
    const end = outputCursor + wordCount
    const sourcePartIds = sourceRanges
      .filter((range) => range.start < end && range.end > outputCursor)
      .map((range) => range.id)
    outputCursor = end
    return { ...block, sourcePartIds }
  })
  return { ...proposal, sourcePartIds: liveParts.map((part) => part.id), blocks }
}

function validateProposal(
  proposal: Proposal,
  liveParts: readonly import('../../engine/prompter').PrompterPart[],
) {
  const ids = liveParts.map((part) => part.id)
  if (proposal.blocks.some((block) => block.sourcePartIds.some((id) => !ids.includes(id)))) {
    return 'This suggestion refers to a prompter block that no longer exists.'
  }
  const compressedSources = proposal.blocks
    .flatMap((block) => block.sourcePartIds)
    .filter((id, index, all) => index === 0 || id !== all[index - 1])
  if (compressedSources.length !== ids.length || compressedSources.some((id, i) => id !== ids[i])) {
    return 'The suggestion must keep every source block in its original order.'
  }
  const originalWords = spokenWords(liveParts.map((part) => part.text).join(' '))
  const proposedWords = spokenWords(proposal.blocks.map((block) => block.text).join(' '))
  if (
    originalWords.length !== proposedWords.length ||
    originalWords.some((word, i) => word !== proposedWords[i])
  ) {
    return 'This suggestion changes spoken words. Only punctuation and block boundaries can be applied automatically.'
  }
  return null
}

function sharedValue<T>(values: readonly (T | undefined)[]): T | undefined {
  if (values.length === 0 || values[0] === undefined) return undefined
  const serialized = JSON.stringify(values[0])
  return values.every((value) => JSON.stringify(value) === serialized) ? values[0] : undefined
}

export function PrompterEditProposal({
  content,
  onFix,
}: {
  content: string
  onFix: (errors: string[]) => void
}) {
  const { engine, dispatch } = useEngine()
  const extracted = extractProposal(content)
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dryRunErrors, setDryRunErrors] = useState<string[]>([])
  const [dryRunPassed, setDryRunPassed] = useState(false)
  const [replaceAudioConfirmed, setReplaceAudioConfirmed] = useState(false)
  const [plannedCommands, setPlannedCommands] = useState<Command<unknown>[]>([])
  const [dryRunFingerprint, setDryRunFingerprint] = useState<string | null>(null)
  if (!extracted.found) return null
  const parsedProposal = extracted.proposal
  if (!parsedProposal) {
    const parseError = extracted.error ?? 'The proposal could not be read.'
    return (
      <section
        data-testid="prompter-edit-proposal"
        style={{
          marginTop: 10,
          padding: 10,
          border: '1px solid var(--color-error, #c44)',
          borderRadius: 8,
        }}
      >
        <strong>Dry-run failed</strong>
        <p role="alert" data-testid="prompter-edit-dry-run-errors">
          {parseError}
        </p>
        <button
          type="button"
          data-testid="prompter-edit-send-errors"
          onClick={() => onFix([parseError])}
        >
          Send errors to assistant
        </button>
      </section>
    )
  }
  let slide: ReturnType<typeof engine.getSlide> | null = null
  let slideLookupError: string | null = null
  try {
    slide = engine.getSlide(parsedProposal.slideId)
  } catch {
    slideLookupError = `Slide “${parsedProposal.slideId}” no longer exists.`
  }
  if (!slide) {
    return (
      <section
        data-testid="prompter-edit-proposal"
        style={{
          marginTop: 10,
          padding: 10,
          border: '1px solid var(--color-error, #c44)',
          borderRadius: 8,
        }}
      >
        <strong>Dry-run failed</strong>
        <p role="alert">
          {slideLookupError ?? `Slide “${parsedProposal.slideId}” no longer exists.`}
        </p>
        <button
          type="button"
          data-testid="prompter-edit-send-errors"
          onClick={() => onFix([slideLookupError ?? 'Target slide no longer exists.'])}
        >
          Send errors to assistant
        </button>
      </section>
    )
  }
  const liveParts = slide.prompter?.parts ?? []
  const proposal = mapBlocksToLiveSources(parsedProposal, liveParts)
  const validationError = validateProposal(proposal, liveParts)
  const hasBoundAudio = liveParts.some(
    (part) => hasPrompterPartAudio(part) || (part.segments?.length ?? 0) > 0,
  )
  const inPlaceEdit =
    proposal.blocks.length === liveParts.length &&
    proposal.blocks.every(
      (block, index) =>
        block.sourcePartIds.length === 1 && block.sourcePartIds[0] === liveParts[index]?.id,
    )
  const describedChange =
    proposal.blocks.length > liveParts.length
      ? `Split into ${proposal.blocks.length} blocks`
      : proposal.blocks.length < liveParts.length
        ? `Unite into ${proposal.blocks.length} blocks`
        : 'Update block punctuation'

  const buildCommands = (): Command<unknown>[] => {
    if (inPlaceEdit) {
      return proposal.blocks.map(
        (block, index) =>
          new UpdatePrompterPartCommand({
            slideId: slide.id,
            partId: liveParts[index].id,
            text: block.text,
            ...(block.language ? { ttsLanguage: block.language } : {}),
          }),
      )
    }
    const commands: Command<unknown>[] = liveParts
      .slice()
      .reverse()
      .map((part) => new DeletePrompterPartCommand({ slideId: slide.id, partId: part.id }))
    const allChars = proposal.blocks.reduce((total, block) => total + block.text.length, 0) || 1
    const totalDuration = liveParts.reduce((total, part) => total + part.duration, 0)
    const secondsPerCharacter = getPrompterSecondsPerCharacter(engine.project?.settings)
    proposal.blocks.forEach((block, index) => {
      const sources = block.sourcePartIds.map((id) => liveParts.find((part) => part.id === id)!)
      const duration =
        totalDuration > 0
          ? totalDuration * (block.text.length / allChars)
          : estimatePrompterDuration(block.text, secondsPerCharacter)
      commands.push(
        new CreatePrompterPartCommand({
          slideId: slide.id,
          id: newPrompterPartId(),
          text: block.text,
          duration,
          insertIndex: index,
          ttsLanguage: block.language ?? sharedValue(sources.map((part) => part.ttsLanguage)),
          ttsProsody: sharedValue(sources.map((part) => part.ttsProsody)),
        }),
      )
    })
    return commands
  }

  const runDryRun = () => {
    setError(null)
    setDryRunErrors([])
    setDryRunPassed(false)
    if (validationError) {
      setDryRunErrors([validationError])
      return
    }
    try {
      const commands = buildCommands()
      const snapshot = toLessonJSON(engine.project!, engine.clips, engine.clipCollections)
      const result = validateAndApplyInOrder(snapshot, commands)
      if (!result.ok) {
        setDryRunErrors([
          `Command ${result.failure.failedStep + 1} (${result.failure.phase}): ${result.failure.message}`,
        ])
        return
      }
      setPlannedCommands(commands)
      setDryRunFingerprint(computeProjectFingerprint(engine))
      setDryRunPassed(true)
    } catch (dryRunError) {
      setDryRunErrors([dryRunError instanceof Error ? dryRunError.message : String(dryRunError)])
    }
  }

  const apply = () => {
    if (!dryRunPassed || validationError || applied) return
    if (computeProjectFingerprint(engine) !== dryRunFingerprint) {
      setError('The project changed after dry-run. Run Dry-run validate again before applying.')
      setDryRunPassed(false)
      return
    }
    if (hasBoundAudio && !inPlaceEdit && !replaceAudioConfirmed) return
    const command =
      plannedCommands.length === 1 ? plannedCommands[0] : new TransactionCommand(plannedCommands)
    const result = dispatch(command)
    if (!result.ok) setError(result.error.message)
    else setApplied(true)
  }

  return (
    <section
      data-testid="prompter-edit-proposal"
      style={{
        marginTop: 10,
        padding: 10,
        border: '1px solid var(--color-accent)',
        borderRadius: 8,
      }}
    >
      <strong>{describedChange}</strong>
      <ol style={{ margin: '8px 0', paddingLeft: 24 }}>
        {proposal.blocks.map((block, index) => (
          <li key={`${index}-${block.sourcePartIds.join('-')}`}>{block.text}</li>
        ))}
      </ol>
      <button type="button" data-testid="prompter-edit-dry-run" onClick={runDryRun}>
        Dry-run validate
      </button>
      {dryRunPassed && !applied && (
        <span role="status">Dry-run passed. No project changes have been made.</span>
      )}
      {dryRunErrors.length > 0 && (
        <div role="alert" data-testid="prompter-edit-dry-run-errors">
          {dryRunErrors.map((message, index) => (
            <p key={`${index}-${message}`}>{message}</p>
          ))}
          <button
            type="button"
            data-testid="prompter-edit-send-errors"
            onClick={() => onFix(dryRunErrors)}
          >
            Send errors to assistant
          </button>
        </div>
      )}
      {hasBoundAudio && !inPlaceEdit && !applied && (
        <div style={{ margin: '8px 0' }}>
          <p role="note">
            This split/merge affects blocks with attached audio. Applying will remove those audio
            clips; regenerate TTS afterward.
          </p>
          <label>
            <input
              type="checkbox"
              data-testid="prompter-edit-confirm-audio"
              checked={replaceAudioConfirmed}
              onChange={(event) => setReplaceAudioConfirmed(event.target.checked)}
            />{' '}
            Confirm replacing the attached audio
          </label>
        </div>
      )}
      {!applied && (validationError || error) && <p role="alert">{validationError ?? error}</p>}
      {!applied && !validationError && !error && !dryRunPassed && (
        <p data-testid="prompter-edit-apply-reason">Run Dry-run validate before applying.</p>
      )}
      {!applied && dryRunPassed && hasBoundAudio && !inPlaceEdit && !replaceAudioConfirmed && (
        <p data-testid="prompter-edit-apply-reason">Confirm audio replacement to enable Apply.</p>
      )}
      {applied ? (
        <span role="status" data-testid="prompter-edit-applied">
          Applied as one undoable change.
        </span>
      ) : (
        <button
          type="button"
          data-testid="prompter-edit-apply"
          disabled={!dryRunPassed || (hasBoundAudio && !inPlaceEdit && !replaceAudioConfirmed)}
          onClick={apply}
        >
          Apply block edits
        </button>
      )}
    </section>
  )
}

function prompterEditAssistantText(content: string): string {
  return content.replace(/```prompter-edit\s*[\s\S]*?```/i, '').trim()
}

export function PrompterEditExplanation({ content }: { content: string }) {
  const explanation = prompterEditAssistantText(content)
  return explanation ? <AiMarkdown content={explanation} /> : null
}
