import type { EnginePublic, Unsubscribe } from '../engine'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

export function registerActiveSlideSync(engine: EnginePublic): Unsubscribe {
  return engine.subscribe((event) => {
    if (event.type === 'SlideActivated') {
      usePlaybackController.getState().stopPreservingTimes()
      useSelectionStore.getState().clear()
    }
  })
}
