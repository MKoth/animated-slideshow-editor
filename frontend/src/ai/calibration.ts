/**
 * Stage D calibration helpers (issue #426). Client mirror of the backend
 * `app/ai/calibrations.py` seam: verify-only triple check (voice reuse +
 * face-rig readiness + intro/outro camera framing), phoneme-timed mouth from
 * forced-alignment word timings through the rig-local phoneme-to-Shape map,
 * per-part waveform-peaks envelope fallback driving a single Open
 * coefficient (clearly marked), morphCoefficient-track builders only,
 * intro/outro scope, no rotation writes, middle excluded.
 */

export const INTRO_OUTRO_TAGS: readonly string[] = ['intro', 'outro']

export const OPEN_SHAPE = 'Open'

/** Camera framing is pan/zoom keys only: pan = positionX/positionY, zoom = scaleX/scaleY. */
export const PAN_ZOOM_KEYS: readonly string[] = ['positionX', 'positionY', 'scaleX', 'scaleY']

export type CalibrationWord = { word: string; start: number; end: number; phoneme?: string }
export type MappedWord = CalibrationWord & {
  phoneme: string
  shape: string | null
  missing: boolean
}
export type EnvelopeKey = { t: number; open: number }

export interface CalibrationTiming {
  stepId: string
  order?: number
  partTag: string
  spokenLine: string
  audioDuration?: number | null
  level?: number | null
  measured?: boolean
  words?: CalibrationWord[]
  fallback?: boolean
  envelope?: EnvelopeKey[]
  missingShapes?: string[]
}

export interface CalibrationChecks {
  voice?: { ok: boolean; message?: string }
  faceRig?: { ok: boolean; message?: string }
  camera?: { ok: boolean; message?: string }
}

const PHONEME_FOR_CHAR: Record<string, string> = (() => {
  const table: Record<string, string> = {}
  for (const ch of ['a', 'e', 'i', 'y']) table[ch] = 'AH'
  for (const ch of ['o', 'u', 'w']) table[ch] = 'OW'
  for (const ch of ['b', 'm', 'p']) table[ch] = 'B'
  for (const ch of ['f', 'v']) table[ch] = 'F'
  for (const ch of ['l', 'r']) table[ch] = 'L'
  for (const ch of ['s', 'z', 'c']) table[ch] = 'S'
  for (const ch of ['k', 'g', 'q', 'x']) table[ch] = 'K'
  for (const ch of ['d', 't', 'n']) table[ch] = 'T'
  for (const ch of ['j', 'h']) table[ch] = 'H'
  return table
})()

export function splitWords(spokenLine: string): string[] {
  return spokenLine.split(/\s+/).filter((w) => w.length > 0)
}

export function phonemeForChar(ch: string): string {
  const lowered = ch.toLowerCase()
  if (lowered.length !== 1 || !/[a-z]/.test(lowered)) return 'AH'
  return PHONEME_FOR_CHAR[lowered] ?? 'AH'
}

export function wordToPhonemes(word: string): string[] {
  const out: string[] = []
  for (const ch of word) {
    if (!/[a-zA-Z]/.test(ch)) continue
    const label = phonemeForChar(ch)
    if (out.length === 0 || out[out.length - 1] !== label) out.push(label)
  }
  return out.length > 0 ? out : ['AH']
}

export function shapeForWord(
  word: string,
  phonemeMap?: Record<string, string> | null,
): { shape: string | null; phoneme: string } {
  const phonemes = wordToPhonemes(word)
  const phoneme = phonemes[0] ?? 'AH'
  if (!phonemeMap) return { shape: null, phoneme }
  const shape = phonemeMap[phoneme]
  return { shape: typeof shape === 'string' && shape.trim() ? shape : null, phoneme }
}

/** Intro/outro steps only, verbatim — middle (blackboard) excluded. */
export function introOutroStepsFromScenario(
  steps: readonly { id: string; order: number; partTag: string; spokenLine: string }[],
): CalibrationTiming[] {
  const out: CalibrationTiming[] = []
  for (const step of steps) {
    if (step.partTag !== 'intro' && step.partTag !== 'outro') continue
    if (!step.id || !step.spokenLine || !step.spokenLine.trim()) continue
    out.push({
      stepId: step.id,
      order: step.order,
      partTag: step.partTag,
      spokenLine: step.spokenLine,
      audioDuration: null,
      level: null,
      words: [],
      fallback: false,
      envelope: [],
      missingShapes: [],
    })
  }
  if (out.length === 0)
    throw new Error('no intro/outro steps with spoken lines — nothing to calibrate')
  return out
}

