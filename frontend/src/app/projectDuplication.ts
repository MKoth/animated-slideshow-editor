import type { LessonJSON } from '../engine'
import { newId } from '../engine/ids'
import { newClipId } from '../engine/clipDefinition'
import { newClipCollectionId } from '../engine/clipCollection'
import { newClipInstanceId } from '../engine/clipInstance'
import { newCollectionPlacementId } from '../engine/collectionPlacement'
import { newKeyframeId } from '../engine/keyframe'
import { newAudioClipId } from '../engine/audioClip'
import { newPrompterPartId, newAudioSegmentId } from '../engine/prompter'
import { validate } from '../engine/lessonSerializer'

export const DUPLICATE_FAILED_MESSAGE = 'Could not duplicate the project.'

export function getUniqueDuplicateName(baseName: string, existingNames: readonly string[]): string {
  const existing = new Set(existingNames)
  const copyName = `${baseName} (copy)`
  if (!existing.has(copyName)) return copyName
  let counter = 2
  while (true) {
    const candidate = `${baseName} (copy ${counter})`
    if (!existing.has(candidate)) return candidate
    counter += 1
  }
}

export function duplicateLessonJSON(
  original: LessonJSON,
  existingNames: readonly string[],
): LessonJSON {
  const clone = JSON.parse(JSON.stringify(original)) as LessonJSONMutable
  const now = new Date().toISOString()

  const slideIdMap = new Map<string, string>()
  const sceneIdMap = new Map<string, string>()
  const nodeIdMap = new Map<string, string>()
  const shapeIdMapPerOldNode = new Map<string, Map<string, string>>()
  const categoryIdMapPerOldNode = new Map<string, Map<string, string>>()
  const audioClipIdMap = new Map<string, string>()
  const prompterPartIdMap = new Map<string, string>()
  const audioSegmentIdMap = new Map<string, string>()
  const clipIdMap = new Map<string, string>()
  const collectionIdMap = new Map<string, string>()
  const placementIdMap = new Map<string, string>()
  const clipInstanceIdMap = new Map<string, string>()
  const ikChainIdMap = new Map<string, string>()
  const constraintIdMap = new Map<string, string>()

  clone.project.id = newId('project')
  clone.project.name = getUniqueDuplicateName(original.project.name, existingNames)
  clone.project.createdAt = now
  clone.project.modifiedAt = now

  for (const slide of clone.slides) {
    slideIdMap.set(slide.id, newId('slide'))
    if (slide.scene) {
      sceneIdMap.set(slide.scene.id, newId('scene'))
      for (const node of slide.scene.nodes as MutableNodeJSON[]) {
        nodeIdMap.set(node.id, newId('node'))
        const meshComp = (node.components as Record<string, unknown>)?.mesh as
          Record<string, unknown> | undefined
        if (meshComp) {
          const shapes = meshComp.shapes as unknown[] | undefined
          if (Array.isArray(shapes) && shapes.length > 0) {
            const m = new Map<string, string>()
            for (const s of shapes) {
              const rec = s as Record<string, unknown>
              const oldId = rec.id as string
              if (typeof oldId === 'string' && oldId !== '') m.set(oldId, newId('shape'))
            }
            if (m.size > 0) shapeIdMapPerOldNode.set(node.id, m)
          }
          const cats = meshComp.shapeCategories as unknown[] | undefined
          if (Array.isArray(cats) && cats.length > 0) {
            const m = new Map<string, string>()
            for (const c of cats) {
              const rec = c as Record<string, unknown>
              const oldId = rec.id as string
              if (typeof oldId === 'string' && oldId !== '') m.set(oldId, newId('shapeCategory'))
            }
            if (m.size > 0) categoryIdMapPerOldNode.set(node.id, m)
          }
        }
      }
      if (slide.audio?.clips) {
        for (const clip of slide.audio.clips as Record<string, unknown>[]) {
          const oldId = clip.id as string
          if (typeof oldId === 'string') audioClipIdMap.set(oldId, newAudioClipId())
        }
      }
      if (slide.prompter?.parts) {
        for (const part of slide.prompter.parts as Record<string, unknown>[]) {
          const oldId = part.id as string
          if (typeof oldId === 'string') prompterPartIdMap.set(oldId, newPrompterPartId())
          const segs = part.segments as unknown[] | undefined
          if (Array.isArray(segs)) {
            for (const seg of segs as Record<string, unknown>[]) {
              const sid = seg.id as string
              if (typeof sid === 'string') audioSegmentIdMap.set(sid, newAudioSegmentId())
            }
          }
        }
      }
    }
  }

  for (const slide of clone.slides) {
    for (const node of slide.scene.nodes as MutableNodeJSON[]) {
      if (Array.isArray(node.clipInstances)) {
        for (const inst of node.clipInstances as Record<string, unknown>[]) {
          const oldId = inst.id as string
          if (typeof oldId === 'string' && !clipInstanceIdMap.has(oldId))
            clipInstanceIdMap.set(oldId, newClipInstanceId())
        }
      }
      const placements = (node as Record<string, unknown>).collectionPlacements as
        unknown[] | undefined
      if (Array.isArray(placements)) {
        for (const p of placements as Record<string, unknown>[]) {
          const oldId = p.id as string
          if (typeof oldId === 'string' && !placementIdMap.has(oldId))
            placementIdMap.set(oldId, newCollectionPlacementId())
        }
      }
    }
  }

  const collectClipIds = (arr: unknown[] | undefined) => {
    if (!Array.isArray(arr)) return
    for (const c of arr as Record<string, unknown>[]) {
      const oldId = c.id as string
      if (typeof oldId === 'string' && !clipIdMap.has(oldId)) clipIdMap.set(oldId, newClipId())
    }
  }
  collectClipIds(clone.clips as unknown[] | undefined)
  collectClipIds(
    (clone.library as Record<string, unknown> | undefined)?.clips as unknown[] | undefined,
  )
  const collectCollectionIds = (arr: unknown[] | undefined) => {
    if (!Array.isArray(arr)) return
    for (const c of arr as Record<string, unknown>[]) {
      const oldId = c.id as string
      if (typeof oldId === 'string' && !collectionIdMap.has(oldId))
        collectionIdMap.set(oldId, newClipCollectionId())
    }
  }
  collectCollectionIds(clone.clipCollections as unknown[] | undefined)
  collectCollectionIds(
    (clone.library as Record<string, unknown> | undefined)?.clipCollections as
      unknown[] | undefined,
  )

  if (clone.ikChains?.chains) {
    for (const chain of clone.ikChains.chains as Record<string, unknown>[]) {
      const oldId = chain.id as string
      if (typeof oldId === 'string') ikChainIdMap.set(oldId, newId('ikChain'))
    }
  }
  if (clone.constraints?.nodeConstraints) {
    for (const [, list] of Object.entries(
      clone.constraints.nodeConstraints as Record<string, unknown[]>,
    )) {
      for (const c of list as Record<string, unknown>[]) {
        const oldId = c.id as string
        if (typeof oldId === 'string') constraintIdMap.set(oldId, newId('constraint'))
      }
    }
  }

  for (const slide of clone.slides) {
    const newSlideId = slideIdMap.get(slide.id)
    if (newSlideId) slide.id = newSlideId
    if (slide.scene) {
      const newSceneId = sceneIdMap.get(slide.scene.id)
      if (newSceneId) slide.scene.id = newSceneId
    }
  }

  for (const slide of clone.slides) {
    for (const node of slide.scene.nodes as MutableNodeJSON[]) {
      const oldIdForShapeLookup = node.id
      const newNodeId = nodeIdMap.get(node.id)
      if (newNodeId) node.id = newNodeId
      if (node.parentId !== null && typeof node.parentId === 'string') {
        const mapped = nodeIdMap.get(node.parentId)
        if (mapped) node.parentId = mapped
      }
      const comps = node.components as Record<string, unknown>
      if (comps && typeof comps.mesh === 'object' && comps.mesh !== null) {
        let meshComp = comps.mesh as Record<string, unknown>
        if (Array.isArray(meshComp.shapeCategories)) {
          const catMap = categoryIdMapPerOldNode.get(oldIdForShapeLookup)
          if (catMap) {
            const newCats = (meshComp.shapeCategories as unknown[]).map((c) => {
              const rec = c as Record<string, unknown>
              const oldCid = rec.id as string
              const newCid = catMap.get(oldCid) ?? oldCid
              let newParent = rec.parentId as string | null
              if (newParent !== null && catMap.has(newParent)) newParent = catMap.get(newParent)!
              return { ...rec, id: newCid, parentId: newParent }
            })
            meshComp = { ...meshComp, shapeCategories: newCats }
            comps.mesh = meshComp
          }
        }
        if (Array.isArray(meshComp.shapes)) {
          const shapeMap = shapeIdMapPerOldNode.get(oldIdForShapeLookup)
          const catMap = categoryIdMapPerOldNode.get(oldIdForShapeLookup)
          if (shapeMap || catMap) {
            const newShapes = (meshComp.shapes as unknown[]).map((s) => {
              const rec = s as Record<string, unknown>
              const oldSid = rec.id as string
              const newSid = shapeMap?.get(oldSid) ?? oldSid
              let newCat = (rec.categoryId as string | null | undefined) ?? null
              if (newCat !== null && catMap?.has(newCat)) newCat = catMap.get(newCat)!
              const base: Record<string, unknown> = { ...rec, id: newSid }
              if (newCat !== (rec.categoryId ?? null)) base.categoryId = newCat
              if (base.categoryId === null && rec.categoryId === undefined)
                delete (base as Record<string, unknown>).categoryId
              return base
            })
            meshComp = { ...meshComp, shapes: newShapes }
            comps.mesh = meshComp
          }
        }
        const mesh = meshComp.mesh as Record<string, unknown> | undefined
        if (mesh) {
          let newMesh: Record<string, unknown> | null = null
          if (Array.isArray(mesh.boneWeights)) {
            const newWeights = (mesh.boneWeights as unknown[]).map((arr) => {
              if (!Array.isArray(arr)) return arr
              return (arr as unknown[]).map((entry) => {
                if (
                  typeof entry !== 'object' ||
                  entry === null ||
                  typeof (entry as Record<string, unknown>).boneId !== 'string'
                )
                  return entry
                const oldBoneId = (entry as Record<string, unknown>).boneId as string
                return {
                  ...(entry as Record<string, unknown>),
                  boneId: nodeIdMap.get(oldBoneId) ?? oldBoneId,
                }
              })
            })
            newMesh = { ...(mesh as Record<string, unknown>), boneWeights: newWeights }
          }
          if (
            mesh.bindPose !== null &&
            typeof mesh.bindPose === 'object' &&
            !Array.isArray(mesh.bindPose)
          ) {
            const oldBind = mesh.bindPose as Record<string, unknown>
            const newBind: Record<string, unknown> = {}
            for (const [boneId, transform] of Object.entries(oldBind)) {
              newBind[nodeIdMap.get(boneId) ?? boneId] = transform
            }
            if (!newMesh) newMesh = { ...(mesh as Record<string, unknown>) }
            newMesh.bindPose = newBind
          }
          if (newMesh) {
            meshComp = { ...meshComp, mesh: newMesh }
            comps.mesh = meshComp
          }
        }
      }
      if (Array.isArray(node.clipInstances)) {
        for (const inst of node.clipInstances as Record<string, unknown>[]) {
          const oldIId = inst.id as string
          const newIId = clipInstanceIdMap.get(oldIId)
          if (newIId) inst.id = newIId
          const oldClipId = inst.clipId as string
          if (typeof oldClipId === 'string') {
            const newClip = clipIdMap.get(oldClipId)
            if (newClip) inst.clipId = newClip
          }
          if (typeof inst.placementId === 'string') {
            const mapped = placementIdMap.get(inst.placementId as string)
            if (mapped) inst.placementId = mapped
          }
        }
      }
      const placements = (node as Record<string, unknown>).collectionPlacements as
        unknown[] | undefined
      if (Array.isArray(placements)) {
        for (const p of placements as Record<string, unknown>[]) {
          const oldPid = p.id as string
          const newPid = placementIdMap.get(oldPid)
          if (newPid) p.id = newPid
          const oldCid = p.collectionId as string
          if (typeof oldCid === 'string') {
            const newCid = collectionIdMap.get(oldCid)
            if (newCid) p.collectionId = newCid
          }
          const oldParent = p.parentNodeId as string
          if (typeof oldParent === 'string') {
            const newParent = nodeIdMap.get(oldParent)
            if (newParent) p.parentNodeId = newParent
          }
        }
      }
    }
  }

  for (const slide of clone.slides) {
    const anim = slide.animation as Record<string, unknown> | undefined
    if (!anim || !Array.isArray((anim as Record<string, unknown>).nodes)) continue
    for (const nodeAnim of (anim as { nodes: Record<string, unknown>[] }).nodes) {
      const oldNodeId = nodeAnim.nodeId as string
      if (typeof oldNodeId === 'string') {
        const newNodeId = nodeIdMap.get(oldNodeId)
        if (newNodeId) nodeAnim.nodeId = newNodeId
      }
      const remapKeyframes = (arr: unknown[] | undefined) => {
        if (!Array.isArray(arr)) return
        for (const kf of arr as Record<string, unknown>[]) kf.id = newKeyframeId()
      }
      for (const track of (nodeAnim.tracks as unknown[] | undefined) ?? [])
        remapKeyframes((track as Record<string, unknown>).keyframes as unknown[] | undefined)
      for (const track of (nodeAnim.materialTracks as unknown[] | undefined) ?? [])
        remapKeyframes((track as Record<string, unknown>).keyframes as unknown[] | undefined)
      for (const track of (nodeAnim.dataLabelTracks as unknown[] | undefined) ?? [])
        remapKeyframes((track as Record<string, unknown>).keyframes as unknown[] | undefined)
      for (const track of ((nodeAnim as Record<string, unknown>).circleTracks as
        unknown[] | undefined) ?? [])
        remapKeyframes((track as Record<string, unknown>).keyframes as unknown[] | undefined)
      for (const track of ((nodeAnim as Record<string, unknown>).tableTracks as
        unknown[] | undefined) ?? [])
        remapKeyframes((track as Record<string, unknown>).keyframes as unknown[] | undefined)
      for (const track of ((nodeAnim as Record<string, unknown>).shadowTracks as
        unknown[] | undefined) ?? [])
        remapKeyframes((track as Record<string, unknown>).keyframes as unknown[] | undefined)
      if ((nodeAnim as Record<string, unknown>).visibleTrack)
        remapKeyframes(
          ((nodeAnim as Record<string, unknown>).visibleTrack as Record<string, unknown>)
            .keyframes as unknown[] | undefined,
        )
      if ((nodeAnim as Record<string, unknown>).morphTrack)
        remapKeyframes(
          ((nodeAnim as Record<string, unknown>).morphTrack as Record<string, unknown>)
            .keyframes as unknown[] | undefined,
        )
      if ((nodeAnim as Record<string, unknown>).symmetryTrack)
        remapKeyframes(
          ((nodeAnim as Record<string, unknown>).symmetryTrack as Record<string, unknown>)
            .keyframes as unknown[] | undefined,
        )
      if ((nodeAnim as Record<string, unknown>).zIndexTrack)
        remapKeyframes(
          ((nodeAnim as Record<string, unknown>).zIndexTrack as Record<string, unknown>)
            .keyframes as unknown[] | undefined,
        )
      const morphBinding = (nodeAnim as Record<string, unknown>).morphBinding as
        Record<string, unknown> | null | undefined
      if (morphBinding && typeof morphBinding === 'object') {
        const oldFrom = morphBinding.fromShapeId as string | null
        const oldTo = morphBinding.toShapeId as string | null
        const shapeMap =
          typeof oldNodeId === 'string' ? shapeIdMapPerOldNode.get(oldNodeId) : undefined
        if (oldFrom !== null && typeof oldFrom === 'string' && shapeMap?.has(oldFrom))
          morphBinding.fromShapeId = shapeMap.get(oldFrom)!
        if (oldTo !== null && typeof oldTo === 'string' && shapeMap?.has(oldTo))
          morphBinding.toShapeId = shapeMap.get(oldTo)!
      }
      const morphTrack = (nodeAnim as Record<string, unknown>).morphTrack as
        Record<string, unknown> | undefined
      if (morphTrack && Array.isArray(morphTrack.keyframes)) {
        const shapeMap =
          typeof oldNodeId === 'string' ? shapeIdMapPerOldNode.get(oldNodeId) : undefined
        if (shapeMap) {
          for (const kf of morphTrack.keyframes as Record<string, unknown>[]) {
            const val = kf.value as unknown
            if (typeof val === 'object' && val !== null) {
              const rec = val as Record<string, unknown>
              if ('fromShapeId' in rec || 'toShapeId' in rec) {
                const oldF = rec.fromShapeId as string | null
                const oldT = rec.toShapeId as string | null
                if (oldF !== null && typeof oldF === 'string' && shapeMap.has(oldF))
                  (rec as Record<string, unknown>).fromShapeId = shapeMap.get(oldF)!
                if (oldT !== null && typeof oldT === 'string' && shapeMap.has(oldT))
                  (rec as Record<string, unknown>).toShapeId = shapeMap.get(oldT)!
              }
            }
          }
        }
      }
    }
  }

  for (const slide of clone.slides) {
    if (slide.audio?.clips) {
      for (const clip of slide.audio.clips as Record<string, unknown>[]) {
        const newIdVal = audioClipIdMap.get(clip.id as string)
        if (newIdVal) clip.id = newIdVal
      }
    }
    if (slide.prompter?.parts) {
      for (const part of slide.prompter.parts as Record<string, unknown>[]) {
        const newPartId = prompterPartIdMap.get(part.id as string)
        if (newPartId) part.id = newPartId
        if (typeof part.audioClipId === 'string') {
          const mapped = audioClipIdMap.get(part.audioClipId as string)
          if (mapped) part.audioClipId = mapped
        }
        const segs = part.segments as unknown[] | undefined
        if (Array.isArray(segs)) {
          for (const seg of segs as Record<string, unknown>[]) {
            const newSegId = audioSegmentIdMap.get(seg.id as string)
            if (newSegId) seg.id = newSegId
            if (typeof seg.audioClipId === 'string') {
              const mapped = audioClipIdMap.get(seg.audioClipId as string)
              if (mapped) seg.audioClipId = mapped
            }
          }
        }
      }
    }
  }

  const rewriteClipArray = (arr: unknown[] | undefined) => {
    if (!Array.isArray(arr)) return
    for (const clip of arr as Record<string, unknown>[]) {
      const newIdVal = clipIdMap.get(clip.id as string)
      if (newIdVal) clip.id = newIdVal
      const channelAnimations = clip.channelAnimations as Record<string, unknown> | undefined
      if (channelAnimations)
        for (const anim of Object.values(channelAnimations) as Record<string, unknown>[])
          if (Array.isArray((anim as Record<string, unknown>).keyframes))
            for (const kf of (anim as Record<string, unknown>).keyframes as Record<
              string,
              unknown
            >[])
              kf.id = newKeyframeId()
      const matAnims = clip.materialChannelAnimations as Record<string, unknown> | undefined
      if (matAnims)
        for (const anim of Object.values(matAnims) as Record<string, unknown>[])
          if (Array.isArray((anim as Record<string, unknown>).keyframes))
            for (const kf of (anim as Record<string, unknown>).keyframes as Record<
              string,
              unknown
            >[])
              kf.id = newKeyframeId()
      const visibleAnim = clip.visibleAnimation as Record<string, unknown> | undefined
      if (visibleAnim && Array.isArray(visibleAnim.keyframes))
        for (const kf of visibleAnim.keyframes as Record<string, unknown>[]) kf.id = newKeyframeId()
      const circleAnims = clip.circleChannelAnimations as Record<string, unknown> | undefined
      if (circleAnims)
        for (const anim of Object.values(circleAnims) as Record<string, unknown>[])
          if (Array.isArray((anim as Record<string, unknown>).keyframes))
            for (const kf of (anim as Record<string, unknown>).keyframes as Record<
              string,
              unknown
            >[])
              kf.id = newKeyframeId()
      const morphAnim = clip.morphAnimation as Record<string, unknown> | undefined
      if (morphAnim && Array.isArray(morphAnim.keyframes))
        for (const kf of morphAnim.keyframes as Record<string, unknown>[]) kf.id = newKeyframeId()
      const shadowAnims = clip.shadowChannelAnimations as Record<string, unknown> | undefined
      if (shadowAnims)
        for (const anim of Object.values(shadowAnims) as Record<string, unknown>[])
          if (Array.isArray((anim as Record<string, unknown>).keyframes))
            for (const kf of (anim as Record<string, unknown>).keyframes as Record<
              string,
              unknown
            >[])
              kf.id = newKeyframeId()
    }
  }
  rewriteClipArray(clone.clips as unknown[] | undefined)
  if (clone.library?.clips) rewriteClipArray(clone.library.clips as unknown[] | undefined)

  const rewriteCollectionArray = (arr: unknown[] | undefined) => {
    if (!Array.isArray(arr)) return
    for (const col of arr as Record<string, unknown>[]) {
      const newIdVal = collectionIdMap.get(col.id as string)
      if (newIdVal) col.id = newIdVal
      const bindings = col.bindings as Record<string, unknown> | undefined
      if (bindings)
        for (const [sem, clipId] of Object.entries(bindings)) {
          const mapped = clipIdMap.get(clipId as string)
          if (mapped) bindings[sem] = mapped
        }
      if (typeof col.sourceNodeId === 'string') {
        const mapped = nodeIdMap.get(col.sourceNodeId as string)
        if (mapped) col.sourceNodeId = mapped
      }
    }
  }
  rewriteCollectionArray(clone.clipCollections as unknown[] | undefined)
  if (clone.library?.clipCollections)
    rewriteCollectionArray(clone.library.clipCollections as unknown[] | undefined)

  if (clone.ikChains) {
    const newSlidesMap: Record<string, readonly string[]> = {}
    for (const [oldSlideId, chainIds] of Object.entries(
      (clone.ikChains.slides ?? {}) as Record<string, readonly string[]>,
    )) {
      const newSlideId = slideIdMap.get(oldSlideId) ?? oldSlideId
      newSlidesMap[newSlideId] = chainIds.map(
        (cid) => ikChainIdMap.get(cid as string) ?? (cid as string),
      )
    }
    clone.ikChains.slides = newSlidesMap
    for (const chain of clone.ikChains.chains as Record<string, unknown>[]) {
      const newCid = ikChainIdMap.get(chain.id as string)
      if (newCid) chain.id = newCid
      if (typeof chain.slideId === 'string') {
        const mapped = slideIdMap.get(chain.slideId as string)
        if (mapped) chain.slideId = mapped
      }
      if (Array.isArray(chain.boneIds))
        chain.boneIds = (chain.boneIds as string[]).map((bid) => nodeIdMap.get(bid) ?? bid)
      if (chain.target && typeof (chain.target as Record<string, unknown>).nodeId === 'string') {
        const mapped = nodeIdMap.get((chain.target as Record<string, unknown>).nodeId as string)
        if (mapped) (chain.target as Record<string, unknown>).nodeId = mapped
      }
      if (
        chain.poleTarget &&
        typeof (chain.poleTarget as Record<string, unknown>).nodeId === 'string'
      ) {
        const mapped = nodeIdMap.get((chain.poleTarget as Record<string, unknown>).nodeId as string)
        if (mapped) (chain.poleTarget as Record<string, unknown>).nodeId = mapped
      }
      if (typeof chain.ghostNodeId === 'string') {
        const mapped = nodeIdMap.get(chain.ghostNodeId as string)
        if (mapped) chain.ghostNodeId = mapped
      }
      if (typeof chain.poleGhostNodeId === 'string') {
        const mapped = nodeIdMap.get(chain.poleGhostNodeId as string)
        if (mapped) chain.poleGhostNodeId = mapped
      }
    }
  }

  if (clone.constraints?.nodeConstraints) {
    const oldMap = clone.constraints.nodeConstraints as unknown as Record<
      string,
      readonly unknown[]
    >
    const newMap: Record<string, unknown[]> = {}
    for (const [oldNodeId, list] of Object.entries(oldMap)) {
      const newNodeId = nodeIdMap.get(oldNodeId) ?? oldNodeId
      const newList: unknown[] = []
      for (const c of list as unknown as Record<string, unknown>[]) {
        const newCid = constraintIdMap.get(c.id as string) ?? (c.id as string)
        const newC: Record<string, unknown> = { ...c, id: newCid }
        const params = newC.params as Record<string, unknown> | undefined
        if (params && typeof params.targetNodeId === 'string') {
          const mapped = nodeIdMap.get(params.targetNodeId as string)
          if (mapped) params.targetNodeId = mapped
        }
        newList.push(newC)
      }
      newMap[newNodeId] = newList
    }
    ;(
      clone.constraints as unknown as { nodeConstraints: Record<string, unknown[]> }
    ).nodeConstraints = newMap
  }

  const errors = validate(clone as unknown as LessonJSON)
  if (errors.length > 0) throw new Error(errors.join('; '))
  return clone as unknown as LessonJSON
}

type MutableNodeJSON = {
  id: string
  parentId: string | null
  name: string
  components: Record<string, unknown>
  clipInstances?: Record<string, unknown>[]
  visible?: boolean
  opacity?: number
  zIndex?: number
  material?: unknown
  transform?: unknown
  localPivot?: unknown
  castShadow?: boolean
  shadowEffect?: unknown
}

type LessonJSONMutable = LessonJSON & {
  project: {
    id: string
    name: string
    description: string
    author: string
    createdAt: string
    modifiedAt: string
    settings?: Record<string, unknown>
  }
  slides: (LessonJSON['slides'][number] & {
    id: string
    scene: { id: string; nodes: MutableNodeJSON[] }
    animation?: Record<string, unknown>
    audio?: { clips: Record<string, unknown>[] }
    prompter?: { parts: Record<string, unknown>[] }
  })[]
  clips?: unknown[]
  clipCollections?: unknown[]
  library?: Record<string, unknown> & { clips?: unknown[]; clipCollections?: unknown[] }
  ikChains?: { slides: Record<string, readonly string[]>; chains: Record<string, unknown>[] }
  constraints?: { nodeConstraints: Record<string, unknown[]> }
}
