import { newId } from './ids'
import type { Keyframe } from './keyframe'
import {
  Keyframe as KeyframeModel,
  requireKeyframeBlend,
  requireKeyframeInterpolation,
  requireKeyframeTangent,
  ZERO_TANGENT,
} from './keyframe'
import { evaluateSegment } from './interpolators'
import type { ControlCollectionBlockJSON, ControlSetJSON } from './json'
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

export type ControlBindingValue = ControlBinding | readonly ControlBinding[]
export type ControlBindingJSONValue = ControlBindingJSON | readonly ControlBindingJSON[]

/**
 * A live-linked reference from a Control timeline to a whole ClipCollection.
 * The block occupies `[start,end]` on the control value axis (like a clip
 * interval) and fans out to the collection's `semanticName → clipId` bindings
 * at read time, so collection edits propagate automatically. Each member clip
 * is evaluated at the same remapped `uPrime = (rawU - start) / (end - start)`.
 */
export interface ControlCollectionBlock {
  readonly id: string
  readonly collectionId: string
  readonly start: number
  readonly end: number
}

export interface ControlGroup {
  readonly id: string
  readonly name: string
  readonly bindings: Readonly<Record<string, ControlBindingValue>>
  /**
   * Grouped collection blocks, in display/priority order. Optional for
   * backward compat — absent means a clip-only group.
   */
  readonly collectionBlocks?: readonly ControlCollectionBlock[]
}

export interface ControlGroupJSON {
  readonly id: string
  readonly name: string
  readonly bindings: Readonly<Record<string, ControlBindingJSONValue>>
  readonly collectionBlocks?: readonly ControlCollectionBlockJSON[]
}