/** Validate forced-alignment word timings (verbatim, ordered, inside duration). */
export function validateAlignerWords(
  spokenLine: string,
  audioDuration: number,
  words: readonly CalibrationWord[],
): string[] {
  const errors: string[] = []
  if (!(audioDuration > 0)) {
    errors.push('audioDuration must be > 0 before word timings can apply')
    return errors
  }
  const expected = splitWords(spokenLine)
  if (!Array.isArray(words) || words.length === 0) {
    errors.push('aligner produced no word timings — use the envelope fallback')
    return errors
  }
  if (words.length !== expected.length) {
    errors.push(
      `aligner word count ${words.length} != spoken word count ${expected.length} — use the envelope fallback`,
    )
  }
  let previousEnd = 0
  words.forEach((raw, index) => {
    const want = expected[index]
    if (!raw.word) errors.push(`word #${index}: missing word text`)
    else if (want !== undefined && raw.word !== want) {
      errors.push(
        `word #${index}: '${raw.word}' != spoken '${want}' — timings must stay verbatim, use the envelope fallback`,
      )
    }
    if (typeof raw.start !== 'number' || typeof raw.end !== 'number') {
      errors.push(`word #${index} (${raw.word}): start/end must be numbers`)
      return
    }
    if (!(raw.start >= 0 && raw.start < raw.end && raw.end <= audioDuration)) {
      errors.push(
        `word #${index} (${raw.word}): [${raw.start}, ${raw.end}] outside [0, ${audioDuration}]`,
      )
    }
    if (raw.start < previousEnd - 1e-9) {
      errors.push(`word #${index} (${raw.word}): overlaps the previous word`)
    }
    previousEnd = Math.max(previousEnd, raw.end)
  })
  return errors
}

export function mapWordsToShapes(
  words: readonly CalibrationWord[],
  phonemeMap?: Record<string, string> | null,
): MappedWord[] {
  return words.map((raw) => {
    const supplied = (raw as { phoneme?: unknown }).phoneme
    if (typeof supplied === 'string' && supplied.trim() && phonemeMap?.[supplied.trim()]) {
      const phoneme = supplied.trim()
      const shape = phonemeMap[phoneme]
      const named = typeof shape === 'string' && shape.trim() ? shape : null
      return { ...raw, phoneme, shape: named, missing: named === null }
    }
    const { shape, phoneme } = shapeForWord(raw.word, phonemeMap)
    return { ...raw, phoneme, shape, missing: shape === null }
  })
}

/** Waveform-peaks envelope -> single Open coefficient curve (fallback). */
export function envelopeCoefficients(
  peaks: readonly number[],
  audioDuration: number,
  maxKeys = 32,
): EnvelopeKey[] {
  if (!(audioDuration > 0)) throw new Error('audioDuration must be > 0 for the envelope fallback')
  if (!Array.isArray(peaks) || peaks.length === 0)
    throw new Error('peaks must be a non-empty list for the envelope fallback')
  for (const peak of peaks) {
    if (!Number.isInteger(peak) || peak < 0 || peak > 255)
      throw new Error('peaks must be 0-255 ints (waveformPeaks convention)')
  }
  const count = Math.min(maxKeys, peaks.length)
  if (!(count > 0)) throw new Error('max_keys must be > 0')
  const perBucket = peaks.length / count
  const keys: EnvelopeKey[] = []
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * perBucket)
    const end = i < count - 1 ? Math.floor((i + 1) * perBucket) : peaks.length
    const chunk = peaks.slice(start, end)
    const peak = chunk.length > 0 ? Math.max(...chunk) : 0
    keys.push({
      t: Math.round(((i + 0.5) / count) * audioDuration * 10000) / 10000,
      open: Math.round((peak / 255) * 10000) / 10000,
    })
  }
  return keys
}

export function verifyVoiceReuse(
  narrationDefaultVoice: string | null | undefined,
  expectedVoice: string | null | undefined,
  pregen: readonly { stepId: string; audioDuration?: number | null }[],
): { ok: boolean; message: string } {
  const expected = (expectedVoice ?? '').trim() || null
  const current = (narrationDefaultVoice ?? '').trim() || null
  if (expected !== null && expected !== current) {
    return {
      ok: false,
      message: `voice mismatch: calibration expects ${expected} but the accepted narration uses ${current} — fix the voice before accepting`,
    }
  }
  if (pregen.length === 0) {
    return { ok: false, message: 'no pregenerated intro/outro audio measured — measure it first' }
  }
  for (const entry of pregen) {
    if (!(typeof entry.audioDuration === 'number' && entry.audioDuration > 0)) {
      return {
        ok: false,
        message: `pregen part ${entry.stepId}: no measurable duration — measure pregen audio before accepting`,
      }
    }
  }
  return {
    ok: true,
    message: 'voice reused from the accepted narration; pregen audio measured',
  }
}

