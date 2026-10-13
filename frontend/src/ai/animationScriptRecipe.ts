import type { SequenceBeatDraft, SequenceDraft, SequenceTransitionPlan } from './animationSequence'

/** Frozen-hold gap (seconds) for implicit between-beat holds and explicit poses. */
export const SEQUENCE_FROZEN_HOLD_DURATION = 0.5

/**
 * Emit the retained Animation Script recipe for a Scene Animation Sequence.
 *
 * With no selection, every draftable beat is emitted for preview. When beat ids
 * are supplied, only those draftable beats are emitted, in Sequence order;
 * every omitted beat remains visible as a comment. Approval and applicability
 * decisions stay with the apply planner.
 */
export function buildAnimationSequenceRecipe(
  draft: Pick<SequenceDraft, 'beats' | 'transitions' | 'alignmentEffects'>,
  selectedBeatIds?: readonly string[],
): string {
  const beats = Array.isArray(draft?.beats) ? [...draft.beats] : []
  const selected = selectedBeatIds === undefined ? null : new Set(selectedBeatIds)
  const included = beats.filter(
    (beat) =>
      beat?.status === 'draftable' &&
      beat.collectionName !== null &&
      (selected === null || selected.has(beat.beatId)),
  )
  const total = beats.length
  const lines = [
    'script "Scene Animation Sequence" from 0',
    '// Retained recipe - compiles to ordinary timeline keyframes, clip instances, and placements.',
    '// Beat order follows the Scene Animation Sequence - placements are sequential; lane priority does not crossfade.',
    '// Character-local motion comes from reusable Clip Collections; scene travel stays as separate scene-level raw keyframes.',
    '// Frozen holds use hold interpolation between beats - pauses never reveal the default pose.',
  ]

  if (selected !== null && included.length === 0) {
    lines.push('// No beats approved in this batch - nothing to draft.')
  }

  const usedAliases = new Set<string>()
  const targetAliasById = new Map<string, string>()
  const collectionAliasByName = new Map<string, string>()
  const travelNameById = new Map<string, string>()
  const nameById = new Map<string, string>()
  for (const beat of included) {
    for (const [id, name] of Object.entries(beat.targetNames)) {
      if (!nameById.has(id)) nameById.set(id, name)
    }
    for (const leg of beat.travel) {
      if (!travelNameById.has(leg.targetNodeId)) {
        travelNameById.set(leg.targetNodeId, leg.targetName)
      }
    }
  }
  const ensureTargetAlias = (id: string): string => {
    const existing = targetAliasById.get(id)
    if (existing) return existing
    const sameBeat = included.find((beat) => beat.targetNodeIds.includes(id))
    const baseName = sameBeat?.targetNames[id] ?? travelNameById.get(id) ?? nameById.get(id) ?? id
    const alias = uniqueAlias(`target_${baseName}`, usedAliases)
    targetAliasById.set(id, alias)
    return alias
  }
  for (const beat of included) {
    for (const id of beat.targetNodeIds) ensureTargetAlias(id)
    for (const leg of beat.travel) ensureTargetAlias(leg.targetNodeId)
    const collectionName = beat.collectionName ?? ''
    if (collectionName && !collectionAliasByName.has(collectionName)) {
      collectionAliasByName.set(
        collectionName,
        uniqueAlias(`motion_${collectionName}`, usedAliases),
      )
    }
  }
  for (const [id, alias] of targetAliasById) {
    lines.push(
      `bind ${alias} = node("${escapeScriptString(nameById.get(id) ?? travelNameById.get(id) ?? id)}")`,
    )
  }
  for (const [name, alias] of collectionAliasByName) {
    lines.push(`bind ${alias} = collection("${escapeScriptString(name)}")`)
  }

  const explicitByPair = new Map<string, SequenceTransitionPlan>()
  for (const entry of draft?.transitions ?? []) {
    if (entry.explicit) explicitByPair.set(`${entry.fromBeatId}→${entry.toBeatId}`, entry)
  }
  let previousIncluded: SequenceBeatDraft | null = null
  for (const beat of beats) {
    const position = `Beat ${beat.order + 1}/${total} "${beat.label}"`
    if (beat.status !== 'draftable' || beat.collectionName === null) {
      const reason = beat.blockers[0] ?? `blocked (${beat.beatId})`
      lines.push(`// ${position} omitted - blocked: ${reason}`)
      for (const action of beat.actions) lines.push(`// Next step: ${action}`)
      continue
    }
    if (selected !== null && !selected.has(beat.beatId)) {
      lines.push(`// ${position} omitted - not in the approved batch; remains unapplied.`)
      continue
    }

    if (previousIncluded !== null) {
      const explicit = explicitByPair.get(`${previousIncluded.beatId}→${beat.beatId}`)
      if (explicit?.kind === 'cut') {
        lines.push(
          `// explicit cut from "${previousIncluded.label}" to "${beat.label}" — placements are sequential; lane priority does not crossfade`,
        )
      } else if (explicit?.kind === 'hold') {
        lines.push(
          `wait(${formatTime(explicit.duration)}s) // explicit hold transition from "${previousIncluded.label}" to "${beat.label}" — frozen hold with hold interpolation; lane priority does not crossfade`,
        )
      } else if (explicit?.kind === 'move') {
        lines.push(
          `wait(${formatTime(explicit.duration)}s) // explicit move transition from "${previousIncluded.label}" to "${beat.label}" — scene-level travel continues; placements are sequential and lane priority does not crossfade`,
        )
      } else {
        lines.push(
          `wait(${formatTime(SEQUENCE_FROZEN_HOLD_DURATION)}s) // frozen hold - coordinated pose holds before the next beat`,
        )
      }
      for (const jump of beat.jumps) lines.push(`// ${jump}`)
    } else if (beat.frozenBefore) {
      lines.push(
        `wait(${formatTime(SEQUENCE_FROZEN_HOLD_DURATION)}s) // frozen pose hold before beat "${beat.label}" — coordinated pose holds with hold interpolation`,
      )
    }

    const collectionAlias = collectionAliasByName.get(beat.collectionName) ?? 'motion'
    const bindings =
      beat.matchedSemantics.length > 0 ? ` (bindings: ${beat.matchedSemantics.join(', ')})` : ''
    const targets = formatNodes(beat.targetNodeIds, beat.targetNames)
    lines.push(`// ${position} - reusable ${beat.collectionName} on ${targets}${bindings}`)
    for (const targetId of beat.targetNodeIds) {
      const targetAlias = targetAliasById.get(targetId)
      if (targetAlias) lines.push(`${targetAlias}.apply(${collectionAlias})`)
    }
    for (const leg of beat.travel) {
      const travelAlias = targetAliasById.get(leg.targetNodeId)
      if (!travelAlias) continue
      lines.push(
        `${travelAlias}.tween(${formatTravelRecord(leg.to)}, ${formatTime(leg.duration)}, ${leg.ease}) // scene-level travel for beat "${beat.label}" — separate from character-local "${beat.collectionName}"; never baked into reusable motion`,
      )
    }
    if (included[included.length - 1]?.beatId === beat.beatId && beat.frozenAfter) {
      lines.push(
        `wait(${formatTime(SEQUENCE_FROZEN_HOLD_DURATION)}s) // frozen pose hold after beat "${beat.label}" — coordinated pose holds with hold interpolation`,
      )
    }
    previousIncluded = beat
  }

  const includedCollections = new Set(included.map((beat) => beat.collectionName))
  for (const effect of draft?.alignmentEffects ?? []) {
    if (selected !== null && !includedCollections.has(effect.collectionName)) continue
    const fullScope = selected === null
    const scopeText = fullScope
      ? ` (${effect.affectedPlacements} in this draft plus existing timeline placements)`
      : ''
    lines.push(
      `// Proposed alignment offset for collection "${effect.collectionName}" semantic "${effect.semanticName}": (${effect.x}, ${effect.y}) — shared by all placements of "${effect.collectionName}"${scopeText}; preview across the collection before approval via SetClipCollectionAlignmentOffsets; never silently mutated.`,
    )
  }
  return lines.join('\n')
}

function formatTime(time: number): string {
  return Number(time.toFixed(2)).toString()
}

function escapeScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function toAliasBase(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = cleaned || 'target'
  return /^[0-9]/.test(base) ? `n_${base}` : base
}

function uniqueAlias(base: string, used: Set<string>): string {
  const candidate = toAliasBase(base)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  let index = 2
  while (used.has(`${candidate}_${index}`)) index += 1
  const unique = `${candidate}_${index}`
  used.add(unique)
  return unique
}

function formatTravelRecord(to: {
  x: number
  y: number
  scaleX?: number
  scaleY?: number
}): string {
  const parts = [`x: ${to.x}`, `y: ${to.y}`]
  if (typeof to.scaleX === 'number') parts.push(`scaleX: ${to.scaleX}`)
  if (typeof to.scaleY === 'number') parts.push(`scaleY: ${to.scaleY}`)
  return `{ ${parts.join(', ')} }`
}

function formatNodes(nodeIds: readonly string[], names: Readonly<Record<string, string>>): string {
  if (nodeIds.length === 0) return 'no scene nodes'
  return nodeIds
    .map((id) => {
      const name = names[id]
      return typeof name === 'string' && name ? `${name} [${id}]` : `[${id}]`
    })
    .join(', ')
}
