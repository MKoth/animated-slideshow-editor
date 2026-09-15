import { isRecord } from './guards'
import { CONTROL_KEY_PATTERN, CONTROL_INTERVAL_MIN_SPAN } from './control'

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
    if (nodeJson.controlSet !== undefined) {
      if (!isRecord(nodeJson.controlSet)) {
        errors.push(`Node "${String(id)}" controlSet must be an object`)
      } else {
        const controlSet = nodeJson.controlSet
        if (!Array.isArray(controlSet.controls)) {
          errors.push(`Node "${String(id)}" controlSet.controls must be an array`)
        } else {
          const controlKeys = new Set<string>()
          for (const control of controlSet.controls as unknown[]) {
            if (!isRecord(control)) {
              errors.push(`Node "${String(id)}" control must be an object`)
              continue
            }
            if (typeof control.key !== 'string' || !CONTROL_KEY_PATTERN.test(control.key)) {
              errors.push(`Node "${String(id)}" has an invalid control key`)
            } else if (controlKeys.has(control.key)) {
              errors.push(`Node "${String(id)}" has duplicate control key "${control.key}"`)
            } else {
              controlKeys.add(control.key)
            }
            if (control.min !== 0 || control.max !== 1) {
              errors.push(`Control "${String(control.key)}" must use the v1 range [0, 1]`)
            }
            if (
              typeof control.bindings !== 'object' ||
              control.bindings === null ||
              Array.isArray(control.bindings)
            ) {
              errors.push(`Control "${String(control.key)}" bindings must be an object`)
            } else {
              for (const [semantic, rawBinding] of Object.entries(
                control.bindings as Record<string, unknown>,
              )) {
                const validateOne = (rb: unknown): void => {
                  if (typeof rb === 'string') {
                    if (rb === '')
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" clipId must be non-empty`,
                      )
                    return
                  }
                  if (isRecord(rb)) {
                    const clipId = (rb as Record<string, unknown>).clipId
                    const start = (rb as Record<string, unknown>).start
                    const end = (rb as Record<string, unknown>).end
                    if (typeof clipId !== 'string' || clipId === '') {
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" clipId must be non-empty`,
                      )
                      return
                    }
                    if (typeof start !== 'number' || !Number.isFinite(start)) {
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" start must be a finite number`,
                      )
                      return
                    }
                    if (typeof end !== 'number' || !Number.isFinite(end)) {
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" end must be a finite number`,
                      )
                      return
                    }
                    if (start < 0)
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" start must be >= 0`,
                      )
                    if (end > 1)
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" end must be <= 1`,
                      )
                    if (start >= end)
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" start must be < end`,
                      )
                    else if (end - (start as number) < CONTROL_INTERVAL_MIN_SPAN)
                      errors.push(
                        `Control "${String(control.key)}" binding "${semantic}" span must be >= ${CONTROL_INTERVAL_MIN_SPAN}`,
                      )
                    return
                  }
                  errors.push(
                    `Control "${String(control.key)}" binding "${semantic}" must be a string or interval object`,
                  )
                }
                if (Array.isArray(rawBinding)) {
                  if (rawBinding.length === 0) {
                    errors.push(
                      `Control "${String(control.key)}" binding "${semantic}" array must not be empty`,
                    )
                    continue
                  }
                  for (const entry of rawBinding as unknown[]) validateOne(entry)
                } else {
                  validateOne(rawBinding)
                }
              }
            }
            // Groups & blendKeys validation (additive)
            const groups = (control as Record<string, unknown>).groups
            const blendKeys = (control as Record<string, unknown>).blendKeys
            if (groups !== undefined) {
              if (!Array.isArray(groups)) {
                errors.push(`Control "${String(control.key)}" groups must be an array`)
              } else {
                if (groups.length === 0)
                  errors.push(`Control "${String(control.key)}" must have at least one group`)
                const gIds = new Set<string>()
                for (const rawGroup of groups) {
                  if (!isRecord(rawGroup)) {
                    errors.push(`Control "${String(control.key)}" group must be an object`)
                    continue
                  }
                  const gid = rawGroup.id
                  if (typeof gid !== 'string' || gid === '')
                    errors.push(
                      `Control "${String(control.key)}" group id must be non-empty string`,
                    )
                  else if (gIds.has(gid))
                    errors.push(`Control "${String(control.key)}" has duplicate group id "${gid}"`)
                  else gIds.add(gid)
                  if (typeof rawGroup.name !== 'string' || rawGroup.name.trim() === '')
                    errors.push(
                      `Control "${String(control.key)}" group name must be a non-empty string`,
                    )
                  const gb = rawGroup.bindings
                  if (typeof gb !== 'object' || gb === null || Array.isArray(gb)) {
                    errors.push(`Control "${String(control.key)}" group bindings must be an object`)
                    continue
                  }
                  for (const [semantic, rawBinding] of Object.entries(
                    gb as Record<string, unknown>,
                  )) {
                    const validateOneGroup = (rb: unknown): void => {
                      if (typeof rb === 'string') {
                        if (rb === '')
                          errors.push(
                            `Control "${String(control.key)}" group binding "${semantic}" clipId must be non-empty`,
                          )
                        return
                      }
                      if (isRecord(rb)) {
                        const clipId = (rb as Record<string, unknown>).clipId
                        const start = (rb as Record<string, unknown>).start
                        const end = (rb as Record<string, unknown>).end
                        if (typeof clipId !== 'string' || clipId === '') {
                          errors.push(
                            `Control "${String(control.key)}" group binding "${semantic}" clipId must be non-empty`,
                          )
                          return
                        }
                        if (typeof start !== 'number' || !Number.isFinite(start))
                          errors.push(
                            `Control "${String(control.key)}" group binding "${semantic}" start must be a finite number`,
                          )
                        if (typeof end !== 'number' || !Number.isFinite(end))
                          errors.push(
                            `Control "${String(control.key)}" group binding "${semantic}" end must be a finite number`,
                          )
                        if (typeof start === 'number' && typeof end === 'number') {
                          if (start < 0)
                            errors.push(
                              `Control "${String(control.key)}" group binding "${semantic}" start must be >= 0`,
                            )
                          if (end > 1)
                            errors.push(
                              `Control "${String(control.key)}" group binding "${semantic}" end must be <= 1`,
                            )
                          if (start >= end)
                            errors.push(
                              `Control "${String(control.key)}" group binding "${semantic}" start must be < end`,
                            )
                          else if (end - (start as number) < CONTROL_INTERVAL_MIN_SPAN)
                            errors.push(
                              `Control "${String(control.key)}" group binding "${semantic}" span must be >= ${CONTROL_INTERVAL_MIN_SPAN}`,
                            )
                        }
                        return
                      }
                      errors.push(
                        `Control "${String(control.key)}" group binding "${semantic}" must be a string or interval object`,
                      )
                    }
                    if (Array.isArray(rawBinding)) {
                      if (rawBinding.length === 0) {
                        errors.push(
                          `Control "${String(control.key)}" group binding "${semantic}" array must not be empty`,
                        )
                        continue
                      }
                      for (const entry of rawBinding as unknown[]) validateOneGroup(entry)
                    } else {
                      validateOneGroup(rawBinding)
                    }
                  }
                }
                if (blendKeys !== undefined) {
                  if (!Array.isArray(blendKeys))
                    errors.push(`Control "${String(control.key)}" blendKeys must be an array`)
                  else {
                    const expected = Math.max(0, groups.length - 1)
                    if (blendKeys.length !== expected)
                      errors.push(
                        `Control "${String(control.key)}" blendKeys length must be max(0, groups.length-1) (expected ${expected}, got ${blendKeys.length})`,
                      )
                    for (const bk of blendKeys) {
                      if (typeof bk !== 'string' || !CONTROL_KEY_PATTERN.test(bk))
                        errors.push(
                          `Control "${String(control.key)}" has invalid blend key "${String(bk)}"`,
                        )
                    }
                    if (blendKeys.includes(control.key as string))
                      errors.push(
                        `Control "${String(control.key)}" blendKeys must not contain its own key`,
                      )
                  }
                } else {
                  const expected = Math.max(0, groups.length - 1)
                  if (expected !== 0)
                    errors.push(
                      `Control "${String(control.key)}" missing blendKeys (expected length ${expected})`,
                    )
                }
              }
            } else if (blendKeys !== undefined) {
              errors.push(`Control "${String(control.key)}" has blendKeys without groups`)
            }
          }
          // Validate blend sibling order per node (once per controlSet)
          {
            const controlsArr = controlSet.controls as unknown as Record<string, unknown>[]
            const hostMap = new Map<string, { idx: number; blendKeys: string[] }>()
            for (let idx = 0; idx < controlsArr.length; idx++) {
              const rc = controlsArr[idx]
              if (!isRecord(rc)) continue
              const bks = rc.blendKeys as unknown
              if (Array.isArray(bks) && bks.length > 0) {
                hostMap.set(rc.key as string, { idx, blendKeys: bks as string[] })
              }
            }
            const occupied = new Set<number>()
            for (const [, info] of hostMap) {
              for (let i = 0; i <= info.blendKeys.length; i++) {
                const pos = info.idx + i
                if (occupied.has(pos))
                  errors.push(`blend sibling order violated — overlapping host blocks at ${pos}`)
                else occupied.add(pos)
              }
            }
            for (const [hk, info] of hostMap) {
              for (let i = 0; i < info.blendKeys.length; i++) {
                const bk = info.blendKeys[i]
                const expectedIdx = info.idx + 1 + i
                if (expectedIdx >= controlsArr.length) {
                  errors.push(`blend sibling order violated for "${hk}" — missing blend "${bk}"`)
                  continue
                }
                const actualKey = (controlsArr[expectedIdx] as Record<string, unknown>).key
                if (actualKey !== bk)
                  errors.push(
                    `blend sibling order violated for "${hk}" — expected "${bk}" at ${expectedIdx}, got "${String(actualKey)}"`,
                  )
                const blendCtrl = controlsArr[expectedIdx]
                if (isRecord(blendCtrl)) {
                  const bks2 = (blendCtrl as Record<string, unknown>).blendKeys as unknown
                  if (Array.isArray(bks2) && bks2.length > 0)
                    errors.push(`Blend control "${String(bk)}" must not have its own blendKeys`)
                  const blendBindings = (blendCtrl as Record<string, unknown>).bindings as unknown
                  const hasBindings =
                    blendBindings &&
                    typeof blendBindings === 'object' &&
                    Object.keys(blendBindings as Record<string, unknown>).length > 0
                  if (hasBindings)
                    errors.push(`Blend control "${String(bk)}" must have empty bindings`)
                  else {
                    const gb2 = (blendCtrl as Record<string, unknown>).groups as unknown
                    if (Array.isArray(gb2) && gb2.length === 1) {
                      const gbind = (gb2[0] as Record<string, unknown>).bindings as unknown
                      if (
                        gbind &&
                        typeof gbind === 'object' &&
                        Object.keys(gbind as Record<string, unknown>).length > 0
                      )
                        errors.push(`Blend control "${String(bk)}" must have empty bindings`)
                    } else if (Array.isArray(gb2) && gb2.length !== 0) {
                      errors.push(`Blend control "${String(bk)}" must have empty bindings`)
                    }
                  }
                  const exposedVal = (blendCtrl as Record<string, unknown>).exposed
                  if (exposedVal !== true)
                    errors.push(`Blend control "${String(bk)}" must be exposed:true`)
                  const defaultVal = (blendCtrl as Record<string, unknown>).default
                  if (defaultVal !== 0)
                    errors.push(`Blend control "${String(bk)}" must have default:0`)
                }
              }
            }
            const blendKeyToHost = new Map<string, string>()
            for (const [hk, info] of hostMap)
              for (const bk of info.blendKeys) blendKeyToHost.set(bk, hk)
            for (let idx = 0; idx < controlsArr.length; idx++) {
              const rc = controlsArr[idx]
              if (!isRecord(rc) || typeof rc.key !== 'string') continue
              const k = rc.key as string
              if (blendKeyToHost.has(k)) {
                const hk = blendKeyToHost.get(k)!
                const hInfo = hostMap.get(hk)!
                const pos = hInfo.blendKeys.indexOf(k)
                if (hInfo.idx + 1 + pos !== idx)
                  errors.push(
                    `blend sibling order violated for "${hk}" — blend "${k}" at wrong index ${idx}`,
                  )
              }
            }
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
    if (
      !isRecord(nodeJson) ||
      typeof nodeJson.id !== 'string' ||
      typeof nodeJson.parentId !== 'string'
    )
      continue
    let cursor: Record<string, unknown> | undefined = nodeJson
    let steps = 0
    while (
      cursor !== undefined &&
      typeof cursor.parentId === 'string' &&
      cursor.parentId !== cursor.id
    ) {
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
      for (const key of [
        'assets',
        'materials',
        'shaders',
        'data_sources',
        'clips',
        'clipCollections',
      ] as const) {
        if (library[key] !== undefined && !Array.isArray(library[key])) {
          errors.push(`Reusable object library.${key} must be an array`)
        }
      }
      if (Array.isArray(library.clips)) {
        const seen = new Set<string>()
        const controlClipIds = new Set<string>()
        for (const nodeJson of nodes) {
          if (!isRecord(nodeJson) || !isRecord(nodeJson.controlSet)) continue
          const controls = nodeJson.controlSet.controls
          if (!Array.isArray(controls)) continue
          for (const control of controls) {
            if (isRecord(control.bindings)) {
              for (const rawBinding of Object.values(control.bindings as Record<string, unknown>)) {
                if (typeof rawBinding === 'string' && rawBinding !== '')
                  controlClipIds.add(rawBinding)
                else if (
                  isRecord(rawBinding) &&
                  typeof rawBinding.clipId === 'string' &&
                  rawBinding.clipId !== ''
                )
                  controlClipIds.add(rawBinding.clipId)
              }
            }
            const groups = (control as Record<string, unknown>).groups as unknown
            if (Array.isArray(groups)) {
              for (const g of groups as Record<string, unknown>[]) {
                if (!isRecord(g) || !isRecord(g.bindings)) continue
                for (const rawBinding of Object.values(g.bindings as Record<string, unknown>)) {
                  if (typeof rawBinding === 'string' && rawBinding !== '')
                    controlClipIds.add(rawBinding)
                  else if (
                    isRecord(rawBinding) &&
                    typeof rawBinding.clipId === 'string' &&
                    rawBinding.clipId !== ''
                  )
                    controlClipIds.add(rawBinding.clipId)
                }
              }
            }
          }
        }
        for (const clip of library.clips as unknown[]) {
          if (!isRecord(clip) || typeof clip.id !== 'string' || clip.id === '') {
            errors.push('Library clip must have non-empty id')
            continue
          }
          if (seen.has(clip.id)) errors.push(`A library clip with id "${clip.id}" already exists`)
          else seen.add(clip.id)
          if (typeof clip.name !== 'string' || clip.name === '')
            errors.push(`Library clip "${clip.id}" name must be non-empty`)
          if (
            typeof clip.duration !== 'number' ||
            !Number.isFinite(clip.duration) ||
            clip.duration < 0
          )
            errors.push(`Library clip "${clip.id}" duration must be non-negative`)
          if (!Array.isArray(clip.params))
            errors.push(`Library clip "${clip.id}" params must be array`)
          if (!Array.isArray(clip.channels))
            errors.push(`Library clip "${clip.id}" channels must be array`)
          if (controlClipIds.has(clip.id)) {
            if (clip.visibleAnimation !== undefined) {
              errors.push(`Control clip "${clip.id}" cannot animate visible`)
            }
            // Hold-only zIndex (if present as clip animation) also rejected
            if ((clip as Record<string, unknown>).zIndexAnimation !== undefined) {
              errors.push(`Control clip "${clip.id}" cannot animate zIndex`)
            }
          }
        }
      }
      if (Array.isArray(library.clipCollections)) {
        const seen = new Set<string>()
        for (const col of library.clipCollections as unknown[]) {
          if (!isRecord(col)) {
            errors.push('Library clipCollection must be an object')
            continue
          }
          if (typeof col.id !== 'string' || col.id === '')
            errors.push('Library clipCollection id must be non-empty')
          else if (seen.has(col.id))
            errors.push(`A library clipCollection with id "${col.id}" already exists`)
          else seen.add(col.id)
          if (typeof col.name !== 'string' || col.name === '')
            errors.push(`Library clipCollection "${String(col.id)}" name must be non-empty`)
          if (!isRecord(col.bindings))
            errors.push(`Library clipCollection "${String(col.id)}" bindings must be object`)
        }
      }
    }
  }
  if (isRecord(json.library) && Array.isArray((json.library as Record<string, unknown>).clips)) {
    const clipIds = new Set<string>(
      ((json.library as unknown as import('./json').LessonLibraryJSON).clips ?? []).map(
        (c) => (c as { id: string }).id,
      ),
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
          errors.push(
            `ClipCollection "${(col as { id: string }).id}" binding references unknown clip id: ${clipId}`,
          )
        }
      }
    }
    for (const nodeJson of nodes) {
      if (!isRecord(nodeJson) || !isRecord(nodeJson.controlSet)) continue
      const controls = nodeJson.controlSet.controls
      if (!Array.isArray(controls)) continue
      for (const control of controls) {
        if (isRecord(control.bindings)) {
          for (const rawBinding of Object.values(control.bindings as Record<string, unknown>)) {
            let clipId: string | undefined
            if (typeof rawBinding === 'string') clipId = rawBinding
            else if (isRecord(rawBinding) && typeof rawBinding.clipId === 'string')
              clipId = rawBinding.clipId
            if (clipId !== undefined && clipId !== '' && !clipIds.has(clipId)) {
              errors.push(
                `Control "${String(control.key)}" binding references unknown clip id: ${clipId}`,
              )
            }
          }
        }
        // Groups are tolerant: missing clipIds are soft-warned on import, not file-fatal validation error
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
          if (typeof chain.id !== 'string' || chain.id === '')
            errors.push('IK chain id must be non-empty')
          if (!Array.isArray(chain.boneIds))
            errors.push(`IK chain "${String(chain.id)}" boneIds must be array`)
          else if ((chain.boneIds as unknown[]).length < 2)
            errors.push(`IK chain "${String(chain.id)}" must have at least 2 bones`)
        }
      }
    }
  }
  return errors
}
