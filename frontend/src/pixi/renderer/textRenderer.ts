import type { SceneNode } from '../../engine'
import type { TextComponent } from '../../engine/components'
import type { PixiContainer, PixiText, RendererPixi } from './pixi'
import type { WorldSize } from './worldGeometry'
import { hexColorToTint } from './placeholder'

const DEFAULT_FONT_SIZE = 24
const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif'

const textByContainer = new WeakMap<PixiContainer, PixiText>()
const textSizeByContainer = new WeakMap<PixiContainer, WorldSize>()

export function textDisplayOf(container: PixiContainer): PixiText | undefined {
  return textByContainer.get(container)
}

export function textSizeOf(container: PixiContainer): WorldSize | undefined {
  return textSizeByContainer.get(container)
}

export function createTextContainer(pixi: RendererPixi, node: SceneNode): PixiContainer {
  const textComponent = node.components.text
  if (!textComponent) {
    throw new Error(`Node "${node.name}" does not have a text component`)
  }

  const group = new pixi.Container()
  group.label = `text:${node.name}`

  const text = createTextObject(pixi, textComponent)
  textByContainer.set(group, text)
  group.addChild(text)

  applyTextSize(group, textComponent)

  return group
}

export function rebuildText(
  pixi: RendererPixi,
  group: PixiContainer,
  textComponent: TextComponent,
): void {
  for (const child of [...group.children]) {
    child.destroy()
  }

  const text = createTextObject(pixi, textComponent)
  textByContainer.set(group, text)
  group.addChild(text)

  applyTextSize(group, textComponent)
}

export function applyTextTint(group: PixiContainer, tint: string): void {
  const text = textByContainer.get(group)
  if (!text) {
    return
  }
  text.style.fill = hexColorToTint(tint)
}

function applyTextSize(group: PixiContainer, textComponent: TextComponent): void {
  const size = measureText(textComponent)
  textSizeByContainer.set(group, size)
  group.pivot.set(size.width / 2, size.height / 2)
}

function createTextObject(pixi: RendererPixi, textComponent: TextComponent): PixiText {
  const text = new pixi.Text({
    text: textComponent.content,
    style: buildTextStyle(textComponent),
  })
  text.label = 'text-display'
  return text
}

function buildTextStyle(textComponent: TextComponent): Record<string, unknown> {
  return {
    fontSize: textComponent.fontSize || DEFAULT_FONT_SIZE,
    fill: 0xffffff,
    fontFamily: DEFAULT_FONT_FAMILY,
    align: textComponent.alignment || 'left',
  }
}

function measureText(textComponent: TextComponent): WorldSize {
  const fontSize = textComponent.fontSize || DEFAULT_FONT_SIZE
  const content = textComponent.content || ''
  const estimatedWidth = Math.max(content.length * fontSize * 0.6, fontSize)
  const estimatedHeight = fontSize * 1.2
  return { width: estimatedWidth, height: estimatedHeight }
}
