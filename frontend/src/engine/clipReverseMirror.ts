import type { ClipDefinition } from './clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId, ZERO_TANGENT } from './keyframe'
import { createReversedClipDefinition } from './clipReverse'
import {
  createMirroredClipDefinition,
  requireMirrorAxis,
  type MirrorAxis,
  type MirroredClipResult,
} from './clipMirror'

export function reverseMirrorClipDefaultName(sourceName: string, axis: MirrorAxis): string {
  requireMirrorAxis(axis)
  return `${sourceName} Reversed Mirrored (${axis})`
}

/**
 * Collection-level default name: same "<original> Reversed Mirrored (X)"
 * format as single clips. Kept as a separate export so collection surfaces
 * do not depend on the clip naming helper by accident.
 */
export function reverseMirrorCollectionDefaultName(sourceName: string, axis: MirrorAxis): string {
  requireMirrorAxis(axis)
  return reverseMirrorClipDefaultName(sourceName, axis)
}

/**
 * Create a reversed + spatially mirrored copy of a clip.
 *
 * Reverse applies first (temporal `t' = 1 - t`, hold-correct on
 * visible/zIndex, `isReversed = true` for parametric evaluation), then the
 * spatial mirror (axis/rotation negation). Morph shape names and collection
 * bindings stay on their original side — no left↔right guessing; the
 * symmetry 1 → 0 bracket alone carries the mirror.
 */
export function createReverseMirroredClipDefinition(
  source: ClipDefinition,
  axis: MirrorAxis,
  newName?: string,
): MirroredClipResult {
  requireMirrorAxis(axis)
  const name = newName ?? reverseMirrorClipDefaultName(source.name, axis)
  const reversed = createReversedClipDefinition(source, name)
  const { clip, skipped } = createMirroredClipDefinition(reversed, axis, name, {
    preserveMorphNames: true,
  })
  // isReversed survives the mirror via pass-through; assert the composition
  // never silently drops the temporal reversal.
  clip.isReversed = true
  // Bracket: exactly these two keys, replacing whatever the source carried.
  for (const existing of clip.getSymmetryKeyframes()) {
    clip.removeSymmetryKeyframe(existing.id)
  }
  const symAxis = axis === 'X' ? 'x' : 'y'
  clip.addSymmetryKeyframe(
    new KeyframeModel(
      newKeyframeId(),
      0,
      { axis: symAxis, factor: 1 } as never,
      'hold',
      { ...ZERO_TANGENT },
      { ...ZERO_TANGENT },
    ),
  )
  clip.addSymmetryKeyframe(
    new KeyframeModel(
      newKeyframeId(),
      1,
      { axis: symAxis, factor: 0 } as never,
      'hold',
      { ...ZERO_TANGENT },
      { ...ZERO_TANGENT },
    ),
  )
  return { clip, skipped }
}
