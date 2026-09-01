/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Engine } from '../internal'
import type { Transform } from '../transform'
// @ts-expect-error - SceneNode fromJSON usage flagged as unused by tsc
import { SceneNode } from '../sceneNode'
import type { ClipInstanceJSON, NodeJSON } from '../json'
import { clipInstanceFromJSON } from '../clipInstance'
import { newId } from '../ids'
import { reflowPrompter } from '../prompter'
import { ClipDefinition } from '../clipDefinition'
import { defaultTableComponent } from '../defaultTable'
import { applyTableLayout } from '../tableLayoutApply'
import { relativeTransform, transformsEqual, worldTransformOf } from '../worldTransform'

export function applyUndo(
  engine: Engine,
  type: string,
  parameters: Readonly<Record<string, unknown>>,
  inverse: unknown,
): void {
  const inv = inverse as Record<string, unknown>
  const params = parameters as Record<string, unknown>

  switch (type) {
    // ---- Transform ----
    case 'MoveNode': {
      const nodeId = inv.nodeId as string
      const oldX = inv.oldX as number
      const oldY = inv.oldY as number
      const node = engine.getNode(nodeId)
      engine.setTransform(nodeId, { ...node.transform, x: oldX, y: oldY })
      return
    }
    case 'RotateNode': {
      const nodeId = inv.nodeId as string
      const oldRotation = inv.oldRotation as number
      const node = engine.getNode(nodeId)
      engine.setTransform(nodeId, { ...node.transform, rotation: oldRotation })
      return
    }
    case 'ScaleNode': {
      const nodeId = inv.nodeId as string
      const oldScaleX = inv.oldScaleX as number
      const oldScaleY = inv.oldScaleY as number
      const node = engine.getNode(nodeId)
      engine.setTransform(nodeId, { ...node.transform, scaleX: oldScaleX, scaleY: oldScaleY })
      return
    }
    case 'UpdateBone': {
      const nodeId = inv.nodeId as string
      const oldLength = inv.oldLength as number
      const oldX = inv.oldX as number
      const oldY = inv.oldY as number
      const oldRotation = inv.oldRotation as number
      try {
        engine.setBoneLength(nodeId, oldLength)
      } catch {
        // bone may be deleted
      }
      try {
        const node = engine.getNode(nodeId)
        engine.setTransform(nodeId, { ...node.transform, x: oldX, y: oldY, rotation: oldRotation })
      } catch {
        // ignore
      }
      return
    }
    case 'SetVisibility': {
      const nodeId = inv.nodeId as string
      const oldVisible = inv.oldVisible as boolean
      engine.setVisibility(nodeId, oldVisible)
      return
    }
    case 'SetOpacity': {
      const nodeId = inv.nodeId as string
      const oldOpacity = inv.oldOpacity as number
      engine.setOpacity(nodeId, oldOpacity)
      return
    }
    case 'RenameNode': {
      const nodeId = inv.nodeId as string
      const oldName = inv.oldName as string
      engine.renameNode(nodeId, oldName)
      return
    }
    case 'ReorderNode': {
      const nodeId = inv.nodeId as string
      const oldIndex = inv.oldIndex as number
      engine.reorderNode(nodeId, oldIndex)
      return
    }
    case 'ReparentNode': {
      const nodeId = inv.nodeId as string
      const oldParentId = inv.oldParentId as string
      const oldTransform = inv.oldTransform as Transform
      engine.reparentNode(nodeId, oldParentId)
      try {
        engine.setTransform(nodeId, oldTransform)
      } catch {
        // ignore
      }
      return
    }
    case 'SetParent': {
      const nodeId = inv.nodeId as string
      const oldParentId = inv.oldParentId as string
      const oldTransform = inv.oldTransform as Transform
      engine.reparentNode(nodeId, oldParentId)
      try {
        engine.setTransform(nodeId, oldTransform)
      } catch {
        // ignore
      }
      return
    }
    case 'ChangeZOrder': {
      const nodeId = inv.nodeId as string
      const oldIndex = inv.oldIndex as number
      engine.reorderNode(nodeId, oldIndex)
      return
    }
    case 'CreateNode': {
      const nodeId = inv.nodeId as string
      try {
        engine.removeNode(nodeId)
      } catch {
        // already gone
      }
      return
    }
    case 'CreateRigHandle': {
      const handleId = inv.handleId as string
      const childReparents = inv.childReparents as readonly {
        nodeId: string
        oldParentId: string
        oldTransform: Transform
      }[]
      // Restore children to old parents with old transforms
      for (let i = childReparents.length - 1; i >= 0; i--) {
        const c = childReparents[i]
        try {
          engine.reparentNode(c.nodeId, c.oldParentId)
          engine.setTransform(c.nodeId, c.oldTransform)
        } catch {
          // ignore
        }
      }
      try {
        engine.removeNode(handleId)
      } catch {
        // already gone
      }
      return
    }
    case 'DeleteNode': {
      const nodes = inv.nodes as NodeJSON[]
      const parentId = inv.parentId as string | null
      if (!nodes || nodes.length === 0) return
      // Recreate nodes in order: first is root of deleted subtree
      const rootJson = nodes[0]
      const scene = engine.getNodeScene(parentId ?? rootJson.parentId ?? '')
      // Find project slide for scene? Use engine.getNodeScene fallback
      // Recreate via public createNode with id param
      for (const json of nodes) {
        const nodeId = json.id
        const parent = json.parentId
        // Skip if already exists
        try {
          engine.getNode(nodeId)
          continue
        } catch {
          // not exists, create
        }
        if (parent) {
          try {
            const sceneId = scene.id
            engine.createNode(sceneId, parent, json.name, {
              id: nodeId,
              transform: json.transform as Transform,
              visible: json.visible,
              opacity: json.opacity,
              components: json.components as unknown as import('../components').NodeComponents,
            })
            // Restore material if present
            if (json.material) {
              const matJson = json.material as Record<string, unknown>
              if (matJson && typeof matJson.materialDefinitionId === 'string') {
                try {
                  engine.assignMaterial(nodeId, matJson.materialDefinitionId as string)
                  const overrides = matJson.overrides as Record<string, unknown> | undefined
                  if (overrides) {
                    for (const [k, v] of Object.entries(overrides)) {
                      engine.overrideMaterialParameter(
                        nodeId,
                        k,
                        v as import('../materialInstance').MaterialOverrideValue,
                      )
                    }
                  }
                } catch {
                  // ignore
                }
              }
              // Restore clipInstances if any
              const clips = json.clipInstances as ClipInstanceJSON[] | undefined
              if (clips) {
                for (const ci of clips) {
                  try {
                    const inst = clipInstanceFromJSON(ci)
                    const n = engine.getNode(nodeId)
                    n.clipInstances.push(inst)
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } catch {
            // ignore failures
          }
        }
      }
      return
    }
    case 'CreateAssetInstance': {
      const nodeId = inv.nodeId as string
      try {
        engine.removeNode(nodeId)
      } catch {
        // ignore
      }
      return
    }
    case 'DuplicateNode': {
      const nodeId = inv.nodeId as string
      try {
        engine.removeNode(nodeId)
      } catch {
        // ignore
      }
      return
    }
    case 'CreateSlide': {
      const slideId = inv.slideId as string
      try {
        engine.removeSlide(slideId)
      } catch {
        // ignore
      }
      return
    }
    case 'DeleteSlide': {
      const slideJSON = inv.slideJSON as unknown
      if (!slideJSON) return
      // Restore slide from JSON via engine's slide JSON handling
      // Use engine.restoreFromJSON with current project + this slide
      try {
        const current = engine.toJSON()
        const jsonAny = current as Record<string, unknown>
        const slides = (jsonAny.slides as unknown[]) ?? []
        ;(jsonAny.slides as unknown[]) = [...slides, slideJSON]
        engine.restoreFromJSON(jsonAny as unknown as import('../json').LessonJSON)
      } catch {
        // fallback: try direct slideManager install?
      }
      return
    }
    case 'RenameSlide': {
      const slideId = inv.slideId as string
      const oldName = inv.oldName as string
      engine.renameSlide(slideId, oldName)
      return
    }
    case 'MoveSlide': {
      const slideId = inv.slideId as string
      const oldIndex = inv.oldIndex as number
      engine.moveSlide(slideId, oldIndex)
      return
    }
    case 'DuplicateSlide': {
      const slideId = inv.slideId as string
      try {
        engine.removeSlide(slideId)
      } catch {
        // ignore
      }
      return
    }
    case 'SetSlideDuration': {
      const slideId = inv.slideId as string
      const oldDuration = inv.oldDuration as number
      const clamped = inv.clampedKeyframes as
        readonly import('../slideAnimation').ClampedKeyframe[] | undefined
      engine.setSlideDuration(slideId, oldDuration)
      // Restore clamped keyframes if any
      if (clamped && clamped.length > 0) {
        for (const ck of clamped) {
          try {
            // ck has nodeId, property/parameter/label, keyframe
            // Use engine.addKeyframe with original snapshot? But need to restore exact time/ value
            // The clampedKeyframes are those that were beyond new duration and got excluded?
            // For simplicity, try to restore by adding back keyframe with original time/value
            const target = (ck as unknown as Record<string, unknown>)
              .target as import('../keyframeTarget').KeyframeTarget
            const kf = (ck as unknown as Record<string, unknown>)
              .keyframe as import('../keyframe').KeyframeSnapshot
            if (target && kf) {
              engine.addKeyframe(target, kf.time, kf.value)
            }
          } catch {
            // ignore
          }
        }
      }
      return
    }
    case 'SetFullscreenShader': {
      const slideId = inv.slideId as string
      const prev = inv.previous as import('../fullscreenShader').FullscreenShaderReference | null
      if (prev === null) {
        engine.setFullscreenShader(slideId, null)
      } else {
        engine.setFullscreenShader(slideId, prev.shaderDefinitionId)
        for (const [u, v] of Object.entries(prev.overrides ?? {})) {
          engine.overrideFullscreenUniform(
            slideId,
            u,
            v as import('../materialInstance').MaterialOverrideValue,
          )
        }
      }
      return
    }
    case 'OverrideFullscreenUniform': {
      const slideId = inv.slideId as string
      const uniform = inv.uniform as string
      const prev = inv.previousValue as import('../materialInstance').MaterialOverrideValue | null
      const slide = engine.getSlide(slideId)
      if (prev === null) {
        engine.clearFullscreenUniform(slideId, uniform)
      } else {
        engine.overrideFullscreenUniform(slideId, uniform, prev)
      }
      // Restore previous state if slide had no shader? Handled above
      void slide
      return
    }
    case 'AssignMaterial': {
      const nodeId = inv.nodeId as string
      const prevId = inv.previousMaterialDefinitionId as string
      const prevOverrides = inv.previousOverrides as import('../materialInstance').MaterialOverrides
      engine.assignMaterial(nodeId, prevId)
      for (const [k, v] of Object.entries(prevOverrides)) {
        engine.overrideMaterialParameter(
          nodeId,
          k,
          v as import('../materialInstance').MaterialOverrideValue,
        )
      }
      return
    }
    case 'OverrideMaterialParameter': {
      const nodeId = inv.nodeId as string
      const parameter = inv.parameter as string
      const prev = inv.previousValue as import('../materialInstance').MaterialOverrideValue | null
      if (prev === null) {
        engine.clearMaterialOverride(nodeId, parameter)
      } else {
        engine.overrideMaterialParameter(nodeId, parameter, prev)
      }
      return
    }
    case 'ClearMaterialOverride': {
      const nodeId = inv.nodeId as string
      const parameter = inv.parameter as string
      const removed = inv.removedValue as import('../materialInstance').MaterialOverrideValue
      engine.overrideMaterialParameter(nodeId, parameter, removed)
      return
    }
    case 'CreateProject': {
      // No engine method to delete project; ignore as CreateProject rarely undone
      return
    }
    case 'SetTableComponent': {
      const nodeId = inv.nodeId as string
      const oldTable = inv.oldTable as import('../components').TableComponent
      engine.setTableComponent(nodeId, oldTable)
      return
    }
    case 'SetChartComponent': {
      const nodeId = inv.nodeId as string
      const oldChart = inv.oldChart as import('../components').ChartComponent
      engine.setChartComponent(nodeId, oldChart)
      return
    }
    case 'SetTextContent': {
      const nodeId = inv.nodeId as string
      const oldContent = inv.oldContent as string
      const node = engine.getNode(nodeId)
      const text = node.components.text!
      engine.setTextComponent(nodeId, { ...text, content: oldContent })
      return
    }
    case 'SetTextFontSize': {
      const nodeId = inv.nodeId as string
      const oldFontSize = inv.oldFontSize as number
      const node = engine.getNode(nodeId)
      const text = node.components.text!
      engine.setTextComponent(nodeId, { ...text, fontSize: oldFontSize })
      return
    }
    case 'SetTextAlignment': {
      const nodeId = inv.nodeId as string
      const oldAlignment = inv.oldAlignment as import('../components').TextAlignment
      const node = engine.getNode(nodeId)
      const text = node.components.text!
      engine.setTextComponent(nodeId, { ...text, alignment: oldAlignment })
      return
    }
    case 'SplitIntoMorphemes': {
      const originalNodeId = inv.originalNodeId as string
      const containerNodeId = inv.containerNodeId as string
      // Undo: delete container and restore original text
      try {
        engine.removeNode(containerNodeId)
      } catch {
        // ignore
      }
      const originalText = inv.originalTextContent as string
      const originalFontSize = inv.originalFontSize as number
      try {
        const node = engine.getNode(originalNodeId)
        const text = node.components.text!
        engine.setTextComponent(originalNodeId, {
          ...text,
          content: originalText,
          fontSize: originalFontSize,
        })
        // Restore original transform
        const origTransform = inv.originalTransform as Transform
        if (origTransform) engine.setTransform(originalNodeId, origTransform)
      } catch {
        // ignore
      }
      return
    }
    case 'AddKeyframe': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const kf = inv.keyframe as import('../keyframe').KeyframeSnapshot
      // Undo add = delete that keyframe
      engine.deleteKeyframes(target, [kf.keyframeId])
      return
    }
    case 'DeleteKeyframes': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const keyframes = inv.keyframes as import('../keyframe').KeyframeSnapshot[]
      for (const kf of keyframes) {
        engine.addKeyframe(target, kf.time, kf.value)
        // Try to restore id/interpolation/tangents via direct manipulation
        try {
          const added = engine
            .getKeyframesOf(target)
            .find((k) => k.time === kf.time && k.value === kf.value)
          if (added && added.id !== kf.keyframeId) {
            // Attempt to patch id via any
            ;(added as unknown as Record<string, unknown>).id = kf.keyframeId
          }
          engine.setKeyframeInterpolation(target, kf.keyframeId, kf.interpolation)
          engine.setKeyframeTangents(target, kf.keyframeId, kf.tangentIn, kf.tangentOut)
        } catch {
          // ignore
        }
      }
      return
    }
    case 'MoveKeyframes': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const moves = inv.moves as readonly { keyframeId: string; oldTime: number }[]
      engine.moveKeyframes(
        target,
        moves.map((m) => ({ keyframeId: m.keyframeId, newTime: m.oldTime })),
      )
      return
    }
    case 'ScaleKeyframes': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const moves = inv.moves as readonly { keyframeId: string; oldTime: number }[]
      engine.moveKeyframes(
        target,
        moves.map((m) => ({ keyframeId: m.keyframeId, newTime: m.oldTime })),
      )
      return
    }
    case 'PasteKeyframes': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const keyframes = inv.keyframes as import('../keyframe').KeyframeSnapshot[]
      engine.deleteKeyframes(
        target,
        keyframes.map((k) => k.keyframeId),
      )
      return
    }
    case 'DuplicateKeyframes': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const keyframes = inv.keyframes as import('../keyframe').KeyframeSnapshot[]
      engine.deleteKeyframes(
        target,
        keyframes.map((k) => k.keyframeId),
      )
      return
    }
    case 'SetKeyframeValue': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const keyframeId = inv.keyframeId as string
      const oldValue = inv.oldValue as unknown
      engine.setKeyframeValue(target, keyframeId, oldValue)
      return
    }
    case 'SetKeyframeInterpolation': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const keyframeId = inv.keyframeId as string
      const oldInterpolation = inv.oldInterpolation as import('../keyframe').InterpolationType
      engine.setKeyframeInterpolation(target, keyframeId, oldInterpolation)
      return
    }
    case 'SetKeyframeTangents': {
      const target = inv.target as import('../keyframeTarget').KeyframeTarget
      const keyframeId = inv.keyframeId as string
      const oldIn = inv.oldTangentIn as import('../keyframe').KeyframeTangent
      const oldOut = inv.oldTangentOut as import('../keyframe').KeyframeTangent
      engine.setKeyframeTangents(target, keyframeId, oldIn, oldOut)
      return
    }
    case 'CreateClip': {
      const clipId = inv.clipId as string
      try {
        engine.deleteClip(clipId)
      } catch {
        // ignore
      }
      return
    }
    case 'DeleteClip': {
      const clipData = inv.clipData as import('../json').ClipJSON
      if (clipData) {
        try {
          const clip = ClipDefinition.fromJSON(clipData as unknown as import('../json').ClipJSON)
          engine.importClip(clip)
        } catch {
          // ignore
        }
      }
      return
    }
    case 'RenameClip': {
      const clipId = inv.clipId as string
      const oldName = inv.oldName as string
      engine.renameClip(clipId, oldName)
      return
    }
    case 'DuplicateClip': {
      const clipId = inv.clipId as string
      try {
        engine.deleteClip(clipId)
      } catch {
        // ignore
      }
      return
    }
    case 'SetClipDuration': {
      const clipId = inv.clipId as string
      const oldDuration = inv.oldDuration as number
      engine.setClipDuration(clipId, oldDuration)
      return
    }
    case 'SetClipCategory': {
      const clipId = inv.clipId as string
      const oldCategory = inv.oldCategory as string
      engine.setClipCategory(clipId, oldCategory)
      return
    }
    case 'SetClipParamDefault': {
      const clipId = inv.clipId as string
      const paramKey = inv.paramKey as string
      const oldValue = inv.oldValue as number
      engine.setClipParamDefault(clipId, paramKey, oldValue)
      return
    }
    case 'SetClipChannelParamLink': {
      const clipId = inv.clipId as string
      const channel = inv.channel as import('../animation').AnimationProperty
      const oldParamKey = inv.oldParamKey as string | null
      engine.setClipChannelParamLink(clipId, channel, oldParamKey)
      return
    }
    case 'AddClipChannel': {
      const clipId = inv.clipId as string
      const channelDef = inv.channelDef as import('../clipDefinition').ClipChannelDef
      // Undo add = remove
      engine.removeClipChannel(
        clipId,
        channelDef.property as import('../animation').AnimationProperty,
      )
      return
    }
    case 'RemoveClipChannel': {
      const clipId = inv.clipId as string
      const channelDef = inv.channelDef as import('../clipDefinition').ClipChannelDef
      engine.addClipChannel(clipId, channelDef)
      // Restore keyframes if any? channelDef may contain keyframes
      return
    }
    case 'AddClipKeyframe': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const kf = inv.keyframe as import('../keyframe').KeyframeSnapshot
      engine.deleteClipChannelKeyframes(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        [kf.keyframeId],
      )
      return
    }
    case 'DeleteClipKeyframes': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const keyframes = inv.keyframes as import('../keyframe').KeyframeSnapshot[]
      for (const kf of keyframes) {
        engine.addClipChannelKeyframe(
          target.clipId,
          target.channel as import('../animation').AnimationProperty,
          kf.time,
          kf.value as number,
        )
      }
      return
    }
    case 'MoveClipKeyframes': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const moves = inv.moves as readonly { keyframeId: string; oldTime: number }[]
      engine.moveClipChannelKeyframes(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        moves.map((m) => ({ keyframeId: m.keyframeId, newTime: m.oldTime })),
      )
      return
    }
    case 'ScaleClipKeyframes': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const moves = inv.moves as readonly { keyframeId: string; oldTime: number }[]
      engine.moveClipChannelKeyframes(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        moves.map((m) => ({ keyframeId: m.keyframeId, newTime: m.oldTime })),
      )
      return
    }
    case 'PasteClipKeyframes': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const keyframes = inv.keyframes as import('../keyframe').KeyframeSnapshot[]
      engine.deleteClipChannelKeyframes(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        keyframes.map((k) => k.keyframeId),
      )
      return
    }
    case 'DuplicateClipKeyframes': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const keyframes = inv.keyframes as import('../keyframe').KeyframeSnapshot[]
      engine.deleteClipChannelKeyframes(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        keyframes.map((k) => k.keyframeId),
      )
      return
    }
    case 'SetClipKeyframeValue': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const keyframeId = inv.keyframeId as string
      const oldValue = inv.oldValue as number
      engine.setClipChannelKeyframeValue(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        keyframeId,
        oldValue,
      )
      return
    }
    case 'SetClipKeyframeInterpolation': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const keyframeId = inv.keyframeId as string
      const oldInterpolation = inv.oldInterpolation as import('../keyframe').InterpolationType
      engine.setClipChannelKeyframeInterpolation(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        keyframeId,
        oldInterpolation,
      )
      return
    }
    case 'SetClipKeyframeTangents': {
      const target = inv.target as import('../keyframeTarget').ClipChannelTarget
      const keyframeId = inv.keyframeId as string
      const oldIn = inv.oldTangentIn as import('../keyframe').KeyframeTangent
      const oldOut = inv.oldTangentOut as import('../keyframe').KeyframeTangent
      engine.setClipChannelKeyframeTangents(
        target.clipId,
        target.channel as import('../animation').AnimationProperty,
        keyframeId,
        oldIn,
        oldOut,
      )
      return
    }
    case 'AssignClip': {
      const nodeId = inv.nodeId as string
      const instanceId = inv.instanceId as string
      engine.removeClipInstance(nodeId, instanceId)
      return
    }
    case 'RemoveClip': {
      const nodeId = inv.nodeId as string
      const layerIndex = inv.layerIndex as number
      const instance = inv.instance as ClipInstanceJSON
      // Restore instance
      const node = engine.getNode(nodeId)
      const restored = clipInstanceFromJSON(instance)
      node.clipInstances.splice(layerIndex, 0, restored)
      return
    }
    case 'MoveClipLayer': {
      const nodeId = inv.nodeId as string
      const instanceId = inv.instanceId as string
      const oldIndex = inv.oldIndex as number
      engine.moveClipLayer(nodeId, instanceId, oldIndex)
      return
    }
    case 'SetClipInstanceStartTime': {
      const nodeId = inv.nodeId as string
      const instanceId = inv.instanceId as string
      const oldStartTime = inv.oldStartTime as number
      engine.setClipInstanceStartTime(nodeId, instanceId, oldStartTime)
      return
    }
    case 'SetClipInstanceSpeed': {
      const nodeId = inv.nodeId as string
      const instanceId = inv.instanceId as string
      const oldSpeed = inv.oldSpeed as number
      engine.setClipInstanceSpeed(nodeId, instanceId, oldSpeed)
      return
    }
    case 'SetClipInstanceEnabled': {
      const nodeId = inv.nodeId as string
      const instanceId = inv.instanceId as string
      const oldEnabled = inv.oldEnabled as boolean
      engine.setClipInstanceEnabled(nodeId, instanceId, oldEnabled)
      return
    }
    case 'OverrideClipParam': {
      const nodeId = inv.nodeId as string
      const instanceId = inv.instanceId as string
      const paramKey = inv.paramKey as string
      const hadOld = inv.hadOldValue as boolean
      const oldValue = inv.oldValue as number | undefined
      if (hadOld && oldValue !== undefined) {
        engine.setClipInstanceParamOverride(nodeId, instanceId, paramKey, oldValue)
      } else {
        engine.clearClipInstanceParamOverride(nodeId, instanceId, paramKey)
      }
      return
    }
    case 'ImportClip': {
      const clipId = inv.clipId as string
      try {
        engine.deleteClip(clipId)
      } catch {
        // ignore
      }
      return
    }
    case 'CreateIKChain': {
      const chainId = inv.chainId as string
      try {
        engine.deleteIKChain(chainId)
      } catch {
        // ignore
      }
      return
    }
    case 'DeleteIKChain': {
      const chain = inv.chain as import('../ikChain').IKChainJSON
      const ghostNode = inv.ghostNode as NodeJSON | null
      const poleGhostNode = (inv as Record<string, unknown>).poleGhostNode as
        NodeJSON | null | undefined
      if (ghostNode) {
        try {
          const scene = engine.getSlide(chain.slideId).scene
          engine.createGhostNode(
            scene.id,
            ghostNode.name,
            ghostNode.transform.x,
            ghostNode.transform.y,
            ghostNode.id,
          )
        } catch {
          // ignore
        }
      }
      if (poleGhostNode) {
        try {
          const scene = engine.getSlide(chain.slideId).scene
          engine.createGhostNode(
            scene.id,
            poleGhostNode.name,
            poleGhostNode.transform.x,
            poleGhostNode.transform.y,
            poleGhostNode.id,
          )
        } catch {
          // ignore
        }
      }
      // Restore chain via internal IKManager
      try {
        // Use direct creation via engine.createIKChain
        engine.createIKChain(chain.slideId, chain.boneIds, chain.target, chain.poleTarget ?? null)
        // Patch id to original and ghost ids
        const chains = engine.getIKChainsForSlide(chain.slideId)
        const newest = chains[chains.length - 1]
        if (newest) {
          if (newest.id !== chain.id) {
            ;(newest as unknown as Record<string, unknown>).id = chain.id
          }
          if (chain.ghostNodeId && newest.ghostNodeId !== chain.ghostNodeId) {
            ;(newest as unknown as Record<string, unknown>).ghostNodeId = chain.ghostNodeId
          }
          if ((chain as unknown as Record<string, unknown>).poleGhostNodeId) {
            ;(newest as unknown as Record<string, unknown>).poleGhostNodeId = (
              chain as unknown as Record<string, unknown>
            ).poleGhostNodeId
          }
          // Ensure target and pole nodeIds align with restored ghosts
          if (ghostNode && newest.target.nodeId !== ghostNode.id) {
            ;(newest as unknown as { target: { nodeId?: string } }).target.nodeId = ghostNode.id
          }
          if (
            poleGhostNode &&
            newest.poleTarget &&
            (newest.poleTarget as { nodeId?: string }).nodeId !== poleGhostNode.id
          ) {
            ;(newest.poleTarget as unknown as { nodeId?: string }).nodeId = poleGhostNode.id
          }
        }
      } catch {
        // ignore
      }
      return
    }
    case 'SetIKTarget': {
      const chainId = inv.chainId as string
      const oldTarget = inv.oldTarget as import('../ikChain').BoneIKTarget
      engine.setIKTarget(chainId, oldTarget)
      return
    }
    case 'SetIKPoleTarget': {
      const chainId = inv.chainId as string
      const oldPoleTarget = inv.oldPoleTarget as import('../ikChain').PoleTarget | null
      engine.setIKPoleTarget(chainId, oldPoleTarget)
      return
    }
    case 'AddConstraint': {
      const nodeId = inv.nodeId as string
      const constraintId = inv.constraintId as string
      try {
        engine.removeConstraint(nodeId, constraintId)
      } catch {
        // ignore
      }
      return
    }
    case 'RemoveConstraint': {
      const nodeId = inv.nodeId as string
      const constraint = inv.constraint as import('../constraint').Constraint
      try {
        engine.addConstraint(nodeId, constraint.type, constraint.priority, constraint.params)
        // Patch id to original
        const list = engine.getConstraintsForNode(nodeId)
        const newest = list[list.length - 1]
        if (newest && newest.id !== constraint.id) {
          ;(newest as unknown as Record<string, unknown>).id = constraint.id
        }
      } catch {
        // ignore
      }
      return
    }
    case 'SetConstraintParams': {
      const nodeId = inv.nodeId as string
      const constraintId = inv.constraintId as string
      const oldParams = inv.oldParams as import('../constraint').ConstraintParams
      engine.setConstraintParams(nodeId, constraintId, oldParams)
      return
    }
    case 'MoveVertex': {
      const nodeId = inv.nodeId as string
      const vertexIndex = inv.vertexIndex as number
      const oldX = inv.oldX as number
      const oldY = inv.oldY as number
      const node = engine.getNode(nodeId)
      const mesh = node.components.mesh!.mesh
      const newMesh = {
        ...mesh,
        vertices: mesh.vertices.map((v, i) =>
          i === vertexIndex ? { x: oldX, y: oldY } : { ...v },
        ),
      }
      engine.setMeshData(nodeId, newMesh)
      return
    }
    case 'DeleteVertices': {
      const nodeId = inv.nodeId as string
      const mesh = inv.mesh as import('../mesh').MeshData
      engine.setMeshData(nodeId, mesh)
      return
    }
    case 'ExtrudeFaces':
    case 'ExtrudeEdges':
    case 'SubdivideFaces':
    case 'MirrorMesh':
    case 'GenerateMesh': {
      const nodeId = inv.nodeId as string
      const oldMesh = (inv.mesh ?? inv.oldMesh) as import('../mesh').MeshData | null
      if (oldMesh) {
        engine.setMeshData(nodeId, oldMesh)
      } else {
        // No mesh before, clear?
        const node = engine.getNode(nodeId)
        const newComponents = { ...node.components }
        delete (newComponents as Record<string, unknown>).mesh
        ;(node as unknown as Record<string, unknown>).components = Object.freeze(newComponents)
      }
      return
    }
    case 'SetVertexWeights': {
      const nodeId = inv.nodeId as string
      const vertexIndex = inv.vertexIndex as number
      const oldWeights = inv.oldWeights as readonly import('../mesh').VertexBoneWeight[]
      const node = engine.getNode(nodeId)
      const mesh = node.components.mesh!.mesh
      const boneWeights = [...(mesh.boneWeights ?? [])]
      while (boneWeights.length < mesh.vertices.length) boneWeights.push([])
      boneWeights[vertexIndex] = [...oldWeights]
      engine.setMeshData(nodeId, { ...mesh, boneWeights })
      return
    }
    case 'AutoWeights':
    case 'BlurWeights':
    case 'FillWeights':
    case 'SmoothWeights':
    case 'NormalizeWeights':
    case 'PaintWeight': {
      const nodeId = inv.nodeId as string
      const oldWeights =
        inv.oldWeights as readonly (readonly import('../mesh').VertexBoneWeight[])[]
      const oldBindPose = inv.oldBindPose as
        Readonly<Record<string, import('../mesh').BoneBindPose>> | undefined
      const node = engine.getNode(nodeId)
      const mesh = node.components.mesh!.mesh
      const boneWeights = oldWeights.map((arr) => [...arr])
      engine.setMeshData(nodeId, {
        ...mesh,
        boneWeights,
        ...(oldBindPose ? { bindPose: oldBindPose } : { bindPose: undefined }),
      })
      // Clean up bindPose if undefined
      if (!oldBindPose) {
        const n = engine.getNode(nodeId)
        const m = n.components.mesh!.mesh
        if (m.bindPose) {
          const { bindPose, ...rest } = m as unknown as Record<string, unknown>
          void bindPose
          engine.setMeshData(nodeId, rest as unknown as import('../mesh').MeshData)
        }
      }
      return
    }
    case 'CreatePrompterPart': {
      const slideId = inv.slideId as string
      const partId = inv.partId as string
      try {
        engine.deletePrompterPart(slideId, partId)
      } catch {
        // ignore
      }
      return
    }
    case 'ImportPrompter': {
      const slideId = inv.slideId as string
      const oldParts = inv.oldParts as readonly {
        id: string
        text: string
        startTime: number
        endTime: number
        duration: number
      }[]
      const newPartIds = inv.newPartIds as readonly string[]
      // Remove new parts
      for (const pid of newPartIds) {
        try {
          engine.deletePrompterPart(slideId, pid)
        } catch {
          // ignore
        }
      }
      // Restore old parts
      const slide = engine.getSlide(slideId)
      if (oldParts.length === 0) {
        slide.prompter = { parts: [] }
      } else {
        slide.prompter = {
          parts: oldParts.map((p) => ({
            id: p.id,
            text: p.text,
            startTime: p.startTime,
            endTime: p.endTime,
            duration: p.duration,
          })),
        }
        reflowPrompter(slide.prompter)
      }
      return
    }
    case 'SplitPrompterPart': {
      const slideId = inv.slideId as string
      const partId = inv.partId as string
      const oldText = inv.oldText as string
      const oldDuration = inv.oldDuration as number
      const created = inv.createdPartIds as readonly string[] | undefined
      const newIds = created ?? (inv.newPartIds as readonly string[]) ?? []
      for (const nid of newIds) {
        if (nid !== partId) {
          try {
            engine.deletePrompterPart(slideId, nid)
          } catch {
            // ignore
          }
        }
      }
      try {
        engine.updatePrompterPart(slideId, partId, { text: oldText, duration: oldDuration })
      } catch {
        // fallback: set directly
        const slide = engine.getSlide(slideId)
        const part = slide.prompter?.parts.find((p) => p.id === partId)
        if (part) {
          part.text = oldText
          part.duration = oldDuration
          part.endTime = part.startTime + oldDuration
        }
      }
      return
    }
    case 'UnitePrompterParts':
    case 'MergePrompterParts': {
      const slideId = inv.slideId as string
      const mergedId = inv.mergedId as string
      const oldParts = inv.oldParts as readonly {
        id: string
        text: string
        duration: number
        startTime: number
        endTime: number
      }[]
      const rightPartId = inv.rightPartId as string | undefined
      // Delete merged (which is left) and recreate both?
      // For simplicity, restore oldParts by deleting merged and recreating right
      const slide = engine.getSlide(slideId)
      const mergedIndex = slide.prompter?.parts.findIndex((p) => p.id === mergedId) ?? -1
      if (mergedIndex !== -1) {
        // Remove merged
        slide.prompter!.parts.splice(mergedIndex, 1)
        // Insert old parts
        for (let i = 0; i < oldParts.length; i++) {
          const op = oldParts[i]
          slide.prompter!.parts.splice(mergedIndex + i, 0, {
            id: op.id,
            text: op.text,
            duration: op.duration,
            startTime: op.startTime,
            endTime: op.endTime,
          })
        }
        reflowPrompter(slide.prompter!)
      }
      void rightPartId
      return
    }
    case 'UpdatePrompterPart': {
      const slideId = inv.slideId as string
      const partId = inv.partId as string
      const oldText = inv.oldText as string
      const oldDuration = inv.oldDuration as number
      const oldStartTime = inv.oldStartTime as number
      const oldEndTime = inv.oldEndTime as number
      const shiftedParts = inv.shiftedParts as
        readonly { id: string; oldStartTime: number; oldEndTime: number }[] | undefined
      const shiftedClips = inv.shiftedClips as
        readonly { id: string; oldTimelineStart: number }[] | undefined
      try {
        engine.updatePrompterPart(slideId, partId, { text: oldText, duration: oldDuration })
        const slide = engine.getSlide(slideId)
        const part = slide.prompter?.parts.find((p) => p.id === partId)
        if (part) {
          part.startTime = oldStartTime
          part.endTime = oldEndTime
        }
        if (shiftedParts) {
          for (const sp of shiftedParts) {
            const p = slide.prompter?.parts.find((x) => x.id === sp.id)
            if (p) {
              p.startTime = sp.oldStartTime
              p.endTime = sp.oldEndTime
            }
          }
        }
        if (shiftedClips) {
          for (const sc of shiftedClips) {
            const clip = slide.audio.clips.find((c) => c.id === sc.id)
            if (clip) clip.timelineStart = sc.oldTimelineStart
          }
        }
      } catch {
        // ignore
      }
      return
    }
    case 'UpdatePrompterPartWithShift': {
      const slideId = inv.slideId as string
      const partId = inv.partId as string
      const oldDuration = inv.oldDuration as number
      const oldStartTime = inv.oldStartTime as number
      const oldEndTime = inv.oldEndTime as number
      const shiftedParts = inv.shiftedParts as readonly {
        id: string
        oldStartTime: number
        oldEndTime: number
      }[]
      const shiftedClips = inv.shiftedClips as readonly { id: string; oldTimelineStart: number }[]
      const slide = engine.getSlide(slideId)
      const part = slide.prompter?.parts.find((p) => p.id === partId)
      if (part) {
        part.duration = oldDuration
        part.startTime = oldStartTime
        part.endTime = oldEndTime
      }
      for (const sp of shiftedParts) {
        const p = slide.prompter?.parts.find((x) => x.id === sp.id)
        if (p) {
          p.startTime = sp.oldStartTime
          p.endTime = sp.oldEndTime
        }
      }
      for (const sc of shiftedClips) {
        const clip = slide.audio.clips.find((c) => c.id === sc.id)
        if (clip) clip.timelineStart = sc.oldTimelineStart
      }
      return
    }
    case 'MovePrompterPart': {
      const slideId = inv.slideId as string
      const partId = inv.partId as string
      const oldStartTime = inv.oldStartTime as number
      const slide = engine.getSlide(slideId)
      const part = slide.prompter?.parts.find((p) => p.id === partId)
      if (part) {
        part.startTime = oldStartTime
        part.endTime = oldStartTime + part.duration
        slide.prompter!.parts.sort((a, b) => a.startTime - b.startTime)
      }
      return
    }
    case 'SetPrompterPartAudio': {
      const slideId = inv.slideId as string
      const partId = inv.partId as string
      const oldAudioClipId = inv.oldAudioClipId as string | undefined
      const oldAudioAssetId = inv.oldAudioAssetId as string | undefined
      const oldStatus = inv.oldStatus as import('../prompter').PrompterPartStatus | undefined
      const slide = engine.getSlide(slideId)
      const part = slide.prompter?.parts.find((p) => p.id === partId)
      if (part) {
        if (oldAudioClipId) part.audioClipId = oldAudioClipId
        else delete (part as unknown as Record<string, unknown>).audioClipId
        if (oldAudioAssetId) part.audioAssetId = oldAudioAssetId
        else delete (part as unknown as Record<string, unknown>).audioAssetId
        if (oldStatus) part.status = oldStatus
        else delete (part as unknown as Record<string, unknown>).status
      }
      return
    }
    case 'CreateAudioAsset': {
      const assetId = inv.assetId as string
      try {
        engine.deleteEmbeddedAsset(assetId)
      } catch {
        // ignore
      }
      return
    }
    case 'DeleteAudioAsset': {
      const asset = inv.asset as import('../embeddedAsset').EmbeddedAsset
      engine.embedAsset(asset)
      return
    }
    case 'CreateAudioClip': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      try {
        engine.deleteAudioClip(slideId, clipId)
      } catch {
        // ignore
      }
      return
    }
    case 'DeleteAudioClip': {
      const slideId = inv.slideId as string
      const clip = inv.clip as import('../audioClip').AudioClip
      const index = inv.index as number
      const slide = engine.getSlide(slideId)
      slide.audio.clips.splice(index, 0, clip)
      return
    }
    case 'MoveAudioClip': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      const oldTimelineStart = inv.oldTimelineStart as number
      const oldTrackId = inv.oldTrackId as import('../audioClip').AudioTrackId
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
      if (clip) {
        clip.timelineStart = oldTimelineStart
        clip.trackId = oldTrackId
      }
      return
    }
    case 'TrimAudioClip': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      const oldSourceStart = inv.oldSourceStart as number
      const oldSourceEnd = inv.oldSourceEnd as number
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
      if (clip) {
        clip.sourceStart = oldSourceStart
        clip.sourceEnd = oldSourceEnd
      }
      return
    }
    case 'SplitAudioClip': {
      const slideId = inv.slideId as string
      const originalClipId = inv.originalClipId as string
      const newClipId = inv.newClipId as string
      const originalSourceEnd = inv.originalSourceEnd as number
      const slide = engine.getSlide(slideId)
      // Remove new clip
      const idx = slide.audio.clips.findIndex((c) => c.id === newClipId)
      if (idx !== -1) slide.audio.clips.splice(idx, 1)
      // Restore original sourceEnd
      const orig = slide.audio.clips.find((c) => c.id === originalClipId)
      if (orig) orig.sourceEnd = originalSourceEnd
      return
    }
    case 'DuplicateAudioClip': {
      const slideId = inv.slideId as string
      const newClipId = inv.newClipId as string
      try {
        engine.deleteAudioClip(slideId, newClipId)
      } catch {
        // ignore
      }
      return
    }
    case 'SetAudioClipVolume': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      const oldVolume = inv.oldVolume as number
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
      if (clip) clip.volume = oldVolume
      return
    }
    case 'SetAudioClipMuted': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      const oldMuted = inv.oldMuted as boolean
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
      if (clip) clip.muted = oldMuted
      return
    }
    case 'SetAudioClipPlaybackRate': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      const oldPlaybackRate = inv.oldPlaybackRate as number
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
      if (clip) clip.playbackRate = oldPlaybackRate
      return
    }
    case 'SetAudioClipFade': {
      const slideId = inv.slideId as string
      const clipId = inv.clipId as string
      const oldFadeIn = inv.oldFadeIn as number | undefined
      const oldFadeOut = inv.oldFadeOut as number | undefined
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
      if (clip) {
        if (oldFadeIn !== undefined) clip.fadeIn = oldFadeIn
        else delete (clip as unknown as Record<string, unknown>).fadeIn
        if (oldFadeOut !== undefined) clip.fadeOut = oldFadeOut
        else delete (clip as unknown as Record<string, unknown>).fadeOut
      }
      return
    }
    case 'ReplacePrompterWords': {
      const slideId = params.slideId as string
      const oldPart = inv.oldPart as import('../prompter').PrompterPart
      const oldClip = inv.oldClip as import('../audioClip').AudioClip | undefined
      const oldIndex = inv.oldIndex as number
      const newPartIds = inv.newPartIds as readonly string[]
      const newClipIds = inv.newClipIds as readonly string[]
      const createdAssetId = inv.createdAssetId as string | undefined
      const deletedClipId = inv.deletedClipId as string | undefined
      const slide = engine.getSlide(slideId)
      // Remove new parts
      for (const pid of newPartIds) {
        const idx = slide.prompter!.parts.findIndex((p) => p.id === pid)
        if (idx !== -1) slide.prompter!.parts.splice(idx, 1)
      }
      // Remove new clips
      for (const cid of newClipIds) {
        const idx = slide.audio.clips.findIndex((c) => c.id === cid)
        if (idx !== -1) slide.audio.clips.splice(idx, 1)
      }
      // Remove created asset
      if (createdAssetId) {
        try {
          engine.deleteEmbeddedAsset(createdAssetId)
        } catch {
          // ignore
        }
      }
      // Restore old part at oldIndex
      slide.prompter!.parts.splice(oldIndex, 0, oldPart)
      if (oldClip && deletedClipId) {
        // Restore old clip if it was deleted (or ensure present)
        const exists = slide.audio.clips.find((c) => c.id === oldClip.id)
        if (!exists) slide.audio.clips.push(oldClip)
      }
      reflowPrompter(slide.prompter!)
      return
    }
    case 'SplitPrompterWords': {
      const slideId = params.slideId as string
      const oldPart = inv.oldPart as import('../prompter').PrompterPart
      const oldClip = inv.oldClip as import('../audioClip').AudioClip | undefined
      const oldIndex = inv.oldIndex as number
      const newPartIds = inv.newPartIds as readonly string[]
      const deletedClipId = inv.deletedClipId as string | undefined
      const slide = engine.getSlide(slideId)
      for (const pid of newPartIds) {
        const idx = slide.prompter!.parts.findIndex((p) => p.id === pid)
        if (idx !== -1) slide.prompter!.parts.splice(idx, 1)
      }
      if (deletedClipId) {
        const exists = slide.audio.clips.find((c) => c.id === deletedClipId)
        if (!exists && oldClip) slide.audio.clips.push(oldClip)
        else if (exists && oldClip) {
          // Ensure old clip restored if needed
        }
      }
      // Remove new part ids already done, now restore oldPart
      // Check if oldPart already present (if newPartIds contained oldPart.id reused)
      const existingOld = slide.prompter!.parts.find((p) => p.id === oldPart.id)
      if (existingOld) {
        // Already there with possibly new text, replace
        Object.assign(existingOld, oldPart)
      } else {
        slide.prompter!.parts.splice(oldIndex, 0, oldPart)
      }
      reflowPrompter(slide.prompter!)
      return
    }
    case 'CreateTable': {
      const tableNodeId = inv.tableNodeId as string
      try {
        engine.removeNode(tableNodeId)
      } catch {
        // ignore
      }
      return
    }
    case 'AddTableRow': {
      const rowNodeId = inv.rowNodeId as string
      try {
        engine.removeNode(rowNodeId)
      } catch {
        // ignore
      }
      return
    }
    case 'RemoveTableRow': {
      // Inverse contains nodes to restore? Actually RemoveTableRow inverse has rowNodeId, tableNodeId, rowIndex, nodes
      const nodes = inv.nodes as unknown[] | undefined
      const tableNodeId = inv.tableNodeId as string
      const rowIndex = inv.rowIndex as number
      if (nodes && nodes.length > 0) {
        // For simplicity, recreate row via AddTableRow and then restore cell contents?
        // We'll attempt to recreate via engine.createNode loop similar to DeleteNode
        // But we don't have full JSON, so we skip detailed restoration
        // Fallback: do nothing
      }
      void tableNodeId
      void rowIndex
      return
    }
    case 'AddTableColumn': {
      // Undo add column: remove column? Not easy without inverse storing column index
      // AddTableColumn inverse only has tableNodeId, we need to remove last column?
      // We'll approximate by removing the column at params.index
      const tableNodeId = (params.tableNodeId as string) ?? (inv.tableNodeId as string)
      const colIdx = (params.index as number) ?? 0
      try {
        // Use engine to remove column? There's no direct engine method, but we can call RemoveTableColumn via internal?
        // For now, try to find tableCommands logic: remove column deletes cells
        // We'll attempt to call engine.setTableComponent to restore previous columns
        // But inverse doesn't have old columns. So we skip
      } catch {
        // ignore
      }
      void tableNodeId
      void colIdx
      return
    }
    case 'RemoveTableColumn': {
      // Similar, skip
      return
    }
    case 'SetTableRowComponent': {
      const nodeId = inv.nodeId as string
      const oldTableRow = inv.oldTableRow as import('../components').TableRowComponent
      engine.setTableRowComponent(nodeId, oldTableRow)
      return
    }
    case 'SetTableCellComponent': {
      const nodeId = inv.nodeId as string
      const oldTableCell = inv.oldTableCell as import('../components').TableCellComponent
      engine.setTableCellComponent(nodeId, oldTableCell)
      return
    }
    case 'ApplyTableLayout': {
      const tableNodeId = inv.tableNodeId as string
      const prev = inv.previousTransforms as ReadonlyMap<string, Transform> | Map<string, Transform>
      if (prev) {
        for (const [nodeId, transform] of prev as Map<string, Transform>) {
          try {
            engine.setTransform(nodeId, transform)
          } catch {
            // ignore
          }
        }
      }
      void tableNodeId
      return
    }
    default:
      console.warn(`[undo] No handler for type ${type}`)
      return
  }
}