export interface Control {
  readonly id: string
  readonly key: string
  readonly label: string
  readonly min: 0
  readonly max: 1
  readonly default: number
  readonly exposed: boolean
  readonly bindings: Readonly<Record<string, ControlBindingValue>>
  readonly groups: readonly ControlGroup[]
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

export function normalizeBindingValue(
  value: ControlBindingValue | undefined,
): readonly ControlBindingInterval[] {
  if (value === undefined) return []
  const arr = Array.isArray(value) ? value : [value]
  return arr.map((b) => normalizeControlBinding(b))
}

export function getBindingsForSemantic(
  bindings: Readonly<Record<string, ControlBindingValue>>,
  semantic: string,
): readonly ControlBinding[] {
  const v = bindings[semantic]
  if (v === undefined) return []
  return Array.isArray(v) ? (v as readonly ControlBinding[]) : [v as ControlBinding]
}

export function addBindingToRecord(
  record: Record<string, ControlBindingValue>,
  semantic: string,
  binding: ControlBinding,
): void {
  const existing = record[semantic]
  if (existing === undefined) {
    record[semantic] = binding
  } else if (Array.isArray(existing)) {
    record[semantic] = [...existing, binding]
  } else {
    record[semantic] = [existing as ControlBinding, binding]
  }
}

export function removeBindingFromRecord(
  record: Record<string, ControlBindingValue>,
  semantic: string,
  clipId?: string,
  start?: number,
  end?: number,
): boolean {
  const existing = record[semantic]
  if (existing === undefined) return false
  if (!Array.isArray(existing)) {
    // single value – remove only if matches filter
    if (clipId !== undefined) {
      const b = existing as ControlBinding
      const cid = typeof b === 'string' ? b : b.clipId
      if (cid !== clipId) return false
      if (start !== undefined || end !== undefined) {
        const norm = normalizeControlBinding(b as ControlBinding)
        if (start !== undefined && norm.start !== start) return false
        if (end !== undefined && norm.end !== end) return false
      }
    }
    delete record[semantic]
    return true
  }
  const arr = existing as readonly ControlBinding[]
  if (clipId === undefined) {
    // remove semantic entirely? For UI remove action we delete all for semantic
    delete record[semantic]
    return true
  }
  const filtered = arr.filter((b) => {
    const cid = typeof b === 'string' ? b : b.clipId
    if (cid !== clipId) return true
    if (start !== undefined || end !== undefined) {
      const norm = normalizeControlBinding(b as ControlBinding)
      if (start !== undefined && norm.start !== start) return true
      if (end !== undefined && norm.end !== end) return true
    }
    return false // remove this one
  })
  if (filtered.length === 0) delete record[semantic]
  else if (filtered.length === 1) record[semantic] = filtered[0]!
  else record[semantic] = filtered
  return true
}

// ---------------------------------------------------------------------------
// Collection blocks (live-linked ClipCollection references on a timeline)
// ---------------------------------------------------------------------------

/** Read a group's collection blocks tolerantly (absent = clip-only group). */
export function groupCollectionBlocks(
  group: Pick<ControlGroup, 'collectionBlocks'> | undefined | null,
): readonly ControlCollectionBlock[] {
  if (!group) return []
  const blocks = (group as ControlGroup).collectionBlocks
  if (!blocks) return []
  return blocks
}

export function validateControlCollectionBlock(
  block: ControlCollectionBlock,
  controlKey: string,
): void {
  if (!block || typeof block !== 'object')
    throw new Error(`Control "${controlKey}" collection block must be an object`)
  if (typeof block.id !== 'string' || block.id === '')
    throw new Error(`Control "${controlKey}" collection block id must be non-empty`)
  if (typeof block.collectionId !== 'string' || block.collectionId === '')
    throw new Error(
      `Control "${controlKey}" collection block must reference a non-empty collectionId`,
    )
  const start = requireFiniteNumber(
    (block as unknown as Record<string, unknown>).start,
    `Control "${controlKey}" collection block start`,
  )
  const end = requireFiniteNumber(
    (block as unknown as Record<string, unknown>).end,
    `Control "${controlKey}" collection block end`,
  )
  if (start < 0) throw new Error(`Control "${controlKey}" collection block start must be >= 0`)
  if (end > 1) throw new Error(`Control "${controlKey}" collection block end must be <= 1`)
  if (start >= end) throw new Error(`Control "${controlKey}" collection block start must be < end`)
  if (end - start < CONTROL_INTERVAL_MIN_SPAN)
    throw new Error(
      `Control "${controlKey}" collection block span must be >= ${CONTROL_INTERVAL_MIN_SPAN}`,
    )
}

function withCollectionBlocks(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
  next: readonly ControlCollectionBlock[],
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host control "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]!
  const groupIdx = host.groups.findIndex((g) => g.id === groupId)
  if (groupIdx === -1) throw new Error(`Group "${groupId}" not found on "${hostKey}"`)
  const newGroups = host.groups.map((g, idx) =>
    idx === groupIdx ? { ...g, collectionBlocks: [...next] } : g,
  )
  const newHost: Control = {
    ...host,
    groups: newGroups,
    bindings: mergeGroupBindings(newGroups),
  }
  const newControls = [...controlSet.controls]
  newControls[hostIdx] = newHost
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

function findControlGroup(controlSet: ControlSet, hostKey: string, groupId: string): ControlGroup {
  const host = controlSet.controls.find((c) => c.key === hostKey)
  if (!host) throw new Error(`Host control "${hostKey}" not found`)
  const group = host.groups.find((g) => g.id === groupId)
  if (!group) throw new Error(`Group "${groupId}" not found on "${hostKey}"`)
  return group
}

export function addCollectionBlockToGroup(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
  input: { collectionId: string; start?: number; end?: number },
): ControlSet {
  const group = findControlGroup(controlSet, hostKey, groupId)
  const block: ControlCollectionBlock = {
    id: newId('control-collection-block'),
    collectionId: input.collectionId,
    start: input.start ?? 0,
    end: input.end ?? 1,
  }
  validateControlCollectionBlock(block, hostKey)
  return withCollectionBlocks(controlSet, hostKey, groupId, [
    ...groupCollectionBlocks(group),
    block,
  ])
}

export function removeCollectionBlockFromGroup(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
  blockId: string,
): ControlSet {
  const group = findControlGroup(controlSet, hostKey, groupId)
  const blocks = groupCollectionBlocks(group)
  const next = blocks.filter((b) => b.id !== blockId)
  if (next.length === blocks.length)
    throw new Error(`Collection block "${blockId}" not found on "${hostKey}"`)
  return withCollectionBlocks(controlSet, hostKey, groupId, next)
}

export function updateCollectionBlockInterval(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
  blockId: string,
  start: number,
  end: number,
): ControlSet {
  const group = findControlGroup(controlSet, hostKey, groupId)
  const blocks = groupCollectionBlocks(group)
  const idx = blocks.findIndex((b) => b.id === blockId)
  if (idx === -1) throw new Error(`Collection block "${blockId}" not found on "${hostKey}"`)
  const next = blocks.map((b, i) => (i === idx ? { ...b, start, end } : b))
  validateControlCollectionBlock(next[idx]!, hostKey)
  return withCollectionBlocks(controlSet, hostKey, groupId, next)
}

export function reorderCollectionBlockWithinGroup(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
  fromIndex: number,
  toIndex: number,
): ControlSet {
  const group = findControlGroup(controlSet, hostKey, groupId)
  const blocks = [...groupCollectionBlocks(group)]
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= blocks.length)
    throw new Error(`fromIndex ${fromIndex} out of range`)
  const [moved] = blocks.splice(fromIndex, 1)
  const dest = Math.min(Math.max(toIndex, 0), blocks.length)
  blocks.splice(dest, 0, moved!)
  return withCollectionBlocks(controlSet, hostKey, groupId, blocks)
}

export function moveCollectionBlockBetweenGroups(
  controlSet: ControlSet,
  hostKey: string,
  fromGroupId: string,
  toGroupId: string,
  blockId: string,
  toIndex?: number,
): ControlSet {
  const fromGroup = findControlGroup(controlSet, hostKey, fromGroupId)
  findControlGroup(controlSet, hostKey, toGroupId)
  const blocks = groupCollectionBlocks(fromGroup)
  const block = blocks.find((b) => b.id === blockId)
  if (!block) throw new Error(`Collection block "${blockId}" not found on "${hostKey}"`)
  const remaining = blocks.filter((b) => b.id !== blockId)
  if (fromGroupId === toGroupId) {
    const dest =
      toIndex !== undefined ? Math.min(Math.max(toIndex, 0), remaining.length) : remaining.length
    const reordered = [...remaining]
    reordered.splice(dest, 0, block)
    return withCollectionBlocks(controlSet, hostKey, fromGroupId, reordered)
  }
  const afterRemove = withCollectionBlocks(controlSet, hostKey, fromGroupId, remaining)
  const toGroup = findControlGroup(afterRemove, hostKey, toGroupId)
  const destBlocks = [...groupCollectionBlocks(toGroup)]
  const dest =
    toIndex !== undefined ? Math.min(Math.max(toIndex, 0), destBlocks.length) : destBlocks.length
  destBlocks.splice(dest, 0, block)
  return withCollectionBlocks(afterRemove, hostKey, toGroupId, destBlocks)
}

export function flattenControlBindings(
  bindings: Readonly<Record<string, ControlBindingValue>>,
): Array<{ semantic: string; binding: ControlBinding; index: number }> {
  const out: Array<{ semantic: string; binding: ControlBinding; index: number }> = []
  let idx = 0
  for (const [semantic, value] of Object.entries(bindings)) {
    if (Array.isArray(value)) {
      for (const b of value as readonly ControlBinding[]) {
        out.push({ semantic, binding: b as ControlBinding, index: idx++ })
      }
    } else {
      out.push({ semantic, binding: value as ControlBinding, index: idx++ })
    }
  }
  return out
}

export function countControlBindings(
  bindings: Readonly<Record<string, ControlBindingValue>>,
): number {
  let n = 0
  for (const v of Object.values(bindings)) {
    if (Array.isArray(v)) n += (v as readonly unknown[]).length
    else n += 1
  }
  return n
}

export function isEmptyControlBindings(
  bindings: Readonly<Record<string, ControlBindingValue>> | undefined,
): boolean {
  if (!bindings) return true
  return countControlBindings(bindings) === 0
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
  bindings?: Readonly<Record<string, ControlBindingValue>>
  collectionBlocks?: readonly ControlCollectionBlock[]
}): ControlGroup {
  const id = input.id ?? newId('control-group')
  const name = input.name ?? 'Group 1'
  const bindings: Record<string, ControlBindingValue> = {}
  if (input.bindings) {
    for (const [semantic, value] of Object.entries(input.bindings)) {
      if (Array.isArray(value)) {
        bindings[semantic] = (value as readonly ControlBinding[]).map((b) =>
          typeof b === 'string' ? b : { ...b },
        )
      } else {
        const binding = value as ControlBinding
        bindings[semantic] = typeof binding === 'string' ? binding : { ...binding }
      }
    }
  }
  const group: ControlGroup = { id, name, bindings }
  if (input.collectionBlocks !== undefined) {
    const blocks = input.collectionBlocks.map((b) => ({ ...b }))
    for (const b of blocks) validateControlCollectionBlock(b, name)
    return { ...group, collectionBlocks: blocks }
  }
  return group
}

