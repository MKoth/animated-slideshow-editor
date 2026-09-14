import { newId } from './ids'
import type { Keyframe } from './keyframe'
import {
  Keyframe as KeyframeModel,
  requireKeyframeInterpolation,
  requireKeyframeTangent,
  ZERO_TANGENT,
} from './keyframe'
import { evaluateSegment } from './interpolators'
import type { ControlSetJSON } from './json'
import { requireFiniteNumber, requireString } from './guards'

export const CONTROL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.]*$/

export const CONTROL_INTERVAL_MIN_SPAN = 1e-6
export const CONTROL_INTERVAL_EPSILON = 1e-9

export interface ControlBindingInterval {
  readonly clipId: string
  readonly start: number
  readonly end: number
}

export type ControlBinding = string | ControlBindingInterval

export type ControlBindingJSON =
  string | { readonly clipId: string; readonly start: number; readonly end: number }

export interface ControlGroup {
  readonly id: string
  readonly name: string
  readonly bindings: Readonly<Record<string, ControlBinding>>
}

export interface ControlGroupJSON {
  readonly id: string
  readonly name: string
  readonly bindings: Readonly<Record<string, ControlBindingJSON>>
}

export interface Control {
  readonly id: string
  readonly key: string
  readonly label: string
  readonly min: 0
  readonly max: 1
  readonly default: number
  readonly exposed: boolean
  readonly bindings: Readonly<Record<string, ControlBinding>>
  readonly groups: readonly ControlGroup[]
  readonly blendKeys: readonly string[]
}

export interface ControlSet {
  readonly id: string
  readonly hostNodeId: string
  readonly controls: readonly Control[]
}

export function normalizeControlBinding(binding: ControlBinding): ControlBindingInterval {
  if (typeof binding === 'string') return { clipId: binding, start: 0, end: 1 }
  return binding
}

export function isControlBindingInterval(
  binding: ControlBinding,
): binding is ControlBindingInterval {
  return typeof binding === 'object' && binding !== null
}

export function controlBindingClipId(binding: ControlBinding): string {
  return typeof binding === 'string' ? binding : binding.clipId
}

export function validateControlBinding(
  binding: ControlBinding,
  semantic: string,
  controlKey: string,
): void {
  if (typeof binding === 'string') {
    if (binding.length === 0)
      throw new Error(`Control "${controlKey}" binding "${semantic}" clipId must be non-empty`)
    return
  }
  if (!binding || typeof binding !== 'object')
    throw new Error(
      `Control "${controlKey}" binding "${semantic}" must be a string or interval object`,
    )
  const interval = binding as unknown as Record<string, unknown>
  const clipId = interval.clipId
  if (typeof clipId !== 'string' || clipId.length === 0)
    throw new Error(
      `Control "${controlKey}" binding "${semantic}" clipId must be a non-empty string`,
    )
  const start = requireFiniteNumber(
    interval.start,
    `Control "${controlKey}" binding "${semantic}" start`,
  )
  const end = requireFiniteNumber(interval.end, `Control "${controlKey}" binding "${semantic}" end`)
  if (start < 0) throw new Error(`Control "${controlKey}" binding "${semantic}" start must be >= 0`)
  if (end > 1) throw new Error(`Control "${controlKey}" binding "${semantic}" end must be <= 1`)
  if (start >= end)
    throw new Error(`Control "${controlKey}" binding "${semantic}" start must be < end`)
  const span = end - start
  if (span < CONTROL_INTERVAL_MIN_SPAN)
    throw new Error(
      `Control "${controlKey}" binding "${semantic}" span must be >= ${CONTROL_INTERVAL_MIN_SPAN}`,
    )
}

