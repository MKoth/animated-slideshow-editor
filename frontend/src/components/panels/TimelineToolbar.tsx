import { deleteSelectedKeyframes } from '../../app/keyframeSelectionActions'
import { deleteSelectedClipKeyframes } from '../../app/clipKeyframeActions'
import { useEngine } from '../../app/useEngine'
import { PLAYBACK_SPEEDS, formatTimeCode, usePlaybackController } from '../../stores/playbackStore'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import { pixelsPerSecond, useTimelineViewStore } from '../../stores/timelineViewStore'
import { useCurveEditorViewStore } from '../../stores/curveEditorViewStore'
import { useUiStore } from '../../stores/uiStore'
import { useTimelineSelectionStore as useTimelineSelStore } from '../../stores/timelineSelectionStore'

export function TimelineToolbar({
  slideId,
  duration,
  viewportWidth,
  zoomAnchor,
  clipEdit,
}: {
  slideId: string
  duration: number
  viewportWidth: number
  zoomAnchor: () => number | null
  clipEdit?: { clipId: string; clipName: string }
}) {
  const editingContext = useTimelineSelStore((state) => state.editingContext)
  const isClipEdit = editingContext === 'clip-edit' && clipEdit !== undefined

  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)
  const status = usePlaybackController((state) => state.status)
  const playbackSpeed = usePlaybackController((state) => state.playbackSpeed)
  const loopEnabled = usePlaybackController((state) => state.loopEnabled)
  const animationMode = useUiStore((state) => state.animationMode)
  const cameraAnimationMode = useUiStore((state) => state.cameraAnimationMode)
  const gridSnapEnabled = useTimelineViewStore((state) => state.gridSnapEnabled)
  const snapToKeyframesEnabled = useTimelineViewStore((state) => state.snapToKeyframesEnabled)
  const keyframeCount = selectedKeyframeIdsOf(useTimelineSelectionStore()).length
  const { engine, dispatch } = useEngine()
  const viewMode = useCurveEditorViewStore((state) => state.viewMode)
  const fitCurves = useCurveEditorViewStore((state) => state.fitCurves)
  const frameSelected = useCurveEditorViewStore((state) => state.frameSelected)

  const playing = status === 'playing'
  const paused = status === 'paused'
  const controller = usePlaybackController.getState

  const exitClipEdit = () => {
    useTimelineSelStore.getState().setEditingContext('slide')
  }

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

  const handleDeleteKeyframe = () => {
    if (isClipEdit && clipEdit) {
      deleteSelectedClipKeyframes(engine, dispatch)
    } else {
      deleteSelectedKeyframes(engine, dispatch)
    }
  }

  return (
    <div className={`timeline-toolbar${isClipEdit ? ' timeline-toolbar--clip-edit' : ''}`}>
      {isClipEdit && clipEdit && (
        <div className="timeline-toolbar__clip-edit-label">
          <span className="timeline-toolbar__clip-edit-badge">Clip Edit</span>
          <span className="timeline-toolbar__clip-edit-name">{clipEdit.clipName}</span>
          <button
            className="timeline-toolbar__button timeline-toolbar__exit-clip-edit"
            aria-label="Exit Clip Edit"
            title="Return to slide timeline"
            onClick={exitClipEdit}
          >
            Exit
          </button>
        </div>
      )}
      <div className="timeline-toolbar__view-toggle">
        <button
          className="timeline-toolbar__button"
          aria-pressed={viewMode === 'dopeSheet'}
          onClick={() => useCurveEditorViewStore.getState().setViewMode('dopeSheet')}
        >
          Dope Sheet
        </button>
        <button
          className="timeline-toolbar__button"
          aria-pressed={viewMode === 'curveEditor'}
          onClick={() => useCurveEditorViewStore.getState().setViewMode('curveEditor')}
        >
          Curve Editor
        </button>
      </div>
      <div className="timeline-toolbar__playback">
        {!isClipEdit ? (
          <>
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
          </>
        ) : (
          <span className="timeline-toolbar__clip-edit-hint">
            Scrubbing only — playback disabled
          </span>
        )}
        <button
          className="timeline-toolbar__button"
          aria-label="Delete Keyframe"
          disabled={keyframeCount === 0}
          onClick={handleDeleteKeyframe}
        >
          Delete Keyframe
        </button>
      </div>
      {!isClipEdit && (
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
      )}
      <div className="timeline-toolbar__snap">
        <button
          className="timeline-toolbar__button"
          aria-label="Grid Snap"
          aria-pressed={gridSnapEnabled}
          title={
            gridSnapEnabled
              ? 'Grid snap: keyframes snap to 1/60 s frame boundaries'
              : 'Grid snap off: keyframes move freely'
          }
          onClick={() => useTimelineViewStore.getState().toggleGridSnap()}
        >
          Grid Snap
        </button>
        <button
          className="timeline-toolbar__button"
          aria-label="Snap to Keyframes"
          aria-pressed={snapToKeyframesEnabled}
          title={
            snapToKeyframesEnabled
              ? 'Snap to keyframes: keyframes snap to nearby keyframes on any track'
              : 'Snap to keyframes off'
          }
          disabled={!gridSnapEnabled}
          onClick={() => useTimelineViewStore.getState().toggleSnapToKeyframes()}
        >
          Snap to Keyframes
        </button>
      </div>
      {!isClipEdit && (
        <span className="timeline-time" aria-label="Current time">
          {formatTimeCode(currentTime)}
        </span>
      )}
      <div className="timeline-toolbar__zoom">
        {viewMode === 'curveEditor' && (
          <>
            <button
              className="timeline-toolbar__button"
              aria-label="Fit Curves"
              title="Fit all curves in the viewport"
              onClick={() => fitCurves()}
            >
              Fit Curves
            </button>
            <button
              className="timeline-toolbar__button"
              aria-label="Frame Selected"
              title="Frame selected keyframes in the viewport"
              onClick={() => frameSelected()}
            >
              Frame Selected
            </button>
          </>
        )}
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
