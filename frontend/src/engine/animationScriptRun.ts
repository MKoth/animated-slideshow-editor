import type { EnginePublic } from './engine'
import type { DispatchCommand } from './commands/dispatcher'
import { TransactionCommand } from './commands/transactionCommand'
import { SetSlideSceneEffectsCommand } from './commands/setSlideSceneEffectsCommand'
import { SetSlideAnimationScriptFootprintCommand } from './commands/setSlideAnimationScriptFootprintCommand'
import { CreateAudioClipCommand } from './commands/createAudioClipCommand'
import { DeleteAudioClipCommand } from './commands/deleteAudioClipCommand'
import { GenerateMeshCommand } from './commands/generateMeshCommand'
import type { Command } from './commands/command'
import { animationScriptClearCommands } from './animationScriptClear'
import { checkAnimationScript } from './animationScriptCheck'
import type { AnimationScriptCheckOptions } from './animationScriptCheck'
import type {
  AnimationScriptCompileResult,
  AnimationScriptMeshRequest,
} from './animationScriptCompiler'
import { SCRIPT_EFFECT_CLIP_ID_PREFIX } from './animationScriptCompiler'
import { SCRIPT_MESH_PARAMETER_SPECS } from './animationScriptCompiler'
import { compiledFootprintToJSON } from './compiledFootprint'
import { loadImageDataFromAsset, hasTransparentPixels } from './imageDataLoader'
import { generateMesh } from './meshGenerator'
import type { EmbeddedAsset } from './embeddedAsset'
import type { MeshData } from './mesh'
import type { AnimationScriptDiagnostic, AnimationScriptSummary } from './animationScriptCompiler'

/**
 * The Animation Script Run seam: compile `(source, slide state)` pure, then
 * dispatch the emitted commands plus the compiled-footprint record as children
 * of one Transaction — one Run, one History entry. Replace-by-footprint runs a
 * clear of the previous and new footprints first, so a re-run replaces its own
 * output (including script-created nodes and data sources) instead of
 * duplicating it. A blocked compile dispatches nothing; a failing run rolls
 * back completely. The source is never rewritten.
 */
export interface AnimationScriptRunResult {
  readonly ran: boolean
  readonly diagnostics: readonly AnimationScriptDiagnostic[]
  /** The same metrics Check promised for this source. */
  readonly summary: AnimationScriptSummary
  /** Set when the compile was runnable but the run failed; null otherwise. */
  readonly error: string | null
}

/** One step of a multi-step Run (asset embeds, mesh gen, material/audio embeds, apply). */
export interface AnimationScriptRunProgress {
  /** Steps finished so far (0 on the opening report). */
  readonly done: number
  /** Total steps this run will take, known up front after compile. */
  readonly total: number
  readonly phase: 'compile' | 'asset' | 'mesh' | 'material' | 'audio' | 'dispatch'
  /** Human line for the loader, e.g. `asset "oak-tree"`. */
  readonly label: string
}

export interface AnimationScriptRunOptions extends AnimationScriptCheckOptions {
  /**
   * Embed an asset snapshot for a script-created asset instance. The app wires
   * this to the asset library (fetch bytes from the backend). When omitted, the
   * asset must already be embedded or registered in the library.
   */
  readonly captureAsset?: (definitionId: string) => Promise<boolean>
  /**
   * Embed a material (and its shader) snapshot for a script `material(...)`
   * assignment. The app wires this to the material library. When omitted, the
   * material must already be embedded or registered in the library.
   */
  readonly captureMaterial?: (definitionId: string) => boolean | Promise<boolean>
  /**
   * Embed an audio snapshot for an effect `sound:` resolved to a global
   * library asset. The app wires this to `captureAudioSnapshot`; best-effort
   * like image capture — playback falls back to the library URL when it fails.
   */
  readonly captureAudio?: (assetId: string) => boolean | Promise<boolean>
  /**
   * Image loader seam for mesh generation, so tests can supply pixels without
   * a canvas. Defaults to the renderer's data-URL loader.
   */
  readonly loadImageData?: (asset: EmbeddedAsset) => Promise<ImageData>
  /**
   * Step-count loader seam: called once up front with `{ done: 0, total }`
   * and after every run step (asset/mesh/material/audio embed, final
   * dispatch). First runs of multi-step lessons embed dozens of assets, so
   * the panel shows "step X of N" instead of a frozen Run button.
   */
  readonly onProgress?: (progress: AnimationScriptRunProgress) => void
}

