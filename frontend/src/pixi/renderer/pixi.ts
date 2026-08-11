import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'

export interface RendererPixi {
  readonly Application: typeof Application
  readonly Container: typeof Container
  readonly Graphics: typeof Graphics
  readonly Text: typeof Text
  readonly Sprite: typeof Sprite
  readonly Texture: typeof Texture
}

export const realPixi: RendererPixi = { Application, Container, Graphics, Text, Sprite, Texture }

export type PixiApplication = Application
export type PixiContainer = Container
export type PixiGraphics = Graphics
export type PixiText = Text
export type PixiSprite = Sprite
export type PixiTexture = Texture
