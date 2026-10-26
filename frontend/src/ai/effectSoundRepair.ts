import { checkAnimationScript } from '../engine/animationScriptCheck'
import { SCRIPT_EFFECT_CLIP_ID_PREFIX } from '../engine/animationScriptCompiler'
import type { AnimationScriptMeasure } from '../engine/animationScriptReads'
import type { EnginePublic } from '../engine/engine'
import type { Command } from '../engine/commands/command'
import type { UndoStack } from '../engine/commands/undoStack'
import { TransactionCommand } from '../engine/commands/transactionCommand'
import { CreateAudioClipCommand } from '../engine/commands/createAudioClipCommand'
import { DeleteAudioClipCommand } from '../engine/commands/deleteAudioClipCommand'
import type { ScenarioScriptApplyDispatcher } from './scenarioScriptApply'

export interface EffectSoundRepairSystem {
  dispatcher: ScenarioScriptApplyDispatcher
  undoStack: UndoStack
}

export interface EffectSoundRepairGlobalAudio {
  readonly id: string
  readonly name: string
  readonly duration: number
}

export interface EffectSoundRepairOptions {
  /**
   * Renderer-measured node sizes (the Script panel passes its pixi
   * measurement). Omitted only in headless tests, where the stub returns
   * sizes; without any measure, reveal/wipe effects report no measurable
   * content and the repair reports that instead of silently doing nothing.
   */
  readonly measure?: AnimationScriptMeasure
  readonly globalAudioAssets?: readonly EffectSoundRepairGlobalAudio[]
}

/** Library definition shape the repair audio collector reads (structural). */
export interface RepairAudioDefinition {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly mimeType?: string
  readonly original_filename?: string | null
  readonly metadata?: Readonly<Record<string, unknown>> | null
}

/**
 * Fresh library uploads Check can resolve by name before anything embeds
 * them (mirrors the Script panel collector): audio definitions with usable
 * durations. Embedded snapshots win at compile time; this only fills gaps.
 */
export function collectGlobalAudioForRepair(
  definitions: readonly RepairAudioDefinition[],
): EffectSoundRepairGlobalAudio[] {
  const out: EffectSoundRepairGlobalAudio[] = []
  for (const definition of definitions) {
    const isAudio =
      definition.category === 'audio' ||
      definition.mimeType?.startsWith('audio/') === true ||
      /\.(wav|mp3|mpeg|ogg|webm)$/i.test(definition.original_filename ?? '')
    if (!isAudio) continue
    const raw = (definition.metadata as Record<string, unknown> | undefined)?.duration
    out.push({
      id: definition.id,
      name: definition.name,
      duration: typeof raw === 'number' ? raw : Number.NaN,
    })
  }
  return out
}

export type EffectSoundRepairResult =
  | {
      readonly ok: true
      readonly deleted: number
      readonly created: number
      /** True when every connected sound was already exactly in place. */
      readonly noop: boolean
      readonly historyEntryId: string | null
    }
  | { readonly ok: false; readonly error: string }

function samePlacement(
  clip: { assetId: string; timelineStart: number; sourceStart: number; sourceEnd: number },
  planned: { assetId: string; timelineStart: number; sourceStart: number; sourceEnd: number },
): boolean {
  return (
    clip.assetId === planned.assetId &&
    Math.abs(clip.timelineStart - planned.timelineStart) < 1e-9 &&
    Math.abs(clip.sourceStart - planned.sourceStart) < 1e-9 &&
    Math.abs(clip.sourceEnd - planned.sourceEnd) < 1e-9
  )
}

/**
 * Repair one slide's effect sounds (issue: wipe/reveal SFX displaced by TTS
 * timing shifts). Deletes exactly the script-connected audio — footprint
 * sounds plus orphaned `script-effect-clip:*` strays (pre-footprint lesson,
 * lost footprint, shifted survivor) — and recreates the compiled placements
 * at the visual times. Voice, manual SFX and music never carry the reserved
 * prefix and are never touched. One Transaction, one History entry; a no-op
 * reports `noop` without writing history.
 *
 * A blocked board compile dispatches nothing and reports the script errors,
 * so a dead Run button stops being silent: the caller surfaces `error`.
 */
