import type { EnginePublic } from '../engine'
import type { ExtractableKeyframe } from '../engine/clipExtraction'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import { snapshotOf } from '../engine/keyframe'
import {
  keyframeRefsOfScene,
  circleKeyframeRefsOfScene,
  visibleKeyframeRefsOfScene,
  morphKeyframeRefsOfScene,
} from './keyframeSelectionActions'
import type { KeyframeTarget } from '../engine/keyframeTarget'

function allRefsForExtraction(engine: EnginePublic): { target: KeyframeTarget; keyframe: import('../engine/keyframe').Keyframe }[] {
  const results: { target: KeyframeTarget; keyframe: import('../engine/keyframe').Keyframe }[] = []
  for (const slide of engine.project?.slides ?? []) {
    const scene = slide.scene
    // property
    for (const ref of keyframeRefsOfScene(engine, scene)) {
      const kfs = engine.getKeyframes(ref.nodeId, ref.property)
      const kf = kfs.find((k) => k.id === ref.keyframeId)
      if (kf) results.push({ target: { kind: 'node', nodeId: ref.nodeId, property: ref.property }, keyframe: kf })
    }
    // material - skip for extraction (clip material channels are separate but we could include)
    // For now, skip material extraction as spec says uniform-six + visible + circle
    // visible
    for (const ref of visibleKeyframeRefsOfScene(engine, scene)) {
      const kfs = engine.getVisibleKeyframes(ref.nodeId)
      const kf = kfs.find((k) => k.id === ref.keyframeId)
      if (kf) results.push({ target: { kind: 'visible', nodeId: ref.nodeId }, keyframe: kf })
    }
    // circle
    for (const ref of circleKeyframeRefsOfScene(engine, scene)) {
      const kfs = engine.getCircleKeyframes(ref.nodeId, ref.property)
      const kf = kfs.find((k) => k.id === ref.keyframeId)
      if (kf) results.push({ target: { kind: 'circle', nodeId: ref.nodeId, property: ref.property }, keyframe: kf })
    }
    // morph
    for (const ref of morphKeyframeRefsOfScene(engine, scene)) {
      const kfs = engine.getMorphKeyframes(ref.nodeId)
      const kf = kfs.find((k) => k.id === ref.keyframeId)
      if (kf) results.push({ target: { kind: 'morph', nodeId: ref.nodeId }, keyframe: kf })
    }
    // Also dataLabel/table? Skip for now
  }
  return results
}

export function collectSelectedExtractableKeyframes(engine: EnginePublic): ExtractableKeyframe[] {
  const selectedIds = new Set(selectedKeyframeIdsOf(useTimelineSelectionStore.getState()))
  if (selectedIds.size === 0) return []
  const all = allRefsForExtraction(engine)
  const extractable: ExtractableKeyframe[] = []
  for (const { target, keyframe } of all) {
    if (selectedIds.has(keyframe.id)) {
      const snap = snapshotOf(keyframe)
      extractable.push({
        target,
        time: snap.time,
        value: snap.value,
        interpolation: snap.interpolation,
        tangentIn: { time: snap.tangentIn.time, value: snap.tangentIn.value },
        tangentOut: { time: snap.tangentOut.time, value: snap.tangentOut.value },
        keyframeId: keyframe.id,
      })
    }
  }
  return extractable
}

export function collectExtractableForSingle(
  engine: EnginePublic,
  target: KeyframeTarget,
  keyframeId: string,
): ExtractableKeyframe | null {
  let kf: import('../engine/keyframe').Keyframe | undefined
  if (target.kind === 'node' && 'property' in target) {
    kf = engine.getKeyframes(target.nodeId, target.property).find((k) => k.id === keyframeId)
  } else if (target.kind === 'visible') {
    kf = engine.getVisibleKeyframes(target.nodeId).find((k) => k.id === keyframeId)
  } else if (target.kind === 'morph') {
    kf = engine.getMorphKeyframes(target.nodeId).find((k) => k.id === keyframeId)
  } else if (target.kind === 'circle') {
    kf = engine.getCircleKeyframes(target.nodeId, target.property).find((k) => k.id === keyframeId)
  } else if (target.kind === 'node' && 'parameter' in target) {
    kf = engine.getMaterialKeyframes(target.nodeId, target.parameter).find((k) => k.id === keyframeId)
  } else {
    return null
  }
  if (!kf) return null
  const snap = snapshotOf(kf)
  return {
    target,
    time: snap.time,
    value: snap.value,
    interpolation: snap.interpolation,
    tangentIn: { time: snap.tangentIn.time, value: snap.tangentIn.value },
    tangentOut: { time: snap.tangentOut.time, value: snap.tangentOut.value },
    keyframeId,
  }
}