export function mergeGroupBindings(
  groups: readonly ControlGroup[],
): Record<string, ControlBindingValue> {
  const merged: Record<string, ControlBindingValue> = {}
  for (const group of groups) {
    for (const [semantic, value] of Object.entries(group.bindings)) {
      if (Array.isArray(value)) {
        const arr = value as readonly ControlBinding[]
        for (const b of arr) addBindingToRecord(merged, semantic, b as ControlBinding)
      } else {
        addBindingToRecord(merged, semantic, value as ControlBinding)
      }
    }
  }
  return merged
}

/**
 * @deprecated Blend siblings removed — blend lives inside host keyframes
 * (`Keyframe.blend`). Kept as no-op stubs for backward-compat imports.
 */
export function uniquifyBlendKey(_existingKeys: Set<string>, _base = 'blend'): string {
  return _base
}

/** @deprecated Always false — no separate blend controls exist anymore. */
export function isBlendControl(_control: Control): boolean {
  void _control
  return false
}

/** @deprecated Hosts no longer have sibling blocks; returns host-only block. */
export function findBlendBlock(
  controls: readonly Control[],
  hostIdx: number,
): { host: Control; blends: readonly Control[]; endIdx: number } | undefined {
  const host = controls[hostIdx]
  if (!host) return undefined
  return { host, blends: [], endIdx: hostIdx }
}

export function validateControls(controls: readonly Control[]): void {
  const keys = new Set<string>()
  for (const control of controls) {
    validateControlKey(control.key)
    if (keys.has(control.key)) throw new Error(`Duplicate control key: ${control.key}`)
    keys.add(control.key)
    if (control.min !== 0 || control.max !== 1 || control.default < 0 || control.default > 1) {
      throw new Error(`Control "${control.key}" must use the v1 range [0, 1]`)
    }
    // validate bindings (merged)
    if (control.bindings && typeof control.bindings === 'object') {
      for (const [semantic, value] of Object.entries(control.bindings)) {
        if (Array.isArray(value)) {
          for (const b of value as readonly ControlBinding[]) {
            validateControlBinding(b as ControlBinding, semantic, control.key)
          }
        } else {
          validateControlBinding(value as ControlBinding, semantic, control.key)
        }
      }
    }
    // validate groups — N timelines, no sibling blend controls
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
        if (typeof group.name !== 'string' || group.name.trim() === '')
          throw new Error(`Control "${control.key}" group name must be a non-empty string`)
        if (
          group.bindings &&
          typeof group.bindings === 'object' &&
          !Array.isArray(group.bindings)
        ) {
          for (const [semantic, value] of Object.entries(
            group.bindings as Record<string, ControlBindingValue>,
          )) {
            if (Array.isArray(value)) {
              for (const b of value as readonly ControlBinding[]) {
                validateControlBinding(b as ControlBinding, semantic, control.key)
              }
            } else {
              validateControlBinding(value as ControlBinding, semantic, control.key)
            }
          }
        } else if (group.bindings !== undefined) {
          throw new Error(`Control "${control.key}" group bindings must be an object`)
        }
        const collectionBlocks = groupCollectionBlocks(group)
        const blockIds = new Set<string>()
        for (const block of collectionBlocks) {
          validateControlCollectionBlock(block, control.key)
          if (blockIds.has(block.id))
            throw new Error(
              `Control "${control.key}" has duplicate collection block id "${block.id}"`,
            )
          blockIds.add(block.id)
        }
      }
    }
  }
}

export function createControl(input: {
  key: string
  label?: string
  default?: number
  exposed?: boolean
  bindings?: Readonly<Record<string, ControlBindingValue>>
  groups?: readonly ControlGroup[]
  blendKeys?: readonly string[]
}): Control {
  validateControlKey(input.key)
  const value = input.default ?? 0
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Control default must be within [0, 1]')
  }
  let groups: ControlGroup[]
  if (input.groups !== undefined) {
    // validate groups provided (blendKeys ignored — legacy tolerant)
    groups = input.groups.map((g) => {
      const next: ControlGroup = {
        id: g.id ?? newId('control-group'),
        name: g.name ?? 'Group 1',
        bindings: { ...g.bindings },
      }
      const blocks = groupCollectionBlocks(g)
      if (g.collectionBlocks !== undefined) {
        const cloned = blocks.map((b) => ({ ...b }))
        for (const b of cloned) validateControlCollectionBlock(b, input.key)
        return { ...next, collectionBlocks: cloned }
      }
      return next
    })
    // validate duplicate group ids
    const gidSet = new Set<string>()
    for (const g of groups) {
      if (gidSet.has(g.id))
        throw new Error(`Control "${input.key}" has duplicate group id "${g.id}"`)
      gidSet.add(g.id)
    }
    // validate each binding
    for (const group of groups) {
      for (const [semantic, value] of Object.entries(group.bindings)) {
        if (Array.isArray(value)) {
          for (const b of value as readonly ControlBinding[]) {
            validateControlBinding(b as ControlBinding, semantic, input.key)
          }
        } else {
          validateControlBinding(value as ControlBinding, semantic, input.key)
        }
      }
    }
  } else if (input.bindings !== undefined) {
    // create single group from flat bindings
    const bindings: Record<string, ControlBindingValue> = {}
    for (const [semantic, value] of Object.entries(input.bindings)) {
      if (Array.isArray(value)) {
        const arr = value as readonly ControlBinding[]
        for (const b of arr) validateControlBinding(b as ControlBinding, semantic, input.key)
        bindings[semantic] = (arr as readonly ControlBinding[]).map((b) =>
          typeof b === 'string' ? b : { ...(b as ControlBindingInterval) },
        )
      } else {
        const binding = value as ControlBinding
        validateControlBinding(binding, semantic, input.key)
        bindings[semantic] = typeof binding === 'string' ? binding : { ...binding }
      }
    }
    groups = [{ id: newId('control-group'), name: 'Group 1', bindings }]
  } else {
    groups = [{ id: newId('control-group'), name: 'Group 1', bindings: {} }]
  }
  const merged = mergeGroupBindings(groups)
  // If input also provided bindings and groups, merged takes groups
  // (legacy blendKeys input ignored)
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
  // If control already has groups, return as is (but ensure bindings merged)
  const hasGroups = (control as unknown as { groups?: unknown }).groups !== undefined
  if (hasGroups) {
    const groups = (control.groups as readonly ControlGroup[]) ?? []
    // ensure bindings merged matches groups
    const merged = mergeGroupBindings(groups as ControlGroup[])
    // Preserve id, key, etc., but ensure bindings is merged; drop legacy blendKeys
    const { blendKeys: _drop, ...rest } = control as unknown as Record<string, unknown>
    void _drop
    return {
      ...(rest as unknown as Control),
      bindings: merged,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        bindings: { ...g.bindings },
        ...(g.collectionBlocks !== undefined
          ? { collectionBlocks: groupCollectionBlocks(g).map((b) => ({ ...b })) }
          : {}),
      })),
    }
  }
  // Legacy: synthesize groups from flat bindings
  const flat = control.bindings ?? {}
  const groups: ControlGroup[] = [
    { id: newId('control-group'), name: 'Group 1', bindings: { ...flat } },
  ]
  const { blendKeys: _drop2, ...rest2 } = control as unknown as Record<string, unknown>
  void _drop2
  return {
    ...(rest2 as unknown as Control),
    bindings: { ...flat },
    groups,
  }
}

