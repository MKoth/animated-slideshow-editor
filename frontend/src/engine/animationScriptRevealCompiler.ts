import type { RevealNode, ScriptExpression, SourceSpan, WipeNode } from './animationScriptParser'
import type { AnimationScriptBoundsRead } from './animationScriptReads'
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
  readonly resolveTarget: (
    expression: ScriptExpression,
    allowGroup: boolean,
    what: string,
  ) => { readonly members: readonly { readonly nodeId: string }[] } | null
  readonly bindingKind: (expression: ScriptExpression) => string | undefined
  readonly isVisible: (nodeId: string, time: number) => boolean
  readonly nodeBounds: (nodeId: string, time: number) => AnimationScriptBoundsRead | null
  readonly roundTime: (time: number) => number
  readonly formatSeconds: (time: number) => string
  readonly reportError: (message: string, span: SourceSpan) => void
}

/** Compile one reveal call into a fixed, measurable effect target. */
export function compileAnimationScriptReveal(
  statement: RevealNode | WipeNode,
  cursor: number,
  context: AnimationScriptRevealCompileContext,
): { readonly cursor: number; readonly effect?: SceneEffect } {
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

  let visual: SceneEffect['visual'] = { kind: label === 'wipe' ? 'cloth' : 'paw' }
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
        visual = { kind: 'asset', nodeId: visualNode.nodeId }
      } else {
        context.reportError(
          `${label} visual must be an Asset Instance binding or none`,
          statement.visual.span,
        )
      }
      if (!visualNode || !visualInfo?.isAssetInstance) return { cursor: Math.max(cursor, end) }
    }
  }

  const effect: SceneEffect =
    label === 'wipe'
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
  return {
    cursor: context.roundTime(cursor + duration),
    effect,
  }
}
