import { describe, expect, it } from 'vitest'
import { cameraViewportForAspect, cameraViewportScaleFactor } from '../engine/cameraFrameSize'

describe('camera frame aspect sizing', () => {
  it('keeps the selected pixel aspect ratio through viewport size changes', () => {
    const wideHost = cameraViewportForAspect(1800, 900, 1920, 1080)
    const narrowHost = cameraViewportForAspect(1400, 900, 1920, 1080)

    expect(wideHost.width / wideHost.height).toBeCloseTo(16 / 9)
    expect(narrowHost.width / narrowHost.height).toBeCloseTo(16 / 9)
    expect(wideHost.width).toBeLessThanOrEqual(1800)
    expect(wideHost.height).toBeLessThanOrEqual(900)
    expect(narrowHost.width).toBeLessThanOrEqual(1400)
    expect(narrowHost.height).toBeLessThanOrEqual(900)
    expect(wideHost.offsetX).toBeGreaterThan(narrowHost.offsetX)
    expect(narrowHost.offsetY).toBeGreaterThan(wideHost.offsetY)

    const authoredZoom = 2
    expect(
      wideHost.width / (authoredZoom * cameraViewportScaleFactor(wideHost.width, 1920)),
    ).toBeCloseTo(1920 / authoredZoom)
    expect(
      narrowHost.width / (authoredZoom * cameraViewportScaleFactor(narrowHost.width, 1920)),
    ).toBeCloseTo(1920 / authoredZoom)
  })
})
