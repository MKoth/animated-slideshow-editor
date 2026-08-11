import type { SceneNode } from '../../engine'
import type { PixiContainer, RendererPixi } from './pixi'

const PLACEHOLDER_WIDTH = 160
const PLACEHOLDER_HEIGHT = 100

export function createPlaceholder(pixi: RendererPixi, node: SceneNode): PixiContainer {
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`

  const box = new pixi.Graphics()
  box
    .rect(-PLACEHOLDER_WIDTH / 2, -PLACEHOLDER_HEIGHT / 2, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT)
    .fill({ color: placeholderColor(node.id), alpha: 0.85 })
    .stroke({ width: 2, color: 0xffffff, alpha: 0.35 })

  const label = new pixi.Text({
    text: node.name,
    style: {
      fontSize: 13,
      fill: 0xffffff,
      fontWeight: '600',
      fontFamily: 'system-ui, sans-serif',
    },
  })
  label.anchor.set(0.5, 0.5)

  group.addChild(box, label)
  return group
}

export function placeholderColor(nodeId: string): number {
  let hash = 0
  for (const character of nodeId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hslToHex(hash % 360, 55, 45)
}

function hslToHex(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * (saturation / 100)
  const section = hue / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = lightness - chroma / 2
  let red = 0
  let green = 0
  let blue = 0
  if (section < 1) {
    red = chroma
    green = secondary
  } else if (section < 2) {
    red = secondary
    green = chroma
  } else if (section < 3) {
    green = chroma
    blue = secondary
  } else if (section < 4) {
    green = secondary
    blue = chroma
  } else if (section < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }
  const toByte = (value: number) => Math.round((value + offset) * 255)
  return (toByte(red) << 16) | (toByte(green) << 8) | toByte(blue)
}
