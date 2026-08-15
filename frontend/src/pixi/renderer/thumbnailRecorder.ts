import type { EngineEvent } from '../../engine'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import type { PixiApplication } from './pixi'

export type CanvasCapture = (app: PixiApplication) => string | null

export class ThumbnailRecorder {
  readonly #capture: CanvasCapture
  #app: PixiApplication | null = null
  #boundSlideId: string | null = null
  #disposed = false

  constructor(capture: CanvasCapture = extractCanvasCapture) {
    this.#capture = capture
  }

  attach(app: PixiApplication): void {
    this.#app = app
    this.#disposed = false
  }

  detach(): void {
    this.#app = null
    this.#disposed = true
  }

  setBoundSlideId(slideId: string | null): void {
    this.#boundSlideId = slideId
  }

  handleEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'ProjectLoaded':
        useThumbnailStore.getState().clear()
        break
      case 'SlideRemoved':
        useThumbnailStore.getState().remove(event.slideId)
        break
      case 'SlideActivated':
      case 'SlideCreated':
        this.#scheduleCapture()
        break
      case 'SlideShaderChanged':
      case 'SlideShaderUniformChanged':
        if (event.slideId === this.#boundSlideId) {
          this.#scheduleCapture()
        }
        break
    }
  }

  #scheduleCapture(): void {
    const app = this.#app
    if (!app) {
      return
    }
    app.ticker.addOnce(() => {
      if (this.#disposed || !this.#boundSlideId) {
        return
      }
      const dataUrl = this.#capture(app)
      if (dataUrl) {
        useThumbnailStore.getState().setThumbnail(this.#boundSlideId, dataUrl)
      }
    })
  }
}

export function extractCanvasCapture(app: PixiApplication): string | null {
  try {
    const canvas = app.renderer.extract?.canvas(app.stage) ?? app.canvas
    const dataUrl = (
      canvas as { toDataURL?: (type?: string, quality?: number) => string }
    ).toDataURL?.('image/png')
    return dataUrl ?? null
  } catch {
    return null
  }
}
