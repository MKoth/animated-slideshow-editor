import { isRecord, requireFiniteNumber, requireString } from './guards'
import { requireKeyframeTarget } from './keyframeTarget'
import type { KeyframeTarget } from './keyframeTarget'
import type { CompiledFootprintJSON } from './json'

export interface CompiledFootprintTrack {
  readonly nodeId: string
  readonly target: KeyframeTarget
}

export interface CompiledFootprint {
  readonly from: number
  readonly to: number
  readonly tracks: readonly CompiledFootprintTrack[]
  readonly placementParents: readonly string[]
  readonly instanceNodes: readonly string[]
  readonly entryVersions: Readonly<Record<string, number>>
  /** Root node ids this run minted; a re-run deletes them before recreating. */
  readonly createdNodes: readonly string[]
  /** Data source ids this run embedded; a re-run replaces them. */
  readonly createdDataSources: readonly string[]
  readonly effectIds?: readonly string[]
  /** Ordinary SFX AudioClip ids this run generated for effect sounds. */
  readonly audioClipIds?: readonly string[]
}

export function compiledFootprintToJSON(footprint: CompiledFootprint): CompiledFootprintJSON {
  return {
    from: footprint.from,
    to: footprint.to,
    tracks: footprint.tracks.map((track) => ({ nodeId: track.nodeId, target: track.target })),
    placementParents: [...footprint.placementParents],
    instanceNodes: [...footprint.instanceNodes],
    entryVersions: { ...footprint.entryVersions },
    createdNodes: [...footprint.createdNodes],
    createdDataSources: [...footprint.createdDataSources],
    ...(footprint.effectIds && footprint.effectIds.length > 0
      ? { effectIds: [...footprint.effectIds] }
      : {}),
    ...(footprint.audioClipIds && footprint.audioClipIds.length > 0
      ? { audioClipIds: [...footprint.audioClipIds] }
      : {}),
  }
}

/**
 * Remap a footprint's node-id references through the same id map a scene copy
 * builds, so the copy's recompile clears the copy's own output. Entries for
 * deleted nodes (ids absent from the map) are kept verbatim — the clear path
 * tolerates targets that no longer resolve, so stale references never block a
 * recompile. Entry versions are project-scoped and travel unchanged.
 *
 * `dropCreatedDataSources` is for slide duplication: script data-source ids
 * are scoped to their slide, so the copy must not inherit (and later delete)
 * the source slide's data sources; its first run mints its own.
 */
export function remapCompiledFootprint(
  footprint: CompiledFootprint,
  nodeIds: ReadonlyMap<string, string>,
  options: {
    readonly dropCreatedDataSources?: boolean
    readonly effectIds?: ReadonlyMap<string, string>
    readonly audioClipIds?: ReadonlyMap<string, string>
  } = {},
): CompiledFootprint {
  const remapId = (id: string): string => nodeIds.get(id) ?? id
  return {
    from: footprint.from,
    to: footprint.to,
    tracks: footprint.tracks.map((track) => ({
      nodeId: remapId(track.nodeId),
      target: remapTargetNodeId(track.target, remapId),
    })),
    placementParents: footprint.placementParents.map(remapId),
    instanceNodes: footprint.instanceNodes.map(remapId),
    entryVersions: { ...footprint.entryVersions },
    createdNodes: footprint.createdNodes.map(remapId),
    createdDataSources: options.dropCreatedDataSources ? [] : [...footprint.createdDataSources],
    effectIds: (footprint.effectIds ?? []).map((id) => options.effectIds?.get(id) ?? id),
    audioClipIds: (footprint.audioClipIds ?? []).map((id) => options.audioClipIds?.get(id) ?? id),
  }
}

function remapTargetNodeId(
  target: KeyframeTarget,
  remapId: (id: string) => string,
): KeyframeTarget {
  if (!('nodeId' in target) || typeof target.nodeId !== 'string') {
    return { ...target } as KeyframeTarget
  }
  return { ...target, nodeId: remapId(target.nodeId) } as KeyframeTarget
}

