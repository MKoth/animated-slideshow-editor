import type { EnginePublic } from './engine'
import { walkPreOrder } from './sceneNode'
import { compileAnimationScript, enginePropertyForScriptProperty } from './animationScriptCompiler'
import type {
  AnimationScriptKeyframeInfo,
  AnimationScriptCompileResult,
  AnimationScriptNodeInfo,
  ScriptProperty,
} from './animationScriptCompiler'

/**
 * The Animation Script Check seam: a pure function of `(source, slide state)`
 * that returns diagnostics, the prospective command output, and a footprint
 * summary. It reads the engine and dispatches nothing.
 */
export function checkAnimationScript(
  engine: EnginePublic,
  slideId: string,
  source: string,
): AnimationScriptCompileResult {
  const slide = engine.getSlide(slideId)
  const nodes: AnimationScriptNodeInfo[] = []
  for (const node of walkPreOrder(slide.scene.root)) {
    nodes.push({
      id: node.id,
      name: node.name,
      isBone: node.components.bone !== undefined,
      isCamera: node.components.camera !== undefined,
    })
  }
  return compileAnimationScript(source, {
    slideDuration: slide.duration,
    nodes,
    evaluateProperty: (nodeId, property, time) => evaluateProperty(engine, nodeId, property, time),
    keyframesOf: (nodeId, property) => keyframesOf(engine, nodeId, property),
  })
}

function evaluateProperty(
  engine: EnginePublic,
  nodeId: string,
  property: ScriptProperty,
  time: number,
): number {
  if (property === 'zIndex') {
    return engine.evaluateZIndex(nodeId, time)
  }
  const state = engine.evaluateNode(nodeId, time)
  switch (property) {
    case 'x':
      return state.transform.x
    case 'y':
      return state.transform.y
    case 'rotation':
      return state.transform.rotation
    case 'scaleX':
      return state.transform.scaleX
    case 'scaleY':
      return state.transform.scaleY
    case 'opacity':
      return state.opacity
  }
}

function keyframesOf(
  engine: EnginePublic,
  nodeId: string,
  property: ScriptProperty,
): readonly AnimationScriptKeyframeInfo[] {
  const keyframes =
    property === 'zIndex'
      ? engine.getZIndexKeyframes(nodeId)
      : engine.getKeyframes(nodeId, enginePropertyForScriptProperty(property))
  return keyframes.map((keyframe) => ({
    id: keyframe.id,
    time: keyframe.time,
    value: keyframe.value as number,
    interpolation: keyframe.interpolation,
    tangentIn: keyframe.tangentIn,
    tangentOut: keyframe.tangentOut,
  }))
}
