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
}

export function compiledFootprintToJSON(footprint: CompiledFootprint): CompiledFootprintJSON {
  return {
    from: footprint.from,
    to: footprint.to,
    tracks: footprint.tracks.map((track) => ({ nodeId: track.nodeId, target: track.target })),
    placementParents: [...footprint.placementParents],
    instanceNodes: [...footprint.instanceNodes],
    entryVersions: { ...footprint.entryVersions },
  }
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

function requireStringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${what} must be an array`)
  }
  return value.map((entry, index) => requireString(entry, `${what}[${index}]`))
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
