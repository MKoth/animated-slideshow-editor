export function TimelinePanel({ height }: { height: number }) {
  return (
    <div className="timeline-panel" style={{ height }}>
      <div className="panel-empty-state">
        <p>No animation loaded.</p>
      </div>
    </div>
  )
}