export function repairSlideEffectSounds(
  system: EffectSoundRepairSystem,
  engine: EnginePublic,
  slideId: string,
  options: EffectSoundRepairOptions = {},
): EffectSoundRepairResult {
  let slide: ReturnType<EnginePublic['getSlide']>
  try {
    slide = engine.getSlide(slideId)
  } catch {
    return { ok: false, error: `Slide not found: ${slideId}. Nothing executed.` }
  }
  const liveClips = slide.audio.clips
  const byId = new Map(liveClips.map((clip) => [clip.id, clip] as const))
  const previousIds = slide.animationScript?.lastCompiled?.audioClipIds ?? []
  const source = slide.animationScript?.source ?? null

  // No board script: pure cleanup of connected strays, nothing to re-place.
  if (source === null || source.trim() === '') {
    const strays = liveClips.filter(
      (clip) => clip.id.startsWith(SCRIPT_EFFECT_CLIP_ID_PREFIX) || previousIds.includes(clip.id),
    )
    if (strays.length === 0) {
      return { ok: true, deleted: 0, created: 0, noop: true, historyEntryId: null }
    }
    const commands: Command<unknown>[] = strays.map(
      (clip) => new DeleteAudioClipCommand({ slideId, clipId: clip.id }),
    )
    return executeRepair(system, commands, strays.length, 0)
  }

  const compiled = checkAnimationScript(engine, slideId, source, {
    ...(options.measure ? { measure: options.measure } : {}),
    ...(options.globalAudioAssets ? { globalAudioAssets: options.globalAudioAssets } : {}),
  })
  if (!compiled.runnable) {
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error')
    const shown = errors
      .slice(0, 3)
      .map((d) => `line ${d.line}: ${d.message}`)
      .join(' | ')
    const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : ''
    return {
      ok: false,
      error:
        `Board script has ${errors.length} error(s) — sounds cannot be repaired until it compiles: ${shown}${more}. ` +
        `Fix the script (Script panel Check shows the same list), then repair again. Nothing executed.`,
    }
  }

  const fresh = compiled.audioClips
  const freshIds = new Set(fresh.map((clip) => clip.id))
  const trackedIds = new Set([...previousIds, ...freshIds])
  const deleteIds: string[] = []
  for (const clip of liveClips) {
    if (!trackedIds.has(clip.id)) {
      // Orphan sweep: reserved-prefix clips outside every footprint are
      // stale script output — delete exactly those, nothing else.
      if (clip.id.startsWith(SCRIPT_EFFECT_CLIP_ID_PREFIX) && !freshIds.has(clip.id)) {
        deleteIds.push(clip.id)
      }
      continue
    }
    const planned = fresh.find((entry) => entry.id === clip.id)
    if (!planned || !samePlacement(clip, planned)) deleteIds.push(clip.id)
  }
  const createEntries = fresh.filter((planned) => {
    const live = byId.get(planned.id)
    return !live || !samePlacement(live, planned)
  })
  if (deleteIds.length === 0 && createEntries.length === 0) {
    return { ok: true, deleted: 0, created: 0, noop: true, historyEntryId: null }
  }
  // Pre-validate sound assets so a missing embed reports instead of a
  // rolled-back Transaction that looks like nothing happened. (Global
  // uploads above only help the compile resolve durations; dispatch needs
  // the asset embedded or registered.)
  for (const planned of createEntries) {
    if (engine.getEmbeddedAsset(planned.assetId) !== undefined) continue
    let foundGlobal = false
    try {
      if (engine.getAssetDefinition(planned.assetId)) foundGlobal = true
    } catch {
      foundGlobal = false
    }
    if (!foundGlobal) {
      return {
        ok: false,
        error: `Effect sound audio "${planned.assetId}" is not in this project — open the board Script panel and press Run once to embed it, then repair again. Nothing executed.`,
      }
    }
  }
  const commands: Command<unknown>[] = [
    ...deleteIds.map((clipId) => new DeleteAudioClipCommand({ slideId, clipId })),
    ...createEntries.map(
      (planned) =>
        new CreateAudioClipCommand({
          id: planned.id,
          slideId,
          assetId: planned.assetId,
          trackId: 'sfx',
          timelineStart: planned.timelineStart,
          sourceStart: planned.sourceStart,
          sourceEnd: planned.sourceEnd,
          playbackRate: 1,
        }),
    ),
  ]
  return executeRepair(system, commands, deleteIds.length, createEntries.length)
}

function executeRepair(
  system: EffectSoundRepairSystem,
  commands: Command<unknown>[],
  deleted: number,
  created: number,
): EffectSoundRepairResult {
  const before = system.undoStack.entries.length
  const result = system.dispatcher.dispatch(new TransactionCommand(commands), 'ai')
  if (!result.ok) {
    return { ok: false, error: `Sound repair failed: ${result.error.message}. Nothing applied.` }
  }
  const top = system.undoStack.entries[0]
  if (system.undoStack.entries.length !== before + 1 || top?.type !== 'Transaction') {
    return { ok: false, error: 'Repair did not record exactly one History entry.' }
  }
  return { ok: true, deleted, created, noop: false, historyEntryId: top.id }
}