export function verifyFaceRig(
  mouthShapes?: readonly string[] | null,
  morphBinding?: { fromShape?: unknown; toShape?: unknown } | null,
): { ok: boolean; message: string; missing?: string[] } {
  const shapes = (mouthShapes ?? []).filter((s) => typeof s === 'string' && s.trim())
  if (shapes.length === 0) {
    return { ok: false, message: 'no user-owned mouth Shapes supplied — author the cat rig first' }
  }
  if (!morphBinding || typeof morphBinding !== 'object') {
    return {
      ok: false,
      message: 'no MorphBinding on the cat node — select From/To mouth Shapes first',
    }
  }
  const from = morphBinding.fromShape
  const to = morphBinding.toShape
  const fromName = typeof from === 'string' && from.trim() ? from.trim() : null
  const toName = typeof to === 'string' && to.trim() ? to.trim() : null
  if (!fromName || !toName) {
    return {
      ok: false,
      message: 'MorphBinding is incomplete — select both From and To mouth Shapes',
    }
  }
  const missing = [fromName, toName].filter((name) => !shapes.includes(name))
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `binding references missing mouth Shapes ${missing.join(', ')} — soft-warn-and-skip: author them on the reusable cat object first`,
    }
  }
  return {
    ok: true,
    message: 'face rig ready: user Shapes + MorphBinding present, agent writes coefficients only',
  }
}

export function verifyCameraFraming(
  cameraCount: number,
  cameraKeys?: readonly { property?: unknown; partTag?: unknown }[] | null,
): { ok: boolean; message: string } {
  const keys = [...(cameraKeys ?? [])]
  if (cameraCount !== 1) {
    return {
      ok: false,
      message: `exactly one camera required, found ${cameraCount} — fix the scene before accepting`,
    }
  }
  for (const key of keys) {
    const prop = String((key as Record<string, unknown>).property ?? '')
    if (prop.trim().toLowerCase() === 'rotation') {
      return { ok: false, message: 'camera rotation writes are forbidden — pan/zoom keys only' }
    }
    if (prop.trim() && !PAN_ZOOM_KEYS.includes(prop.trim())) {
      return {
        ok: false,
        message: `camera key property '${prop}' is not pan/zoom (positionX/positionY/scaleX/scaleY only)`,
      }
    }
    const tag = String((key as Record<string, unknown>).partTag ?? '')
    if (tag && tag !== 'intro' && tag !== 'outro') {
      return {
        ok: false,
        message: `camera keys are scoped to intro/outro only (got partTag '${tag}') — the blackboard middle is owned by Stage E`,
      }
    }
  }
  return {
    ok: true,
    message: 'camera framing holds: exactly one camera, pan/zoom keys on intro/outro',
  }
}

export function validateCameraKeys(
  keys: readonly { property?: unknown; partTag?: unknown }[],
): string[] {
  const errors: string[] = []
  keys.forEach((key, index) => {
    const prop = String((key as Record<string, unknown>).property ?? '')
    if (prop.trim().toLowerCase() === 'rotation') {
      errors.push(`camera key #${index}: rotation is never written — pan/zoom keys only`)
    } else if (prop.trim() && !PAN_ZOOM_KEYS.includes(prop.trim())) {
      errors.push(
        `camera key #${index}: property '${prop}' is not pan/zoom (positionX/positionY/scaleX/scaleY only)`,
      )
    }
    const tag = String((key as Record<string, unknown>).partTag ?? '')
    if (tag && tag !== 'intro' && tag !== 'outro') {
      errors.push(`camera key #${index}: partTag must be intro/outro (middle excluded)`)
    }
  })
  return errors
}

const MOUTH_COMMAND_TYPES: readonly string[] = [
  'AiSetMorphCoefficient',
  'AiSetControlValue',
  'AiPlaceMouthClip',
]