/** Keep the merged binding view in sync with the single group used by v1 controls. */
export function normalizeControlSetForMutation(controlSet: ControlSet): ControlSet {
  return {
    ...controlSet,
    controls: controlSet.controls.map((control) => {
      if (control.groups.length !== 1) return ensureControlGroups(control)
      const bindings: Record<string, ControlBindingValue> = {}
      for (const [semantic, value] of Object.entries(control.bindings)) {
        bindings[semantic] = Array.isArray(value)
          ? (value as readonly ControlBinding[]).map((binding) =>
              typeof binding === 'string' ? binding : { ...binding },
            )
          : typeof value === 'string'
            ? value
            : { ...(value as ControlBindingInterval) }
      }
      const sourceGroup = control.groups[0]!
      return {
        ...control,
        bindings,
        groups: [
          {
            ...sourceGroup,
            bindings,
            ...(sourceGroup.collectionBlocks !== undefined
              ? { collectionBlocks: groupCollectionBlocks(sourceGroup).map((b) => ({ ...b })) }
              : {}),
          },
        ],
      }
    }),
  }
}

/**
 * Tolerant parse of a group's `collectionBlocks` array (warn-and-drop invalid
 * entries so old readers and hand-edited files never hard-fail).
 */
function parseControlCollectionBlocks(
  raw: unknown,
  controlKey: string,
  groupName: string,
): ControlCollectionBlock[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    console.warn(
      `[control] Dropping invalid collectionBlocks on "${controlKey}" group "${groupName}": must be an array`,
    )
    return []
  }
  const out: ControlCollectionBlock[] = []
  const seenIds = new Set<string>()
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      console.warn(
        `[control] Dropping invalid collection block on "${controlKey}" group "${groupName}": not an object`,
      )
      continue
    }
    const obj = entry as Record<string, unknown>
    const id =
      typeof obj.id === 'string' && obj.id !== '' ? obj.id : newId('control-collection-block')
    if (seenIds.has(id)) {
      console.warn(
        `[control] Dropping duplicate collection block id "${id}" on "${controlKey}" group "${groupName}"`,
      )
      continue
    }
    const block: ControlCollectionBlock = {
      id,
      collectionId: typeof obj.collectionId === 'string' ? obj.collectionId : '',
      start: typeof obj.start === 'number' ? obj.start : NaN,
      end: typeof obj.end === 'number' ? obj.end : NaN,
    }
    try {
      validateControlCollectionBlock(
        { ...block, start: block.start as number, end: block.end as number },
        controlKey,
      )
    } catch (e) {
      console.warn(
        `[control] Dropping invalid collection block on "${controlKey}" group "${groupName}": ${e instanceof Error ? e.message : String(e)}`,
      )
      continue
    }
    seenIds.add(id)
    out.push(block)
  }
  return out
}

