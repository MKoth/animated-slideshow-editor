import type { Command, CommandSystem } from '../engine/commands'
import { TransactionCommand } from '../engine/commands/transactionCommand'
import { AiCommitTtsCommand } from '../engine/commands/aiCommitTtsCommand'
import { CreateSlideCommand } from '../engine/commands/createSlideCommand'
import { CreatePrompterPartCommand } from '../engine/commands/createPrompterPartCommand'
import { UpdatePrompterPartCommand } from '../engine/commands/updatePrompterPartCommand'
import { UpdatePrompterPartWithShiftCommand } from '../engine/commands/updatePrompterPartWithShiftCommand'
import { ReplacePrompterWordsCommand } from '../engine/commands/replacePrompterWordsCommand'
import { SetPrompterPartAudioCommand } from '../engine/commands/setPrompterPartAudioCommand'
import { SetSlideAnimationScriptCommand } from '../engine/commands/setSlideAnimationScriptCommand'
import type { EnginePublic } from '../engine'

/**
 * Canonical AI Edit Proposal allowlist (issue #422). Server schema validation
 * runs first; the client dry-run validate() against the live engine runs
 * second, in order. Stage D/E/merge placeholders carry typed params here;
 * AiCommitTts landed as a real Stage C command (#425) — the remaining stages
 * land their real commands in their own tickets.
 */
export const AI_COMMAND_ALLOWLIST: readonly string[] = [
  'CreateSlide',
  'CreatePrompterPart',
  'UpdatePrompterPart',
  'UpdatePrompterPartWithShift',
  'ReplacePrompterWords',
  'SetPrompterPartAudio',
  'AiCommitTts',
  'AiSetMorphCoefficient',
  'AiSetControlValue',
  'AiPlaceMouthClip',
  'SetSlideAnimationScript',
  'AiCreateBoardText',
  'AiCreateBoardTable',
  'AiImportSlides',
] as const

export type AiCommandJson = { readonly type: string } & Readonly<Record<string, unknown>>

export interface ProposalValidationError {
  readonly index: number
  readonly type: string
  readonly message: string
}

export interface ProposalSchemaResult {
  readonly ok: boolean
  readonly errors: readonly ProposalValidationError[]
}

function error(index: number, type: string, message: string): ProposalValidationError {
  return { index, type, message }
}

function required(
  command: Record<string, unknown>,
  index: number,
  ctype: string,
  fields: readonly string[],
): ProposalValidationError[] {
  const out: ProposalValidationError[] = []
  for (const field of fields) {
    const value = command[field]
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      out.push(
        error(
          index,
          ctype,
          `command #${index} (${ctype}): missing required field '${field}'. Fix the proposal and re-validate before anything executes.`,
        ),
      )
    }
  }
  return out
}

function isPlaceholder(type: string): boolean {
  return type.startsWith('Ai')
}

/** Stage D scope: mouth tracks stay on intro/outro, never baked ids or rotation. */
function mouthScope(
  command: Record<string, unknown>,
  index: number,
  ctype: string,
): ProposalValidationError[] {
  const out: ProposalValidationError[] = []
  const tag = command.partTag
  if (tag !== undefined && tag !== 'intro' && tag !== 'outro') {
    out.push(
      error(
        index,
        ctype,
        `command #${index} (${ctype}): partTag must be 'intro' or 'outro' (middle excluded).`,
      ),
    )
  }
  for (const baked of ['shapeId', 'fromShapeId', 'toShapeId']) {
    if (command[baked] !== undefined && command[baked] !== null) {
      out.push(
        error(
          index,
          ctype,
          `command #${index} (${ctype}): baked shape ids are forbidden — clips stay name-based and portable.`,
        ),
      )
    }
  }
  if (
    String(command.property ?? '')
      .trim()
      .toLowerCase() === 'rotation'
  ) {
    out.push(error(index, ctype, `command #${index} (${ctype}): camera rotation is never written.`))
  }
  return out
}

