import type {
  MarkEffectNode,
  RevealNode,
  ScriptExpression,
  SourceSpan,
  WipeNode,
} from './animationScriptParser'
import type { AnimationScriptBoundsRead } from './animationScriptReads'
import type { PlannedEffectAudioClip } from './animationScriptCompiler'
import type { SceneEffect } from './sceneEffect'
import { sampleAnimationScriptRevealTarget } from './animationScriptRevealTarget'

export interface RevealCompileNode {
  readonly id: string
  readonly parentId?: string
  readonly isRenderable?: boolean
  readonly isAssetInstance?: boolean
}

export interface AnimationScriptRevealCompileContext {
  readonly from: number
  readonly slideDuration: number
  readonly slideScope: string
  readonly effectIndex: number
  readonly nodes: readonly RevealCompileNode[]
  readonly evaluateNumber: (expression: ScriptExpression, what: string) => number | null
  readonly evaluateString: (expression: ScriptExpression, what: string) => string | null
  readonly resolveTarget: (
    expression: ScriptExpression,
    allowGroup: boolean,
    what: string,
  ) => { readonly members: readonly { readonly nodeId: string }[] } | null
  readonly resolveAudio: (
    expression: ScriptExpression,
    what: string,
  ) => { readonly assetId: string; readonly duration: number } | null
  readonly bindingKind: (expression: ScriptExpression) => string | undefined
  readonly isVisible: (nodeId: string, time: number) => boolean
  readonly nodeBounds: (nodeId: string, time: number) => AnimationScriptBoundsRead | null
  readonly roundTime: (time: number) => number
  readonly formatSeconds: (time: number) => string
  readonly reportError: (message: string, span: SourceSpan) => void
}

export interface CompiledRevealEffect {
  readonly cursor: number
  readonly effect?: SceneEffect
  readonly audioClips?: readonly PlannedEffectAudioClip[]
}