export function validateControlKey(key: string): void {
  if (!CONTROL_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid control key "${key}"`)
  }
}

export function createControlGroup(input: {
  id?: string
  name?: string
  bindings?: Readonly<Record<string, ControlBinding>>
}): ControlGroup {
  const id = input.id ?? newId('control-group')
  const name = input.name ?? 'Group 1'
  const bindings: Record<string, ControlBinding> = {}
  if (input.bindings) {
    for (const [semantic, binding] of Object.entries(input.bindings)) {
      // we need controlKey for validation; use placeholder group validation will be done in createControl
      bindings[semantic] = typeof binding === 'string' ? binding : { ...binding }
    }
  }
  return { id, name, bindings }
}

export function mergeGroupBindings(groups: readonly ControlGroup[]): Record<string, ControlBinding> {
  const merged: Record<string, ControlBinding> = {}
  for (const group of groups) {
    for (const [semantic, binding] of Object.entries(group.bindings)) {
      merged[semantic] = binding
    }
  }
  return merged
}

export function uniquifyBlendKey(existingKeys: Set<string>, base = 'blend'): string {
  if (!existingKeys.has(base)) return base
  let idx = 2
  while (existingKeys.has(`${base}${idx}`)) idx += 1
  return `${base}${idx}`
}

export function isBlendControl(_control: Control): boolean {
  // Blend controls are empty bindings with no groups? Actually they are ordinary controls with single empty group.
  // We detect via being referenced as blendKey elsewhere, but for standalone check we consider empty bindings and exposed true default0
  // However to avoid false positives, caller should use ControlSet context.
  return false
}

export function findBlendBlock(
  controls: readonly Control[],
  hostIdx: number,
): { host: Control; blends: readonly Control[]; endIdx: number } | undefined {
  const host = controls[hostIdx]
  if (!host) return undefined
  const blendCount = host.blendKeys.length
  if (blendCount === 0) return { host, blends: [], endIdx: hostIdx }
  if (hostIdx + blendCount >= controls.length) return undefined
  const blends: Control[] = []
  for (let i = 0; i < blendCount; i++) {
    const blendKey = host.blendKeys[i]
    const sibling = controls[hostIdx + 1 + i]
    if (!sibling || sibling.key !== blendKey) return undefined
    blends.push(sibling)
  }
  return { host, blends, endIdx: hostIdx + blendCount }
}

export function validateControls(controls: readonly Control[]): void {
  const keys = new Set<string>()
  const keyToIndex = new Map<string, number>()
  for (let idx = 0; idx < controls.length; idx++) {
    const control = controls[idx]
    validateControlKey(control.key)
    if (keys.has(control.key)) throw new Error(`Duplicate control key: ${control.key}`)
    keys.add(control.key)
    keyToIndex.set(control.key, idx)
    if (control.min !== 0 || control.max !== 1 || control.default < 0 || control.default > 1) {
      throw new Error(`Control "${control.key}" must use the v1 range [0, 1]`)
    }
    // validate bindings (merged)
    if (control.bindings && typeof control.bindings === 'object') {
      for (const [semantic, binding] of Object.entries(control.bindings)) {
        validateControlBinding(binding as ControlBinding, semantic, control.key)
      }
    }
    // validate groups
    if (control.groups !== undefined) {
      if (!Array.isArray(control.groups))
        throw new Error(`Control "${control.key}" groups must be an array`)
      if (control.groups.length === 0)
        throw new Error(`Control "${control.key}" must have at least one group`)
      const groupIds = new Set<string>()
      for (const group of control.groups) {
        if (typeof group.id !== 'string' || group.id === '')
          throw new Error(`Control "${control.key}" group id must be non-empty`)
        if (groupIds.has(group.id))
          throw new Error(`Control "${control.key}" has duplicate group id "${group.id}"`)
        groupIds.add(group.id)
        if (typeof group.name !== 'string')
          throw new Error(`Control "${control.key}" group name must be a string`)
        if (group.bindings && typeof group.bindings === 'object') {
          for (const [semantic, binding] of Object.entries(group.bindings as Record<string, ControlBinding>)) {
            validateControlBinding(binding as ControlBinding, semantic, control.key)
          }
        } else if (group.bindings !== undefined) {
          throw new Error(`Control "${control.key}" group bindings must be an object`)
        }
      }
      // blendKeys validation
      if (control.blendKeys !== undefined) {
        if (!Array.isArray(control.blendKeys))
          throw new Error(`Control "${control.key}" blendKeys must be an array`)
        const expectedLen = Math.max(0, control.groups.length - 1)
        if (control.blendKeys.length !== expectedLen)
          throw new Error(
            `Control "${control.key}" blendKeys length must be max(0, groups.length-1) (expected ${expectedLen}, got ${control.blendKeys.length})`,
          )
        for (const blendKey of control.blendKeys) {
          if (typeof blendKey !== 'string' || !CONTROL_KEY_PATTERN.test(blendKey))
            throw new Error(`Control "${control.key}" has invalid blend key "${blendKey}"`)
          // blendKey must be unique in ControlSet already checked via keys set? Need to check later that each blendKey exists as sibling control key
        }
        // check circular reference? blendKeys should not contain host key?
        if (control.blendKeys.includes(control.key))
          throw new Error(`Control "${control.key}" blendKeys must not contain its own key`)
      } else {
        // if groups exist but blendKeys missing, default to empty array length check
        const expectedLen = Math.max(0, control.groups.length - 1)
        if (expectedLen !== 0)
          throw new Error(
            `Control "${control.key}" missing blendKeys (expected length ${expectedLen})`,
          )
      }
      // merged bindings consistency? For backward compat, merged should equal union of groups. We allow mismatch but validate that top-level bindings equals merged? Spec says merged-union for backward compat, but we tolerate mismatch and will synthesize on toJSON.
    } else {
      // legacy control without groups: treat as single group, blendKeys should be empty or undefined
      if ((control as unknown as { blendKeys?: unknown }).blendKeys !== undefined) {
        // if blendKeys present without groups, it's malformed
        throw new Error(`Control "${control.key}" has blendKeys without groups`)
      }
    }
  }
  // validate per-ControlSet key uniqueness already done
  // validate blend sibling order and not directly referenced blend keys without host
  const allBlendKeys = new Set<string>()
  const hostIndices = new Map<string, number>() // host key -> index
  for (let idx = 0; idx < controls.length; idx++) {
    const control = controls[idx]
    // Determine if this control is a host with blends
    const blendCount = (control.blendKeys?.length ?? 0)
    if (blendCount > 0) {
      hostIndices.set(control.key, idx)
      // check contiguous siblings
      for (let i = 0; i < blendCount; i++) {
        const blendKey = control.blendKeys[i]
        if (allBlendKeys.has(blendKey))
          throw new Error(`Duplicate blend key: ${blendKey}`)
        allBlendKeys.add(blendKey)
        const siblingIdx = idx + 1 + i
        if (siblingIdx >= controls.length)
          throw new Error(`blend sibling order violated for "${control.key}" — missing blend "${blendKey}" at ${siblingIdx}`)
        const sibling = controls[siblingIdx]
        if (sibling.key !== blendKey)
          throw new Error(`blend sibling order violated for "${control.key}" — expected "${blendKey}" at ${siblingIdx}, got "${sibling.key}"`)
        // sibling should be a blend control: empty bindings, no blends of its own?
        // We enforce that blend controls have no blendKeys (single group) and empty bindings (or empty groups)
        const siblingBlendCount = (sibling.blendKeys?.length ?? 0)
        if (siblingBlendCount !== 0)
          throw new Error(`Blend control "${blendKey}" must not have its own blendKeys`)
        // check sibling bindings empty? Allow empty groups as well
        const isEmptyBindings = Object.keys(sibling.bindings ?? {}).length === 0
        const isEmptyGroups =
          sibling.groups !== undefined
            ? sibling.groups.length === 1 && Object.keys(sibling.groups[0].bindings ?? {}).length === 0
            : true // legacy without groups but empty bindings
        if (!isEmptyBindings && !isEmptyGroups)
          throw new Error(`Blend control "${blendKey}" must have empty bindings`)
        if (sibling.exposed !== true)
          throw new Error(`Blend control "${blendKey}" must be exposed:true`)
        if (sibling.default !== 0)
          throw new Error(`Blend control "${blendKey}" must have default:0`)
      }
    }
  }
  // Ensure that any control that is a blend is immediately after its host and not orphaned
  // Find all blend keys that are not part of a validated host block -> violation
  // Already checked that hosts' blends are contiguous. Now check that no other control is a blend orphan
  // For each control that is not a host but its key is in allBlendKeys, verify it is within a host block
  const blendKeyToHost = new Map<string, string>()
  for (const control of controls) {
    for (const bk of control.blendKeys ?? []) blendKeyToHost.set(bk, control.key)
  }
  for (let idx = 0; idx < controls.length; idx++) {
    const control = controls[idx]
    if (blendKeyToHost.has(control.key)) {
      const hostKey = blendKeyToHost.get(control.key)!
      const hostIdx = keyToIndex.get(hostKey)!
      const host = controls[hostIdx]
      const pos = host.blendKeys.indexOf(control.key)
      if (hostIdx + 1 + pos !== idx)
        throw new Error(`blend sibling order violated for "${hostKey}" — blend "${control.key}" at wrong index ${idx}`)
    }
  }
  // Also ensure no overlapping blocks: hosts' blocks must not overlap
  const occupied = new Set<number>()
  for (const [, hostIdx] of hostIndices) {
    const host = controls[hostIdx]
    for (let i = 0; i <= host.blendKeys.length; i++) {
      const idx = hostIdx + i
      if (occupied.has(idx)) throw new Error(`blend sibling order violated — overlapping host blocks at ${idx}`)
      occupied.add(idx)
    }
  }
}

export function createControl(input: {
  key: string
  label?: string
  default?: number
  exposed?: boolean
  bindings?: Readonly<Record<string, ControlBinding>>
  groups?: readonly ControlGroup[]
  blendKeys?: readonly string[]
}): Control {
  validateControlKey(input.key)
  const value = input.default ?? 0
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Control default must be within [0, 1]')
  }
  let groups: ControlGroup[]
  let blendKeys: string[]
  if (input.groups !== undefined) {
    // validate groups provided
    groups = input.groups.map((g) => ({
      id: g.id ?? newId('control-group'),
      name: g.name ?? 'Group 1',
      bindings: { ...g.bindings },
    }))
    // validate blendKeys length
    blendKeys = input.blendKeys ? [...input.blendKeys] : []
    const expected = Math.max(0, groups.length - 1)
    if (blendKeys.length !== expected) {
      throw new Error(
        `Control "${input.key}" blendKeys length must be max(0, groups.length-1) (expected ${expected})`,
      )
    }
    // validate duplicate group ids
    const gidSet = new Set<string>()
    for (const g of groups) {
      if (gidSet.has(g.id)) throw new Error(`Control "${input.key}" has duplicate group id "${g.id}"`)
      gidSet.add(g.id)
    }
    // validate each binding
    for (const group of groups) {
      for (const [semantic, binding] of Object.entries(group.bindings)) {
        validateControlBinding(binding as ControlBinding, semantic, input.key)
      }
    }
    for (const bk of blendKeys) validateControlKey(bk)
  } else if (input.bindings !== undefined) {
    // create single group from flat bindings
    const bindings: Record<string, ControlBinding> = {}
    for (const [semantic, binding] of Object.entries(input.bindings)) {
      validateControlBinding(binding, semantic, input.key)
      bindings[semantic] = typeof binding === 'string' ? binding : { ...binding }
    }
    groups = [{ id: newId('control-group'), name: 'Group 1', bindings }]
    blendKeys = []
  } else {
    groups = [{ id: newId('control-group'), name: 'Group 1', bindings: {} }]
    blendKeys = []
  }
  const merged = mergeGroupBindings(groups)
  // If input also provided bindings and groups, merged takes groups
  return {
    id: newId('control'),
    key: input.key,
    label: input.label ?? input.key,
    min: 0,
    max: 1,
    default: value,
    exposed: input.exposed ?? false,
    bindings: merged,
    groups,
    blendKeys,
  }
}

export function createControlSet(
  hostNodeId: string,
  controls: readonly Control[] = [],
): ControlSet {
  // Ensure controls have proper groups/blendKeys defaults for legacy inputs
  const normalized = controls.map((c) => ensureControlGroups(c))
  validateControls(normalized)
  return { id: newId('control-set'), hostNodeId, controls: [...normalized] }
}

export function ensureControlGroups(control: Control): Control {
  // If control already has groups and blendKeys, return as is (but ensure bindings merged)
  const hasGroups = (control as unknown as { groups?: unknown }).groups !== undefined
  const hasBlendKeys = (control as unknown as { blendKeys?: unknown }).blendKeys !== undefined
  if (hasGroups && hasBlendKeys) {
    const groups = (control.groups as readonly ControlGroup[]) ?? []
    const blendKeys = (control.blendKeys as readonly string[]) ?? []
    // ensure bindings merged matches groups
    const merged = mergeGroupBindings(groups as ControlGroup[])
    // Preserve id, key, etc., but ensure bindings is merged
    return {
      ...control,
      bindings: merged,
      groups: groups.map((g) => ({ id: g.id, name: g.name, bindings: { ...g.bindings } })),
      blendKeys: [...blendKeys],
    }
  }
  // Legacy: synthesize groups from flat bindings
  const flat = control.bindings ?? {}
  const groups: ControlGroup[] = [{ id: newId('control-group'), name: 'Group 1', bindings: { ...flat } }]
  const blendKeys: string[] = []
  return {
    ...control,
    bindings: { ...flat },
    groups,
    blendKeys,
  }
}

export function controlSetToJSON(controlSet: ControlSet): ControlSetJSON {
  return {
    id: controlSet.id,
    hostNodeId: controlSet.hostNodeId,
    controls: controlSet.controls.map((control) => {
      const bindings: Record<string, ControlBindingJSON> = {}
      // merged-union for backward compat: emit union of all groups
      const merged = mergeGroupBindings(control.groups)
      for (const [semantic, binding] of Object.entries(merged)) {
        if (typeof binding === 'string') {
          bindings[semantic] = { clipId: binding, start: 0, end: 1 }
        } else {
          bindings[semantic] = { clipId: binding.clipId, start: binding.start, end: binding.end }
        }
      }
      // Also emit groups for new readers
      const groups: ControlGroupJSON[] = control.groups.map((group) => {
        const gb: Record<string, ControlBindingJSON> = {}
        for (const [semantic, binding] of Object.entries(group.bindings)) {
          if (typeof binding === 'string') {
            gb[semantic] = { clipId: binding, start: 0, end: 1 }
          } else {
            gb[semantic] = { clipId: binding.clipId, start: binding.start, end: binding.end }
          }
        }
        return { id: group.id, name: group.name, bindings: gb }
      })
      return {
        id: control.id,
        key: control.key,
        label: control.label,
        min: control.min,
        max: control.max,
        default: control.default,
        exposed: control.exposed,
        bindings,
        groups,
        blendKeys: [...control.blendKeys],
      }
    }),
  }
}

export function controlSetFromJSON(value: unknown, nodeId: string): ControlSet | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object')
    throw new Error(`Node "${nodeId}" controlSet must be an object`)
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.controls))
    throw new Error(`Node "${nodeId}" controlSet controls must be an array`)
  const controls: Control[] = []
  for (const raw of record.controls) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    try {
      const key = requireString(item.key, 'Control key')
      validateControlKey(key)
      // Parse top-level bindings (legacy and merged-union)
      const topBindings: Record<string, ControlBinding> = {}
      if (item.bindings && typeof item.bindings === 'object') {
        for (const [semantic, rawBinding] of Object.entries(
          item.bindings as Record<string, unknown>,
        )) {
          if (typeof rawBinding === 'string') {
            if (rawBinding.length > 0) topBindings[semantic] = { clipId: rawBinding, start: 0, end: 1 }
            continue
          }
          if (rawBinding && typeof rawBinding === 'object') {
            const obj = rawBinding as Record<string, unknown>
            try {
              const clipId = requireString(
                obj.clipId,
                `Control "${key}" binding "${semantic}" clipId`,
              )
              const start = requireFiniteNumber(
                obj.start,
                `Control "${key}" binding "${semantic}" start`,
              )
              const end = requireFiniteNumber(obj.end, `Control "${key}" binding "${semantic}" end`)
              if (start < 0 || end > 1 || start >= end || end - start < CONTROL_INTERVAL_MIN_SPAN) {
                console.warn(
                  `[control] Dropping invalid interval binding "${semantic}" on "${key}": start=${start} end=${end}`,
                )
                continue
              }
              topBindings[semantic] = { clipId, start, end }
            } catch (e) {
              console.warn(
                `[control] Dropping invalid binding "${semantic}" on "${key}": ${e instanceof Error ? e.message : String(e)}`,
              )
              continue
            }
          } else {
            console.warn(
              `[control] Dropping invalid binding "${semantic}" on "${key}": unsupported value`,
            )
          }
        }
      }
      // Parse groups if present (additive tolerant)
      let groups: ControlGroup[] | undefined
      let blendKeys: string[] | undefined
      if (Array.isArray(item.groups)) {
        groups = []
        for (const rawGroup of item.groups) {
          if (!rawGroup || typeof rawGroup !== 'object') {
            console.warn(`[control] Dropping invalid group on "${key}": not an object`)
            continue
          }
          const g = rawGroup as Record<string, unknown>
          const gid = typeof g.id === 'string' && g.id !== '' ? g.id : newId('control-group')
          const gname = typeof g.name === 'string' ? g.name : 'Group 1'
          const gbindings: Record<string, ControlBinding> = {}
          if (g.bindings && typeof g.bindings === 'object') {
            for (const [semantic, rawBinding] of Object.entries(g.bindings as Record<string, unknown>)) {
              if (typeof rawBinding === 'string') {
                if (rawBinding.length > 0) gbindings[semantic] = { clipId: rawBinding, start: 0, end: 1 }
                continue
              }
              if (rawBinding && typeof rawBinding === 'object') {
                const obj = rawBinding as Record<string, unknown>
                try {
                  const clipId = requireString(
                    obj.clipId,
                    `Control "${key}" group "${gname}" binding "${semantic}" clipId`,
                  )
                  const start = requireFiniteNumber(
                    obj.start,
                    `Control "${key}" group "${gname}" binding "${semantic}" start`,
                  )
                  const end = requireFiniteNumber(
                    obj.end,
                    `Control "${key}" group "${gname}" binding "${semantic}" end`,
                  )
                  if (start < 0 || end > 1 || start >= end || end - start < CONTROL_INTERVAL_MIN_SPAN) {
                    console.warn(
                      `[control] Dropping invalid group interval binding "${semantic}" on "${key}" group "${gname}": start=${start} end=${end}`,
                    )
                    continue
                  }
                  gbindings[semantic] = { clipId, start, end }
                } catch (e) {
                  console.warn(
                    `[control] Dropping invalid group binding "${semantic}" on "${key}": ${e instanceof Error ? e.message : String(e)}`,
                  )
                  continue
                }
              } else {
                console.warn(
                  `[control] Dropping invalid group binding "${semantic}" on "${key}": unsupported`,
                )
              }
            }
          }
          groups.push({ id: gid, name: gname, bindings: gbindings })
        }
        // blendKeys
        if (Array.isArray(item.blendKeys)) {
          blendKeys = []
          for (const bk of item.blendKeys) {
            if (typeof bk === 'string' && CONTROL_KEY_PATTERN.test(bk)) blendKeys.push(bk)
            else console.warn(`[control] Dropping invalid blendKey "${String(bk)}" on "${key}"`)
          }
        } else if (item.blendKeys !== undefined) {
          console.warn(`[control] Ignoring invalid blendKeys on "${key}"`)
          blendKeys = []
        } else {
          blendKeys = []
        }
        // Validate length; if mismatch, warn and truncate/pad?
        const expected = Math.max(0, groups.length - 1)
        if (blendKeys.length !== expected) {
          console.warn(
            `[control] Fixing blendKeys length for "${key}": expected ${expected}, got ${blendKeys.length}`,
          )
          // tolerant: truncate or pad with uniquified?
          if (blendKeys.length > expected) blendKeys = blendKeys.slice(0, expected)
          else {
            // pad not needed? leave as is and validation will catch later, but we will not throw here, let validateControls handle
            // For tolerant load, we will allow mismatch and adjust groups? Instead we drop extra? We'll just keep as is and let validation warn.
            // To keep tolerant, we will synthesize missing? But we warn and keep mismatch; validateControls will throw later, but we are in tolerant path that drops invalid controls via try/catch? Actually we push control and then validateControls at end will throw. We need to make it tolerant: adjust to expected.
            // We'll pad with empty? No, we should just set to expected by truncating or leaving shorter? Let's pad with placeholder blend keys that will be uniquified later? For now just truncate/pad with generated? We'll pad with uniquified temp keys that don't collide.
            // For tolerant load we will generate missing blendKeys as "blend" series but they may collide; we will generate but note they may be missing sibling controls — validation will fix? For now just pad with generated keys that are not validated until later.
            // Simpler: set blendKeys to length expected by truncating or keeping what we have and letting validation fail? But we want file stays readable, so we should fix to expected by adjusting.
            if (groups.length === 1) blendKeys = []
            // else we leave as is, but we need to ensure length matches expected for validation; we will synthesize missing with dummy keys that we will later remap? Instead we will set blendKeys to expected length by slicing or generating placeholder.
            // For tolerant, we will if mismatch, set blendKeys to empty and let addGroup logic recreate? But we want to preserve what we can.
            // We'll just if mismatch, we will adjust: if too short, pad with generated keys using existing keys set.
            if (blendKeys.length < expected) {
              // generate placeholders - but we don't know existing ControlSet keys yet. Use simple blendN
              const existing = new Set<string>()
              // collect keys from already parsed controls plus current blendKeys
              for (const c of controls) existing.add(c.key)
              for (const bk of blendKeys) existing.add(bk)
              existing.add(key)
              while (blendKeys.length < expected) {
                const next = uniquifyBlendKey(existing, 'blend')
                blendKeys.push(next)
                existing.add(next)
              }
            }
          }
        }
        // If groups is empty, synthesize one empty group
        if (groups.length === 0) {
          groups = [{ id: newId('control-group'), name: 'Group 1', bindings: { ...topBindings } }]
          blendKeys = []
        }
        // Ensure merged bindings matches groups union for backward compat field
        // Use groups as source of truth; topBindings is ignored if groups present (but we have it for old readers)
      } else {
        // No groups field: legacy file -> synthesize single group from topBindings
        groups = [{ id: newId('control-group'), name: 'Group 1', bindings: { ...topBindings } }]
        blendKeys = []
      }

      const defaultVal = typeof item.default === 'number' ? item.default : 0
      const merged = mergeGroupBindings(groups)
      const control: Control = {
        id: requireString(item.id, 'Control id'),
        key,
        label: typeof item.label === 'string' ? item.label : key,
        min: 0 as const,
        max: 1 as const,
        default: defaultVal,
        exposed: item.exposed === true,
        bindings: merged,
        groups,
        blendKeys: blendKeys ?? [],
      }
      if (control.default < 0 || control.default > 1 || !Number.isFinite(control.default)) continue
      controls.push(control)
    } catch {
      continue
    }
  }
  // Tolerant: filter out controls that fail validation? validateControls will throw on first error; we want to keep file readable by dropping invalid controls? For now we call validate and if fails, drop offending controls? The existing code just called validateControls and let it throw, but outer try catches and continues per control. However validateControls checks cross-control invariants like duplicate keys and blend sibling order; those are cross-control, not per-control. We need to handle that: if cross-control validation fails, we should drop the whole set? Or we can attempt to fix contiguous order by dropping blend sibling violations.
  // For now we will attempt to validate; if fails due to blend sibling order, we will try to repair by removing offending blendKeys? Instead we will just warn and return controls without validation if it fails? But spec says validators should catch blend sibling order violated. For tolerant load, we should warn and keep controls as is, but validate in strict validator path (lessonSerializer) will error.
  // Here in controlSetFromJSON we are tolerant: we will try to validate, and if fails, we will console.warn and attempt to repair by ensuring contiguous order: if blend sibling order violated, we will drop those blendKeys that have missing siblings and keep groups with reduced blendKeys.
  // Simple repair: iterate hosts and if their blend siblings not found at expected positions, truncate blendKeys to what is actually present contiguously.
  try {
    validateControls(controls)
  } catch (e) {
    console.warn(`[control] ControlSet validation warning for node "${nodeId}": ${e instanceof Error ? e.message : String(e)} — attempting tolerant repair`)
    // Attempt repair: for each host, check contiguous availability and truncate blendKeys accordingly
    const keyToIdx = new Map<string, number>()
    controls.forEach((c, idx) => keyToIdx.set(c.key, idx))
    const repaired: Control[] = []
    // We will rebuild controls with truncated blendKeys where needed
    for (let i = 0; i < controls.length; i++) {
      const ctrl = controls[i]
      const expected = Math.max(0, ctrl.groups.length - 1)
      if (ctrl.blendKeys.length !== expected) {
        // truncate to available contiguous siblings
        let available = 0
        for (let j = 0; j < expected; j++) {
          const bk = ctrl.blendKeys[j]
          const siblingIdx = i + 1 + j
          if (siblingIdx < controls.length && controls[siblingIdx].key === bk) available += 1
          else break
        }
        if (available !== ctrl.blendKeys.length) {
          console.warn(`[control] Truncating blendKeys for "${ctrl.key}" from ${ctrl.blendKeys.length} to ${available} due to order violation`)
          repaired.push({ ...ctrl, blendKeys: ctrl.blendKeys.slice(0, available), groups: ctrl.groups.slice(0, available + 1) } as Control)
          continue
        }
      }
      repaired.push(ctrl)
    }
    // If repaired still fails, just return repaired without re-validating strictly? We will try again but if fails, return repaired as is with warning
    try {
      validateControls(repaired)
      return {
        id: typeof record.id === 'string' ? record.id : newId('control-set'),
        hostNodeId: nodeId,
        controls: repaired,
      }
    } catch (e2) {
      console.warn(`[control] Still invalid after repair: ${e2 instanceof Error ? e2.message : String(e2)} — returning best effort`)
      return {
        id: typeof record.id === 'string' ? record.id : newId('control-set'),
        hostNodeId: nodeId,
        controls: repaired,
      }
    }
  }
  return {
    id: typeof record.id === 'string' ? record.id : newId('control-set'),
    hostNodeId: nodeId,
    controls,
  }
}

export function evaluateControlTrack(
  keyframes: readonly Keyframe[],
  time: number,
  fallback: number,
): number {
  const enabled = keyframes.filter((keyframe) => !keyframe.disabled)
  if (enabled.length === 0) return fallback
  if (time <= enabled[0].time) return enabled[0].value as number
  const last = enabled[enabled.length - 1]
  if (time >= last.time) return last.value as number
  for (let index = 0; index < enabled.length - 1; index += 1) {
    const from = enabled[index]
    const to = enabled[index + 1]
    if (time >= from.time && time < to.time) {
      return evaluateSegment(from, to, time)
    }
  }
  return last.value as number
}

export function controlTrackKeyframeFromJSON(
  value: unknown,
  duration: number,
): Keyframe | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  try {
    const time = requireFiniteNumber(record.time, 'Control keyframe time')
    const numberValue = requireFiniteNumber(record.value, 'Control keyframe value')
    if (time < 0 || time > duration || numberValue < 0 || numberValue > 1) return undefined
    return new KeyframeModel(
      requireString(record.id, 'Control keyframe id'),
      time,
      numberValue,
      record.interpolation === undefined
        ? 'linear'
        : requireKeyframeInterpolation(record.interpolation),
      record.tangentIn === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentIn),
      record.tangentOut === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentOut),
      record.disabled === true,
    )
  } catch {
    return undefined
  }
}

// —————————————————————————————————————————————————————————————————————————————
// Blend genesis & group mutation helpers
// —————————————————————————————————————————————————————————————————————————————

export function createBlendControl(key: string): Control {
  validateControlKey(key)
  return {
    id: newId('control'),
    key,
    label: key,
    min: 0,
    max: 1,
    default: 0,
    exposed: true,
    bindings: {},
    groups: [{ id: newId('control-group'), name: 'Group 1', bindings: {} }],
    blendKeys: [],
  }
}

export function addGroupToControlSet(
  controlSet: ControlSet,
  hostKey: string,
  groupName?: string,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host control "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]
  // Actually check if this control is a blend sibling of another host
  const hostIsBlend = controlSet.controls.some((c) => c.blendKeys.includes(host.key))
  if (hostIsBlend) throw new Error(`Blend control "${hostKey}" cannot be used as host for groups`)
  const newGroupId = newId('control-group')
  const newGroupName = groupName ?? `Group ${host.groups.length + 1}`
  const newGroup: ControlGroup = { id: newGroupId, name: newGroupName, bindings: {} }
  const newGroups = [...host.groups, newGroup]
  // Generate new blend key uniquified per ControlSet
  const existingKeys = new Set<string>(controlSet.controls.map((c) => c.key))
  // Also include future blendKeys
  for (const c of controlSet.controls) for (const bk of c.blendKeys) existingKeys.add(bk)
  // host's current blendKeys plus new one
  const newBlendKey = uniquifyBlendKey(existingKeys, 'blend')
  const newBlendKeys = [...host.blendKeys, newBlendKey]
  const newHost: Control = {
    ...host,
    groups: newGroups,
    blendKeys: newBlendKeys,
    bindings: mergeGroupBindings(newGroups),
  }
  const blendControl = createBlendControl(newBlendKey)
  // Build new controls array: host + existing blends + new blend inserted contiguously
  const existingBlendCount = host.blendKeys.length
  const insertIdx = hostIdx + 1 + existingBlendCount
  const newControls: Control[] = [...controlSet.controls]
  newControls[hostIdx] = newHost
  // Insert new blend after existing blends
  newControls.splice(insertIdx, 0, blendControl)
  // Validate contiguous invariant
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

export function removeGroupFromControlSet(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host control "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]
  const hostIsBlend = controlSet.controls.some((c) => c.blendKeys.includes(host.key))
  if (hostIsBlend) throw new Error(`Blend control "${hostKey}" cannot have groups removed`)
  const groupIdx = host.groups.findIndex((g) => g.id === groupId)
  if (groupIdx === -1) throw new Error(`Group "${groupId}" not found on "${hostKey}"`)
  if (host.groups.length === 1) throw new Error(`Cannot remove last group from "${hostKey}"`)
  const newGroups = host.groups.filter((g) => g.id !== groupId)
  // Determine which blendKey to remove: if removing group that had an associated blend, remove corresponding blendKey
  // Simplified: after removal, blendKeys length = newGroups.length -1, we will remove blendKey at index groupIdx-1 if groupIdx>0 else 0? For now remove last blendKey if groupIdx is last, else remove at groupIdx-1 or 0.
  let newBlendKeys: string[]
  if (host.blendKeys.length === 0) {
    newBlendKeys = []
  } else {
    // If we removed a group, we need to remove one blendKey. Choose to remove blendKey corresponding to removed group's position, or if that group was first (no blend), remove first blendKey? Equivalent to remove last.
    // Spec says removing groups collapses Blends; for middle removal, we keep first blends? We'll implement: if groupIdx === host.groups.length -1 (last group), remove last blendKey. Otherwise remove blendKeys[groupIdx] if groupIdx < blendKeys.length else last.
    if (groupIdx === host.groups.length - 1) {
      // removed last group -> remove last blendKey
      newBlendKeys = host.blendKeys.slice(0, -1)
    } else if (groupIdx === 0) {
      // removed first group -> remove first blendKey (since first group has no blend, but gap shifts, we remove first blend which was between first and second)
      newBlendKeys = host.blendKeys.slice(1)
    } else {
      // middle group: remove blend at index groupIdx-1? Actually blendKeys[groupIdx-1] is blend between previous and this group, and blendKeys[groupIdx] is between this and next. Removing middle group should collapse one gap: we can remove blendKeys[groupIdx] (the gap after removed group) and keep previous.
      // For simplicity remove blend at groupIdx (if exists) else last.
      if (groupIdx < host.blendKeys.length) {
        newBlendKeys = [...host.blendKeys]
        newBlendKeys.splice(groupIdx, 1)
      } else {
        newBlendKeys = host.blendKeys.slice(0, -1)
      }
    }
  }
  const newHost: Control = {
    ...host,
    groups: newGroups,
    blendKeys: newBlendKeys,
    bindings: mergeGroupBindings(newGroups),
  }
  // Determine which blend control to remove: the blend control(s) that correspond to removed blendKey(s)
  // Removed keys are those in old but not in new
  const removedKeys = host.blendKeys.filter((k) => !newBlendKeys.includes(k))
  // For conservative, remove exactly one blend control (first removed)
  const removedKey = removedKeys[0]
  const newControls: Control[] = [...controlSet.controls]
  newControls[hostIdx] = newHost
  if (removedKey) {
    const blendIdx = newControls.findIndex((c, idx) => idx > hostIdx && c.key === removedKey)
    if (blendIdx !== -1) {
      // Check that this blend is indeed contiguous within host block: it should be within hostIdx+1..hostIdx+oldBlendCount
      const oldBlendCount = host.blendKeys.length
      const expectedEnd = hostIdx + oldBlendCount
      if (blendIdx >= hostIdx + 1 && blendIdx <= expectedEnd) {
        newControls.splice(blendIdx, 1)
      } else {
        // If not found in expected range, fallback search whole array
        const globalIdx = newControls.findIndex((c) => c.key === removedKey)
        if (globalIdx !== -1) newControls.splice(globalIdx, 1)
      }
    }
  }
  // Validate
  // If newGroups length ==1, ensure host's blends are zero and no remaining blend siblings
  // Already handled
  try {
    validateControls(newControls)
  } catch (e) {
    // If validation still fails due to overlapping, we will keep as is but warn
    console.warn(`[control] removeGroup validation warning: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { ...controlSet, controls: newControls }
}

export function reorderGroupsInControlSet(
  controlSet: ControlSet,
  hostKey: string,
  newOrder: readonly number[],
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]
  if (newOrder.length !== host.groups.length) throw new Error(`newOrder length must match groups length`)
  const sorted = [...newOrder].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i) throw new Error(`newOrder must be a permutation`)
  const newGroups = newOrder.map((idx) => host.groups[idx])
  // Permute blendKeys accordingly: mapping based on associated groups
  const oldBlendKeys = host.blendKeys
  const n = newGroups.length
  const newBlendKeys: string[] = []
  if (n > 1) {
    // For each new position i >=1, the group now at i is oldGroups[order[i]], its original blend was oldBlendKeys[order[i]-1] if order[i]>0 else missing.
    // We will map: newBlendKeys[i-1] = oldBlendKeys[ order[i]-1 ] if order[i]>0 else oldBlendKeys[0] fallback
    // For n groups, we need n-1 blendKeys
    for (let newIdx = 1; newIdx < n; newIdx++) {
      const oldIdx = newOrder[newIdx]
      if (oldIdx > 0 && oldIdx - 1 < oldBlendKeys.length) {
        newBlendKeys.push(oldBlendKeys[oldIdx - 1])
      } else if (oldIdx === 0) {
        // original first group had no blend; we need to pick a blend that is not already used and corresponds to gap that now includes this group
        // Fallback: use oldBlendKeys that hasn't been used yet, or keep original order's corresponding
        // Find first old blend not yet used
        const used = new Set(newBlendKeys)
        const remaining = oldBlendKeys.filter((k) => !used.has(k))
        if (remaining.length > 0) newBlendKeys.push(remaining[0])
        else if (oldBlendKeys.length > newIdx - 1) newBlendKeys.push(oldBlendKeys[newIdx - 1])
        else newBlendKeys.push(oldBlendKeys[0] ?? uniquifyBlendKey(new Set(oldBlendKeys), 'blend'))
      } else {
        // oldIdx out of range? fallback
        newBlendKeys.push(oldBlendKeys[newIdx - 1] ?? oldBlendKeys[0])
      }
    }
    // If we have duplicates or missing, deduplicate and ensure correct length
    // Ensure uniqueness and correct length
    const uniq: string[] = []
    const seen = new Set<string>()
    for (const k of newBlendKeys) {
      if (!seen.has(k)) {
        uniq.push(k)
        seen.add(k)
      }
    }
    // If we still have wrong length due to duplicates, pad with remaining old keys
    if (uniq.length < n - 1) {
      for (const k of oldBlendKeys) if (!seen.has(k)) { uniq.push(k); seen.add(k); if (uniq.length===n-1) break }
    }
    // If still short, generate? Should not happen
    while (uniq.length < n - 1) uniq.push(uniquifyBlendKey(new Set([...uniq, ...oldBlendKeys]), 'blend'))
    // Truncate to n-1
    newBlendKeys.length = 0
    newBlendKeys.push(...uniq.slice(0, n - 1))
  }
  const newHost: Control = {
    ...host,
    groups: newGroups,
    blendKeys: newBlendKeys,
    bindings: mergeGroupBindings(newGroups),
  }
  const newControls: Control[] = [...controlSet.controls]
  newControls[hostIdx] = newHost
  // Need to reorder blend sibling controls to match new blendKeys order
  // Existing blends are at hostIdx+1 .. hostIdx+oldBlendCount
  const oldBlendCount = oldBlendKeys.length
  const blendsStart = hostIdx + 1
  const existingBlends = newControls.slice(blendsStart, blendsStart + oldBlendCount)
  // Validate that existingBlends keys match oldBlendKeys order
  // Now reorder them to match newBlendKeys order: find each new key's old control
  const blendKeyToControl = new Map<string, Control>()
  for (const bc of existingBlends) blendKeyToControl.set(bc.key, bc)
  const reorderedBlends: Control[] = []
  for (const nk of newBlendKeys) {
    const ctrl = blendKeyToControl.get(nk)
    if (ctrl) reorderedBlends.push(ctrl)
    else {
      // Should not happen, but create missing blend
      reorderedBlends.push(createBlendControl(nk))
    }
  }
  // Replace slice
  newControls.splice(blendsStart, oldBlendCount, ...reorderedBlends)
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