export function controlSetToJSON(controlSet: ControlSet): ControlSetJSON {
  return {
    id: controlSet.id,
    hostNodeId: controlSet.hostNodeId,
    controls: controlSet.controls.map((control) => {
      const bindings: Record<string, ControlBindingJSONValue> = {}
      // merged-union for backward compat: emit union of all groups (last-wins, array→last)
      const merged = mergeGroupBindings(control.groups)
      for (const [semantic, value] of Object.entries(merged)) {
        const arr = Array.isArray(value)
          ? (value as readonly ControlBinding[])
          : [value as ControlBinding]
        const last = arr[arr.length - 1] as ControlBinding
        if (typeof last === 'string') {
          bindings[semantic] = { clipId: last, start: 0, end: 1 }
        } else {
          bindings[semantic] = {
            clipId: (last as ControlBindingInterval).clipId,
            start: (last as ControlBindingInterval).start,
            end: (last as ControlBindingInterval).end,
          }
        }
        // If array length >1, also preserve array for new readers via extra field? But old readers only see last. New readers use groups, so okay.
        // For new readers that might read top-level without groups (legacy fallback), we emit array if multiple
        if (Array.isArray(value) && (value as readonly ControlBinding[]).length > 1) {
          ;(bindings as Record<string, ControlBindingJSONValue>)[semantic] = (
            value as readonly ControlBinding[]
          ).map((b) =>
            typeof b === 'string'
              ? { clipId: b, start: 0, end: 1 }
              : {
                  clipId: (b as ControlBindingInterval).clipId,
                  start: (b as ControlBindingInterval).start,
                  end: (b as ControlBindingInterval).end,
                },
          ) as readonly ControlBindingJSON[]
        }
      }
      // Also emit groups for new readers
      const groups: ControlGroupJSON[] = control.groups.map((group) => {
        const gb: Record<string, ControlBindingJSONValue> = {}
        for (const [semantic, value] of Object.entries(group.bindings)) {
          if (Array.isArray(value)) {
            gb[semantic] = (value as readonly ControlBinding[]).map((b) =>
              typeof b === 'string'
                ? { clipId: b, start: 0, end: 1 }
                : {
                    clipId: (b as ControlBindingInterval).clipId,
                    start: (b as ControlBindingInterval).start,
                    end: (b as ControlBindingInterval).end,
                  },
            ) as readonly ControlBindingJSON[]
          } else {
            const binding = value as ControlBinding
            if (typeof binding === 'string') {
              gb[semantic] = { clipId: binding, start: 0, end: 1 }
            } else {
              gb[semantic] = { clipId: binding.clipId, start: binding.start, end: binding.end }
            }
          }
        }
        const blocks = groupCollectionBlocks(group)
        const groupJson: ControlGroupJSON = { id: group.id, name: group.name, bindings: gb }
        if (blocks.length > 0) {
          return {
            ...groupJson,
            collectionBlocks: blocks.map((b): ControlCollectionBlockJSON => ({
              id: b.id,
              collectionId: b.collectionId,
              start: b.start,
              end: b.end,
            })),
          }
        }
        return groupJson
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
      // Parse top-level bindings (legacy and merged-union) – supports array per semantic
      const topBindings: Record<string, ControlBindingValue> = {}
      if (item.bindings && typeof item.bindings === 'object' && !Array.isArray(item.bindings)) {
        for (const [semantic, rawBinding] of Object.entries(
          item.bindings as Record<string, unknown>,
        )) {
          const parseOne = (rb: unknown): ControlBinding | undefined => {
            if (typeof rb === 'string') {
              if (rb.length > 0) return { clipId: rb, start: 0, end: 1 }
              return undefined
            }
            if (rb && typeof rb === 'object' && !Array.isArray(rb)) {
              const obj = rb as Record<string, unknown>
              try {
                const clipId = requireString(
                  obj.clipId,
                  `Control "${key}" binding "${semantic}" clipId`,
                )
                const start = requireFiniteNumber(
                  obj.start,
                  `Control "${key}" binding "${semantic}" start`,
                )
                const end = requireFiniteNumber(
                  obj.end,
                  `Control "${key}" binding "${semantic}" end`,
                )
                if (
                  start < 0 ||
                  end > 1 ||
                  start >= end ||
                  end - start < CONTROL_INTERVAL_MIN_SPAN
                ) {
                  console.warn(
                    `[control] Dropping invalid interval binding "${semantic}" on "${key}": start=${start} end=${end}`,
                  )
                  return undefined
                }
                return { clipId, start, end }
              } catch (e) {
                console.warn(
                  `[control] Dropping invalid binding "${semantic}" on "${key}": ${e instanceof Error ? e.message : String(e)}`,
                )
                return undefined
              }
            }
            console.warn(
              `[control] Dropping invalid binding "${semantic}" on "${key}": unsupported value`,
            )
            return undefined
          }
          if (Array.isArray(rawBinding)) {
            const arr: ControlBinding[] = []
            for (const entry of rawBinding as unknown[]) {
              const b = parseOne(entry)
              if (b) arr.push(b)
            }
            if (arr.length === 0) continue
            topBindings[semantic] = arr.length === 1 ? arr[0]! : arr
          } else {
            const b = parseOne(rawBinding)
            if (b) topBindings[semantic] = b
          }
        }
      }
      // Parse groups if present (additive tolerant). blendKeys is legacy — ignored.
      let groups: ControlGroup[] | undefined
      const hasGroupsField = Object.prototype.hasOwnProperty.call(item, 'groups')
      const hasBlendKeysField = Object.prototype.hasOwnProperty.call(item, 'blendKeys')
      if (hasBlendKeysField) {
        console.warn(
          `[control] Ignoring legacy blendKeys on "${key}" — blend lives in host keyframes`,
        )
      }
      if (Array.isArray(item.groups)) {
        groups = []
        for (const rawGroup of item.groups) {
          if (!rawGroup || typeof rawGroup !== 'object') {
            console.warn(`[control] Dropping invalid group on "${key}": not an object`)
            continue
          }
          const g = rawGroup as Record<string, unknown>
          let gid: string
          if (typeof g.id === 'string' && g.id !== '') gid = g.id
          else {
            console.warn(`[control] Group on "${key}" missing id — generating fresh`)
            gid = newId('control-group')
          }
          let gname: string
          if (typeof g.name === 'string' && g.name.trim() !== '') gname = g.name
          else {
            console.warn(
              `[control] Group "${String(g.id)}" on "${key}" has empty name — using "Group 1"`,
            )
            gname = typeof g.name === 'string' && g.name !== '' ? g.name : 'Group 1'
            if (typeof g.name !== 'string' || g.name.trim() === '') {
              console.warn(`[control] Dropping invalid group name on "${key}" — using fallback`)
            }
          }
          const gbindings: Record<string, ControlBindingValue> = {}
          if (g.bindings && typeof g.bindings === 'object' && !Array.isArray(g.bindings)) {
            for (const [semantic, rawBinding] of Object.entries(
              g.bindings as Record<string, unknown>,
            )) {
              const parseOneGroup = (rb: unknown): ControlBinding | undefined => {
                if (typeof rb === 'string') {
                  if (rb.length > 0) return { clipId: rb, start: 0, end: 1 }
                  console.warn(
                    `[control] Dropping empty string binding "${semantic}" on "${key}" group "${gname}"`,
                  )
                  return undefined
                }
                if (rb && typeof rb === 'object' && !Array.isArray(rb)) {
                  const obj = rb as Record<string, unknown>
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
                    if (
                      start < 0 ||
                      end > 1 ||
                      start >= end ||
                      end - start < CONTROL_INTERVAL_MIN_SPAN
                    ) {
                      console.warn(
                        `[control] Dropping invalid group interval binding "${semantic}" on "${key}" group "${gname}": start=${start} end=${end}`,
                      )
                      return undefined
                    }
                    return { clipId, start, end }
                  } catch (e) {
                    console.warn(
                      `[control] Dropping invalid group binding "${semantic}" on "${key}": ${e instanceof Error ? e.message : String(e)}`,
                    )
                    return undefined
                  }
                }
                console.warn(
                  `[control] Dropping invalid group binding "${semantic}" on "${key}": unsupported`,
                )
                return undefined
              }
              if (Array.isArray(rawBinding)) {
                const arr: ControlBinding[] = []
                for (const entry of rawBinding as unknown[]) {
                  const b = parseOneGroup(entry)
                  if (b) arr.push(b)
                }
                if (arr.length === 0) continue
                gbindings[semantic] = arr.length === 1 ? arr[0]! : arr
              } else {
                const b = parseOneGroup(rawBinding)
                if (b) gbindings[semantic] = b
              }
            }
          } else if (g.bindings !== undefined) {
            console.warn(
              `[control] Dropping invalid group bindings on "${key}" group "${gname}": must be object`,
            )
          }
          // Validate group name non-empty (tolerant: already warned, but keep)
          const collectionBlocks = parseControlCollectionBlocks(
            (g as Record<string, unknown>).collectionBlocks,
            key,
            gname,
          )
          const base = { id: gid, name: 'Group 1', bindings: gbindings }
          if (typeof gname !== 'string' || gname.trim() === '') {
            console.warn(
              `[control] Group "${gid}" on "${key}" has empty name — falling back to "Group 1"`,
            )
            groups.push(collectionBlocks.length > 0 ? { ...base, collectionBlocks } : base)
          } else {
            groups.push(
              collectionBlocks.length > 0
                ? { id: gid, name: gname, bindings: gbindings, collectionBlocks }
                : { id: gid, name: gname, bindings: gbindings },
            )
          }
        }
        // Check duplicate group ids (tolerant: warn and keep, but dedupe by generating fresh for duplicates)
        const seenIds = new Set<string>()
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi]!
          if (seenIds.has(g.id)) {
            console.warn(`[control] Duplicate group id "${g.id}" on "${key}" — generating fresh`)
            const fresh = newId('control-group')
            groups[gi] = { ...g, id: fresh }
            seenIds.add(fresh)
          } else seenIds.add(g.id)
        }
        // If groups is empty, synthesize one empty group (warn-and-fallback)
        if (groups.length === 0) {
          console.warn(
            `[control] Control "${key}" groups empty/malformed — warn-and-fallback to single group [0,1]`,
          )
          groups = [
            {
              id: newId('control-group'),
              name:
                typeof item.label === 'string' && item.label.trim() !== ''
                  ? (item.label as string)
                  : 'Group 1',
              bindings: { ...topBindings },
            },
          ]
        }
        // Ensure merged bindings matches groups union for backward compat field
        // Use groups as source of truth; topBindings is ignored if groups present (but we have it for old readers)
      } else if (hasGroupsField) {
        // Bad groups field (non-array) → warn-and-fallback to single group
        console.warn(
          `[control] Control "${key}" has invalid groups field (non-array) — warn-and-fallback to single group`,
        )
        groups = [
          {
            id: newId('control-group'),
            name:
              typeof item.label === 'string' && item.label.trim() !== ''
                ? (item.label as string)
                : 'Group 1',
            bindings: { ...topBindings },
          },
        ]
      } else {
        // No groups field: legacy file -> synthesize single group from topBindings
        const labelName =
          typeof item.label === 'string' && item.label.trim() !== ''
            ? (item.label as string)
            : 'Group 1'
        groups = [{ id: newId('control-group'), name: labelName, bindings: { ...topBindings } }]
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
      }
      if (control.default < 0 || control.default > 1 || !Number.isFinite(control.default)) continue
      controls.push(control)
    } catch {
      continue
    }
  }
  // Drop legacy blend sibling controls: any control whose key appears in another
  // control's legacy blendKeys array is a sibling, not a real host. Collect from
  // raw JSON before filtering.
  {
    const legacyBlendKeys = new Set<string>()
    for (const raw of record.controls as unknown[]) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const bks = (item as { blendKeys?: unknown }).blendKeys
      if (Array.isArray(bks)) {
        for (const bk of bks) if (typeof bk === 'string') legacyBlendKeys.add(bk)
      }
    }
    if (legacyBlendKeys.size > 0) {
      const before = controls.length
      const kept = controls.filter((c) => {
        if (!legacyBlendKeys.has(c.key)) return true
        // Keep it only if it has real bindings (i.e. not an empty blend sibling)
        const emptyBindings = isEmptyControlBindings(c.bindings)
        const emptyGroups =
          c.groups !== undefined
            ? c.groups.length === 1 &&
              isEmptyControlBindings(c.groups[0]!.bindings) &&
              groupCollectionBlocks(c.groups[0]).length === 0
            : true
        if (emptyBindings && emptyGroups) {
          console.warn(
            `[control] Dropping legacy blend sibling control "${c.key}" — blend now lives in host keyframes`,
          )
          return false
        }
        return true
      })
      if (kept.length !== before) {
        controls.length = 0
        for (const c of kept) controls.push(c)
      }
    }
  }
  try {
    validateControls(controls)
  } catch (e) {
    console.warn(
      `[control] ControlSet validation warning for node "${nodeId}": ${e instanceof Error ? e.message : String(e)}`,
    )
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
    let blend: readonly number[] = []
    if (record.blend !== undefined) {
      try {
        blend = requireKeyframeBlend(record.blend)
      } catch {
        blend = []
      }
    }
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
      blend,
    )
  } catch {
    return undefined
  }
}

