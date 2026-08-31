import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { pruneKeyframeSelection } from '../../app/keyframeSelectionActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  DEFAULT_TIMELINE_VIEWPORT_WIDTH,
  useTimelineViewStore,
} from '../../stores/timelineViewStore'
import { useCurveEditorViewStore } from '../../stores/curveEditorViewStore'
import { useTimelineSelectionStore } from '../../stores/timelineSelectionStore'
import { useClipLibraryStore } from '../../stores/clipLibraryStore'
import { sceneHasObjects, timelineRows } from './timelineTracks'
import { TimelineBody } from './TimelineBody'
import { TimelineToolbar } from './TimelineToolbar'
import { CurveEditorPanel } from './CurveEditorPanel'
import { ClipEditBody } from './ClipEditBody'
import { AudioTimelineBody } from './AudioTimelineBody'
import { useSyncedAudio } from '../../audio/useSyncedAudio'

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

  const viewMode = useCurveEditorViewStore((state) => state.viewMode)
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    if (viewMode === 'curveEditor' && prevViewModeRef.current !== 'curveEditor') {
      const timelineState = useTimelineViewStore.getState()
      useCurveEditorViewStore
        .getState()
        .syncFromTimeline(timelineState.zoomLevel, timelineState.scrollTime)
    }
    prevViewModeRef.current = viewMode
  }, [viewMode])

  const editingContext = useTimelineSelectionStore((state) => state.editingContext)
  const clipEditId = useClipLibraryStore((state) => state.selectedId)
  const clipEditDefinition =
    editingContext === 'clip-edit' && clipEditId
      ? (engine.clips.find((c) => c.id === clipEditId) ?? null)
      : null

  const project = engine.project
  const slide = engine.getActiveSlide()
  const scene = slide?.scene ?? null
  const hasObjects = scene ? sceneHasObjects(scene) : false
  const expandedNodeIds = useTimelineViewStore((state) => state.expandedNodeIds)
  const [activeTab, setActiveTab] = useState<'animation' | 'audio'>('animation')
  const viewportWidth = useViewportWidth(scrollerRef, [
    slide?.id ?? null,
    hasObjects,
    editingContext,
    clipEditId,
    activeTab,
  ])
  // Synced Web Audio playback — single truth playbackStore, AudioContext leader
  useSyncedAudio()

  const materialDefinitions = engine.materialDefinitions
  const rows = scene ? timelineRows(scene, expandedNodeIds, materialDefinitions) : []

  const isClipEdit = editingContext === 'clip-edit' && clipEditDefinition !== null

  let body: React.ReactNode
  if (isClipEdit && clipEditDefinition) {
    if (viewMode === 'curveEditor' && scene) {
      body = (
        <CurveEditorPanel
          slideId={slide?.id ?? ''}
          duration={clipEditDefinition.duration}
          scene={scene}
          viewportWidth={viewportWidth}
          clip={clipEditDefinition}
        />
      )
    } else {
      body = (
        <ClipEditBody
          clip={clipEditDefinition}
          scrollerRef={scrollerRef}
          tracksRef={tracksRef}
          timeAreaRef={timeAreaRef}
          viewportWidth={viewportWidth}
          lastPointerTimeRef={lastPointerTimeRef}
        />
      )
    }
  } else if (!project) {
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
  } else if (activeTab === 'audio') {
    body = (
      <AudioTimelineBody
        slide={slide}
        duration={slide.duration}
        scrollerRef={scrollerRef}
        tracksRef={tracksRef}
        timeAreaRef={timeAreaRef}
        viewportWidth={viewportWidth}
        lastPointerTimeRef={lastPointerTimeRef}
      />
    )
  } else if (!hasObjects || !scene) {
    body = (
      <div className="panel-empty-state">
        <p>No objects in the scene. Drag assets into the scene to begin animating.</p>
      </div>
    )
  } else if (viewMode === 'curveEditor') {
    body = (
      <CurveEditorPanel
        slideId={slide.id}
        duration={slide.duration}
        scene={scene}
        viewportWidth={viewportWidth}
      />
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

  const toolbarDuration =
    isClipEdit && clipEditDefinition ? clipEditDefinition.duration : (slide?.duration ?? 0)
  const toolbarSlideId = slide?.id ?? ''

  return (
    <div
      className={`timeline-panel${isClipEdit ? ' timeline-panel--clip-edit' : ''}`}
      style={{ height }}
    >
      {(slide || isClipEdit) && !isClipEdit && (
        <div
          className="timeline-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-panel)',
          }}
        >
          <div
            className="timeline-tabs"
            role="tablist"
            style={{
              display: 'flex',
              gap: 4,
              background: 'var(--color-bg)',
              borderRadius: 6,
              padding: 2,
            }}
          >
            <button
              role="tab"
              aria-selected={activeTab === 'animation'}
              className={`timeline-tab${activeTab === 'animation' ? ' timeline-tab--active' : ''}`}
              style={{
                padding: '4px 14px',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: activeTab === 'animation' ? 'var(--color-accent)' : 'transparent',
                color:
                  activeTab === 'animation'
                    ? 'var(--color-accent-text)'
                    : 'var(--color-text-muted)',
              }}
              onClick={() => setActiveTab('animation')}
              data-testid="timeline-tab-animation"
            >
              Animation
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'audio'}
              className={`timeline-tab${activeTab === 'audio' ? ' timeline-tab--active' : ''}`}
              style={{
                padding: '4px 14px',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: activeTab === 'audio' ? 'var(--color-accent)' : 'transparent',
                color:
                  activeTab === 'audio' ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
              }}
              onClick={() => setActiveTab('audio')}
              data-testid="timeline-tab-audio"
            >
              Audio
            </button>
          </div>
        </div>
      )}
      {(slide || isClipEdit) && (
        <TimelineToolbar
          slideId={toolbarSlideId}
          duration={toolbarDuration}
          viewportWidth={viewportWidth}
          zoomAnchor={() => lastPointerTimeRef.current}
          clipEdit={
            isClipEdit
              ? { clipId: clipEditDefinition!.id, clipName: clipEditDefinition!.name }
              : undefined
          }
        />
      )}
      {body}
    </div>
  )
}