/** Client mirror of the server schema gate (server runs first, this runs second). */
export function validateProposalSchema(commands: unknown): ProposalSchemaResult {
  if (!Array.isArray(commands) || commands.length === 0) {
    return {
      ok: false,
      errors: [
        error(
          -1,
          '?',
          'proposal must carry a non-empty commands list. Fix the proposal and re-validate before anything executes.',
        ),
      ],
    }
  }
  const errors: ProposalValidationError[] = []
  commands.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(
        error(index, '?', `command #${index}: must be a JSON object with a 'type' field.`),
      )
      return
    }
    const command = raw as Record<string, unknown>
    const ctype = command.type
    if (typeof ctype !== 'string' || !ctype.trim()) {
      errors.push(
        error(
          index,
          '?',
          `command #${index}: missing required field 'type'. Allowed: ${AI_COMMAND_ALLOWLIST.join(', ')}.`,
        ),
      )
      return
    }
    if (!AI_COMMAND_ALLOWLIST.includes(ctype)) {
      errors.push(
        error(
          index,
          ctype,
          `command #${index}: unknown command type '${ctype}'. Allowed: ${AI_COMMAND_ALLOWLIST.join(', ')}. Remove or replace it before anything executes.`,
        ),
      )
      return
    }
    // Per-type required fields (structural only — live checks happen in dry-run).
    if (ctype === 'CreatePrompterPart')
      errors.push(...required(command, index, ctype, ['slideId', 'text', 'duration']))
    else if (ctype === 'UpdatePrompterPart')
      errors.push(...required(command, index, ctype, ['slideId', 'partId']))
    else if (ctype === 'UpdatePrompterPartWithShift')
      errors.push(
        ...required(command, index, ctype, ['slideId', 'partId', 'duration', 'shiftDownstream']),
      )
    else if (ctype === 'ReplacePrompterWords')
      errors.push(
        ...required(command, index, ctype, [
          'slideId',
          'partId',
          'startWordIndex',
          'endWordIndex',
          'ttsAssetId',
        ]),
      )
    else if (ctype === 'SetPrompterPartAudio')
      errors.push(...required(command, index, ctype, ['slideId', 'partId']))
    else if (ctype === 'AiCommitTts')
      errors.push(
        ...required(command, index, ctype, [
          'slideId',
          'partId',
          'assetId',
          'timelineStart',
          'sourceEnd',
        ]),
      )
    else if (ctype === 'AiSetMorphCoefficient') {
      errors.push(...required(command, index, ctype, ['nodeId', 'coefficient']))
      errors.push(...mouthScope(command, index, ctype))
    } else if (ctype === 'AiSetControlValue') {
      errors.push(...required(command, index, ctype, ['nodeId', 'controlKey', 'value']))
      errors.push(...mouthScope(command, index, ctype))
    } else if (ctype === 'AiPlaceMouthClip') {
      errors.push(...required(command, index, ctype, ['nodeId', 'clipName', 'startTime']))
      errors.push(...mouthScope(command, index, ctype))
      const semantic = command.semanticName
      if (semantic !== undefined && semantic !== 'mouth') {
        errors.push(
          error(
            index,
            ctype,
            `command #${index} (${ctype}): mouth clips belong on semanticName 'mouth' nodes.`,
          ),
        )
      }
    } else if (ctype === 'SetSlideAnimationScript')
      errors.push(...required(command, index, ctype, ['slideId', 'source']))
    else if (ctype === 'AiCreateBoardText')
      errors.push(...required(command, index, ctype, ['slideId', 'text']))
    else if (ctype === 'AiCreateBoardTable')
      errors.push(...required(command, index, ctype, ['slideId', 'rows', 'columns']))
    else if (ctype === 'AiImportSlides') {
      const ids = command.slideIds
      if (!Array.isArray(ids) || ids.length === 0)
        errors.push(
          error(
            index,
            ctype,
            `command #${index} (AiImportSlides): field 'slideIds' must be a non-empty list.`,
          ),
        )
    }
    // Inline base64 guard: proposals reference asset ids, never inline bytes.
    const ttsData = command.ttsData
    if (typeof ttsData === 'object' && ttsData !== null) {
      const data = (ttsData as Record<string, unknown>).data
      if (typeof data === 'string' && data.length > 0) {
        errors.push(
          error(
            index,
            ctype,
            `command #${index} (${ctype}): field 'ttsData.data' carries inline audio data. Generate audio first, embed it, then reference the asset id.`,
          ),
        )
      }
    }
    const asset = command.asset
    if (typeof asset === 'object' && asset !== null) {
      const data = (asset as Record<string, unknown>).data
      if (typeof data === 'string' && data.length > 0) {
        errors.push(
          error(
            index,
            ctype,
            `command #${index} (${ctype}): field 'asset.data' carries inline audio data. Reference the asset id instead.`,
          ),
        )
      }
    }
  })
  return { ok: errors.length === 0, errors }
}

