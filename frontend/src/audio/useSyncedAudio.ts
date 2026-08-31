import { useEffect, useMemo } from 'react'
import { useEngine } from '../app/useEngine'
import { SyncedAudioController, type AudioContextFactory } from './syncedAudioController'

export function useSyncedAudio(
  getAudioContext?: AudioContextFactory,
): SyncedAudioController | null {
  const { engine } = useEngine()

  const controller = useMemo(() => {
    let cached: import('./syncedAudioController').AudioContextLike | null | undefined
    const factory: AudioContextFactory =
      getAudioContext ??
      (() => {
        if (cached !== undefined) return cached
        const ctor =
          (
            window as unknown as {
              AudioContext?: typeof AudioContext
              webkitAudioContext?: typeof AudioContext
            }
          ).AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!ctor) {
          cached = null
          return null
        }
        try {
          cached = new ctor() as unknown as import('./syncedAudioController').AudioContextLike
          return cached
        } catch {
          cached = null
          return null
        }
      })
    return new SyncedAudioController({ engine, getAudioContext: factory })
    // getAudioContext is stable per caller; engine is stable from context
  }, [engine, getAudioContext])

  useEffect(() => {
    controller.attach()
    return () => controller.detach()
  }, [controller])

  return controller
}
