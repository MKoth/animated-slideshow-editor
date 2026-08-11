import { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { DebugPanel } from '../debug/DebugPanel'
import { CanvasPanel } from '../panels/CanvasPanel'
import { InspectorPanel } from '../panels/InspectorPanel'
import { TimelinePanel } from '../panels/TimelinePanel'
import { LeftSidebar } from './LeftSidebar'
import { MenuBar } from './MenuBar'
import { Splitter } from './Splitter'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'

const MIN_SUPPORTED_WIDTH = 1400

function useMinSupportedWidth(minWidth: number): boolean {
  const [supported, setSupported] = useState(() => window.innerWidth >= minWidth)

  useEffect(() => {
    const handleResize = () => setSupported(window.innerWidth >= minWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [minWidth])

  return supported
}

export function EditorLayout() {
  const widthSupported = useMinSupportedWidth(MIN_SUPPORTED_WIDTH)
  const leftSidebarWidth = useUiStore((state) => state.leftSidebarWidth)
  const inspectorWidth = useUiStore((state) => state.inspectorWidth)
  const timelineHeight = useUiStore((state) => state.timelineHeight)
  const setLeftSidebarWidth = useUiStore((state) => state.setLeftSidebarWidth)
  const setInspectorWidth = useUiStore((state) => state.setInspectorWidth)
  const setTimelineHeight = useUiStore((state) => state.setTimelineHeight)

  if (!widthSupported) {
    return (
      <div className="editor-layout editor-layout--too-small">
        <p className="too-small-message">
          The editor is intended for larger screens (minimum 1400px width).
        </p>
      </div>
    )
  }

  return (
    <div className="editor-layout">
      <MenuBar />
      <Toolbar />
      <div className="editor-workspace">
        <LeftSidebar width={leftSidebarWidth} />
        <Splitter
          orientation="vertical"
          ariaLabel="Resize left sidebar"
          onDrag={(delta) => setLeftSidebarWidth(useUiStore.getState().leftSidebarWidth + delta)}
        />
        <CanvasPanel />
        <Splitter
          orientation="vertical"
          ariaLabel="Resize inspector"
          onDrag={(delta) => setInspectorWidth(useUiStore.getState().inspectorWidth + delta)}
        />
        <InspectorPanel width={inspectorWidth} />
      </div>
      <div className="editor-bottom">
        <Splitter
          orientation="horizontal"
          ariaLabel="Resize timeline"
          onDrag={(delta) => setTimelineHeight(useUiStore.getState().timelineHeight + delta)}
        />
        <TimelinePanel height={timelineHeight} />
      </div>
      <StatusBar />
      <DebugPanel />
    </div>
  )
}