/** Only morphCoefficient-track commands may execute in Stage D. */
export function rejectForbiddenWrites(commands: readonly Record<string, unknown>[]): string[] {
  const errors: string[] = []
  commands.forEach((command, index) => {
    const ctype = String((command as Record<string, unknown>).type ?? '')
    if (!MOUTH_COMMAND_TYPES.includes(ctype)) {
      errors.push(
        `command #${index} (${ctype || '?'}): Stage D writes morphCoefficient tracks only (AiSetMorphCoefficient / AiSetControlValue / AiPlaceMouthClip) — Shape creation, binding rewrites, and audio rewrites are forbidden`,
      )
      return
    }
    const record = command as Record<string, unknown>
    if ('shapeId' in record || 'fromShapeId' in record || 'toShapeId' in record) {
      errors.push(
        `command #${index} (${ctype}): baked shape ids are forbidden — clips stay name-based and portable`,
      )
    }
    const tag = record.partTag
    if (tag !== undefined && tag !== 'intro' && tag !== 'outro') {
      errors.push(`command #${index} (${ctype}): partTag must be intro/outro (middle excluded)`)
    }
    if (
      String(record.property ?? '')
        .trim()
        .toLowerCase() === 'rotation'
    ) {
      errors.push(`command #${index} (${ctype}): camera rotation is never written`)
    }
    if (ctype === 'AiPlaceMouthClip') {
      const semantic = record.semanticName
      if (semantic !== undefined && semantic !== 'mouth') {
        errors.push(
          `command #${index} (${ctype}): mouth clips belong on semanticName 'mouth' nodes`,
        )
      }
    }
  })
  return errors
}

/** Phoneme-timed mouth commands, morphCoefficient tracks only (intro/outro). */
export function buildMouthCommands(
  timings: readonly CalibrationTiming[],
  nodeIds: Readonly<Record<string, string>>,
  phonemeMap?: Record<string, string> | null,
  availableShapes?: readonly string[] | null,
): { commands: ({ type: string } & Record<string, unknown>)[]; warnings: string[] } {
  const shapes = availableShapes
    ? availableShapes.filter((s) => typeof s === 'string' && s.trim())
    : null
  const commands: ({ type: string } & Record<string, unknown>)[] = []
  const warnings: string[] = []
  for (const timing of timings) {
    const partTag = timing.partTag
    const stepId = timing.stepId
    if (partTag !== 'intro' && partTag !== 'outro') {
      throw new Error(
        `part ${stepId}: mouth stays on intro/outro cat nodes (blackboard middle excluded)`,
      )
    }
    const nodeId = (nodeIds[stepId] ?? '').trim()
    if (!nodeId) throw new Error(`part ${stepId}: no cat node mapped for this intro/outro part`)
    if (timing.fallback) {
      const envelope = timing.envelope ?? []
      if (!Array.isArray(envelope) || envelope.length === 0) {
        throw new Error(`part ${stepId}: fallback marked but no envelope keys recorded`)
      }
      if (shapes !== null && !shapes.includes(OPEN_SHAPE)) {
        warnings.push(
          `part ${stepId}: Open mouth Shape missing on target — soft-warn-and-skip this part`,
        )
        continue
      }
      for (const key of envelope) {
        commands.push({
          type: 'AiSetMorphCoefficient',
          nodeId,
          coefficient: key.open,
          partTag,
          time: key.t,
          shape: OPEN_SHAPE,
          fallback: true,
        })
      }
      continue
    }
    const words = timing.words ?? []
    if (!Array.isArray(words) || words.length === 0) {
      throw new Error(
        `part ${stepId}: no word timings and no fallback — align it or record the envelope fallback first`,
      )
    }
    const mapped = mapWordsToShapes(words, phonemeMap)
    for (const entry of mapped) {
      if (!entry.shape) {
        warnings.push(
          `part ${stepId}: no rig-local shape for phoneme ${entry.phoneme} (word '${entry.word}') — soft-warn-and-skip`,
        )
        continue
      }
      if (shapes !== null && !shapes.includes(entry.shape)) {
        warnings.push(
          `part ${stepId}: mouth Shape '${entry.shape}' missing on target — soft-warn-and-skip`,
        )
        continue
      }
      commands.push({
        type: 'AiSetMorphCoefficient',
        nodeId,
        coefficient: 1.0,
        partTag,
        time: entry.start,
        word: entry.word,
        shape: entry.shape,
        phoneme: entry.phoneme,
      })
    }
  }
  return { commands, warnings }
}