/** Opaque project fingerprint for stale-blocking at approval. */
export function computeProjectFingerprint(engine: EnginePublic): string {
  try {
    const json = engine.toJSON() as unknown
    const text = JSON.stringify(json) ?? ''
    let h1 = 0x811c9dc5
    let h2 = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 16777619)
      h2 = Math.imul(h2 ^ (c + (i & 255)), 16777619)
    }
    return `fp-${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${text.length.toString(36)}`
  } catch {
    return `fp-fallback-${Date.now().toString(36)}`
  }
}

export function isStale(validatedFingerprint: string | null, currentFingerprint: string): boolean {
  if (!validatedFingerprint) return true
  return validatedFingerprint !== currentFingerprint
}

export function buildExecutableCommands(
  commands: readonly AiCommandJson[],
  selectedIndexes: readonly number[],
): AiCommandJson[] {
  const seen = new Set<number>()
  const out: AiCommandJson[] = []
  for (const i of selectedIndexes) {
    if (!Number.isInteger(i) || i < 0 || i >= commands.length) continue
    if (seen.has(i)) continue
    seen.add(i)
    out.push(commands[i])
  }
  return out
}

function asString(value: unknown, field: string, ctype: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`${ctype}: field '${field}' must be a non-empty string`)
  return value
}

