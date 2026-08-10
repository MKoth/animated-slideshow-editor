export function InspectorPanel({ width }: { width: number }) {
  return (
    <div className="inspector-panel" style={{ width }}>
      <div className="panel-empty-state">
        <p>Nothing selected.</p>
      </div>
    </div>
  )
}
