import type { ClipJSON, ClipChannelJSON, KeyframeJSON } from '../engine/json'
import type { EnginePublic } from '../engine'
import type { DispatchCommand, UndoStack } from '../engine/commands'
import {
  DeleteClipCommand,
  SetClipCollectionBindingsCommand,
  SetClipDefinitionCommand,
} from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import { mergeUndoRecords } from './undoMerge'

export interface CollectionContentTrack {
  readonly key: string
  readonly label: string
  readonly keyframes: readonly KeyframeJSON[]
}

export interface CollectionContentMember {
  readonly semanticName: string
  readonly clipId: string
  readonly clipName: string
  readonly duration: number
  readonly tracks: readonly CollectionContentTrack[]
}

type TrackLocation = {
  readonly field: keyof ClipJSON
  readonly key?: string
}

function trackKey(location: TrackLocation): string {
  return `${String(location.field)}:${location.key ?? ''}`
}

function channelRows(clip: ClipJSON): CollectionContentTrack[] {
  const rows: CollectionContentTrack[] = []
  const addMap = (
    field: keyof ClipJSON,
    map: Readonly<Record<string, ClipChannelJSON>> | undefined,
    prefix: string,
  ) => {
    for (const [key, animation] of Object.entries(map ?? {})) {
      if (animation.keyframes.length === 0) continue
      const label = `${prefix}${key}`
      rows.push({
        key: trackKey({ field, key }),
        label,
        keyframes: animation.keyframes,
      })
    }
  }
  addMap('channelAnimations', clip.channelAnimations, '')
  addMap('materialChannelAnimations', clip.materialChannelAnimations, 'Material: ')
  addMap('circleChannelAnimations', clip.circleChannelAnimations, 'Circle: ')
  addMap('tableChannelAnimations', clip.tableChannelAnimations, 'Table: ')
  addMap('shadowChannelAnimations', clip.shadowChannelAnimations, 'Shadow: ')

  const addSingle = (field: keyof ClipJSON, label: string, animation?: ClipChannelJSON) => {
    if (animation?.keyframes.length) {
      rows.push({ key: trackKey({ field }), label, keyframes: animation.keyframes })
    }
  }
  addSingle('visibleAnimation', 'Visible', clip.visibleAnimation)
  addSingle('zIndexAnimation', 'Z-index', clip.zIndexAnimation)
  addSingle('morphAnimation', 'Morph', clip.morphAnimation)
  addSingle('symmetryAnimation', 'Symmetry', clip.symmetryAnimation)
  return rows.sort((a, b) => a.label.localeCompare(b.label))
}

export function snapshotCollectionContent(
  engine: EnginePublic,
  collectionId: string,
): { readonly members: readonly CollectionContentMember[]; readonly duration: number } {
  const collection = engine.getClipCollection(collectionId)
  const members = [...collection.bindings.entries()].map(([semanticName, clipId]) => {
    const clip = engine.getClip(clipId).toJSON()
    return {
      semanticName,
      clipId,
      clipName: clip.name,
      duration: clip.duration,
      tracks: channelRows(clip),
    }
  })
  return { members, duration: Math.max(0, ...members.map((member) => member.duration)) }
}

function readTrack(
  clip: ClipJSON,
  key: string,
): { location: TrackLocation; data: ClipChannelJSON } | null {
  const splitAt = key.indexOf(':')
  const field = key.slice(0, splitAt) as keyof ClipJSON
  const channelKey = key.slice(splitAt + 1)
  if (
    field === 'channelAnimations' ||
    field === 'materialChannelAnimations' ||
    field === 'circleChannelAnimations' ||
    field === 'tableChannelAnimations' ||
    field === 'shadowChannelAnimations'
  ) {
    const data = (clip[field] as Readonly<Record<string, ClipChannelJSON>> | undefined)?.[
      channelKey
    ]
    return data ? { location: { field, key: channelKey }, data } : null
  }
  if (
    field === 'visibleAnimation' ||
    field === 'zIndexAnimation' ||
    field === 'morphAnimation' ||
    field === 'symmetryAnimation'
  ) {
    const data = clip[field]
    return data ? { location: { field }, data } : null
  }
  return null
}

function replaceTrack(
  clip: ClipJSON,
  location: TrackLocation,
  keyframes: readonly KeyframeJSON[],
): ClipJSON {
  if (
    location.field === 'channelAnimations' ||
    location.field === 'materialChannelAnimations' ||
    location.field === 'circleChannelAnimations' ||
    location.field === 'tableChannelAnimations' ||
    location.field === 'shadowChannelAnimations'
  ) {
    const original =
      (clip[location.field] as Readonly<Record<string, ClipChannelJSON>> | undefined) ?? {}
    const next = { ...original }
    if (keyframes.length === 0) delete next[location.key!]
    else next[location.key!] = { keyframes }
    const result = { ...clip } as Record<string, unknown>
    if (Object.keys(next).length === 0) delete result[location.field]
    else result[location.field] = next
    if (location.field === 'channelAnimations' && keyframes.length === 0) {
      result.channels = clip.channels.filter(
        (channel) => channel.materialParameter !== undefined || channel.property !== location.key,
      )
    }
    if (location.field === 'materialChannelAnimations' && keyframes.length === 0) {
      result.channels = clip.channels.filter(
        (channel) => channel.materialParameter !== location.key,
      )
    }
    return result as unknown as ClipJSON
  }
  const result = { ...clip } as Record<string, unknown>
  if (keyframes.length === 0) delete result[location.field]
  else result[location.field] = { keyframes }
  return result as unknown as ClipJSON
}

