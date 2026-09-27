import type { EnginePublic } from '../engine'
import type { AnimationProperty } from '../engine'
import { ANIMATABLE_PROPERTIES } from '../engine/animationProperties'
import type { DispatchCommand } from '../engine/commands'
import { ProportionalCopyCommand } from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import { longestClipDuration } from '../engine/collectionFlatten'
import {
  collectProportionalCopyPlan,
  validateProportionalCopySelection,
} from '../engine/proportionalCopy'
import type {
  ProportionalCopyBinding,
  ProportionalCopyMode,
  ProportionalCopyPreview,
} from '../engine/proportionalCopy'

export type { ProportionalCopyBinding, ProportionalCopyMode, ProportionalCopyPreview }

export interface ProportionalCopySelection {
  readonly sourceCollectionId: string
  readonly fromNorm: number
  readonly toNorm: number
  readonly bindings: readonly ProportionalCopyBinding[]
  readonly destCollectionIds: readonly string[]
  readonly mode: ProportionalCopyMode
  readonly reverse: boolean
}

export type ProportionalCopyResult =
  | {
      readonly ok: true
      readonly message: string
      readonly keyframeCount: number
      readonly destClipCount: number
      readonly replacedCount: number
      readonly skippedLinked: number
      readonly skippedMissingSemantic: number
      readonly skippedMissingClip: number
      readonly skippedSelf: number
    }
  | { readonly ok: false; readonly error: string }

/** Project-wide placement count of a clip (in-place edits affect all users). */
export function countClipUses(engine: EnginePublic, clipId: string): number {
  const project = engine.project
  if (!project) return 0
  let n = 0
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      for (const inst of node.clipInstances) if (inst.clipId === clipId) n++
    }
  }
  return n
}

export interface ProportionalCopySourceRow {
  readonly semanticName: string
  readonly clipId: string
  readonly clipName: string
  readonly duration: number
  /** Uniform-six channels present on the source clip (copyable). */
  readonly channels: readonly AnimationProperty[]
  /** Whether the source channel is param-linked (copied values would not match world). */
  readonly linkedChannels: readonly AnimationProperty[]
  readonly uses: number
}

export interface ProportionalCopyDestRow {
  readonly key: string
  readonly origin: 'project' | 'library'
  /**
   * Project collection id (origin 'project') or library entry id
   * (origin 'library', imported on confirm).
   */
  readonly refId: string
  readonly collectionName: string
  readonly category: string
  readonly bindingCount: number
}

/** Minimal structural view over a shared-library collection entry. */
export interface ProportionalCopyLibraryEntry {
  readonly id: string
  readonly name: string
  readonly category?: string | null
  readonly bindings: Record<string, string>
}

/** One row per source binding, in collection binding order. */
export function buildProportionalCopySourceRows(
  engine: EnginePublic,
  sourceCollectionId: string,
): ProportionalCopySourceRow[] {
  const rows: ProportionalCopySourceRow[] = []
  let bindings: Record<string, string>
  try {
    bindings = engine.getClipCollection(sourceCollectionId).getBindingsObject()
  } catch {
    return []
  }
  for (const [semanticName, clipId] of Object.entries(bindings)) {
    let clipName = clipId
    let duration = 0
    const channels: AnimationProperty[] = []
    const linkedChannels: AnimationProperty[] = []
    try {
      const clip = engine.getClip(clipId)
      clipName = clip.name
      duration = clip.duration
      for (const property of ANIMATABLE_PROPERTIES) {
        const def = clip.getChannel(property)
        if (!def) continue
        if (def.paramKey) linkedChannels.push(property)
        else channels.push(property)
      }
    } catch {
      // keep the id when the bound clip is gone; the plan reports it as missing
    }
    rows.push({
      semanticName,
      clipId,
      clipName,
      duration,
      channels,
      linkedChannels,
      uses: countClipUses(engine, clipId),
    })
  }
  return rows
}

/** Every project collection except the source, in engine order. */
export function buildProportionalCopyDestRows(
  engine: EnginePublic,
  sourceCollectionId: string,
): ProportionalCopyDestRow[] {
  const rows: ProportionalCopyDestRow[] = []
  for (const collection of engine.clipCollections) {
    if (collection.id === sourceCollectionId) continue
    rows.push({
      key: collection.id,
      origin: 'project',
      refId: collection.id,
      collectionName: collection.name,
      category: collection.category,
      bindingCount: Object.keys(collection.getBindingsObject()).length,
    })
  }
  return rows
}

/**
 * Shared-library collections as destination rows (imported on confirm).
 *
 * Entries that already have a same-named global (imported) project collection
 * are excluded — selecting them would either self-copy or import a confusing
 * "Name 2" duplicate; the project copy wins. The source entry itself is always
 * covered by this rule because importing creates a same-named global.
 */
export function buildLibraryDestRows(
  engine: EnginePublic,
  entries: readonly ProportionalCopyLibraryEntry[],
): ProportionalCopyDestRow[] {
  const globalNames = new Set(
    engine.clipCollections
      .filter((c) => c.sourceNodeId === undefined)
      .map((c) => c.name.trim().toLowerCase()),
  )
  const rows: ProportionalCopyDestRow[] = []
  for (const entry of entries) {
    if (globalNames.has(entry.name.trim().toLowerCase())) continue
    rows.push({
      key: `library:${entry.id}`,
      origin: 'library',
      refId: entry.id,
      collectionName: entry.name,
      category: typeof entry.category === 'string' ? entry.category : '',
      bindingCount: Object.keys(entry.bindings ?? {}).length,
    })
  }
  return rows
}

export interface ResolvedLibraryDests {
  readonly ids: string[]
  readonly skipped: string[]
}