function asNumber(value: unknown, field: string, ctype: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${ctype}: field '${field}' must be a number`)
  return value
}

/** Instantiate a live engine command. Placeholders throw a fixable stage message. */
export function buildCommandFromJson(json: AiCommandJson): Command<unknown> {
  const ctype = json.type
  const params = json as Record<string, unknown>
  switch (ctype) {
    case 'CreateSlide':
      return new CreateSlideCommand(typeof params.name === 'string' ? { name: params.name } : {})
    case 'CreatePrompterPart':
      return new CreatePrompterPartCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        text: asString(params.text, 'text', ctype),
        duration: asNumber(params.duration, 'duration', ctype),
        ...(typeof params.insertIndex === 'number' ? { insertIndex: params.insertIndex } : {}),
      })
    case 'UpdatePrompterPart':
      return new UpdatePrompterPartCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        partId: asString(params.partId, 'partId', ctype),
        ...(typeof params.text === 'string' ? { text: params.text } : {}),
        ...(typeof params.duration === 'number' ? { duration: params.duration } : {}),
        ...(params.shiftDownstream === true ? { shiftDownstream: true as const } : {}),
      })
    case 'UpdatePrompterPartWithShift':
      return new UpdatePrompterPartWithShiftCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        partId: asString(params.partId, 'partId', ctype),
        duration: asNumber(params.duration, 'duration', ctype),
        shiftDownstream: params.shiftDownstream === true,
      })
    case 'ReplacePrompterWords': {
      const ttsAssetId = typeof params.ttsAssetId === 'string' ? params.ttsAssetId : undefined
      const ttsData = (params.ttsData ?? undefined) as
        | { name?: string; data: string; mimeType?: string; metadata?: Record<string, unknown> }
        | undefined
      return new ReplacePrompterWordsCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        partId: asString(params.partId, 'partId', ctype),
        startWordIndex: params.startWordIndex as number,
        endWordIndex: params.endWordIndex as number,
        ...(ttsAssetId ? { ttsAssetId } : {}),
        ...(ttsData ? { ttsData } : {}),
      })
    }
    case 'SetPrompterPartAudio': {
      const clip = (params.audioClipId ?? params.clipId ?? null) as string | null
      const asset = (params.audioAssetId ?? params.assetId ?? null) as string | null
      return new SetPrompterPartAudioCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        partId: asString(params.partId, 'partId', ctype),
        audioClipId: clip,
        audioAssetId: asset,
      })
    }
    case 'SetSlideAnimationScript':
      return new SetSlideAnimationScriptCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        source: params.source as string,
      })
    case 'AiCommitTts':
      // Stage C real command (issue #425): binds an already-embedded voice
      // asset, adopts the audio duration, shifts downstream gap-free at rate 1.
      return new AiCommitTtsCommand({
        slideId: asString(params.slideId, 'slideId', ctype),
        partId: asString(params.partId, 'partId', ctype),
        assetId: asString(params.assetId, 'assetId', ctype),
        timelineStart: asNumber(params.timelineStart, 'timelineStart', ctype),
        sourceEnd: asNumber(params.sourceEnd, 'sourceEnd', ctype),
      })
    default:
      if (isPlaceholder(ctype)) {
        throw new Error(
          `${ctype} is a typed placeholder whose real command lands in its stage ticket ` +
            `(Stage C/D/E/merge). It validates server-side but does not execute in this build — ` +
            `remove it from the approved subset or wait for its stage.`,
        )
      }
      throw new Error(`unknown command type '${ctype}'`)
  }
}

export interface DryRunResult {
  readonly ok: boolean
  readonly errors: readonly ProposalValidationError[]
  readonly fingerprint: string
}

/**
 * Client dry-run: validate() each command in order against the live engine.
 * Never executes — the engine is untouched on both success and failure.
 */
export function dryRunValidate(
  engine: EnginePublic,
  commands: readonly AiCommandJson[],
  selectedIndexes?: readonly number[],
): DryRunResult {
  const fingerprint = computeProjectFingerprint(engine)
  const indexes = selectedIndexes === undefined ? commands.map((_, i) => i) : [...selectedIndexes]
  const errors: ProposalValidationError[] = []
  // Schema first (mirrors the server gate), then live validate() in order.
  const schema = validateProposalSchema(
    indexes.map((i) => commands[i]).filter((c) => c !== undefined),
  )
  if (!schema.ok) {
    // Remap schema error indexes back to proposal indexes where possible.
    return { ok: false, errors: schema.errors, fingerprint }
  }
  const internal = engine as unknown as import('../engine/internal').Engine
  // Schema first per proposal index (mirrors the server gate, keeping proposal
  // indexes intact for fixable messages), then live validate() in order.
  indexes.forEach((proposalIndex, order) => {
    const json = commands[proposalIndex]
    if (json === undefined) {
      errors.push(error(proposalIndex, '?', `command #${proposalIndex}: index out of range.`))
      return
    }
    const schema = validateProposalSchema([json])
    if (!schema.ok) {
      for (const e of schema.errors) {
        errors.push(
          error(
            proposalIndex,
            e.type,
            e.message.replace(`command #0`, `command #${proposalIndex}`),
          ),
        )
      }
      return
    }
    try {
      const command = buildCommandFromJson(json)
      command.validate(internal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(
        error(
          proposalIndex,
          json.type,
          `command #${proposalIndex} (${json.type}) failed dry-run validate() at position ${order}: ${message} Fix it and re-validate before anything executes.`,
        ),
      )
    }
  })
  return { ok: errors.length === 0, errors, fingerprint }
}

export interface ExecuteResult {
  readonly ok: boolean
  readonly historyEntryId?: string
  readonly error?: string
}

/**
 * Execute the approved subset as one Transaction with inverse-walk rollback.
 * One History Entry on success (source 'ai'); no partial history on failure.
 */
export function executeProposal(
  system: Pick<CommandSystem, 'dispatcher' | 'undoStack'>,
  subset: readonly AiCommandJson[],
): ExecuteResult {
  let commands: Command<unknown>[]
  try {
    commands = subset.map((json) => buildCommandFromJson(json))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
  if (commands.length === 0) return { ok: false, error: 'select at least one command to execute' }
  const transaction = new TransactionCommand(commands)
  const before = system.undoStack.entries.length
  const result = system.dispatcher.dispatch(transaction, 'ai')
  if (result.ok) {
    const top = system.undoStack.entries[0]
    const expected = before + 1
    if (system.undoStack.entries.length !== expected || top?.type !== 'Transaction') {
      return { ok: false, error: 'execution did not record exactly one History Entry' }
    }
    return { ok: true, historyEntryId: top.id }
  }
  return { ok: false, error: result.error.message }
}