/**
 * The synchronous Run: execute a compile that needs no asset preparation.
 * Scripts that embed assets or generate meshes use `runAnimationScriptAsync`;
 * this path still creates text, tables, charts and data sources.
 */
export function runAnimationScript(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  source: string,
  options: AnimationScriptCheckOptions = {},
): AnimationScriptRunResult {
  const compiled = checkAnimationScript(engine, slideId, source, options)
  const outcome = {
    diagnostics: compiled.diagnostics,
    summary: compiled.summary,
  }
  if (!compiled.runnable) {
    return { ran: false, error: null, ...outcome }
  }
  if (compiled.creations.nodes.some((created) => created.mesh !== undefined)) {
    return {
      ran: false,
      error: 'This script generates meshes — run it with runAnimationScriptAsync',
      ...outcome,
    }
  }
  return dispatchCompiled(engine, dispatch, slideId, compiled, new Map(), outcome)
}

/**
 * The asynchronous Run: compiles, ensures every script-created asset is
 * embedded (via the app-provided capture seam), generates the requested meshes
 * from the embedded PNGs, then dispatches one Transaction in source order with
 * each mesh command placed right after its asset-instance create.
 */
export async function runAnimationScriptAsync(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  source: string,
  options: AnimationScriptRunOptions = {},
): Promise<AnimationScriptRunResult> {
  const compiled = checkAnimationScript(engine, slideId, source, options)
  const outcome = {
    diagnostics: compiled.diagnostics,
    summary: compiled.summary,
  }
  if (!compiled.runnable) {
    return { ran: false, error: null, ...outcome }
  }
  const report = options.onProgress
  // Step-count loader: every awaited prep plus the final dispatch is one
  // step. Totals are known up front (already-embedded items need no capture
  // and are skipped), so the first run of a multi-step lesson shows its
  // real amount of steps instead of a frozen button.
  const assetNameById = new Map(
    engine.assetDefinitions.map((definition) => [definition.id, definition.name] as const),
  )
  const pending: { phase: AnimationScriptRunProgress['phase']; label: string }[] = []
  for (const created of compiled.creations.nodes) {
    if (
      created.assetDefinitionId !== undefined &&
      engine.getEmbeddedAsset(created.assetDefinitionId) === undefined &&
      options.captureAsset !== undefined
    ) {
      pending.push({ phase: 'asset', label: `asset "${created.name}"` })
    }
    if (created.mesh !== undefined) {
      pending.push({ phase: 'mesh', label: `mesh "${created.mesh.assetName}"` })
    }
  }
  for (const material of compiled.creations.materials) {
    if (
      engine.getEmbeddedMaterial(material.id) === undefined &&
      options.captureMaterial !== undefined
    ) {
      pending.push({ phase: 'material', label: `material "${material.name}"` })
    }
  }
  if (options.captureAudio !== undefined) {
    const seen = new Set<string>()
    for (const clip of compiled.audioClips) {
      if (seen.has(clip.assetId) || engine.getEmbeddedAsset(clip.assetId) !== undefined) continue
      seen.add(clip.assetId)
      pending.push({
        phase: 'audio',
        label: `audio "${assetNameById.get(clip.assetId) ?? clip.assetId}"`,
      })
    }
  }
  pending.push({ phase: 'dispatch', label: 'applying scene changes' })
  const total = pending.length
  report?.({ done: 0, total, phase: pending[0].phase, label: pending[0].label })
  let done = 0
  const step = (phase: AnimationScriptRunProgress['phase'], label: string) => {
    done += 1
    report?.({ done, total, phase, label })
  }
  const extrasByOrder = new Map<number, Command<unknown>[]>()
  for (const created of compiled.creations.nodes) {
    if (created.assetDefinitionId !== undefined) {
      const embedded = engine.getEmbeddedAsset(created.assetDefinitionId)
      if (embedded === undefined && options.captureAsset !== undefined) {
        try {
          await options.captureAsset(created.assetDefinitionId)
        } catch {
          // Fall through to the embedding check below, which reports cleanly.
        }
        step('asset', `asset "${created.name}"`)
      }
    }
    if (created.mesh !== undefined) {
      const failure = await prepareMesh(engine, created.mesh, created.order, extrasByOrder, options)
      step('mesh', `mesh "${created.mesh.assetName}"`)
      if (failure !== null) {
        return { ran: false, error: failure, ...outcome }
      }
    }
  }
  // Embed the materials a `material(...)` statement assigned so the project
  // stays self-contained. A material still registered in the library resolves
  // even when embedding fails; the dispatch reports an unresolvable id cleanly.
  for (const material of compiled.creations.materials) {
    if (engine.getEmbeddedMaterial(material.id) !== undefined) continue
    if (options.captureMaterial === undefined) continue
    try {
      await options.captureMaterial(material.id)
    } catch {
      // Fall through: the assignment validates against the library instead.
    }
    step('material', `material "${material.name}"`)
  }
  // Embed global audio an effect `sound:` resolved so the project stays
  // self-contained. Playback can still fetch the library URL when this fails.
  if (options.captureAudio !== undefined) {
    const seen = new Set<string>()
    for (const clip of compiled.audioClips) {
      if (seen.has(clip.assetId) || engine.getEmbeddedAsset(clip.assetId) !== undefined) continue
      seen.add(clip.assetId)
      try {
        await options.captureAudio(clip.assetId)
      } catch {
        // Fall through: dispatch references the global id directly.
      }
      step('audio', `audio "${assetNameById.get(clip.assetId) ?? clip.assetId}"`)
    }
  }
  const result = dispatchCompiled(engine, dispatch, slideId, compiled, extrasByOrder, outcome)
  step('dispatch', 'applying scene changes')
  return result
}