/**
 * Evaluate a host Control track at time, returning shared U plus per-gap
 * blend factors stored inside host keyframes (blend[N-1]).
 * U and blends share the host segment interpolation (hold/linear/bezier):
 * one evaluateSegment gives U, blends lerp with the same segment.
 * Missing blend = [] (=0s); over-long blends truncated, short padded with 0.
 */
export function evaluateHostWithBlends(
  keyframes: readonly Keyframe[],
  time: number,
  fallback: number,
  blendCount: number,
): { u: number; blends: number[] } {
  const enabled = keyframes.filter((keyframe) => !keyframe.disabled)
  const empty = new Array<number>(Math.max(0, blendCount)).fill(0)
  if (enabled.length === 0) return { u: fallback, blends: empty }
  const normBlend = (kf: Keyframe): number[] => {
    const out = new Array<number>(Math.max(0, blendCount)).fill(0)
    const src = kf.blend ?? []
    for (let i = 0; i < out.length && i < src.length; i++) {
      const v = src[i]!
      out[i] = Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0
    }
    return out
  }
  if (time <= enabled[0]!.time)
    return { u: enabled[0]!.value as number, blends: normBlend(enabled[0]!) }
  const last = enabled[enabled.length - 1]!
  if (time >= last.time) return { u: last.value as number, blends: normBlend(last) }
  for (let index = 0; index < enabled.length - 1; index += 1) {
    const from = enabled[index]!
    const to = enabled[index + 1]!
    if (time >= from.time && time < to.time) {
      const u = evaluateSegment(from, to, time)
      if (from.interpolation === 'hold') return { u, blends: normBlend(from) }
      const fromB = normBlend(from)
      const toB = normBlend(to)
      // Share host segment interp: evaluate each blend lane through the same
      // segment interpolator (same tangents drive U+blend together).
      const blends = fromB.map((fb, i) => {
        const tb = toB[i] ?? 0
        if (fb === tb) return fb
        const synthFrom = new KeyframeModel(
          from.id,
          from.time,
          fb,
          from.interpolation,
          from.tangentIn,
          from.tangentOut,
        )
        const synthTo = new KeyframeModel(
          to.id,
          to.time,
          tb,
          from.interpolation,
          to.tangentIn,
          to.tangentOut,
        )
        const v = evaluateSegment(synthFrom, synthTo, time)
        return Math.min(Math.max(v, 0), 1)
      })
      return { u, blends }
    }
  }
  return { u: last.value as number, blends: normBlend(last) }
}

