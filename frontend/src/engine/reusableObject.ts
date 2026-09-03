import { isRecord } from './guards'

export const REUSABLE_OBJECT_VERSION = 1

export interface ReusableObjectJSON {
  readonly version: number
  readonly name: string
  readonly description?: string
  readonly rootId: string
  readonly nodes: readonly import('./json').NodeJSON[]
  readonly animation?: import('./json').SlideAnimationJSON
  readonly library?: import('./json').LessonLibraryJSON
  readonly ikChains?: import('./json').IKManagerJSON
  readonly constraints?: import('./json').ConstraintManagerJSON
}

/**
 * Validate a ReusableObjectJSON blob, returning an array of error strings.
 */
export function validateReusableObject(json: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(json)) {
    return ['Invalid reusable object JSON: expected an object']
  }
  if (json.version !== REUSABLE_OBJECT_VERSION && json.version !== 1) {
    errors.push(
      `Invalid reusable object JSON: unsupported version ${String(json.version)}. Only version ${REUSABLE_OBJECT_VERSION} is supported.`,
    )
  }
  if (typeof json.name !== 'string' || json.name.trim() === '') {
    errors.push('Reusable object name must be a non-empty string')
  }
  if (json.description !== undefined && typeof json.description !== 'string') {
    errors.push('Reusable object description must be a string')
  }
  if (typeof json.rootId !== 'string' || json.rootId === '') {
    errors.push('Reusable object rootId must be a non-empty string')
  }
  if (!Array.isArray(json.nodes)) {
    errors.push('Reusable object must have a nodes array')
    return errors
  }
  const nodes = json.nodes as unknown[]
  if (nodes.length === 0) {
    errors.push('Reusable object must have at least one node')
  }
  const nodeIds = new Set<string>()
  const nodeById = new Map<string, Record<string, unknown>>()
  for (const nodeJson of nodes) {
    if (!isRecord(nodeJson)) {
      errors.push('Scene node must be an object')
      continue
    }
    const id = nodeJson.id
    if (typeof id !== 'string' || id === '') {
      errors.push('Node id must be a non-empty string')
      continue
    }
    if (nodeIds.has(id)) {
      errors.push(`A node with id "${id}" already exists`)
    } else {
      nodeIds.add(id)
      nodeById.set(id, nodeJson)
    }
    if (typeof nodeJson.name !== 'string' || nodeJson.name === '') {
      errors.push(`Node "${String(id)}" name must be non-empty string`)
    }
    if (nodeJson.parentId !== null && typeof nodeJson.parentId !== 'string') {
      errors.push(`Node "${String(id)}" parentId must be string or null`)
    }
    if (!isRecord(nodeJson.transform)) {
      errors.push(`Node "${String(id)}" must have a transform`)
    }
    if (typeof nodeJson.visible !== 'boolean') {
      errors.push(`Node "${String(id)}" visible must be a boolean`)
    }
    if (!isRecord(nodeJson.components)) {
      errors.push(`Node "${String(id)}" must have a components object`)
    }
    if (
      nodeJson.semanticName !== undefined &&
      (typeof nodeJson.semanticName !== 'string' || nodeJson.semanticName.trim() === '')
    ) {
      errors.push(`Node "${String(id)}" semanticName must be non-empty string if provided`)
    }
    if (nodeJson.clipInstances !== undefined) {
      if (!Array.isArray(nodeJson.clipInstances)) {
        errors.push(`Node "${String(id)}" clipInstances must be an array`)
      } else {
        for (const inst of nodeJson.clipInstances as unknown[]) {
          if (!isRecord(inst)) {
            errors.push(`Node "${String(id)}" clipInstance must be an object`)
            continue
          }
          if (typeof inst.clipId !== 'string' || inst.clipId === '') {
            errors.push(`Node "${String(id)}" clipInstance clipId must be non-empty string`)
          }
        }
      }
    }
  }
  const rootId = json.rootId as string | undefined
  if (rootId && !nodeIds.has(rootId)) {
    errors.push(`Reusable object rootId "${rootId}" not found in nodes`)
  }
  for (const nodeJson of nodes) {
    if (!isRecord(nodeJson) || typeof nodeJson.id !== 'string') continue
    const parentId = nodeJson.parentId as string | null | undefined
    if (nodeJson.id === rootId) {
      if (parentId !== null) {
        errors.push(`Root node "${String(nodeJson.id)}" parentId must be null in object file`)
      }
    } else if (typeof parentId === 'string' && !nodeIds.has(parentId)) {
      errors.push(`Parent node not found: ${parentId}`)
    }
  }
  for (const nodeJson of nodes) {
    if (!isRecord(nodeJson) || typeof nodeJson.id !== 'string' || typeof nodeJson.parentId !== 'string') continue
    let cursor: Record<string, unknown> | undefined = nodeJson
    let steps = 0
    while (cursor !== undefined && typeof cursor.parentId === 'string' && cursor.parentId !== cursor.id) {
      if (steps > nodes.length) {
        errors.push('A node cannot become a descendant of itself')
        break
      }
      const next = nodeById.get(cursor.parentId)
      if (next === nodeJson) {
        errors.push('A node cannot become a descendant of itself')
        break
      }
      if (next === undefined) break
      cursor = next
      steps += 1
    }
  }
  if (json.library !== undefined) {
    if (!isRecord(json.library)) {
      errors.push('Reusable object library must be an object')
    } else {
      const library = json.library as Record<string, unknown>
      for (const key of ['assets', 'materials', 'shaders', 'data_sources', 'clips', 'clipCollections'] as const) {
        if (library[key] !== undefined && !Array.isArray(library[key])) {
          errors.push(`Reusable object library.${key} must be an array`)
        }
      }
      if (Array.isArray(library.clips)) {
        const seen = new Set<string>()
        for (const clip of library.clips as unknown[]) {
          if (!isRecord(clip) || typeof clip.id !== 'string' || clip.id === '') {
            errors.push('Library clip must have non-empty id')
            continue
          }
          if (seen.has(clip.id)) errors.push(`A library clip with id "${clip.id}" already exists`)
          else seen.add(clip.id)
          if (typeof clip.name !== 'string' || clip.name === '') errors.push(`Library clip "${clip.id}" name must be non-empty`)
          if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration < 0) errors.push(`Library clip "${clip.id}" duration must be non-negative`)
          if (!Array.isArray(clip.params)) errors.push(`Library clip "${clip.id}" params must be array`)
          if (!Array.isArray(clip.channels)) errors.push(`Library clip "${clip.id}" channels must be array`)
        }
      }
      if (Array.isArray(library.clipCollections)) {
        const seen = new Set<string>()
        for (const col of library.clipCollections as unknown[]) {
          if (!isRecord(col)) {
            errors.push('Library clipCollection must be an object')
            continue
          }
          if (typeof col.id !== 'string' || col.id === '') errors.push('Library clipCollection id must be non-empty')
          else if (seen.has(col.id)) errors.push(`A library clipCollection with id "${col.id}" already exists`)
          else seen.add(col.id)
          if (typeof col.name !== 'string' || col.name === '') errors.push(`Library clipCollection "${String(col.id)}" name must be non-empty`)
          if (!isRecord(col.bindings)) errors.push(`Library clipCollection "${String(col.id)}" bindings must be object`)
        }
      }
    }
  }
  if (isRecord(json.library) && Array.isArray((json.library as Record<string, unknown>).clips)) {
    const clipIds = new Set<string>(
      ((json.library as unknown as import('./json').LessonLibraryJSON).clips ?? []).map((c) => (c as { id: string }).id),
    )
    for (const nodeJson of nodes) {
      if (!isRecord(nodeJson) || !Array.isArray(nodeJson.clipInstances)) continue
      for (const inst of nodeJson.clipInstances as unknown[]) {
        if (!isRecord(inst) || typeof inst.clipId !== 'string') continue
        if (!clipIds.has(inst.clipId)) {
          errors.push(`Clip instance references unknown clip id: ${inst.clipId}`)
        }
      }
    }
    const library = json.library as unknown as import('./json').LessonLibraryJSON
    const collections = library.clipCollections ?? []
    for (const col of collections) {
      const bindings = (col as { bindings: Record<string, unknown> }).bindings
      if (!bindings || typeof bindings !== 'object') continue
      for (const clipId of Object.values(bindings)) {
        if (typeof clipId === 'string' && !clipIds.has(clipId)) {
          errors.push(`ClipCollection "${(col as { id: string }).id}" binding references unknown clip id: ${clipId}`)
        }
      }
    }
  }
  if (json.ikChains !== undefined) {
    if (!isRecord(json.ikChains)) errors.push('Reusable object ikChains must be an object')
    else {
      const ik = json.ikChains as Record<string, unknown>
      if (!Array.isArray(ik.chains)) errors.push('Reusable object ikChains.chains must be an array')
      else {
        for (const chain of ik.chains as unknown[]) {
          if (!isRecord(chain)) {
            errors.push('IK chain must be an object')
            continue
          }
          if (typeof chain.id !== 'string' || chain.id === '') errors.push('IK chain id must be non-empty')
          if (!Array.isArray(chain.boneIds)) errors.push(`IK chain "${String(chain.id)}" boneIds must be array`)
          else if ((chain.boneIds as unknown[]).length < 2) errors.push(`IK chain "${String(chain.id)}" must have at least 2 bones`)
        }
      }
    }
  }
  return errors
}