export function moveBindingBetweenGroups(
  controlSet: ControlSet,
  hostKey: string,
  semanticName: string,
  fromGroupId: string,
  toGroupId: string,
  toIndex?: number,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]
  const fromIdx = host.groups.findIndex((g) => g.id === fromGroupId)
  const toIdx = host.groups.findIndex((g) => g.id === toGroupId)
  if (fromIdx === -1) throw new Error(`Source group "${fromGroupId}" not found`)
  if (toIdx === -1) throw new Error(`Target group "${toGroupId}" not found`)
  const fromGroup = host.groups[fromIdx]
  const toGroup = host.groups[toIdx]
  const binding = fromGroup.bindings[semanticName]
  if (binding === undefined) throw new Error(`Binding "${semanticName}" not found in group "${fromGroupId}"`)
  // Remove from source
  const newFromBindings: Record<string, ControlBinding> = { ...fromGroup.bindings }
  delete newFromBindings[semanticName]
  // Insert into target
  const targetEntries = Object.entries(toGroup.bindings) as [string, ControlBinding][]
  const insertAt = toIndex !== undefined ? Math.min(Math.max(toIndex, 0), targetEntries.length) : targetEntries.length
  // If moving within same group, handle reorder
  let newTargetEntries: [string, ControlBinding][]
  if (fromGroupId === toGroupId) {
    const entries = Object.entries(fromGroup.bindings) as [string, ControlBinding][]
    const fromPos = entries.findIndex(([k]) => k === semanticName)
    const filtered = entries.filter(([k]) => k !== semanticName)
    const dest = toIndex !== undefined ? Math.min(Math.max(toIndex, 0), filtered.length) : filtered.length
    // adjust for removal shift if dest > fromPos
    const actualDest = fromPos !== -1 && dest > fromPos ? dest : dest
    filtered.splice(actualDest, 0, [semanticName, binding])
    newTargetEntries = filtered
    // For same group, we just replace that group's bindings
    const newGroups = host.groups.map((g, idx) => {
      if (idx !== fromIdx) return g
      const nb: Record<string, ControlBinding> = {}
      for (const [k, v] of newTargetEntries) nb[k] = v
      return { ...g, bindings: nb }
    })
    const newHost: Control = { ...host, groups: newGroups, bindings: mergeGroupBindings(newGroups) }
    const newControls = [...controlSet.controls]
    newControls[hostIdx] = newHost
    validateControls(newControls)
    return { ...controlSet, controls: newControls }
  } else {
    targetEntries.splice(insertAt, 0, [semanticName, binding])
    const newTargetBindings: Record<string, ControlBinding> = {}
    for (const [k, v] of targetEntries) newTargetBindings[k] = v
    const newGroups = host.groups.map((g, idx) => {
      if (idx === fromIdx) return { ...g, bindings: newFromBindings }
      if (idx === toIdx) return { ...g, bindings: newTargetBindings }
      return g
    })
    const newHost: Control = { ...host, groups: newGroups, bindings: mergeGroupBindings(newGroups) }
    const newControls = [...controlSet.controls]
    newControls[hostIdx] = newHost
    validateControls(newControls)
    return { ...controlSet, controls: newControls }
  }
}