/** Generate a mesh request into `extrasByOrder`, or return an error message. */
async function prepareMesh(
  engine: EnginePublic,
  request: AnimationScriptMeshRequest,
  order: number,
  extrasByOrder: Map<number, Command<unknown>[]>,
  options: AnimationScriptRunOptions,
): Promise<string | null> {
  const asset = engine.getEmbeddedAsset(request.assetDefinitionId)
  if (asset === undefined) {
    return `Asset "${request.assetName}" is not embedded in this project — import it into the asset library and retry.`
  }
  if (!asset.mimeType.startsWith('image/png')) {
    return `Asset "${request.assetName}" is ${asset.mimeType || 'not a PNG'} — mesh generation needs a PNG with transparent pixels.`
  }
  let imageData: ImageData
  try {
    imageData = await (options.loadImageData ?? loadImageDataFromAsset)(asset)
  } catch (error) {
    return `Could not load "${request.assetName}" for mesh generation: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!hasTransparentPixels(imageData)) {
    return `Asset "${request.assetName}" has no transparent pixels — mesh generation is not needed.`
  }
  try {
    const result = generateMesh({
      imageData,
      meshDensity: request.params.meshDensity ?? SCRIPT_MESH_PARAMETER_SPECS.meshDensity.default,
      boundarySpacing:
        request.params.boundarySpacing ?? SCRIPT_MESH_PARAMETER_SPECS.boundarySpacing.default,
      jointDensity: request.params.jointDensity ?? SCRIPT_MESH_PARAMETER_SPECS.jointDensity.default,
      jointRadius: request.params.jointRadius ?? SCRIPT_MESH_PARAMETER_SPECS.jointRadius.default,
      jointMinDist: request.params.jointMinDist ?? SCRIPT_MESH_PARAMETER_SPECS.jointMinDist.default,
      maxVertices: request.params.maxVertices ?? SCRIPT_MESH_PARAMETER_SPECS.maxVertices.default,
    })
    const mesh: MeshData = {
      vertices: result.vertices,
      faces: result.faces,
      uvs: result.uvs,
    }
    const extras = extrasByOrder.get(order) ?? []
    extras.push(new GenerateMeshCommand({ nodeId: request.nodeId, mesh }))
    extrasByOrder.set(order, extras)
    return null
  } catch (error) {
    return `Mesh generation for "${request.assetName}" failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * A script-owned id (`script-node:` / `script-ds:`) colliding at create time
 * means stale script output survived clearing (older lesson, lost footprint,
 * or a hand-made id clash). Name the owner instead of surfacing the raw
 * id-exists error so the user can delete the stale node or rename the clash.
 */
function explainRunError(message: string): string {
  const match = /A (node|data source) with id "(script-(?:node|ds):[^"]+)" already exists/.exec(
    message,
  )
  if (!match) return message
  const [, kind, id] = match
  return (
    `${message} — stale script-created ${kind} "${id}" survived clearing. ` +
    `Delete that ${kind} in the scene tree (or the data source) and run again`
  )
}

