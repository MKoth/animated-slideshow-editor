import type { SceneNode } from '../../engine'
import type { WorldPoint } from './worldGeometry'

export function cursorToWorld(
  canvas: HTMLCanvasElement,
  camera: SceneNode,
  clientX: number,
  clientY: number,
): WorldPoint | null {
  const { x, y, scaleX, scaleY } = camera.transform
  if (scaleX <= 0 || scaleY <= 0) {
    return null
  }
  const rect = canvas.getBoundingClientRect()
  return {
    x: x + (clientX - rect.left) / scaleX,
    y: y + (clientY - rect.top) / scaleY,
  }
}
