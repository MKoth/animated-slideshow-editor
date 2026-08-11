import type { PixiContainer, RendererPixi } from './pixi'

const AXIS_LENGTH = 64
const X_AXIS_COLOR = 0xff4d4d
const Y_AXIS_COLOR = 0x4caf50

export function createAxisLines(pixi: RendererPixi): PixiContainer {
  const container = new pixi.Container()
  container.label = 'axis-lines'

  const lines = new pixi.Graphics()
  lines.moveTo(0, 0).lineTo(AXIS_LENGTH, 0).stroke({ width: 2, color: X_AXIS_COLOR, alpha: 0.8 })
  lines.moveTo(0, 0).lineTo(0, AXIS_LENGTH).stroke({ width: 2, color: Y_AXIS_COLOR, alpha: 0.8 })

  container.addChild(lines)
  return container
}
