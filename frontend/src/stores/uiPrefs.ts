export type Theme = 'light' | 'dark'

export type SidebarTab = 'assets' | 'slides' | 'scene' | 'materials' | 'animations'

export interface VisiblePanels {
  leftSidebar: boolean
  inspector: boolean
  timeline: boolean
}

export const MIN_LEFT_SIDEBAR_WIDTH = 200
export const MAX_LEFT_SIDEBAR_WIDTH = 480
export const MIN_INSPECTOR_WIDTH = 220
export const MAX_INSPECTOR_WIDTH = 480
export const MIN_TIMELINE_HEIGHT = 120
export const MAX_TIMELINE_HEIGHT = 480

export const DEFAULT_LEFT_SIDEBAR_WIDTH = 240
export const DEFAULT_INSPECTOR_WIDTH = 260
export const DEFAULT_TIMELINE_HEIGHT = 200
