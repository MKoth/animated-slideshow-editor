import { Application, Container, Graphics, Text } from 'pixi.js'

export interface RendererPixi {
  readonly Application: typeof Application
  readonly Container: typeof Container
  readonly Graphics: typeof Graphics
  readonly Text: typeof Text
}

export const realPixi: RendererPixi = { Application, Container, Graphics, Text }

export type PixiApplication = Application
export type PixiContainer = Container
export type PixiGraphics = Graphics
export type PixiText = Text
