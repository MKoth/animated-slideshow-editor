import { useMemo, useState } from 'react'
import { useEngine, useEngineEvent } from '../app/useEngine'
import { computeProjectFingerprint } from './proposals'

export function useFingerprint(engine: ReturnType<typeof useEngine>['engine']): string {
  const [tick, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))
  return useMemo(() => {
    void tick
    try {
      return computeProjectFingerprint(engine)
    } catch {
      return ''
    }
  }, [engine, tick])
}