/** Same timing source via Control values. */
export function buildControlMouthCommands(
  timings: readonly CalibrationTiming[],
  nodeIds: Readonly<Record<string, string>>,
  controlKey = 'Open',
  phonemeMap?: Record<string, string> | null,
  availableShapes?: readonly string[] | null,
): { commands: ({ type: string } & Record<string, unknown>)[]; warnings: string[] } {
  if (!controlKey.trim()) throw new Error('controlKey must be a non-empty string')
  const { commands: coefficients, warnings } = buildMouthCommands(
    timings,
    nodeIds,
    phonemeMap,
    availableShapes,
  )
  return {
    commands: coefficients.map((command) => {
      const record = command as Record<string, unknown>
      const base: { type: string } & Record<string, unknown> = {
        type: 'AiSetControlValue',
        nodeId: record.nodeId,
        controlKey: controlKey.trim(),
        value: record.coefficient,
        partTag: record.partTag,
        time: record.time,
      }
      if ('word' in record) {
        base.word = record.word
        base.shape = record.shape
      } else {
        base.shape = record.shape ?? OPEN_SHAPE
      }
      return base
    }),
    warnings,
  }
}

/** Same timing source via name-based mouth clip placements (never baked ids). */
export function buildClipMouthCommands(
  timings: readonly CalibrationTiming[],
  nodeIds: Readonly<Record<string, string>>,
  clipName = 'mouth-open',
  phonemeMap?: Record<string, string> | null,
  availableShapes?: readonly string[] | null,
): { commands: ({ type: string } & Record<string, unknown>)[]; warnings: string[] } {
  if (!clipName.trim()) throw new Error('clipName must be a non-empty string')
  const { commands: coefficients, warnings } = buildMouthCommands(
    timings,
    nodeIds,
    phonemeMap,
    availableShapes,
  )
  const byNode = new Map<string, Record<string, unknown>>()
  for (const command of coefficients) {
    const record = command as Record<string, unknown>
    const nodeId = String(record.nodeId)
    if (!byNode.has(nodeId)) byNode.set(nodeId, record)
  }
  return {
    commands: [...byNode.entries()].map(([nodeId, first]) => ({
      type: 'AiPlaceMouthClip',
      nodeId,
      clipName: clipName.trim(),
      semanticName: 'mouth',
      startTime: first.time,
      partTag: first.partTag,
    })),
    warnings,
  }
}

/** Accept-gate blockers: triple check green + every part timed or fallback. */
export function calibrationAcceptBlockers(calibration: {
  checks?: CalibrationChecks | null
  timings?: readonly CalibrationTiming[] | null
}): string[] {
  const blockers: string[] = []
  const checks = calibration.checks
  if (!checks || typeof checks !== 'object')
    return ['calibration has no verify-only checks recorded']
  if (!checks.voice?.ok)
    blockers.push(
      `voice: ${checks.voice?.message ?? 'voice check'} — fix the voice before accepting`,
    )
  if (!checks.faceRig?.ok)
    blockers.push(
      `face-rig: ${checks.faceRig?.message ?? 'face-rig check'} — author the mouth Shapes first`,
    )
  if (!checks.camera?.ok)
    blockers.push(
      `camera: ${checks.camera?.message ?? 'camera check'} — fix framing before accepting`,
    )
  const timings = calibration.timings
  if (!Array.isArray(timings) || timings.length === 0) {
    blockers.push('no intro/outro timings recorded — calibrate the pregen parts first')
    return blockers
  }
  for (const timing of timings) {
    const stepId = timing.stepId ?? '?'
    if (timing.partTag !== 'intro' && timing.partTag !== 'outro') {
      blockers.push(
        `part ${stepId}: mouth and camera stay on intro/outro (blackboard middle excluded)`,
      )
    }
    if (!(typeof timing.audioDuration === 'number' && timing.audioDuration > 0)) {
      blockers.push(`part ${stepId}: pregen audio not measured — measure it before accepting`)
    }
    if (timing.missingShapes && timing.missingShapes.length > 0) {
      blockers.push(
        `part ${stepId}: missing mouth Shapes ${timing.missingShapes.join(', ')} — soft-warn-and-skip: author them on the cat rig first`,
      )
    }
    const hasWords = Array.isArray(timing.words) && timing.words.length > 0
    const hasEnvelope = Array.isArray(timing.envelope) && timing.envelope.length > 0
    if (!hasWords && !(timing.fallback && hasEnvelope)) {
      blockers.push(
        `part ${stepId}: no word timings and no marked fallback — align it or record the envelope fallback first`,
      )
    }
  }
  return blockers
}
