import { formatTimeCode, usePlaybackController } from '../../stores/playbackStore'
import { pixelsPerSecond, useTimelineViewStore } from '../../stores/timelineViewStore'

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
