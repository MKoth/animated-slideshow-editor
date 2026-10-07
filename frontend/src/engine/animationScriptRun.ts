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
   * Image loader seam for mesh generation, so tests can supply pixels without
   * a canvas. Defaults to the renderer's data-URL loader.
   */
  readonly loadImageData?: (asset: EmbeddedAsset) => Promise<ImageData>
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
      }
    }
    if (created.mesh !== undefined) {
      const failure = await prepareMesh(engine, created.mesh, created.order, extrasByOrder, options)
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
  }
  return dispatchCompiled(engine, dispatch, slideId, compiled, extrasByOrder, outcome)
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
  const replacedAudioClipIds = new Set([
    ...(previousFootprint?.audioClipIds ?? []),
    ...(compiled.footprint.audioClipIds ?? []),
  ])
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
    return { ran: false, error: result.error.message, ...outcome }
  }
  return { ran: true, error: null, ...outcome }
}
