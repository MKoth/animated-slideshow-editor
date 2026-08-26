import {
  Application,
  Assets,
  Container,
  Filter,
  GlProgram,
  Graphics,
  MeshSimple,
  RenderTexture,
  Sprite,
  Text,
  Texture,
} from 'pixi.js'

export interface PixiGlProgramOptions {
  vertex: string
  fragment: string
  name?: string
}

export interface PixiMeshSimpleOptions {
  texture: PixiTexture
  vertices?: Float32Array
  uvs?: Float32Array
  indices?: Uint32Array
  topology?: 'triangle-list'
}

export interface PixiRenderTextureOptions {
  width: number
  height: number
  dynamic?: boolean
}

export interface RendererPixi {
  readonly Application: typeof Application
  readonly Container: typeof Container
  readonly Graphics: typeof Graphics
  readonly MeshSimple: new (options: PixiMeshSimpleOptions) => PixiMeshSimple
  readonly Text: typeof Text
  readonly Sprite: typeof Sprite
  readonly Texture: typeof Texture
  readonly Filter: typeof Filter
  readonly GlProgram: {
    from: (options: PixiGlProgramOptions) => PixiGlProgram
  }
  readonly RenderTexture: {
    create: (options: PixiRenderTextureOptions) => PixiRenderTexture
  }
  readonly Assets: {
    load: (url: string) => Promise<PixiTexture>
    unload: (url: string) => Promise<void>
  }
}

export const realPixi: RendererPixi = {
  Application,
  Container,
  Graphics,
  MeshSimple,
  Text,
  Sprite,
  Texture,
  Filter,
  GlProgram: {
    from: (options) => GlProgram.from(options),
  },
  RenderTexture: {
    create: (options) => RenderTexture.create(options),
  },
  Assets: {
    load: (url) => Assets.load(url) as Promise<PixiTexture>,
    unload: (url) => Assets.unload(url),
  },
}

export type PixiApplication = Application
export type PixiContainer = Container
export type PixiGraphics = Graphics
export type PixiMeshSimple = MeshSimple
export type PixiText = Text
export type PixiSprite = Sprite
export type PixiTexture = Texture
export type PixiFilter = Filter
export type PixiGlProgram = GlProgram
export type PixiRenderTexture = RenderTexture
