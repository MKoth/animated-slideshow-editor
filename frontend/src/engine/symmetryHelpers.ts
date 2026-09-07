import type { EnginePublic } from './engine'
import { walkPreOrder } from './sceneNode'
import type { SymmetryAxis } from './symmetry'
import type { Command } from './commands/command'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { SetKeyframeValueCommand } from './commands/setKeyframeValueCommand'
import { keyframeAtTime } from './keyframeEdit'

/**
 * Build keyframe commands to animate symmetry for a subtree.
 * For each node in walkPreOrder(root):
 *  - symmetry track value {axis, factor:1} at time
 *  - mirrored transform position/rotation keyframes if needed
 */
export function symmetryKeyframeCommandsForSubtree(
  engine: EnginePublic,
  rootNodeId: string,
  axis: SymmetryAxis,
  time: number,
): Command<unknown>[] {
  const root = engine.getNode(rootNodeId)
  const nodes = [...walkPreOrder(root)]
  const commands: Command<unknown>[] = []

  for (const node of nodes) {
    // Symmetry factor keyframe (mesh)
    if (node.components.mesh) {
      const target = { kind: 'symmetry' as const, nodeId: node.id }
      const value = { axis, factor: 1 }
      const existing = engine
        .getSymmetryKeyframes(node.id)
        .find((k) => k.time === time)
      if (existing) {
        if (JSON.stringify(existing.value) !== JSON.stringify(value)) {
          commands.push(
            new SetKeyframeValueCommand({ target, keyframeId: existing.id, newValue: value }),
          )
        }
      } else {
        // Check evaluated already equals?
        const cur = engine.evaluateSymmetry(node.id, time)
        if (!cur || cur.axis !== axis || cur.factor !== 1) {
          commands.push(new AddKeyframeCommand({ target, time, value }))
        }
      }
    }

    // Transform mirroring via position/rotation keyframes
    // Use engine.evaluateNode to get current evaluated values at time, then mirror
    // We create keyframes on positionX/Y/rotation tracks
    const evalState = engine.evaluateNode(node.id, time)
    const needsX = axis === 'x'
    const needsY = axis === 'y'

    if (needsX) {
      const mirroredX = -evalState.transform.x
      const target = { kind: 'node' as const, nodeId: node.id, property: 'positionX' as const }
      const kfAt = keyframeAtTime(engine.getKeyframes(node.id, 'positionX'), time)
      if (kfAt) {
        if (kfAt.value !== mirroredX) {
          commands.push(
            new SetKeyframeValueCommand({ target, keyframeId: kfAt.id, newValue: mirroredX }),
          )
        }
      } else if (evalState.transform.x !== mirroredX) {
        commands.push(new AddKeyframeCommand({ target, time, value: mirroredX }))
      }
    }
    if (needsY) {
      const mirroredY = -evalState.transform.y
      const target = { kind: 'node' as const, nodeId: node.id, property: 'positionY' as const }
      const kfAt = keyframeAtTime(engine.getKeyframes(node.id, 'positionY'), time)
      if (kfAt) {
        if (kfAt.value !== mirroredY) {
          commands.push(
            new SetKeyframeValueCommand({ target, keyframeId: kfAt.id, newValue: mirroredY }),
          )
        }
      } else if (evalState.transform.y !== mirroredY) {
        commands.push(new AddKeyframeCommand({ target, time, value: mirroredY }))
      }
    }
    // Rotation always mirrored (reflection reverses angle)
    {
      const mirroredRot = -evalState.transform.rotation
      const target = { kind: 'node' as const, nodeId: node.id, property: 'rotation' as const }
      // Skip camera rotation (not animatable)
      if (!node.components.camera) {
        const kfAt = keyframeAtTime(engine.getKeyframes(node.id, 'rotation'), time)
        if (kfAt) {
          if (kfAt.value !== mirroredRot) {
            commands.push(
              new SetKeyframeValueCommand({ target, keyframeId: kfAt.id, newValue: mirroredRot }),
            )
          }
        } else if (evalState.transform.rotation !== mirroredRot) {
          // Only create if not already symmetric (avoid no-op at 0)
          if (mirroredRot !== evalState.transform.rotation) {
            commands.push(new AddKeyframeCommand({ target, time, value: mirroredRot }))
          }
        }
      }
    }

    // Imported images render as sprites. Their reflection must be represented by
    // a negative scale; position and rotation alone only move the image.
    if (node.components.assetInstance) {
      const property = axis === 'x' ? ('scaleX' as const) : ('scaleY' as const)
      const mirroredScale = -evalState.transform[property]
      const target = { kind: 'node' as const, nodeId: node.id, property }
      const kfAt = keyframeAtTime(engine.getKeyframes(node.id, property), time)
      if (kfAt) {
        if (kfAt.value !== mirroredScale) {
          commands.push(
            new SetKeyframeValueCommand({ target, keyframeId: kfAt.id, newValue: mirroredScale }),
          )
        }
      } else if (evalState.transform[property] !== mirroredScale) {
        commands.push(new AddKeyframeCommand({ target, time, value: mirroredScale }))
      }
    }
  }

  return commands
}
