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

export type MaterialsSectionId = 'materials' | 'shaders'

interface UiState {
  theme: Theme
  leftSidebarWidth: number
  inspectorWidth: number
  visiblePanels: VisiblePanels
  activeSidebarTab: SidebarTab
  activeMaterialsSection: MaterialsSectionId
  gridSnap: boolean
  animationMode: boolean
  cameraAnimationMode: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setLeftSidebarWidth: (width: number) => void
  setInspectorWidth: (width: number) => void
  setVisiblePanel: (panel: keyof VisiblePanels, visible: boolean) => void
  setActiveSidebarTab: (tab: SidebarTab) => void
  setActiveMaterialsSection: (section: MaterialsSectionId) => void
  setGridSnap: (enabled: boolean) => void
  toggleGridSnap: () => void
  setAnimationMode: (enabled: boolean) => void
  toggleAnimationMode: () => void
  setCameraAnimationMode: (enabled: boolean) => void
  toggleCameraAnimationMode: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

type ModeKey = 'animationMode' | 'cameraAnimationMode'

function withMode(
  state: Pick<UiState, 'animationMode' | 'cameraAnimationMode'>,
  mode: ModeKey,
  enabled: boolean,
): Partial<Pick<UiState, 'animationMode' | 'cameraAnimationMode'>> {
  return mode === 'animationMode'
    ? {
        animationMode: enabled,
        cameraAnimationMode: enabled ? false : state.cameraAnimationMode,
      }
    : {
        animationMode: enabled ? false : state.animationMode,
        cameraAnimationMode: enabled,
      }
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
      inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
      visiblePanels: { leftSidebar: true, inspector: true, timeline: true },
      activeSidebarTab: 'assets',
      activeMaterialsSection: 'materials' as MaterialsSectionId,
      gridSnap: false,
      animationMode: false,
      cameraAnimationMode: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setLeftSidebarWidth: (width) =>
        set({ leftSidebarWidth: clamp(width, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH) }),
      setInspectorWidth: (width) =>
        set({ inspectorWidth: clamp(width, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH) }),
      setVisiblePanel: (panel, visible) =>
        set((state) => ({ visiblePanels: { ...state.visiblePanels, [panel]: visible } })),
      setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
      setActiveMaterialsSection: (section) => set({ activeMaterialsSection: section }),
      setGridSnap: (enabled) => set({ gridSnap: enabled }),
      toggleGridSnap: () => set((state) => ({ gridSnap: !state.gridSnap })),
      setAnimationMode: (enabled) => set((state) => withMode(state, 'animationMode', enabled)),
      toggleAnimationMode: () =>
        set((state) => withMode(state, 'animationMode', !state.animationMode)),
      setCameraAnimationMode: (enabled) =>
        set((state) => withMode(state, 'cameraAnimationMode', enabled)),
      toggleCameraAnimationMode: () =>
        set((state) => withMode(state, 'cameraAnimationMode', !state.cameraAnimationMode)),
    }),
    { name: 'editor-ui-prefs' },
  ),
)
