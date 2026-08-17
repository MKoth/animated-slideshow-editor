import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { pruneKeyframeSelection } from '../../app/keyframeSelectionActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  DEFAULT_TIMELINE_VIEWPORT_WIDTH,
  useTimelineViewStore,
} from '../../stores/timelineViewStore'
import { sceneHasObjects, timelineRows } from './timelineTracks'
import { TimelineBody } from './TimelineBody'
import { TimelineToolbar } from './TimelineToolbar'

function useViewportWidth(
  scrollerRef: RefObject<HTMLDivElement | null>,
  deps: readonly unknown[],
): number {
  const [width, setWidth] = useState(DEFAULT_TIMELINE_VIEWPORT_WIDTH)
  useEffect(() => {
    const measure = () => {
      const el = scrollerRef.current
      setWidth(el && el.clientWidth > 0 ? el.clientWidth : DEFAULT_TIMELINE_VIEWPORT_WIDTH)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollerRef, ...deps])
  return width
}

export function TimelinePanel({ height }: { height: number }) {
  const { engine } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent((event) => {
    setTick((tick) => tick + 1)
    if (event.type === 'KeyframeRemoved' || event.type === 'NodeRemoved') {
      pruneKeyframeSelection(engine)
    }
  })
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const timeAreaRef = useRef<HTMLDivElement>(null)
  const lastPointerTimeRef = useRef<number | null>(null)

  const project = engine.project
  const slide = engine.getActiveSlide()
  const scene = slide?.scene ?? null
  const hasObjects = scene ? sceneHasObjects(scene) : false
  const expandedNodeIds = useTimelineViewStore((state) => state.expandedNodeIds)
  const viewportWidth = useViewportWidth(scrollerRef, [slide?.id ?? null, hasObjects])
  const materialDefinitions = engine.materialDefinitions
  const rows = scene ? timelineRows(scene, expandedNodeIds, materialDefinitions) : []

  let body: React.ReactNode
  if (!project) {
    body = (
      <div className="panel-empty-state">
        <p>No project. Create one to get started.</p>
      </div>
    )
  } else if (!slide) {
    body = (
      <div className="panel-empty-state">
        <p>No slides created.</p>
      </div>
    )
  } else if (!hasObjects || !scene) {
    body = (
      <div className="panel-empty-state">
        <p>No objects in the scene. Drag assets into the scene to begin animating.</p>
      </div>
    )
  } else {
    body = (
      <TimelineBody
        slideId={slide.id}
        duration={slide.duration}
        scene={scene}
        rows={rows}
        scrollerRef={scrollerRef}
        tracksRef={tracksRef}
        timeAreaRef={timeAreaRef}
        viewportWidth={viewportWidth}
        lastPointerTimeRef={lastPointerTimeRef}
      />
    )
  }

  return (
    <div className="timeline-panel" style={{ height }}>
      {slide && (
        <TimelineToolbar
          slideId={slide.id}
          duration={slide.duration}
          viewportWidth={viewportWidth}
          zoomAnchor={() => lastPointerTimeRef.current}
        />
      )}
      {body}
    </div>
  )
}
