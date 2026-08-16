import type { EnginePublic, Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { autoKeyCommands, dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import type { TimedKeyframeEdit } from '../../engine/keyframeEdit'
import { evaluatedWorldTransformOf, relativeTransform } from '../../engine/worldTransform'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform, WorldPoint, WorldTransform } from './worldGeometry'

export const BLOCKED_ANIMATED_MOVE_MESSAGE = 'Animated nodes can only be moved in Animation Mode'

const MOVE_START_DISTANCE = 2

export interface PositionCommit {
  readonly nodeId: string
  readonly x: number
  readonly y: number
}

interface AnimatedPreview {
  readonly startWorld: WorldTransform
  readonly parentWorld: WorldTransform | null
}

export interface AnimatedMoveGestureContext {
  readonly canvas: HTMLCanvasElement
  readonly engine?: EnginePublic
  readonly getAnimationMode?: () => boolean
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch?: DispatchCommand
}

export class AnimatedMoveGesture {
  readonly #canvas: HTMLCanvasElement
  readonly #engine?: EnginePublic
  readonly #getAnimationMode?: () => boolean
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch?: DispatchCommand
  readonly #origins = new Map<string, WorldPoint>()
  readonly #previews = new Map<string, AnimatedPreview>()
  #blocked = false
  #blockedNotified = false

  constructor(context: AnimatedMoveGestureContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getAnimationMode = context.getAnimationMode
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
  }

  get enabled(): boolean {
    return Boolean(this.#engine) && (this.#getAnimationMode?.() ?? false)
  }

  get blocked(): boolean {
    return this.#blocked
  }

  begin(ids: readonly string[]): void {
    this.#origins.clear()
    this.#previews.clear()
    const engine = this.#engine
    this.#blocked = false
    if (!this.enabled && engine) {
      this.#blocked = ids.some((id) => hasPositionKeyframes(engine, id))
    }
    if (this.#blocked) {
      return
    }
    const time = this.#playheadTime()
    for (const id of ids) {
      const node = this.#getScene()?.getNode(id)
      if (!node) {
        continue
      }
      let origin = { x: node.transform.x, y: node.transform.y }
      if (this.enabled && engine && time !== null) {
        const evaluated = evaluatedLocalPositionOf(engine, id, time)
        if (evaluated) {
          origin = evaluated
        }
        const preview = animatedPreviewOf(engine, id, time)
        if (preview) {
          this.#previews.set(id, preview)
        }
      }
      this.#origins.set(id, origin)
    }
  }

  originOf(nodeId: string): WorldPoint | undefined {
    return this.#origins.get(nodeId)
  }

  positionOf(nodeId: string, dx: number, dy: number): WorldPoint | null {
    const preview = this.#previews.get(nodeId)
    if (preview) {
      return previewLocalOf(preview, dx, dy)
    }
    const origin = this.#origins.get(nodeId)
    if (!origin) {
      return null
    }
    return { x: origin.x + dx, y: origin.y + dy }
  }

  snapAnchorOf(nodeId: string): WorldPoint | null {
    const preview = this.#previews.get(nodeId)
    if (preview) {
      return preview.startWorld
    }
    return this.#origins.get(nodeId) ?? null
  }

  handleBlockedMove(clientX: number, clientY: number, start: WorldPoint | null): void {
    if (this.#blockedNotified) {
      return
    }
    const camera = this.#getCameraTransform()
    if (!camera || !start) {
      return
    }
    const current = cursorToWorld(this.#canvas, camera, clientX, clientY)
    if (!current) {
      return
    }
    if (Math.hypot(current.x - start.x, current.y - start.y) < MOVE_START_DISTANCE) {
      return
    }
    this.#blockedNotified = true
    useNotificationStore.getState().notify(BLOCKED_ANIMATED_MOVE_MESSAGE)
  }

  commit(positions: readonly PositionCommit[]): void {
    const engine = this.#engine
    const dispatch = this.#dispatch
    const time = this.#playheadTime()
    if (!engine || !dispatch || time === null || positions.length === 0) {
      return
    }
    const edits: TimedKeyframeEdit[] = []
    for (const position of positions) {
      edits.push({
        target: { kind: 'node', nodeId: position.nodeId, property: 'positionX' },
        value: position.x,
        time,
      })
      edits.push({
        target: { kind: 'node', nodeId: position.nodeId, property: 'positionY' },
        value: position.y,
        time,
      })
    }
    dispatchKeyframeCommands(dispatch, autoKeyCommands(engine, edits))
  }

  reset(): void {
    this.#origins.clear()
    this.#previews.clear()
    this.#blocked = false
    this.#blockedNotified = false
  }

  #playheadTime(): number | null {
    return playheadTimeOf(this.#engine, this.#getScene())
  }
}

function hasPositionKeyframes(engine: EnginePublic, nodeId: string): boolean {
  return (
    engine.getKeyframes(nodeId, 'positionX').length > 0 ||
    engine.getKeyframes(nodeId, 'positionY').length > 0
  )
}

function evaluatedLocalPositionOf(
  engine: EnginePublic,
  nodeId: string,
  time: number,
): WorldPoint | null {
  try {
    const state = engine.evaluateNode(nodeId, time)
    return { x: state.transform.x, y: state.transform.y }
  } catch {
    return null
  }
}

function animatedPreviewOf(
  engine: EnginePublic,
  nodeId: string,
  time: number,
): AnimatedPreview | null {
  const startWorld = evaluatedWorldTransformOf(engine, nodeId, time)
  if (!startWorld) {
    return null
  }
  let parent: SceneNode | null = null
  try {
    parent = engine.getNode(nodeId).parent
  } catch {
    return null
  }
  if (!parent) {
    return { startWorld, parentWorld: null }
  }
  const parentWorld = evaluatedWorldTransformOf(engine, parent.id, time)
  if (!parentWorld || parentWorld.scaleX === 0 || parentWorld.scaleY === 0) {
    return { startWorld, parentWorld: null }
  }
  return { startWorld, parentWorld }
}

function previewLocalOf(preview: AnimatedPreview, dx: number, dy: number): WorldPoint {
  const target = {
    ...preview.startWorld,
    x: preview.startWorld.x + dx,
    y: preview.startWorld.y + dy,
  }
  if (preview.parentWorld) {
    const relative = relativeTransform(target, preview.parentWorld)
    if (relative) {
      return relative
    }
  }
  return target
}

function playheadTimeOf(engine: EnginePublic | undefined, scene: Scene | null): number | null {
  if (!engine || !scene) {
    return null
  }
  const slide = engine.project?.slides.find((candidate) => candidate.scene.id === scene.id)
  if (!slide) {
    return null
  }
  return usePlaybackController.getState().getTime(slide.id)
}