export function compiledFootprintFromJSON(json: CompiledFootprintJSON): CompiledFootprint {
  if (!isRecord(json)) {
    throw new Error('Animation Script lastCompiled must be an object')
  }
  if (!Array.isArray(json.tracks)) {
    throw new Error('Animation Script lastCompiled.tracks must be an array')
  }
  const tracks = json.tracks.map((track, index) => {
    if (!isRecord(track)) {
      throw new Error(`Animation Script lastCompiled.tracks[${index}] must be an object`)
    }
    return {
      nodeId: requireString(track.nodeId, `Animation Script lastCompiled.tracks[${index}].nodeId`),
      target: requireKeyframeTarget(track.target),
    }
  })
  const effectIds =
    json.effectIds === undefined
      ? []
      : requireOptionalStringList(json.effectIds, 'Animation Script lastCompiled.effectIds')
  const audioClipIds =
    (json as { audioClipIds?: unknown }).audioClipIds === undefined
      ? []
      : requireOptionalStringList(
          (json as { audioClipIds?: unknown }).audioClipIds,
          'Animation Script lastCompiled.audioClipIds',
        )
  return {
    from: requireFiniteNumber(json.from, 'Animation Script lastCompiled.from'),
    to: requireFiniteNumber(json.to, 'Animation Script lastCompiled.to'),
    tracks,
    placementParents: requireStringList(
      json.placementParents,
      'Animation Script lastCompiled.placementParents',
    ),
    instanceNodes: requireStringList(
      json.instanceNodes,
      'Animation Script lastCompiled.instanceNodes',
    ),
    entryVersions: requireEntryVersions(json.entryVersions),
    createdNodes: requireOptionalStringList(
      json.createdNodes,
      'Animation Script lastCompiled.createdNodes',
    ),
    createdDataSources: requireOptionalStringList(
      json.createdDataSources,
      'Animation Script lastCompiled.createdDataSources',
    ),
    ...(effectIds.length > 0 ? { effectIds } : {}),
    ...(audioClipIds.length > 0 ? { audioClipIds } : {}),
  }
}

export function validateCompiledFootprintJSON(
  errors: string[],
  value: unknown,
  label: string,
): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`)
    return
  }
  if (typeof value.from !== 'number' || !Number.isFinite(value.from)) {
    errors.push(`${label}.from must be a finite number`)
  }
  if (typeof value.to !== 'number' || !Number.isFinite(value.to)) {
    errors.push(`${label}.to must be a finite number`)
  }
  if (!Array.isArray(value.tracks)) {
    errors.push(`${label}.tracks must be an array`)
  } else {
    for (let i = 0; i < value.tracks.length; i++) {
      const track = value.tracks[i] as unknown
      if (!isRecord(track) || typeof track.nodeId !== 'string') {
        errors.push(`${label}.tracks[${i}] must be an object with a nodeId`)
        continue
      }
      try {
        requireKeyframeTarget(track.target)
      } catch (error) {
        errors.push(
          `${label}.tracks[${i}].target is invalid: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  validateStringListJSON(errors, value.placementParents, `${label}.placementParents`)
  validateStringListJSON(errors, value.instanceNodes, `${label}.instanceNodes`)
  validateOptionalStringListJSON(errors, value.createdNodes, `${label}.createdNodes`)
  validateOptionalStringListJSON(errors, value.createdDataSources, `${label}.createdDataSources`)
  validateOptionalStringListJSON(errors, value.effectIds, `${label}.effectIds`)
  validateOptionalStringListJSON(
    errors,
    (value as Record<string, unknown>).audioClipIds,
    `${label}.audioClipIds`,
  )
  if (!isRecord(value.entryVersions)) {
    errors.push(`${label}.entryVersions must be an object`)
  } else {
    for (const [entryId, version] of Object.entries(value.entryVersions)) {
      if (typeof version !== 'number' || !Number.isFinite(version)) {
        errors.push(`${label}.entryVersions["${entryId}"] must be a finite number`)
      }
    }
  }
}

function validateStringListJSON(errors: string[], value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`)
    return
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      errors.push(`${label}[${i}] must be a string`)
    }
  }
}

function validateOptionalStringListJSON(errors: string[], value: unknown, label: string): void {
  // Pre-creation footprints omit these; only a present non-list is invalid.
  if (value === undefined) return
  validateStringListJSON(errors, value, label)
}

function requireStringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${what} must be an array`)
  }
  return value.map((entry, index) => requireString(entry, `${what}[${index}]`))
}

function requireOptionalStringList(value: unknown, what: string): string[] {
  // Older `.lesson` files carry no created lists; read them as empty.
  if (value === undefined) return []
  return requireStringList(value, what)
}

function requireEntryVersions(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error('Animation Script lastCompiled.entryVersions must be an object')
  }
  const versions: Record<string, number> = {}
  for (const [entryId, version] of Object.entries(value)) {
    versions[entryId] = requireFiniteNumber(
      version,
      `Animation Script lastCompiled.entryVersions["${entryId}"]`,
    )
  }
  return versions
}