/** Clear, dispatch and record the footprint as one Transaction. */
function dispatchCompiled(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  compiled: AnimationScriptCompileResult,
  extrasByOrder: ReadonlyMap<number, readonly Command<unknown>[]>,
  outcome: { diagnostics: readonly AnimationScriptDiagnostic[]; summary: AnimationScriptSummary },
): AnimationScriptRunResult {
  const previousFootprint = engine.getSlide(slideId).animationScript?.lastCompiled ?? null
  const replacedEffectIds = new Set([
    ...(previousFootprint?.effectIds ?? []),
    ...(compiled.footprint.effectIds ?? []),
  ])
  // Generated effect sounds are ordinary SFX AudioClips tracked by footprint.
  // Rerun deletes the previous and new footprint ids first (tolerating
  // hand-deleted clips), then recreates the planned placements, so edits
  // replace without duplication and unrelated/manual audio is preserved.
  // Orphan sweep: clips carrying the compiler-reserved effect-sound prefix
  // but missing from the fresh footprint are stale script output
  // (pre-footprint lesson, lost footprint, timing-shifted survivor) — a
  // re-run deletes exactly those too and re-places them at the compiled
  // times, so a displaced reveal/wipe sound is healed while voice, manual
  // SFX and music (never carrying the prefix) are untouched.
  const replacedAudioClipIds = new Set([
    ...(previousFootprint?.audioClipIds ?? []),
    ...(compiled.footprint.audioClipIds ?? []),
  ])
  const freshAudioClipIds = new Set(compiled.footprint.audioClipIds ?? [])
  for (const clip of engine.getSlide(slideId).audio.clips) {
    if (!clip.id.startsWith(SCRIPT_EFFECT_CLIP_ID_PREFIX)) continue
    if (freshAudioClipIds.has(clip.id)) continue
    replacedAudioClipIds.add(clip.id)
  }
  const existingClipIds = new Set(engine.getSlide(slideId).audio.clips.map((clip) => clip.id))
  const deleteAudioCommands: Command<unknown>[] = []
  for (const clipId of replacedAudioClipIds) {
    if (!existingClipIds.has(clipId)) continue
    deleteAudioCommands.push(new DeleteAudioClipCommand({ slideId, clipId }))
  }
  const createAudioCommands: Command<unknown>[] = compiled.audioClips.map(
    (clip) =>
      new CreateAudioClipCommand({
        id: clip.id,
        slideId,
        assetId: clip.assetId,
        trackId: 'sfx',
        timelineStart: clip.timelineStart,
        sourceStart: clip.sourceStart,
        sourceEnd: clip.sourceEnd,
        // No time-stretching: the source repeats adjacently at rate 1.
        playbackRate: 1,
      }) as Command<unknown>,
  )
  const commands: Command<unknown>[] = []
  compiled.commands.forEach((command, index) => {
    commands.push(command)
    const extras = extrasByOrder.get(compiled.commandOrders[index])
    if (extras !== undefined && extras.length > 0) {
      commands.push(...extras)
    }
  })
  const result = dispatch(
    new TransactionCommand([
      ...animationScriptClearCommands(engine, previousFootprint, compiled.footprint),
      ...deleteAudioCommands,
      ...createAudioCommands,
      ...commands,
      new SetSlideSceneEffectsCommand({
        slideId,
        effects: [
          ...engine.getSlide(slideId).effects.filter((effect) => !replacedEffectIds.has(effect.id)),
          ...compiled.effects,
        ],
      }),
      new SetSlideAnimationScriptFootprintCommand({
        slideId,
        footprint: compiledFootprintToJSON(compiled.footprint),
      }),
    ]),
  )
  if (!result.ok) {
    return { ran: false, error: explainRunError(result.error.message), ...outcome }
  }
  return { ran: true, error: null, ...outcome }
}