export interface RemoveCollectionContentSelection {
  readonly collectionId: string
  readonly memberNames: ReadonlySet<string>
  readonly trackKeysBySemantic: ReadonlyMap<string, ReadonlySet<string>>
  readonly from: number
  readonly to: number
}

function valueReferencesClip(value: unknown, clipId: string): boolean {
  if (value === clipId) return true
  if (Array.isArray(value)) return value.some((entry) => valueReferencesClip(entry, clipId))
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return (
      record.clipId === clipId ||
      Object.values(record).some((entry) => valueReferencesClip(entry, clipId))
    )
  }
  return false
}

function clipReferencedElsewhere(
  engine: EnginePublic,
  collectionId: string,
  clipId: string,
): boolean {
  if (
    engine.clipCollections.some(
      (candidate) =>
        candidate.id !== collectionId && [...candidate.bindings.values()].includes(clipId),
    )
  )
    return true
  for (const slide of engine.project?.slides ?? []) {
    for (const node of walkPreOrder(slide.scene.root)) {
      if (node.clipInstances.some((instance) => instance.clipId === clipId)) return true
      if (
        node.controlSet?.controls.some(
          (control) =>
            valueReferencesClip(control.bindings, clipId) ||
            control.groups.some((group) => valueReferencesClip(group.bindings, clipId)),
        )
      )
        return true
    }
  }
  return false
}

export type RemoveCollectionContentResult =
  | {
      readonly ok: true
      readonly removedKeyframeCount: number
      readonly removedMemberCount: number
    }
  | { readonly ok: false; readonly error: string }

/** Apply collection-content edits as a single undo step. */
export function executeRemoveCollectionContent(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  selection: RemoveCollectionContentSelection,
): RemoveCollectionContentResult {
  let records = 0
  try {
    const collection = engine.getClipCollection(selection.collectionId)
    const bindings = collection.getBindingsObject()
    const nextBindings = { ...bindings }
    const memberClips = new Set<string>()
    let removedMemberCount = 0
    for (const semanticName of selection.memberNames) {
      const clipId = nextBindings[semanticName]
      if (!clipId) continue
      delete nextBindings[semanticName]
      memberClips.add(clipId)
      removedMemberCount += 1
    }

    const updatedClips = new Map<string, ClipJSON>()
    let removedKeyframeCount = 0
    for (const [semanticName, trackKeys] of selection.trackKeysBySemantic) {
      if (selection.memberNames.has(semanticName)) continue
      const clipId = bindings[semanticName]
      if (!clipId || trackKeys.size === 0) continue
      let clip = updatedClips.get(clipId) ?? engine.getClip(clipId).toJSON()
      const duration = clip.duration
      for (const key of trackKeys) {
        const selected = readTrack(clip, key)
        if (!selected) continue
        const removed = selected.data.keyframes.filter((keyframe) => {
          const time = keyframe.time * duration
          return time >= selection.from && time <= selection.to
        })
        if (removed.length === 0) continue
        removedKeyframeCount += removed.length
        const removedIds = new Set(removed.map((keyframe) => keyframe.id))
        clip = replaceTrack(
          clip,
          selected.location,
          selected.data.keyframes.filter((keyframe) => !removedIds.has(keyframe.id)),
        )
      }
      updatedClips.set(clipId, clip)
    }

    for (const clip of updatedClips.values()) {
      const result = dispatch(new SetClipDefinitionCommand({ clip }))
      if (!result.ok) throw result.error
      records += 1
    }

    const bindingsChanged = Object.keys(bindings).some((semantic) => !(semantic in nextBindings))
    if (bindingsChanged) {
      const result = dispatch(
        new SetClipCollectionBindingsCommand({
          collectionId: selection.collectionId,
          bindings: nextBindings,
        }),
      )
      if (!result.ok) throw result.error
      records += 1
    }

    const candidates = new Set(memberClips)
    for (const clipId of candidates) {
      const stillBoundInCollection = Object.values(nextBindings).includes(clipId)
      if (
        stillBoundInCollection ||
        clipReferencedElsewhere(engine, selection.collectionId, clipId)
      ) {
        continue
      }
      const result = dispatch(new DeleteClipCommand({ clipId }))
      if (!result.ok) throw result.error
      records += 1
    }
    mergeUndoRecords(undoStack, records)
    return { ok: true, removedKeyframeCount, removedMemberCount }
  } catch (error) {
    mergeUndoRecords(undoStack, records)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
