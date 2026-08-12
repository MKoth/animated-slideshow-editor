import type { SceneNode } from '../../engine'
import type {
  PixiContainer,
  PixiGraphics,
  PixiSprite,
  PixiText,
  PixiTexture,
  RendererPixi,
} from './pixi'
import type { TextureCache } from './textureCache'
import type { WorldSize } from './worldGeometry'

const PLACEHOLDER_WIDTH = 160
const PLACEHOLDER_HEIGHT = 100
const labelByGroup = new WeakMap<PixiContainer, PixiText>()
const outlineByGroup = new WeakMap<PixiContainer, PixiGraphics>()
const bodyByGroup = new WeakMap<PixiContainer, PixiSprite>()

export function createPlaceholder(
  pixi: RendererPixi,
  node: SceneNode,
  cache: TextureCache,
  textureKey: string,
): PixiContainer {
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`

  const body = new pixi.Sprite(cache.get(textureKey))
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
  outlineByGroup.set(group, outline)
  bodyByGroup.set(group, body)
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

export function applyAssetTexture(group: PixiContainer, texture: PixiTexture): void {
  const body = bodyByGroup.get(group)
  if (!body) {
    return
  }
  body.texture = texture
  body.width = texture.width > 0 ? texture.width : PLACEHOLDER_WIDTH
  body.height = texture.height > 0 ? texture.height : PLACEHOLDER_HEIGHT
  const outline = outlineByGroup.get(group)
  if (outline) {
    outline.visible = false
  }
  const label = labelByGroup.get(group)
  if (label) {
    label.visible = false
  }
}

export function placeholderSize(group: PixiContainer): WorldSize | null {
  const body = bodyByGroup.get(group)
  if (!body) {
    return null
  }
  return { width: body.width, height: body.height }
}
