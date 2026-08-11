import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'

export interface GridView {
  cameraX: number
  cameraY: number
  zoomX: number
  zoomY: number
  viewWidth: number
  viewHeight: number
  minorColor: number
  majorColor: number
  pixelRatio?: number
}

export const DEFAULT_MINOR_COLOR = 0xe8e8e8
export const DEFAULT_MAJOR_COLOR = 0xc4c4c4

const BASE_SPACING = 25
const MAX_SCREEN_SPACING = 50
const MAJOR_EVERY = 5
const MINOR_WIDTH = 1
const MAJOR_WIDTH = 3

export class GridRenderer {
  readonly graphics: PixiGraphics

  constructor(pixi: RendererPixi, parent: PixiContainer) {
    this.graphics = new pixi.Graphics()
    this.graphics.label = 'grid'
    parent.addChild(this.graphics)
  }

  update(view: GridView): void {
    const {
      cameraX,
      cameraY,
      zoomX,
      zoomY,
      viewWidth,
      viewHeight,
      minorColor,
      majorColor,
      pixelRatio = 1,
    } = view
    if (
      !Number.isFinite(zoomX) ||
      !Number.isFinite(zoomY) ||
      zoomX <= 0 ||
      zoomY <= 0 ||
      viewWidth <= 0 ||
      viewHeight <= 0
    ) {
      this.graphics.clear()
      return
    }

    const minorStepX = this.#minorStep(zoomX)
    const minorStepY = this.#minorStep(zoomY)
    const left = cameraX
    const top = cameraY
    const right = cameraX + viewWidth / zoomX
    const bottom = cameraY + viewHeight / zoomY

    this.graphics.clear()

    const verticalPositions = this.#linePositions(left, right, minorStepX)
    const horizontalPositions = this.#linePositions(top, bottom, minorStepY)

    this.#drawTier(
      verticalPositions,
      minorStepX,
      MINOR_WIDTH / zoomX,
      minorColor,
      cameraX,
      zoomX,
      top,
      bottom,
      true,
      pixelRatio,
      false,
    )
    this.#drawTier(
      horizontalPositions,
      minorStepY,
      MINOR_WIDTH / zoomY,
      minorColor,
      cameraY,
      zoomY,
      left,
      right,
      false,
      pixelRatio,
      false,
    )
    this.#drawTier(
      verticalPositions,
      minorStepX,
      MAJOR_WIDTH / zoomX,
      majorColor,
      cameraX,
      zoomX,
      top,
      bottom,
      true,
      pixelRatio,
      true,
    )
    this.#drawTier(
      horizontalPositions,
      minorStepY,
      MAJOR_WIDTH / zoomY,
      majorColor,
      cameraY,
      zoomY,
      left,
      right,
      false,
      pixelRatio,
      true,
    )
  }

  #drawTier(
    positions: number[],
    minorStep: number,
    width: number,
    color: number,
    cameraOffset: number,
    zoom: number,
    spanFrom: number,
    spanTo: number,
    vertical: boolean,
    pixelRatio: number,
    majorTier: boolean,
  ): void {
    for (const position of positions) {
      if (this.#isMajor(position, minorStep) !== majorTier) {
        continue
      }
      const snapped = this.#snap(position, cameraOffset, zoom, pixelRatio)
      if (vertical) {
        this.#drawLine(width, color, snapped, spanFrom, snapped, spanTo)
      } else {
        this.#drawLine(width, color, spanFrom, snapped, spanTo, snapped)
      }
    }
  }

  #linePositions(from: number, to: number, step: number): number[] {
    const positions: number[] = []
    const first = Math.floor(from / step) * step
    for (let position = first; position <= to; position += step) {
      positions.push(position)
    }
    return positions
  }

  #isMajor(position: number, minorStep: number): boolean {
    return Math.round(position / minorStep) % MAJOR_EVERY === 0
  }

  #snap(position: number, cameraOffset: number, zoom: number, pixelRatio: number): number {
    return (
      Math.round((position - cameraOffset) * zoom * pixelRatio) / (zoom * pixelRatio) + cameraOffset
    )
  }

  #minorStep(zoom: number): number {
    const exponent = Math.ceil(Math.log2(MAX_SCREEN_SPACING / (BASE_SPACING * zoom))) - 1
    return BASE_SPACING * Math.pow(2, exponent)
  }

  #drawLine(width: number, color: number, x1: number, y1: number, x2: number, y2: number): void {
    this.graphics.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color })
  }
}
