export interface DevOverlayStats {
  fps: number
  cameraX: number
  cameraY: number
  zoom: number
  nodeCount: number
}

export class DevOverlay {
  readonly #host: HTMLElement
  #element: HTMLDivElement | null = null

  constructor(host: HTMLElement) {
    this.#host = host
  }

  update(stats: DevOverlayStats): void {
    const element = this.#element ?? this.#create()
    element.textContent =
      `FPS ${stats.fps.toFixed(1)} · Camera (${stats.cameraX.toFixed(2)}, ` +
      `${stats.cameraY.toFixed(2)}) · Zoom ${stats.zoom.toFixed(2)} · Nodes ${stats.nodeCount}`
  }

  hide(): void {
    this.#element?.remove()
    this.#element = null
  }

  #create(): HTMLDivElement {
    const element = document.createElement('div')
    element.className = 'canvas-dev-overlay'
    this.#host.appendChild(element)
    this.#element = element
    return element
  }
}