/**
 * Resolve selected library entries to project collection ids, importing what
 * is missing. Reuses a same-named global collection when one appeared after
 * the rows were built. Entries sharing no objects with the source are skipped
 * before any import so a bad pick fails fast without side effects.
 */
export async function resolveLibraryDestIds<TEntry extends ProportionalCopyLibraryEntry>(
  engine: EnginePublic,
  sourceCollectionId: string,
  entries: readonly TEntry[],
  importEntry: (entry: TEntry) => Promise<string | null>,
): Promise<ResolvedLibraryDests> {
  const ids: string[] = []
  const skipped: string[] = []
  let sourceBindings: Record<string, string>
  try {
    sourceBindings = engine.getClipCollection(sourceCollectionId).getBindingsObject()
  } catch {
    return { ids, skipped: ['Source collection not found'] }
  }
  for (const entry of entries) {
    const overlap = Object.keys(entry.bindings ?? {}).filter((sem) => sem in sourceBindings)
    if (overlap.length === 0) {
      skipped.push(`"${entry.name}" shares no objects with the source`)
      continue
    }
    const existing = engine.clipCollections.find(
      (c) =>
        c.sourceNodeId === undefined &&
        c.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
    )
    if (existing) {
      ids.push(existing.id)
      continue
    }
    try {
      const importedId = await importEntry(entry)
      if (!importedId) {
        skipped.push(`"${entry.name}" could not be imported`)
        continue
      }
      ids.push(importedId)
    } catch (e) {
      skipped.push(
        `"${entry.name}" could not be imported (${e instanceof Error ? e.message : String(e)})`,
      )
    }
  }
  return { ids, skipped }
}

export function longestSourceDuration(engine: EnginePublic, sourceCollectionId: string): number {
  return longestClipDuration(engine, sourceCollectionId)
}

/**
 * Granular proportional copy across clip collections.
 *
 * The shared normalized window maps 1:1 onto each destination clip, so seconds
 * land proportionally to each clip's own duration. Destination keyframes inside
 * the window are replaced; everything outside is untouched. Mirror modes reuse
 * the spatial-mirror value table (X negates positionX+rotation, Y negates
 * positionY+rotation); reverse mirrors times inside the window (end becomes
 * start) and composes with the mirror modes. One undo step via before/after
 * clip snapshots.
 */
export function executeProportionalCopy(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  selection: ProportionalCopySelection,
): ProportionalCopyResult {
  const fail = (error: string): ProportionalCopyResult => ({ ok: false, error })
  const invalid = validateProportionalCopySelection(engine, selection)
  if (invalid) return fail(invalid)

  const plan = collectProportionalCopyPlan(engine, selection)
  if (plan.ops.length === 0) {
    const { preview } = plan
    if (preview.skippedLinked > 0 && preview.keyframeCount === 0) {
      return fail(
        `Nothing to copy — ${preview.skippedLinked} channel(s) are param-linked and were skipped`,
      )
    }
    return fail('Nothing to copy — selected source tracks have no keyframes in the range')
  }

  let command: ProportionalCopyCommand
  try {
    command = new ProportionalCopyCommand({
      sourceCollectionId: selection.sourceCollectionId,
      fromNorm: selection.fromNorm,
      toNorm: selection.toNorm,
      bindings: selection.bindings.map((b) => ({
        semanticName: b.semanticName,
        channels: [...b.channels],
      })),
      destCollectionIds: [...selection.destCollectionIds],
      mode: selection.mode,
      reverse: selection.reverse,
    })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
  const result = dispatch(command)
  if (!result.ok) return fail(result.error.message)

  const { preview } = plan
  const modeLabel =
    selection.mode === 'exact'
      ? 'Copied'
      : selection.mode === 'mirrorX'
        ? 'Mirrored (X)'
        : 'Mirrored (Y)'
  const bits = [
    `${modeLabel}${selection.reverse ? ' reversed' : ''} ${preview.keyframeCount} keyframe(s) into ${preview.destClipCount} clip(s)`,
  ]
  if (preview.replacedCount > 0) bits.push(`${preview.replacedCount} replaced`)
  if (preview.skippedLinked > 0)
    bits.push(`${preview.skippedLinked} param-linked channel(s) skipped`)
  if (preview.skippedMissingSemantic > 0)
    bits.push(`${preview.skippedMissingSemantic} missing semantic binding(s) skipped`)
  if (preview.skippedMissingClip > 0)
    bits.push(`${preview.skippedMissingClip} missing clip(s) skipped`)
  if (preview.skippedSelf > 0) bits.push(`${preview.skippedSelf} self-copy channel(s) skipped`)
  return {
    ok: true,
    message: bits.join(' · '),
    keyframeCount: preview.keyframeCount,
    destClipCount: preview.destClipCount,
    replacedCount: preview.replacedCount,
    skippedLinked: preview.skippedLinked,
    skippedMissingSemantic: preview.skippedMissingSemantic,
    skippedMissingClip: preview.skippedMissingClip,
    skippedSelf: preview.skippedSelf,
  }
}

/** Dry-run counts for the modal preview line. Mirrors the execute walk. */
export function previewProportionalCopy(
  engine: EnginePublic,
  selection: ProportionalCopySelection,
): ProportionalCopyPreview {
  if (validateProportionalCopySelection(engine, selection) !== null) {
    return {
      keyframeCount: 0,
      destClipCount: 0,
      replacedCount: 0,
      skippedLinked: 0,
      skippedMissingSemantic: 0,
      skippedMissingClip: 0,
      skippedSelf: 0,
    }
  }
  return collectProportionalCopyPlan(engine, selection).preview
}
