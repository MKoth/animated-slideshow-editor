import type { WorldSize } from './worldGeometry'

export type NodeSizeProvider = (nodeId: string) => WorldSize | null

let provider: NodeSizeProvider | null = null

/**
 * The mounted renderer registers its measured node sizes here, so Animation
 * Script compile-time `bounds(...)` reads use the same renderer-measured
 * geometry the canvas draws (text sizes are the renderer's deterministic
 * metric estimate — the Video Export determinism class). A node the renderer
 * has not measured reads as null.
 *
 * Returns an unregister callback that only clears this registration, so a
 * renderer unmounting cannot clear a newer renderer's provider.
 */
export function setNodeSizeProvider(next: NodeSizeProvider | null): () => void {
  provider = next
  return () => {
    if (provider === next) {
      provider = null
    }
  }
}

export function measuredNodeSize(nodeId: string): WorldSize | null {
  return provider?.(nodeId) ?? null
}
