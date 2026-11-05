export const CAMERA_FRAME_SIZES = [
  { id: '1920x1080', label: 'Full HD landscape', width: 1920, height: 1080 },
  { id: '1280x720', label: 'HD landscape', width: 1280, height: 720 },
  { id: '3840x2160', label: '4K landscape', width: 3840, height: 2160 },
  { id: '1440x1080', label: '4:3 landscape', width: 1440, height: 1080 },
  { id: '1080x1080', label: 'Square', width: 1080, height: 1080 },
  { id: '1080x1350', label: '4:5 portrait', width: 1080, height: 1350 },
  { id: '1080x1920', label: '9:16 portrait', width: 1080, height: 1920 },
] as const

export type CameraFrameSizeId = (typeof CAMERA_FRAME_SIZES)[number]['id']
export const DEFAULT_CAMERA_FRAME_SIZE: CameraFrameSizeId = '1920x1080'

export function cameraFrameDimensions(id: string): { width: number; height: number } {
  const size = CAMERA_FRAME_SIZES.find((item) => item.id === id)
  const fallback = CAMERA_FRAME_SIZES[0]
  return { width: size?.width ?? fallback.width, height: size?.height ?? fallback.height }
}

export function cameraAspectRatioLabel(id: string): string {
  const { width, height } = cameraFrameDimensions(id)
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

export interface CameraViewportRect {
  readonly width: number
  readonly height: number
  readonly offsetX: number
  readonly offsetY: number
}

export function cameraViewportScaleFactor(viewportWidth: number, frameWidth: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(frameWidth) || frameWidth <= 0) return 1
  return viewportWidth > 0 ? viewportWidth / frameWidth : 1
}

function gcd(a: number, b: number): number {
  let left = Math.round(a)
  let right = Math.round(b)
  while (right !== 0) [left, right] = [right, left % right]
  return Math.max(1, Math.abs(left))
}

/** Fit a fixed-ratio camera frame inside the resizable editor canvas host. */
export function cameraViewportForAspect(
  hostWidth: number,
  hostHeight: number,
  frameWidth: number,
  frameHeight: number,
): CameraViewportRect {
  if (![hostWidth, hostHeight, frameWidth, frameHeight].every(Number.isFinite)) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 }
  }
  if (hostWidth <= 0 || hostHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 }
  }
  const divisor = gcd(frameWidth, frameHeight)
  const unitWidth = frameWidth / divisor
  const unitHeight = frameHeight / divisor
  const units = Math.floor(Math.min(hostWidth / unitWidth, hostHeight / unitHeight))
  if (units < 1) return { width: 0, height: 0, offsetX: 0, offsetY: 0 }
  const width = unitWidth * units
  const height = unitHeight * units
  return {
    width,
    height,
    offsetX: Math.floor((hostWidth - width) / 2),
    offsetY: Math.floor((hostHeight - height) / 2),
  }
}
