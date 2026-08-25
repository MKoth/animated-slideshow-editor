import type { EmbeddedAsset } from './embeddedAsset'

function embeddedDataUrl(asset: { readonly data: string; readonly mimeType: string }): string {
  return `data:${asset.mimeType};base64,${asset.data}`
}

export function loadImageDataFromAsset(asset: EmbeddedAsset): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to create canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve(imageData)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = embeddedDataUrl(asset)
  })
}

export function hasTransparentPixels(imageData: ImageData): boolean {
  const { data } = imageData
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) {
      return true
    }
  }
  return false
}
