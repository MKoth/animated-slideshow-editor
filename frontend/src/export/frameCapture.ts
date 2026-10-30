import type { EnginePublic } from '../engine/engine'
import { getActiveRenderer } from '../pixi/renderer/activeRenderer'
import { usePlaybackController } from '../stores/playbackStore'

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/**
 * Render one exact-timestamp frame and return its PNG data URL.
 *
 * Seeks the live preview (active slide + playhead time), waits for the Pixi
 * ticker to re-evaluate the scene, then captures through the renderer's
 * extract path — the same pixels as the editor preview at that timestamp.
 * Returns null when no renderer is mounted (tests, background tabs).
 */
export async function captureExportFrameAt(
  engine: EnginePublic,
  slideId: string,
  timestamp: number,
  duration: number,
): Promise<string | null> {
  try {
    if (engine.activeSlideId !== slideId) {
      engine.setActiveSlide(slideId)
    }
    usePlaybackController.getState().setCurrentTime(slideId, timestamp, duration)
    await nextPaint()
    const data = getActiveRenderer()?.captureExportFrame() ?? null
    if (data) return data
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    return canvas?.toDataURL?.('image/png') ?? null
  } catch {
    return null
  }
}

/** Snapshot preview transport so export can seek without disturbing the user. */
export interface PreviewSnapshot {
  readonly activeSlideId: string | null
  readonly times: Readonly<Record<string, number>>
  readonly wasPlaying: boolean
}

export function savePreviewSnapshot(engine: EnginePublic): PreviewSnapshot {
  const state = usePlaybackController.getState()
  return {
    activeSlideId: engine.activeSlideId,
    times: { ...state.currentTimes },
    wasPlaying: state.status === 'playing',
  }
}

export function restorePreviewSnapshot(engine: EnginePublic, snapshot: PreviewSnapshot): void {
  const controller = usePlaybackController.getState()
  controller.pause()
  for (const [slideId, time] of Object.entries(snapshot.times)) {
    const slide = engine.project?.slides.find((s) => s.id === slideId)
    if (slide) controller.setCurrentTime(slideId, time, slide.duration)
  }
  if (snapshot.activeSlideId) {
    try {
      engine.setActiveSlide(snapshot.activeSlideId)
    } catch {
      // Slide may have been deleted mid-export; keep current binding.
    }
  }
}