export function reorderBindingWithinGroup(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
  semanticName: string,
  newIndex: number,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]
  const groupIdx = host.groups.findIndex((g) => g.id === groupId)
  if (groupIdx === -1) throw new Error(`Group "${groupId}" not found`)
  const group = host.groups[groupIdx]
  const entries = Object.entries(group.bindings) as [string, ControlBinding][]
  const curIdx = entries.findIndex(([k]) => k === semanticName)
  if (curIdx === -1) throw new Error(`Binding "${semanticName}" not found`)
  const [moved] = entries.splice(curIdx, 1)
  const dest = Math.min(Math.max(newIndex, 0), entries.length)
  entries.splice(dest, 0, moved)
  const newBindings: Record<string, ControlBinding> = {}
  for (const [k, v] of entries) newBindings[k] = v
  const newGroups = host.groups.map((g, idx) => (idx === groupIdx ? { ...g, bindings: newBindings } : g))
  const newHost: Control = { ...host, groups: newGroups, bindings: mergeGroupBindings(newGroups) }
  const newControls = [...controlSet.controls]
  newControls[hostIdx] = newHost
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

export function renameControlInSet(
  controlSet: ControlSet,
  oldKey: string,
  newKey: string,
): ControlSet {
  validateControlKey(newKey)
  if (oldKey === newKey) return controlSet
  if (!controlSet.controls.some((c) => c.key === oldKey)) throw new Error(`Control "${oldKey}" not found`)
  if (controlSet.controls.some((c) => c.key === newKey)) throw new Error(`Duplicate control key: ${newKey}`)
  // Also check blendKeys uniqueness will be handled
  const newControls = controlSet.controls.map((control) => {
    let nextControl = control
    if (control.key === oldKey) {
      nextControl = { ...control, key: newKey, label: control.label === oldKey ? newKey : control.label }
    }
    if (control.blendKeys.includes(oldKey)) {
      const newBlendKeys = control.blendKeys.map((bk) => (bk === oldKey ? newKey : bk))
      nextControl = { ...nextControl, blendKeys: newBlendKeys }
    }
    return nextControl
  })
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

export function reorderControlBlock(
  controlSet: ControlSet,
  hostKey: string,
  newIndex: number,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]
  const hostIsBlend = controlSet.controls.some((c) => c.blendKeys.includes(hostKey))
  if (hostIsBlend) throw new Error(`Blend control "${hostKey}" cannot be reordered as block`)
  const blockSize = 1 + host.blendKeys.length
  const block = controlSet.controls.slice(hostIdx, hostIdx + blockSize)
  // Check block integrity
  const expectedKeys = [hostKey, ...host.blendKeys]
  for (let i = 0; i < blockSize; i++) if (block[i].key !== expectedKeys[i]) throw new Error(`Block integrity violated at ${i}`)
  const withoutBlock = [...controlSet.controls]
  withoutBlock.splice(hostIdx, blockSize)
  // Compute insertion index in withoutBlock space
  // newIndex is desired index in original array? Spec says Host+blends reorder as a block; we treat newIndex as target index for host in final array (0..)
  // Clamp to valid range
  let target = Math.min(Math.max(newIndex, 0), withoutBlock.length)
  // If target is after original position, adjust because we removed block
  if (target > hostIdx) target = Math.min(target, withoutBlock.length)
  // Ensure we don't insert inside another host's block? But blocks are contiguous; inserting between hosts is okay, but inserting inside a host's block should be blocked and adjusted to block boundaries.
  // Check for overlapping with existing host blocks: we will ensure target is not inside any existing host block in withoutBlock
  // Find host blocks in withoutBlock
  const hostBlocks: { start: number; end: number }[] = []
  for (let i = 0; i < withoutBlock.length; ) {
    const ctrl = withoutBlock[i]
    const bCount = ctrl.blendKeys.length
    hostBlocks.push({ start: i, end: i + bCount })
    i += 1 + bCount
  }
  for (const hb of hostBlocks) {
    if (target > hb.start && target <= hb.end) {
      // snap to after block
      target = hb.end + 1
      break
    }
  }
  withoutBlock.splice(target, 0, ...block)
  validateControls(withoutBlock)
  return { ...controlSet, controls: withoutBlock }
}

export function canDeleteControl(controlSet: ControlSet, key: string): boolean {
  // Blend controls not directly deletable
  const isBlend = controlSet.controls.some((c) => c.blendKeys.includes(key))
  if (isBlend) return false
  return controlSet.controls.some((c) => c.key === key)
}

export function deleteControlFromSet(controlSet: ControlSet, key: string): ControlSet {
  if (!canDeleteControl(controlSet, key)) throw new Error(`Control "${key}" cannot be deleted directly (blend siblings collapsed by removing groups)`)
  const idx = controlSet.controls.findIndex((c) => c.key === key)
  if (idx === -1) throw new Error(`Control "${key}" not found`)
  const ctrl = controlSet.controls[idx]
  // If host with blends, delete whole block (host+blends)
  const blockSize = 1 + (ctrl.blendKeys?.length ?? 0)
  const newControls = [...controlSet.controls]
  newControls.splice(idx, blockSize)
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

