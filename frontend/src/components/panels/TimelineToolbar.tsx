import { deleteSelectedKeyframes } from '../../app/keyframeSelectionActions'
import { useEngine } from '../../app/useEngine'
import { PLAYBACK_SPEEDS, formatTimeCode, usePlaybackController } from '../../stores/playbackStore'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
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
  const status = usePlaybackController((state) => state.status)
  const playbackSpeed = usePlaybackController((state) => state.playbackSpeed)
  const loopEnabled = usePlaybackController((state) => state.loopEnabled)
  const animationMode = useUiStore((state) => state.animationMode)
  const cameraAnimationMode = useUiStore((state) => state.cameraAnimationMode)
  const keyframeCount = selectedKeyframeIdsOf(useTimelineSelectionStore()).length
  const { engine, dispatch } = useEngine()

  const playing = status === 'playing'
  const paused = status === 'paused'
  const controller = usePlaybackController.getState

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
        <button
          className="timeline-toolbar__button"
          aria-label="Play (timeline)"
          title="Play from the playhead"
          disabled={playing}
          onClick={() => controller().play(slideId, duration)}
        >
          Play
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Pause (timeline)"
          title="Pause playback, keeping the position"
          disabled={!playing}
          onClick={() => controller().pause()}
        >
          Pause
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Stop (timeline)"
          title="Stop playback and reset to 0"
          onClick={() => controller().stop(slideId)}
        >
          Stop
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Loop (timeline)"
          aria-pressed={loopEnabled}
          title="Loop playback from the end back to 0"
          onClick={() => controller().setLoopEnabled(!loopEnabled)}
        >
          Loop
        </button>
        <select
          className="timeline-toolbar__select"
          aria-label="Speed (timeline)"
          title="Playback speed"
          value={playbackSpeed}
          onChange={(event) => controller().setPlaybackSpeed(Number(event.target.value))}
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
        <button
          className="timeline-toolbar__button"
          aria-label="Previous Frame (timeline)"
          title="Step back 1/60 s while paused"
          disabled={!paused}
          onClick={() => controller().stepFrame('backward', slideId, duration)}
        >
          ‹
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Next Frame (timeline)"
          title="Step forward 1/60 s while paused"
          disabled={!paused}
          onClick={() => controller().stepFrame('forward', slideId, duration)}
        >
          ›
        </button>
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