// —————————————————————————————————————————————————————————————————————————————
// Blend genesis & group mutation helpers
// —————————————————————————————————————————————————————————————————————————————

/**
 * @deprecated Blend siblings removed — blend lives in host keyframes.
 * Creates a plain empty control (for backward-compat callers).
 */
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
  }
}

export function addGroupToControlSet(
  controlSet: ControlSet,
  hostKey: string,
  groupName?: string,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host control "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]!
  const newGroupId = newId('control-group')
  const newGroupName = groupName ?? `Group ${host.groups.length + 1}`
  const newGroup: ControlGroup = { id: newGroupId, name: newGroupName, bindings: {} }
  const newGroups = [...host.groups, newGroup]
  const newHost: Control = {
    ...host,
    groups: newGroups,
    bindings: mergeGroupBindings(newGroups),
  }
  const newControls: Control[] = [...controlSet.controls]
  newControls[hostIdx] = newHost
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

/**
 * Pad host keyframes for a new timeline: append 0 to every host kf blend array.
 * Call after addGroupToControlSet when animation is available.
 */
export function padHostKeyframesForNewGroup(
  keyframes: readonly import('./keyframe').Keyframe[],
): readonly import('./keyframe').Keyframe[] {
  return keyframes
}

/** Trim host keyframes when a timeline is removed (splice blend index). */
export function trimHostKeyframesForRemovedGroup(
  keyframes: readonly import('./keyframe').Keyframe[],
  _removedGroupIndex: number,
): readonly import('./keyframe').Keyframe[] {
  void _removedGroupIndex
  return [...keyframes]
}

export function removeGroupFromControlSet(
  controlSet: ControlSet,
  hostKey: string,
  groupId: string,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host control "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]!
  const groupIdx = host.groups.findIndex((g) => g.id === groupId)
  if (groupIdx === -1) throw new Error(`Group "${groupId}" not found on "${hostKey}"`)
  if (host.groups.length === 1) throw new Error(`Cannot remove last group from "${hostKey}"`)
  const newGroups = host.groups.filter((g) => g.id !== groupId)
  const newHost: Control = {
    ...host,
    groups: newGroups,
    bindings: mergeGroupBindings(newGroups),
  }
  const newControls: Control[] = [...controlSet.controls]
  newControls[hostIdx] = newHost
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

export function reorderGroupsInControlSet(
  controlSet: ControlSet,
  hostKey: string,
  newOrder: readonly number[],
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]!
  if (newOrder.length !== host.groups.length)
    throw new Error(`newOrder length must match groups length`)
  const sorted = [...newOrder].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++)
    if (sorted[i] !== i) throw new Error(`newOrder must be a permutation`)
  const newGroups = newOrder.map((idx) => host.groups[idx]!)
  const newHost: Control = {
    ...host,
    groups: newGroups,
    bindings: mergeGroupBindings(newGroups),
  }
  const newControls: Control[] = [...controlSet.controls]
  newControls[hostIdx] = newHost
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

export interface MoveBlockMatcher {
  readonly clipId?: string
  readonly start?: number
  readonly end?: number
}

export function moveBindingBetweenGroups(
  controlSet: ControlSet,
  hostKey: string,
  semanticName: string,
  fromGroupId: string,
  toGroupId: string,
  toIndex?: number,
  block?: MoveBlockMatcher,
): ControlSet {
  const hostIdx = controlSet.controls.findIndex((c) => c.key === hostKey)
  if (hostIdx === -1) throw new Error(`Host "${hostKey}" not found`)
  const host = controlSet.controls[hostIdx]!
  const fromIdx = host.groups.findIndex((g) => g.id === fromGroupId)
  const toIdx = host.groups.findIndex((g) => g.id === toGroupId)
  if (fromIdx === -1) throw new Error(`Source group "${fromGroupId}" not found`)
  if (toIdx === -1) throw new Error(`Target group "${toGroupId}" not found`)
  const fromGroup = host.groups[fromIdx]!
  const toGroup = host.groups[toIdx]!
  const binding = fromGroup.bindings[semanticName]
  if (binding === undefined)
    throw new Error(`Binding "${semanticName}" not found in group "${fromGroupId}"`)
  // Single-block move: relocate one (clipId,start,end) entry, merging into the
  // target via addBindingToRecord so existing target blocks survive.
  if (block !== undefined) {
    const EPS = CONTROL_INTERVAL_EPSILON
    const sourceEntries = getBindingsForSemantic(fromGroup.bindings, semanticName)
    const matchIdx = sourceEntries.findIndex((b) => {
      const cid = controlBindingClipId(b)
      if (block.clipId !== undefined && cid !== block.clipId) return false
      if (block.start !== undefined || block.end !== undefined) {
        const norm = normalizeControlBinding(b)
        if (block.start !== undefined && Math.abs(norm.start - block.start) > EPS) return false
        if (block.end !== undefined && Math.abs(norm.end - block.end) > EPS) return false
      }
      return true
    })
    if (matchIdx === -1)
      throw new Error(`Binding "${semanticName}" block not found in group "${fromGroupId}"`)
    const moved = sourceEntries[matchIdx]!
    const remaining = sourceEntries.filter((_, i) => i !== matchIdx)
    const newFromBindings: Record<string, ControlBindingValue> = { ...fromGroup.bindings }
    if (remaining.length === 0) delete newFromBindings[semanticName]
    else if (remaining.length === 1) newFromBindings[semanticName] = remaining[0]!
    else newFromBindings[semanticName] = [...remaining]
    if (fromGroupId === toGroupId) {
      // Reorder within the same semantic array when toIndex is given, else re-append.
      const dest =
        toIndex !== undefined ? Math.min(Math.max(toIndex, 0), remaining.length) : remaining.length
      const reordered = [...remaining]
      reordered.splice(dest, 0, moved)
      const next: Record<string, ControlBindingValue> = { ...newFromBindings }
      if (reordered.length === 1) next[semanticName] = reordered[0]!
      else next[semanticName] = [...reordered]
      const newGroups = host.groups.map((g, idx) =>
        idx === fromIdx ? { ...g, bindings: next } : g,
      )
      const newHost: Control = {
        ...host,
        groups: newGroups,
        bindings: mergeGroupBindings(newGroups),
      }
      const newControls = [...controlSet.controls]
      newControls[hostIdx] = newHost
      validateControls(newControls)
      return { ...controlSet, controls: newControls }
    }
    const newTargetBindings: Record<string, ControlBindingValue> = { ...toGroup.bindings }
    addBindingToRecord(newTargetBindings, semanticName, moved)
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
  const newFromBindings: Record<string, ControlBindingValue> = { ...fromGroup.bindings }
  delete newFromBindings[semanticName]
  const targetEntries = Object.entries(toGroup.bindings) as [string, ControlBindingValue][]
  const insertAt =
    toIndex !== undefined
      ? Math.min(Math.max(toIndex, 0), targetEntries.length)
      : targetEntries.length
  let newTargetEntries: [string, ControlBindingValue][]
  if (fromGroupId === toGroupId) {
    const entries = Object.entries(fromGroup.bindings) as [string, ControlBindingValue][]
    const filtered = entries.filter(([k]) => k !== semanticName)
    const dest =
      toIndex !== undefined ? Math.min(Math.max(toIndex, 0), filtered.length) : filtered.length
    filtered.splice(dest, 0, [semanticName, binding as ControlBindingValue])
    newTargetEntries = filtered
    const newGroups = host.groups.map((g, idx) => {
      if (idx !== fromIdx) return g
      const nb: Record<string, ControlBindingValue> = {}
      for (const [k, v] of newTargetEntries) nb[k] = v
      return { ...g, bindings: nb }
    })
    const newHost: Control = { ...host, groups: newGroups, bindings: mergeGroupBindings(newGroups) }
    const newControls = [...controlSet.controls]
    newControls[hostIdx] = newHost
    validateControls(newControls)
    return { ...controlSet, controls: newControls }
  } else {
    // Cross-group whole-semantic move. Merge (not overwrite) when the target
    // already holds the same semantic — otherwise its blocks would be deleted.
    const newTargetBindings: Record<string, ControlBindingValue> = { ...toGroup.bindings }
    const existing = newTargetBindings[semanticName]
    if (existing === undefined) {
      targetEntries.splice(insertAt, 0, [semanticName, binding as ControlBindingValue])
      for (const [k, v] of targetEntries) newTargetBindings[k] = v
    } else {
      const movedEntries = Array.isArray(binding) ? [...binding] : [binding]
      for (const b of movedEntries as ControlBinding[])
        addBindingToRecord(newTargetBindings, semanticName, b)
    }
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
  const host = controlSet.controls[hostIdx]!
  const groupIdx = host.groups.findIndex((g) => g.id === groupId)
  if (groupIdx === -1) throw new Error(`Group "${groupId}" not found`)
  const group = host.groups[groupIdx]!
  const entries = Object.entries(group.bindings) as [string, ControlBindingValue][]
  const curIdx = entries.findIndex(([k]) => k === semanticName)
  if (curIdx === -1) throw new Error(`Binding "${semanticName}" not found`)
  const [moved] = entries.splice(curIdx, 1)
  const dest = Math.min(Math.max(newIndex, 0), entries.length)
  entries.splice(dest, 0, moved!)
  const newBindings: Record<string, ControlBindingValue> = {}
  for (const [k, v] of entries) newBindings[k] = v
  const newGroups = host.groups.map((g, idx) =>
    idx === groupIdx ? { ...g, bindings: newBindings } : g,
  )
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
  if (!controlSet.controls.some((c) => c.key === oldKey))
    throw new Error(`Control "${oldKey}" not found`)
  if (controlSet.controls.some((c) => c.key === newKey))
    throw new Error(`Duplicate control key: ${newKey}`)
  const newControls = controlSet.controls.map((control) => {
    if (control.key === oldKey) {
      return {
        ...control,
        key: newKey,
        label: control.label === oldKey ? newKey : control.label,
      }
    }
    return control
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
  const newControls = [...controlSet.controls]
  const [block] = newControls.splice(hostIdx, 1)
  const target = Math.min(Math.max(newIndex, 0), newControls.length)
  newControls.splice(target, 0, block!)
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}

/** @deprecated Alias for reorderControlBlock (no sibling blocks anymore). */
export function reorderControl(
  controlSet: ControlSet,
  hostKey: string,
  newIndex: number,
): ControlSet {
  return reorderControlBlock(controlSet, hostKey, newIndex)
}

export function canDeleteControl(controlSet: ControlSet, key: string): boolean {
  return controlSet.controls.some((c) => c.key === key)
}

export function deleteControlFromSet(controlSet: ControlSet, key: string): ControlSet {
  if (!canDeleteControl(controlSet, key)) throw new Error(`Control "${key}" not found`)
  const newControls = controlSet.controls.filter((c) => c.key !== key)
  validateControls(newControls)
  return { ...controlSet, controls: newControls }
}
