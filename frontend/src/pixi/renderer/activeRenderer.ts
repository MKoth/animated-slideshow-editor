import type { Renderer } from './renderer'

let activeRenderer: Renderer | null = null

export function setActiveRenderer(renderer: Renderer | null): void {
  activeRenderer = renderer
}

export function getActiveRenderer(): Renderer | null {
  return activeRenderer
}