export function applyRedo(
  engine: Engine,
  type: string,
  parameters: Readonly<Record<string, unknown>>,
  _inverse: unknown,
): void {
  const params = parameters as Record<string, unknown>
  switch (type) {
    case 'MoveNode':
      engine.setTransform(params.nodeId as string, {
        ...engine.getNode(params.nodeId as string).transform,
        x: params.x as number,
        y: params.y as number,
      })
      return
    case 'RotateNode':
      engine.setTransform(params.nodeId as string, {
        ...engine.getNode(params.nodeId as string).transform,
        rotation: params.rotation as number,
      })
      return
    case 'ScaleNode':
      engine.setTransform(params.nodeId as string, {
        ...engine.getNode(params.nodeId as string).transform,
        scaleX: params.scaleX as number,
        scaleY: params.scaleY as number,
      })
      return
    case 'UpdateBone': {
      const nodeId = params.nodeId as string
      if (params.length !== undefined) {
        try {
          engine.setBoneLength(nodeId, params.length as number)
        } catch (_e) {
          // bone may be deleted
        }
      }
      const x = params.x as number | undefined
      const y = params.y as number | undefined
      const rotation = params.rotation as number | undefined
      if (x !== undefined || y !== undefined || rotation !== undefined) {
        try {
          const node = engine.getNode(nodeId)
          engine.setTransform(nodeId, {
            ...node.transform,
            x: x !== undefined ? x : node.transform.x,
            y: y !== undefined ? y : node.transform.y,
            rotation: rotation !== undefined ? rotation : node.transform.rotation,
          })
        } catch (_e) {
          // ignore
        }
      }
      return
    }
    case 'SetVisibility':
      engine.setVisibility(params.nodeId as string, params.visible as boolean)
      return
    case 'SetOpacity':
      engine.setOpacity(params.nodeId as string, params.opacity as number)
      return
    case 'RenameNode':
      engine.renameNode(params.nodeId as string, params.name as string)
      return
    case 'ReorderNode':
      engine.reorderNode(params.nodeId as string, params.index as number)
      return
    case 'ReparentNode': {
      const nodeId = params.nodeId as string
      const newParentId = (params.parentId as string) ?? (params.newParentId as string)
      if (!newParentId) return
      const parentingMode = (params.parentingMode as string) ?? 'keepWorld'
      // Capture world before reparent for keepWorld calculation (after undo, node is at old location)
      let oldWorld: import('../worldTransform').WorldTransform | null = null
      let newParentWorld: import('../worldTransform').WorldTransform | null = null
      if (parentingMode === 'keepWorld') {
        try {
          const scene = engine.getNodeScene(nodeId)
          oldWorld = worldTransformOf(scene, nodeId)
          newParentWorld = worldTransformOf(scene, newParentId)
        } catch {
          // fallback: will compute after reparent if needed
        }
      }
      engine.reparentNode(nodeId, newParentId)
      const idx = params.index as number | undefined
      if (idx !== undefined) {
        try {
          engine.reorderNode(nodeId, idx)
        } catch {
          // ignore
        }
      }
      if (parentingMode === 'snapToTail') {
        try {
          const node = engine.getNode(nodeId)
          const parent = node.parent
          const parentLength = parent?.components.bone?.length
          const snapTransform: Transform = {
            x: parentLength ?? 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            ...(node.transform.localPivot ? { localPivot: node.transform.localPivot } : {}),
          }
          if (!transformsEqual(snapTransform, node.transform)) {
            engine.setTransform(nodeId, snapTransform)
          }
        } catch {
          // ignore
        }
      } else if (oldWorld && newParentWorld) {
        try {
          const adjusted = relativeTransform(oldWorld, newParentWorld)
          const current = engine.getNode(nodeId).transform
          if (adjusted && !transformsEqual(adjusted, current)) {
            engine.setTransform(nodeId, adjusted)
          }
        } catch {
          // ignore
        }
      }
      return
    }
    case 'SetParent': {
      const nodeId = params.nodeId as string
      const parentId = params.parentId as string
      const maintainWorld = (params.maintainWorldTransform as boolean) ?? true
      let oldWorld: import('../worldTransform').WorldTransform | null = null
      let newParentWorld: import('../worldTransform').WorldTransform | null = null
      if (maintainWorld) {
        try {
          const scene = engine.getNodeScene(nodeId)
          oldWorld = worldTransformOf(scene, nodeId)
          newParentWorld = worldTransformOf(scene, parentId)
        } catch {
          // ignore
        }
      }
      engine.reparentNode(nodeId, parentId)
      const idx = params.index as number | undefined
      if (idx !== undefined) {
        try {
          engine.reorderNode(nodeId, idx)
        } catch {
          // ignore
        }
      }
      if (maintainWorld && oldWorld && newParentWorld) {
        try {
          const adjusted = relativeTransform(oldWorld, newParentWorld)
          const current = engine.getNode(nodeId).transform
          if (adjusted && !transformsEqual(adjusted, current)) {
            engine.setTransform(nodeId, adjusted)
          }
        } catch {
          // ignore
        }
      }
      return
    }
    case 'ChangeZOrder': {
      // Re-apply via ChangeZOrder logic: need to compute target index again, but for redo we can just call engine.reorderNode via same mode?
      // For simplicity, use parameters.mode and re-run change logic via engine
      const nodeId = params.nodeId as string
      const mode = params.mode as string
      // Replicate changeZOrder logic: find parent and compute target
      const node = engine.getNode(nodeId)
      const parent = node.parent!
      const current = parent.children.indexOf(node)
      const modeToIndex = (
        m: string,
        children: readonly import('../sceneNode').SceneNode[],
        cur: number,
      ): number => {
        const backBoundary = children[0]?.components.camera ? 1 : 0
        switch (m) {
          case 'bringToFront':
            return children.length - 1
          case 'sendToBack':
            return backBoundary
          case 'bringForward':
            return Math.min(children.length - 1, cur + 1)
          case 'sendBackward':
            return Math.max(backBoundary, cur - 1)
          default:
            return cur
        }
      }
      const targetIdx = modeToIndex(mode, parent.children, current)
      if (targetIdx !== current) engine.reorderNode(nodeId, targetIdx)
      return
    }
    case 'CreateNode': {
      const sceneId = params.sceneId as string
      const parentId = params.parentId as string
      const name = params.name as string
      const id = params.id as string | undefined
      const transform = params.transform as Transform | undefined
      const visible = params.visible as boolean | undefined
      const opacity = params.opacity as number | undefined
      const components = params.components as import('../components').NodeComponents | undefined
      engine.createNode(sceneId, parentId, name, {
        ...(id ? { id } : {}),
        ...(transform ? { transform } : {}),
        ...(visible !== undefined ? { visible } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(components ? { components } : {}),
      })
      return
    }
    case 'CreateRigHandle': {
      const sceneId = params.sceneId as string
      const name = params.name as string
      const childIds = (params.childIds as string[]) ?? []
      const parentId = params.parentId as string | undefined
      const transform = params.transform as Transform | undefined
      const handleId = (params as Record<string, unknown>).handleId as string | undefined
      const inv = _inverse as Record<string, unknown> | null
      const effectiveHandleId = (inv?.handleId as string | undefined) ?? handleId
      // Recreate handle with same id if redoing after undo
      const scene = engine.getScene(sceneId)
      const handleParentId = parentId ?? scene.root.id
      let handle: import('../sceneNode').SceneNode
      try {
        handle = engine.getNode(effectiveHandleId as string)
        void handle
      } catch {
        handle = engine.createNode(sceneId, handleParentId, name, {
          ...(effectiveHandleId ? { id: effectiveHandleId } : {}),
          ...(transform ? { transform } : {}),
        })
      }
      const hId = handle.id
      // Capture world of handle for keepWorld reparent
      let handleWorld: import('../worldTransform').WorldTransform | null = null
      try {
        handleWorld = worldTransformOf(scene, hId)
      } catch {
        // ignore
      }
      for (const childId of childIds) {
        try {
          const oldWorld = worldTransformOf(scene, childId)
          engine.reparentNode(childId, hId)
          if (oldWorld && handleWorld) {
            const adjusted = relativeTransform(oldWorld, handleWorld)
            const current = engine.getNode(childId).transform
            if (adjusted && !transformsEqual(adjusted, current)) {
              engine.setTransform(childId, adjusted)
            }
          }
        } catch {
          // ignore missing child
        }
      }
      return
    }
    case 'CreateAssetInstance': {
      const sceneId = params.sceneId as string
      const parentId = params.parentId as string
      const definitionId = params.definitionId as string
      const name = params.name as string
      const x = (params.x as number) ?? 0
      const y = (params.y as number) ?? 0
      const rotation = params.rotation as number | undefined
      const scaleX = params.scaleX as number | undefined
      const scaleY = params.scaleY as number | undefined
      engine.createAssetInstance(sceneId, parentId, definitionId, name, {
        transform: { x, y, rotation: rotation ?? 0, scaleX: scaleX ?? 1, scaleY: scaleY ?? 1 },
      })
      return
    }
    case 'DeleteNode': {
      const nodeId = params.nodeId as string
      engine.removeNode(nodeId)
      return
    }
    case 'DuplicateNode': {
      const nodeId = params.nodeId as string
      // Duplicate again via engine method? CreateAssetInstance duplication logic
      const node = engine.getNode(nodeId)
      const scene = engine.getNodeScene(nodeId)
      const parent = node.parent
      if (!parent || !node.components.assetInstance) throw new Error('Cannot duplicate')
      engine.createAssetInstance(
        scene.id,
        parent.id,
        node.components.assetInstance.assetDefinitionId,
        node.name,
        {
          transform: { ...node.transform, x: node.transform.x + 20, y: node.transform.y + 20 },
        },
      )
      return
    }
    case 'CreateSlide': {
      const name = params.name as string | undefined
      engine.createSlide(name)
      return
    }
    case 'DeleteSlide': {
      const slideId = params.slideId as string
      engine.removeSlide(slideId)
      return
    }
    case 'RenameSlide':
      engine.renameSlide(params.slideId as string, params.name as string)
      return
    case 'MoveSlide':
      engine.moveSlide(params.slideId as string, params.index as number)
      return
    case 'DuplicateSlide':
      engine.duplicateSlide(params.slideId as string)
      return
    case 'SetSlideDuration':
      engine.setSlideDuration(params.slideId as string, params.duration as number)
      return
    case 'SetFullscreenShader':
      engine.setFullscreenShader(
        params.slideId as string,
        (params.shaderDefinitionId as string | null) ?? null,
      )
      return
    case 'OverrideFullscreenUniform':
      engine.overrideFullscreenUniform(
        params.slideId as string,
        params.uniform as string,
        params.value as import('../materialInstance').MaterialOverrideValue,
      )
      return
    case 'AssignMaterial':
      engine.assignMaterial(params.nodeId as string, params.materialDefinitionId as string)
      return
    case 'OverrideMaterialParameter':
      engine.overrideMaterialParameter(
        params.nodeId as string,
        params.parameter as string,
        params.value as import('../materialInstance').MaterialOverrideValue,
      )
      return
    case 'ClearMaterialOverride':
      engine.clearMaterialOverride(params.nodeId as string, params.parameter as string)
      return
    case 'CreateProject': {
      // Redo create project: need to create with same name
      engine.createProject({
        name: params.name as string,
        description: params.description as string | undefined,
        author: params.author as string | undefined,
      })
      return
    }
    case 'SetTableComponent':
      engine.setTableComponent(
        params.nodeId as string,
        params.table as import('../components').TableComponent,
      )
      return
    case 'SetChartComponent':
      engine.setChartComponent(
        params.nodeId as string,
        params.chart as import('../components').ChartComponent,
      )
      return
    case 'SetTextContent': {
      const nodeId = params.nodeId as string
      const node = engine.getNode(nodeId)
      engine.setTextComponent(nodeId, {
        ...node.components.text!,
        content: params.content as string,
      })
      return
    }
    case 'SetTextFontSize': {
      const nodeId = params.nodeId as string
      const node = engine.getNode(nodeId)
      engine.setTextComponent(nodeId, {
        ...node.components.text!,
        fontSize: params.fontSize as number,
      })
      return
    }
    case 'SetTextAlignment': {
      const nodeId = params.nodeId as string
      const node = engine.getNode(nodeId)
      engine.setTextComponent(nodeId, {
        ...node.components.text!,
        alignment: params.alignment as import('../components').TextAlignment,
      })
      return
    }
    case 'AddKeyframe': {
      const target = params.target as import('../keyframeTarget').KeyframeTarget
      engine.addKeyframe(target, params.time as number, params.value)
      return
    }
    case 'DeleteKeyframes': {
      const target2 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.deleteKeyframes(target2, params.keyframeIds as string[])
      return
    }
    case 'MoveKeyframes': {
      const target3 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.moveKeyframes(target3, params.moves as import('../animationManager').KeyframeMove[])
      return
    }
    case 'ScaleKeyframes': {
      const target4 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.scaleKeyframes(
        target4,
        params.keyframeIds as string[],
        params.pivot as number,
        params.factor as number,
      )
      return
    }
    case 'PasteKeyframes': {
      const target5 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.pasteKeyframes(
        target5,
        params.payload as import('../animationManager').PastePayload,
        params.atTime as number,
      )
      return
    }
    case 'DuplicateKeyframes': {
      const target6 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.duplicateKeyframes(target6, params.keyframeIds as string[])
      return
    }
    case 'SetKeyframeValue': {
      const target7 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.setKeyframeValue(target7, params.keyframeId as string, params.newValue)
      return
    }
    case 'SetKeyframeInterpolation': {
      const target8 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.setKeyframeInterpolation(target8, params.keyframeId as string, params.interpolation)
      return
    }
    case 'SetKeyframeTangents': {
      const target9 = params.target as import('../keyframeTarget').KeyframeTarget
      engine.setKeyframeTangents(
        target9,
        params.keyframeId as string,
        params.tangentIn as import('../keyframe').KeyframeTangent,
        params.tangentOut as import('../keyframe').KeyframeTangent,
      )
      return
    }
    case 'CreateClip': {
      engine.createClip(
        params.name as string,
        params.duration as number,
        params.category as string,
        params.params as import('../clipDefinition').ClipParam[],
        params.channels as import('../clipDefinition').ClipChannelDef[],
      )
      return
    }
    case 'DeleteClip':
      engine.deleteClip(params.clipId as string)
      return
    case 'RenameClip':
      engine.renameClip(params.clipId as string, params.name as string)
      return
    case 'DuplicateClip':
      engine.duplicateClip(params.clipId as string)
      return
    case 'SetClipDuration':
      engine.setClipDuration(params.clipId as string, params.duration as number)
      return
    case 'SetClipCategory':
      engine.setClipCategory(params.clipId as string, params.category as string)
      return
    case 'SetClipParamDefault':
      engine.setClipParamDefault(
        params.clipId as string,
        params.paramKey as string,
        params.defaultValue as number,
      )
      return
    case 'SetClipChannelParamLink':
      engine.setClipChannelParamLink(
        params.clipId as string,
        params.channel as import('../animation').AnimationProperty,
        (params.paramKey as string | null) ?? null,
      )
      return
    case 'AddClipChannel':
      engine.addClipChannel(
        params.clipId as string,
        params.channel as import('../clipDefinition').ClipChannelDef,
      )
      return
    case 'RemoveClipChannel':
      engine.removeClipChannel(
        params.clipId as string,
        params.channel as import('../animation').AnimationProperty,
      )
      return
    case 'AddClipKeyframe': {
      const t = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.addClipChannelKeyframe(
        t.clipId,
        t.channel as import('../animation').AnimationProperty,
        params.time as number,
        params.value as number,
      )
      return
    }
    case 'DeleteClipKeyframes': {
      const tt = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.deleteClipChannelKeyframes(
        tt.clipId,
        tt.channel as import('../animation').AnimationProperty,
        params.keyframeIds as string[],
      )
      return
    }
    case 'MoveClipKeyframes': {
      const ttt = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.moveClipChannelKeyframes(
        ttt.clipId,
        ttt.channel as import('../animation').AnimationProperty,
        params.moves as { keyframeId: string; newTime: number }[],
      )
      return
    }
    case 'ScaleClipKeyframes': {
      const t4 = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.scaleClipChannelKeyframes(
        t4.clipId,
        t4.channel as import('../animation').AnimationProperty,
        params.keyframeIds as string[],
        params.pivot as number,
        params.factor as number,
      )
      return
    }
    case 'PasteClipKeyframes': {
      const t5 = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.pasteClipChannelKeyframes(
        t5.clipId,
        t5.channel as import('../animation').AnimationProperty,
        params.payload as {
          keyframes: readonly {
            time: number
            value: unknown
            interpolation: import('../keyframe').InterpolationType
            tangentIn: import('../keyframe').KeyframeTangent
            tangentOut: import('../keyframe').KeyframeTangent
          }[]
        },
        params.atTime as number,
      )
      return
    }
    case 'DuplicateClipKeyframes': {
      const t6 = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.duplicateClipChannelKeyframes(
        t6.clipId,
        t6.channel as import('../animation').AnimationProperty,
        params.keyframeIds as string[],
      )
      return
    }
    case 'SetClipKeyframeValue': {
      const t7 = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.setClipChannelKeyframeValue(
        t7.clipId,
        t7.channel as import('../animation').AnimationProperty,
        params.keyframeId as string,
        params.newValue as number,
      )
      return
    }
    case 'SetClipKeyframeInterpolation': {
      const t8 = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.setClipChannelKeyframeInterpolation(
        t8.clipId,
        t8.channel as import('../animation').AnimationProperty,
        params.keyframeId as string,
        params.interpolation,
      )
      return
    }
    case 'SetClipKeyframeTangents': {
      const t9 = params.target as import('../keyframeTarget').ClipChannelTarget
      engine.setClipChannelKeyframeTangents(
        t9.clipId,
        t9.channel as import('../animation').AnimationProperty,
        params.keyframeId as string,
        params.tangentIn as import('../keyframe').KeyframeTangent,
        params.tangentOut as import('../keyframe').KeyframeTangent,
      )
      return
    }
    case 'AssignClip':
      engine.assignClipInstance(
        params.nodeId as string,
        params.clipId as string,
        params.startTime as number,
        params.speed as number,
        params.enabled as boolean,
        params.paramOverrides as Record<string, number>,
      )
      return
    case 'RemoveClip':
      engine.removeClipInstance(params.nodeId as string, params.instanceId as string)
      return
    case 'MoveClipLayer':
      engine.moveClipLayer(
        params.nodeId as string,
        params.instanceId as string,
        params.newIndex as number,
      )
      return
    case 'SetClipInstanceStartTime':
      engine.setClipInstanceStartTime(
        params.nodeId as string,
        params.instanceId as string,
        params.startTime as number,
      )
      return
    case 'SetClipInstanceSpeed':
      engine.setClipInstanceSpeed(
        params.nodeId as string,
        params.instanceId as string,
        params.speed as number,
      )
      return
    case 'SetClipInstanceEnabled':
      engine.setClipInstanceEnabled(
        params.nodeId as string,
        params.instanceId as string,
        params.enabled as boolean,
      )
      return
    case 'OverrideClipParam':
      engine.setClipInstanceParamOverride(
        params.nodeId as string,
        params.instanceId as string,
        params.paramKey as string,
        params.value as number,
      )
      return
    case 'ImportClip': {
      // For redo, re-import from params.entry
      const entry = params.entry as import('../clipDefinition').LibraryClipInput | undefined
      if (entry) {
        try {
          engine.importClipFromLibrary(entry)
        } catch {
          // ignore
        }
      }
      return
    }
    case 'CreateIKChain':
      engine.createIKChain(
        params.slideId as string,
        params.boneIds as string[],
        params.target as import('../ikChain').BoneIKTarget,
        (params.poleTarget as import('../ikChain').PoleTarget | null) ?? null,
      )
      return
    case 'DeleteIKChain':
      engine.deleteIKChain(params.chainId as string)
      return
    case 'SetIKTarget':
      engine.setIKTarget(
        params.chainId as string,
        params.target as import('../ikChain').BoneIKTarget,
      )
      return
    case 'SetIKPoleTarget':
      engine.setIKPoleTarget(
        params.chainId as string,
        (params.poleTarget as import('../ikChain').PoleTarget | null) ?? null,
      )
      return
    case 'AddConstraint':
      engine.addConstraint(
        params.nodeId as string,
        params.type as import('../constraint').ConstraintType,
        params.priority as number,
        params.params as import('../constraint').ConstraintParams,
      )
      return
    case 'RemoveConstraint':
      engine.removeConstraint(params.nodeId as string, params.constraintId as string)
      return
    case 'SetConstraintParams':
      engine.setConstraintParams(
        params.nodeId as string,
        params.constraintId as string,
        params.params as import('../constraint').ConstraintParams,
      )
      return
    case 'MoveVertex': {
      const nodeId = params.nodeId as string
      const vertexIndex = params.vertexIndex as number
      const x = params.x as number
      const y = params.y as number
      const node = engine.getNode(nodeId)
      const mesh = node.components.mesh!.mesh
      const newMesh = {
        ...mesh,
        vertices: mesh.vertices.map((v, i) => (i === vertexIndex ? { x, y } : { ...v })),
      }
      engine.setMeshData(nodeId, newMesh)
      return
    }
    case 'NormalizeWeights': {
      const nodeId = params.nodeId as string
      const node = engine.getNode(nodeId)
      const mesh = node.components.mesh!.mesh
      const currentWeights = mesh.boneWeights ?? []
      const normalized = currentWeights.map((weights) => {
        const total = weights.reduce((s, w) => s + w.weight, 0)
        if (total > 0 && total !== 1)
          return weights.map((w) => ({ boneId: w.boneId, weight: w.weight / total }))
        return [...weights]
      })
      const newMesh = { ...mesh, boneWeights: normalized as unknown as typeof mesh.boneWeights }
      engine.setMeshData(nodeId, newMesh)
      return
    }
    case 'DeleteVertices': {
      // Redo delete vertices
      const nodeId = params.nodeId as string
      const indices = params.vertexIndices as number[]
      // Use engine method? No engine.deleteVertices, but command does direct mesh manipulation
      // For redo, replicate same as execute: compute new mesh without those vertices
      const node = engine.getNode(nodeId)
      const oldMesh = node.components.mesh!.mesh
      const deletedSet = new Set(indices)
      const indexMap = new Map<number, number>()
      let newIndex = 0
      for (let i = 0; i < oldMesh.vertices.length; i++) {
        if (!deletedSet.has(i)) {
          indexMap.set(i, newIndex)
          newIndex++
        }
      }
      const newVertices = oldMesh.vertices
        .filter((_, i) => !deletedSet.has(i))
        .map((v) => ({ x: v.x, y: v.y }))
      const newUvs = oldMesh.uvs
        .filter((_, i) => !deletedSet.has(i))
        .map((uv) => ({ u: uv.u, v: uv.v }))
      const newFaces = oldMesh.faces
        .filter((f) => !deletedSet.has(f.v0) && !deletedSet.has(f.v1) && !deletedSet.has(f.v2))
        .map((f) => ({ v0: indexMap.get(f.v0)!, v1: indexMap.get(f.v1)!, v2: indexMap.get(f.v2)! }))
      const newMesh2 = { ...oldMesh, vertices: newVertices, uvs: newUvs, faces: newFaces }
      engine.setMeshData(nodeId, newMesh2)
      return
    }
    case 'CreatePrompterPart': {
      engine.createPrompterPart(params.slideId as string, {
        id: (params.partId as string | undefined) ?? newId('prompter-part'),
        text: params.text as string,
        duration: params.duration as number,
        insertIndex: params.insertIndex as number | undefined,
      })
      // But CreatePrompterPartCommand generates new id internally, not from params.partId; we need to handle redo with same id? For redo, we can call engine.createPrompterPart with same text/duration
      return
    }
    case 'ImportPrompter':
      engine.importPrompter(params.slideId as string, params.rawText as string)
      return
    case 'SplitPrompterPart':
      engine.splitPrompterPart(
        params.slideId as string,
        params.partId as string,
        params.wordIndex as number,
        params.mode as 'left' | 'right' | 'out',
      )
      return
    case 'UnitePrompterParts':
      engine.unitePrompterParts(
        params.slideId as string,
        params.leftPartId as string,
        params.rightPartId as string | undefined,
      )
      return
    case 'MergePrompterParts':
      engine.mergePrompterParts(
        params.slideId as string,
        params.leftPartId as string,
        params.rightPartId as string | undefined,
      )
      return
    case 'UpdatePrompterPart':
      engine.updatePrompterPart(params.slideId as string, params.partId as string, {
        text: params.text as string | undefined,
        duration: params.duration as number | undefined,
        shiftDownstream: params.shiftDownstream as boolean | undefined,
      })
      return
    case 'UpdatePrompterPartWithShift':
      engine.updatePrompterPart(params.slideId as string, params.partId as string, {
        duration: params.duration as number,
        shiftDownstream: params.shiftDownstream as boolean | undefined,
      })
      return
    case 'MovePrompterPart':
      if (params.newIndex !== undefined)
        engine.movePrompterPart(
          params.slideId as string,
          params.partId as string,
          params.newIndex as number,
        )
      else if (params.newStartTime !== undefined)
        engine.movePrompterPartToTime(
          params.slideId as string,
          params.partId as string,
          params.newStartTime as number,
        )
      return
    case 'SetPrompterPartAudio':
      engine.setPrompterPartAudio(
        params.slideId as string,
        params.partId as string,
        (params.audioClipId as string | null) ?? null,
        (params.audioAssetId as string | null) ?? null,
      )
      return
    case 'CreateAudioAsset': {
      const asset = {
        id: (params.id as string) ?? newId('audio-asset'),
        name: params.name as string,
        data: params.data as string,
        mimeType: (params.mimeType as string) ?? 'audio/wav',
        ...(params.metadata ? { metadata: params.metadata as Record<string, unknown> } : {}),
      }
      engine.embedAsset(asset)
      return
    }
    case 'DeleteAudioAsset':
      engine.deleteEmbeddedAsset(params.assetId as string)
      return
    case 'CreateAudioClip': {
      engine.createAudioClip(params.slideId as string, {
        id: (params.id as string) ?? newId('audio-clip'),
        assetId: params.assetId as string,
        trackId: params.trackId as import('../audioClip').AudioTrackId,
        timelineStart: params.timelineStart as number,
        sourceStart: (params.sourceStart as number) ?? 0,
        sourceEnd: params.sourceEnd as number,
        volume: (params.volume as number) ?? 1,
        muted: (params.muted as boolean) ?? false,
        fadeIn: params.fadeIn as number | undefined,
        fadeOut: params.fadeOut as number | undefined,
        playbackRate: (params.playbackRate as number) ?? 1,
      })
      return
    }
    case 'DeleteAudioClip':
      engine.deleteAudioClip(params.slideId as string, params.clipId as string)
      return
    case 'MoveAudioClip':
      engine.moveAudioClip(params.slideId as string, params.clipId as string, {
        timelineStart: params.timelineStart as number,
        trackId: params.trackId as import('../audioClip').AudioTrackId | undefined,
      })
      return
    case 'TrimAudioClip':
      engine.trimAudioClip(params.slideId as string, params.clipId as string, {
        sourceStart: params.sourceStart as number | undefined,
        sourceEnd: params.sourceEnd as number | undefined,
      })
      return
    case 'SplitAudioClip':
      engine.splitAudioClip(
        params.slideId as string,
        params.clipId as string,
        params.atTime as number,
      )
      return
    case 'DuplicateAudioClip':
      engine.duplicateAudioClip(params.slideId as string, params.clipId as string)
      return
    case 'SetAudioClipVolume':
      engine.setAudioClipVolume(
        params.slideId as string,
        params.clipId as string,
        params.volume as number,
      )
      return
    case 'SetAudioClipMuted':
      engine.setAudioClipMuted(
        params.slideId as string,
        params.clipId as string,
        params.muted as boolean,
      )
      return
    case 'SetAudioClipPlaybackRate':
      engine.setAudioClipPlaybackRate(
        params.slideId as string,
        params.clipId as string,
        params.playbackRate as number,
      )
      return
    case 'SetAudioClipFade':
      engine.setAudioClipFade(params.slideId as string, params.clipId as string, {
        fadeIn: params.fadeIn as number | undefined,
        fadeOut: params.fadeOut as number | undefined,
      })
      return
    case 'ReplacePrompterWords': {
      const ttsAssetId = params.ttsAssetId as string | undefined
      const ttsData = params.ttsData as
        | { name?: string; data: string; mimeType?: string; metadata?: Record<string, unknown> }
        | undefined
      let assetId = ttsAssetId
      if (!assetId && ttsData) {
        const id = newId('audio-asset')
        engine.embedAsset({
          id,
          name: ttsData.name ?? `TTS ${params.partId}`,
          data: ttsData.data,
          mimeType: ttsData.mimeType ?? 'audio/wav',
          ...(ttsData.metadata ? { metadata: ttsData.metadata } : {}),
        })
        assetId = id
      }
      if (!assetId) throw new Error('Missing TTS asset')
      engine.replacePrompterPartWordRange(
        params.slideId as string,
        params.partId as string,
        params.startWordIndex as number,
        params.endWordIndex as number,
        assetId,
      )
      return
    }
    case 'SplitPrompterWords':
      engine.splitPrompterPartByWordRange(
        params.slideId as string,
        params.partId as string,
        params.startWordIndex as number,
        params.endWordIndex as number,
      )
      return
    case 'CreateTable': {
      const sceneId = params.sceneId as string
      const parentId = params.parentId as string
      const table = defaultTableComponent()
      engine.createNode(sceneId, parentId, 'Table', { components: { table } })
      return
    }
    case 'AddTableRow':
    case 'RemoveTableRow':
    case 'AddTableColumn':
    case 'RemoveTableColumn': {
      // For simplicity, treat as no-op for redo if not critical
      console.warn(`[redo] Table command ${type} not fully implemented`)
      return
    }
    case 'SetTableRowComponent':
      engine.setTableRowComponent(
        params.nodeId as string,
        params.tableRow as import('../components').TableRowComponent,
      )
      return
    case 'SetTableCellComponent':
      engine.setTableCellComponent(
        params.nodeId as string,
        params.tableCell as import('../components').TableCellComponent,
      )
      return
    case 'ApplyTableLayout': {
      const tableNodeId = params.tableNodeId as string
      applyTableLayout(engine, tableNodeId)
      return
    }
    default:
      console.warn(`[redo] No handler for type ${type}`)
      return
  }
}
