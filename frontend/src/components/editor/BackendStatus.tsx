import { useEffect } from 'react'
import { healthApi } from '../../api'
import { useBackendStore } from '../../stores/backendStore'

export function BackendStatus() {
  const status = useBackendStore((state) => state.status)

  useEffect(() => {
    let cancelled = false
    healthApi
      .getHealth()
      .then(() => {
        if (!cancelled) {
          useBackendStore.getState().markAvailable()
        }
      })
      .catch(() => {
        if (!cancelled) {
          useBackendStore.getState().markUnavailable()
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'checking') {
    return <span className="backend-status backend-status--checking">Checking backend…</span>
  }
  if (status === 'available') {
    return <span className="backend-status backend-status--connected">Backend connected</span>
  }
  return <span className="backend-status backend-status--unavailable">Backend unavailable</span>
}
