import { walkPreOrder } from './sceneNode'
import type { SceneNode } from './sceneNode'

const SUFFIX_PATTERN = /^(.*) \((\d+)\)$/

export function uniqueNodeName(taken: ReadonlySet<string>, requested: string): string {
  if (!taken.has(requested)) {
    return requested
  }
  const match = SUFFIX_PATTERN.exec(requested)
  const base = match ? match[1] : requested
  let counter = match ? Number(match[2]) : 1
  let candidate = ''
  do {
    counter += 1
    candidate = `${base} (${counter})`
  } while (taken.has(candidate))
  return candidate
}

export function namesInTree(root: SceneNode): Set<string> {
  const names = new Set<string>()
  for (const node of walkPreOrder(root)) {
    names.add(node.name)
  }
  return names
}
