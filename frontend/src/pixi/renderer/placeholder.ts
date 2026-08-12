import type { SceneNode } from '../../engine'
import type { PixiContainer, PixiText, RendererPixi } from './pixi'
import type { TextureCache } from './textureCache'

const PLACEHOLDER_WIDTH = 160
const PLACEHOLDER_HEIGHT = 100
const labelByGroup = new WeakMap<PixiContainer, PixiText>()

export function createPlaceholder(
  pixi: RendererPixi,
  node: SceneNode,
  cache: TextureCache,
): PixiContainer {
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`

  const body = new pixi.Sprite(cache.get(node.id))
  body.anchor.set(0.5, 0.5)
  body.width = PLACEHOLDER_WIDTH
  body.height = PLACEHOLDER_HEIGHT
  body.alpha = 0.85

  const outline = new pixi.Graphics()
  outline
    .rect(-PLACEHOLDER_WIDTH / 2, -PLACEHOLDER_HEIGHT / 2, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT)
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

  labelByGroup.set(group, label)
  group.addChild(body, outline, label)
  return group
}

export function applyPlaceholderName(group: PixiContainer, name: string): void {
  group.label = `placeholder:${name}`
  const label = labelByGroup.get(group)
  if (label) {
    label.text = name
  }
}
