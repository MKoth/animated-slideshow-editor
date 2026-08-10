import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_INSPECTOR_WIDTH,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_TIMELINE_HEIGHT,
  MAX_INSPECTOR_WIDTH,
  MAX_LEFT_SIDEBAR_WIDTH,
  MAX_TIMELINE_HEIGHT,
  MIN_INSPECTOR_WIDTH,
  MIN_LEFT_SIDEBAR_WIDTH,
  MIN_TIMELINE_HEIGHT,
  type SidebarTab,
  type Theme,
  type VisiblePanels,
} from './uiPrefs'

interface UiState {
  theme: Theme
  leftSidebarWidth: number
  inspectorWidth: number
  timelineHeight: number
  visiblePanels: VisiblePanels
  activeSidebarTab: SidebarTab
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setLeftSidebarWidth: (width: number) => void
  setInspectorWidth: (width: number) => void
  setTimelineHeight: (height: number) => void
  setVisiblePanel: (panel: keyof VisiblePanels, visible: boolean) => void
  setActiveSidebarTab: (tab: SidebarTab) => void
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
      timelineHeight: DEFAULT_TIMELINE_HEIGHT,
      visiblePanels: { leftSidebar: true, inspector: true, timeline: true },
      activeSidebarTab: 'assets',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setLeftSidebarWidth: (width) =>
        set({ leftSidebarWidth: clamp(width, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH) }),
      setInspectorWidth: (width) =>
        set({ inspectorWidth: clamp(width, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH) }),
      setTimelineHeight: (height) =>
        set({ timelineHeight: clamp(height, MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT) }),
      setVisiblePanel: (panel, visible) =>
        set((state) => ({ visiblePanels: { ...state.visiblePanels, [panel]: visible } })),
      setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
    }),
    { name: 'editor-ui-prefs' },
  ),
)
