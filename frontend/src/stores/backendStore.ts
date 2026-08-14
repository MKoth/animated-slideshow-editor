import { create } from 'zustand'

export type BackendStatus = 'checking' | 'available' | 'unavailable'

interface BackendState {
  status: BackendStatus
  markAvailable: () => void
  markUnavailable: () => void
}

export const useBackendStore = create<BackendState>()((set) => ({
  status: 'checking',
  markAvailable: () => set({ status: 'available' }),
  markUnavailable: () => set({ status: 'unavailable' }),
}))
