import { useEffect, useState } from 'react'
import { healthApi } from '../../api'

type BackendState = 'checking' | 'connected' | 'unavailable'

export function BackendStatus() {
  const [state, setState] = useState<BackendState>('checking')

  useEffect(() => {
    let cancelled = false
    healthApi
      .getHealth()
      .then(() => {
        if (!cancelled) {
          setState('connected')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState('unavailable')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking') {
    return <span className="backend-status backend-status--checking">Checking backend…</span>
  }
  if (state === 'connected') {
    return <span className="backend-status backend-status--connected">Backend connected</span>
  }
  return <span className="backend-status backend-status--unavailable">Backend unavailable</span>
}
