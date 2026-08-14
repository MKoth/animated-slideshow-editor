import { create } from 'zustand'
import type { MissingAssetsReport } from '../engine'

interface MissingAssetsState {
  report: MissingAssetsReport | null
  dialogVisible: boolean
  setReport: (report: MissingAssetsReport | null) => void
  dismissDialog: () => void
}

export const useMissingAssetsStore = create<MissingAssetsState>()((set) => ({
  report: null,
  dialogVisible: false,
  setReport: (report) => {
    const meaningful = report !== null && report.missing.length > 0
    set({ report: meaningful ? report : null, dialogVisible: meaningful })
  },
  dismissDialog: () => set({ dialogVisible: false }),
}))
