import { useContext, useEffect, useEffectEvent } from 'react'
import type { EngineEvent } from '../engine/events'
import { EngineContext } from './engineContext'
import type { EngineContextValue } from './engineContext'

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext)
  if (!value) {
    throw new Error('useEngine must be used within an EngineProvider')
  }
  return value
}

export function useEngineEvent(listener: (event: EngineEvent) => void): void {
  const { engine } = useEngine()
  const onEvent = useEffectEvent(listener)
  useEffect(() => engine.subscribe((event) => onEvent(event)), [engine])
}
