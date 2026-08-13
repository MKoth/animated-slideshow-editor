import { deleteSelectedKeyframes } from '../../app/keyframeSelectionActions'
import { useEngine } from '../../app/useEngine'
import { formatTimeCode, usePlaybackController } from '../../stores/playbackStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { pixelsPerSecond, useTimelineViewStore } from '../../stores/timelineViewStore'
import { useUiStore } from '../../stores/uiStore'

export function TimelineToolbar({
  slideId,
  duration,
  viewportWidth,
  zoomAnchor,
}: {
  slideId: string
  duration: number
  viewportWidth: number
  zoomAnchor: () => number | null
}) {
  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)
  const animationMode = useUiStore((state) => state.animationMode)
  const cameraAnimationMode = useUiStore((state) => state.cameraAnimationMode)
  const keyframeCount = useSelectionStore((state) => state.selectedKeyframeIds.length)
  const { engine, dispatch } = useEngine()

  const zoomByStep = (direction: 'in' | 'out') => {
    const state = useTimelineViewStore.getState()
    const pps = pixelsPerSecond(state.zoomLevel)
    const anchor = zoomAnchor() ?? state.scrollTime + viewportWidth / 2 / pps
    if (direction === 'in') {
      state.zoomIn(anchor, viewportWidth, duration)
    } else {
      state.zoomOut(anchor, viewportWidth, duration)
    }
  }

  return (
    <div className="timeline-toolbar">
      <div className="timeline-toolbar__playback">
        <button className="timeline-toolbar__button" aria-label="Play (timeline)" disabled>
          Play
        </button>
        <button className="timeline-toolbar__button" aria-label="Pause (timeline)" disabled>
          Pause
        </button>
        <button className="timeline-toolbar__button" aria-label="Stop (timeline)" disabled>
          Stop
        </button>
        <button className="timeline-toolbar__button" aria-label="Loop (timeline)" disabled>
          Loop
        </button>
        <select className="timeline-toolbar__select" aria-label="Speed (timeline)" disabled>
          <option>1×</option>
        </select>
        <button
          className="timeline-toolbar__button"
          aria-label="Delete Keyframe"
          disabled={keyframeCount === 0}
          onClick={() => deleteSelectedKeyframes(engine, dispatch)}
        >
          Delete Keyframe
        </button>
      </div>
      <div className="timeline-toolbar__mode">
        <button
          className="timeline-toolbar__button"
          aria-label="Animation Mode"
          aria-pressed={animationMode}
          title={
            animationMode
              ? 'Animation mode: Inspector edits create keyframes'
              : 'Base mode: Inspector edits change stored values'
          }
          onClick={() => useUiStore.getState().toggleAnimationMode()}
        >
          Animation Mode
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Camera Animation Mode"
          aria-pressed={cameraAnimationMode}
          title={
            cameraAnimationMode
              ? 'Camera animation mode: pan, zoom and reset create camera keyframes'
              : 'Camera base mode: pan, zoom and reset change stored camera values'
          }
          onClick={() => useUiStore.getState().toggleCameraAnimationMode()}
        >
          Camera Animation Mode
        </button>
      </div>
      <span className="timeline-time" aria-label="Current time">
        {formatTimeCode(currentTime)}
      </span>
      <div className="timeline-toolbar__zoom">
        <button
          className="timeline-toolbar__button"
          aria-label="Zoom Out"
          onClick={() => zoomByStep('out')}
        >
          −
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Zoom In"
          onClick={() => zoomByStep('in')}
        >
          +
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Fit Timeline"
          onClick={() => useTimelineViewStore.getState().fitTimeline(duration, viewportWidth)}
        >
          Fit Timeline
        </button>
      </div>
    </div>
  )
}