/** Named sprite anchors for an asset visual: which point of the image sits on the pen point. */
export const VISUAL_ANCHOR_NAMES = [
  'center',
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const

export type VisualAnchorName = (typeof VISUAL_ANCHOR_NAMES)[number]

const VISUAL_ANCHOR_POINTS: Record<VisualAnchorName, { readonly x: number; readonly y: number }> = {
  center: { x: 0.5, y: 0.5 },
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'center-left': { x: 0, y: 0.5 },
  'center-right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
}

/** Compile one reveal call into a fixed, measurable effect target. */
export function compileAnimationScriptReveal(
  statement: RevealNode | WipeNode | MarkEffectNode,
  cursor: number,
  context: AnimationScriptRevealCompileContext,
): CompiledRevealEffect {
  const label = statement.kind
  const startValue =
    statement.at === undefined
      ? cursor
      : context.evaluateNumber(statement.at, `a ${label} start time in seconds`)
  const duration =
    statement.over === undefined
      ? 1
      : context.evaluateNumber(statement.over, `a ${label} duration in seconds`)
  if (startValue === null || duration === null) return { cursor }
  const start = context.roundTime(startValue)
  const end = context.roundTime(start + duration)
  if (duration <= 0 || !Number.isFinite(duration)) {
    context.reportError(
      `${label} over: duration must be greater than 0`,
      statement.over?.span ?? statement.span,
    )
    return { cursor }
  }
  const invalidStart = start < context.from || start > context.slideDuration
  if (invalidStart) {
    context.reportError(
      `${label} at: ${context.formatSeconds(start)}s is outside the slide segment`,
      statement.at?.span ?? statement.span,
    )
  }
  const invalidEnd = end > context.slideDuration
  if (invalidEnd) {
    context.reportError(
      `${label} ends at ${context.formatSeconds(end)}s, past the slide duration (${context.formatSeconds(context.slideDuration)}s)`,
      statement.over?.span ?? statement.span,
    )
  }
  if (invalidStart || invalidEnd) return { cursor: Math.max(cursor, end) }

  let targetExpression = statement.target
  let includeDescendants = false
  if (statement.target.kind === 'call' && statement.target.callee === 'subtree') {
    if (statement.target.args.length !== 1) {
      context.reportError('subtree(target) takes exactly one node binding', statement.target.span)
      return { cursor: Math.max(cursor, end) }
    }
    targetExpression = statement.target.args[0]
    includeDescendants = true
  }
  const target = context.resolveTarget(targetExpression, true, label)
  if (!target) return { cursor: Math.max(cursor, end) }
  const bindingKind = context.bindingKind(targetExpression)
  includeDescendants ||= bindingKind === 'group' || bindingKind === 'table'
  const sampledTarget = sampleAnimationScriptRevealTarget({
    nodes: context.nodes,
    rootNodeIds: target.members.map((member) => member.nodeId),
    includeDescendants,
    time: start,
    isVisible: context.isVisible,
    nodeBounds: context.nodeBounds,
  })
  if (!sampledTarget) {
    context.reportError(
      `${label} target has no visible, measurable renderable content at its start time`,
      targetExpression.span,
    )
    return { cursor: Math.max(cursor, end) }
  }

  let visual: SceneEffect['visual'] =
    label === 'wipe' ? { kind: 'cloth' } : label === 'mark' ? { kind: 'marker' } : { kind: 'paw' }
  let visualNodeId: string | null = null
  if (statement.visual !== undefined) {
    if (statement.visual.kind === 'identifier' && statement.visual.name === 'none') {
      visual = { kind: 'none' }
    } else {
      const visualTarget = context.resolveTarget(statement.visual, false, `${label} visual`)
      if (!visualTarget) return { cursor: Math.max(cursor, end) }
      if (visualTarget.members.length !== 1) {
        context.reportError(
          `${label} visual must resolve to exactly one Asset Instance`,
          statement.visual.span,
        )
        return { cursor: Math.max(cursor, end) }
      }
      const visualNode = visualTarget.members[0]
      const visualInfo = visualNode
        ? context.nodes.find((node) => node.id === visualNode.nodeId)
        : undefined
      if (visualNode && visualInfo?.isAssetInstance) {
        visualNodeId = visualNode.nodeId
      } else {
        context.reportError(
          `${label} visual must be an Asset Instance binding or none`,
          statement.visual.span,
        )
      }
      if (!visualNode || !visualInfo?.isAssetInstance) return { cursor: Math.max(cursor, end) }
    }
  }

  const hasVisualTuning =
    statement.visualScale !== undefined ||
    statement.visualAnchor !== undefined ||
    statement.visualDx !== undefined ||
    statement.visualDy !== undefined
  let visualScale = 1
  let anchorX = 0.5
  let anchorY = 0.5
  let visualDx = 0
  let visualDy = 0
  if (hasVisualTuning && visualNodeId === null) {
    const span =
      statement.visualScale?.span ??
      statement.visualAnchor?.span ??
      statement.visualDx?.span ??
      statement.visualDy?.span ??
      statement.span
    context.reportError(
      `${label} visualScale, visualAnchor, visualDx and visualDy need an asset visual — bind one like visual: paw where bind paw = asset("Paw")`,
      span,
    )
    return { cursor: Math.max(cursor, end) }
  }
  if (statement.visualScale !== undefined) {
    const scale = context.evaluateNumber(statement.visualScale, `a ${label} visualScale multiplier`)
    if (scale === null) return { cursor: Math.max(cursor, end) }
    if (!Number.isFinite(scale) || scale <= 0) {
      context.reportError(`${label} visualScale must be greater than 0`, statement.visualScale.span)
      return { cursor: Math.max(cursor, end) }
    }
    visualScale = scale
  }
  if (statement.visualAnchor !== undefined) {
    const anchor = context.evaluateString(
      statement.visualAnchor,
      `a ${label} visualAnchor name (${VISUAL_ANCHOR_NAMES.join(', ')})`,
    )
    if (anchor === null) return { cursor: Math.max(cursor, end) }
    const point = VISUAL_ANCHOR_POINTS[anchor as VisualAnchorName]
    if (!point) {
      context.reportError(
        `Unknown ${label} visualAnchor "${anchor}". Available anchors: ${VISUAL_ANCHOR_NAMES.join(', ')}.`,
        statement.visualAnchor.span,
      )
      return { cursor: Math.max(cursor, end) }
    }
    anchorX = point.x
    anchorY = point.y
  }
  if (statement.visualDx !== undefined) {
    const dx = context.evaluateNumber(statement.visualDx, `a ${label} visualDx offset`)
    if (dx === null) return { cursor: Math.max(cursor, end) }
    if (!Number.isFinite(dx)) {
      context.reportError(
        `${label} visualDx must be a finite number of world units`,
        statement.visualDx.span,
      )
      return { cursor: Math.max(cursor, end) }
    }
    visualDx = dx
  }
  if (statement.visualDy !== undefined) {
    const dy = context.evaluateNumber(statement.visualDy, `a ${label} visualDy offset`)
    if (dy === null) return { cursor: Math.max(cursor, end) }
    if (!Number.isFinite(dy)) {
      context.reportError(
        `${label} visualDy must be a finite number of world units`,
        statement.visualDy.span,
      )
      return { cursor: Math.max(cursor, end) }
    }
    visualDy = dy
  }
  if (visualNodeId !== null) {
    visual = {
      kind: 'asset',
      nodeId: visualNodeId,
      ...(visualScale !== 1 ? { scale: visualScale } : {}),
      ...(anchorX !== 0.5 ? { anchorX } : {}),
      ...(anchorY !== 0.5 ? { anchorY } : {}),
      ...(visualDx !== 0 ? { dx: visualDx } : {}),
      ...(visualDy !== 0 ? { dy: visualDy } : {}),
    }
  }

  const effect: SceneEffect =
    label === 'mark'
      ? {
          kind: 'mark',
          id: `script-effect:${context.slideScope}:${context.effectIndex}`,
          start,
          duration,
          scopeNodeIds: [...new Set(target.members.map((member) => member.nodeId))],
          nodeIds: sampledTarget.nodeIds,
          bounds: sampledTarget.bounds,
          visual: visual as Extract<SceneEffect, { kind: 'mark' }>['visual'],
        }
      : label === 'wipe'
        ? {
            kind: 'wipe',
            id: `script-effect:${context.slideScope}:${context.effectIndex}`,
            start,
            duration,
            scopeNodeIds: [...new Set(target.members.map((member) => member.nodeId))],
            nodeIds: sampledTarget.nodeIds,
            bounds: sampledTarget.bounds,
            visual: visual as Extract<SceneEffect, { kind: 'wipe' }>['visual'],
          }
        : {
            kind: 'reveal',
            id: `script-effect:${context.slideScope}:${context.effectIndex}`,
            start,
            duration,
            scopeNodeIds: [...new Set(target.members.map((member) => member.nodeId))],
            nodeIds: sampledTarget.nodeIds,
            bounds: sampledTarget.bounds,
            visual: visual as Extract<SceneEffect, { kind: 'reveal' }>['visual'],
          }

  if (statement.sound === undefined) {
    return {
      cursor: context.roundTime(cursor + duration),
      effect,
    }
  }

  const sound = context.resolveAudio(statement.sound, `${label} sound`)
  if (!sound) return { cursor: Math.max(cursor, end) }
  if (!Number.isFinite(sound.duration) || sound.duration <= 0) {
    context.reportError(
      `${label} sound audio has no usable duration — re-import it so its duration is known`,
      statement.sound.span,
    )
    return { cursor: Math.max(cursor, end) }
  }

  const repetitions = Math.max(1, Math.ceil(duration / sound.duration))
  const audioClips = Array.from({ length: repetitions }, (_, index) => {
    const timelineStart = context.roundTime(start + index * sound.duration)
    const remaining = duration - index * sound.duration
    const sourceEnd = context.roundTime(Math.min(sound.duration, remaining))
    return {
      id: `script-effect-clip:${context.slideScope}:${context.effectIndex}:${index}`,
      assetId: sound.assetId,
      timelineStart,
      sourceStart: 0,
      sourceEnd,
    }
  })

  return {
    cursor: context.roundTime(cursor + duration),
    effect,
    audioClips,
  }
}
