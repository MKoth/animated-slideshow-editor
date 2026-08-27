import type { PixiTexture, RendererPixi } from './pixi'

export interface SvgToPixiTextureOptions {
  readonly resolution?: number
  readonly alphaMode?: string
}

export async function svgToPixiTextureAsync(
  pixi: RendererPixi,
  svg: SVGElement,
  options: SvgToPixiTextureOptions = {},
): Promise<PixiTexture> {
  const resolution = options.resolution ?? 2
  const alphaMode = options.alphaMode ?? 'premultiply-alpha-on-upload'

  const xmlSerializer = new XMLSerializer()
  const svgString = xmlSerializer.serializeToString(svg)
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const blobUrl = URL.createObjectURL(blob)

  try {
    const image = new Image()

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Failed to load SVG from blob URL'))
      image.src = blobUrl
    })

    // Safari compositing race-condition workaround: wait two animation frames
    // after the image loads before rasterizing. This ensures the browser has
    // finished compositing the SVG onto the Image element.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth * resolution
    canvas.height = image.naturalHeight * resolution
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    const texture = pixi.Texture.from(canvas)
    texture.source.alphaMode = alphaMode as never

    return texture
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}
