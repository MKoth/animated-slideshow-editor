import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_INSPECTOR_WIDTH,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  MAX_INSPECTOR_WIDTH,
  MAX_LEFT_SIDEBAR_WIDTH,
  MIN_INSPECTOR_WIDTH,
  MIN_LEFT_SIDEBAR_WIDTH,
  type SidebarTab,
  type Theme,
  type VisiblePanels,
} from './uiPrefs'

interface UiState {
  theme: Theme
  leftSidebarWidth: number
  inspectorWidth: number
  visiblePanels: VisiblePanels
  activeSidebarTab: SidebarTab
  gridSnap: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setLeftSidebarWidth: (width: number) => void
  setInspectorWidth: (width: number) => void
  setVisiblePanel: (panel: keyof VisiblePanels, visible: boolean) => void
  setActiveSidebarTab: (tab: SidebarTab) => void
  setGridSnap: (enabled: boolean) => void
  toggleGridSnap: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
      inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
      visiblePanels: { leftSidebar: true, inspector: true, timeline: true },
      activeSidebarTab: 'assets',
      gridSnap: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setLeftSidebarWidth: (width) =>
        set({ leftSidebarWidth: clamp(width, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH) }),
      setInspectorWidth: (width) =>
        set({ inspectorWidth: clamp(width, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH) }),
      setVisiblePanel: (panel, visible) =>
        set((state) => ({ visiblePanels: { ...state.visiblePanels, [panel]: visible } })),
      setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
      setGridSnap: (enabled) => set({ gridSnap: enabled }),
      toggleGridSnap: () => set((state) => ({ gridSnap: !state.gridSnap })),
    }),
    { name: 'editor-ui-prefs' },
  ),
)
