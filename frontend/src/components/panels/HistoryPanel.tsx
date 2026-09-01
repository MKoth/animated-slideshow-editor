import { useMemo, useState, useSyncExternalStore } from 'react'
import { useEngine } from '../../app/useEngine'
import { formatParameters } from '../../engine/commands'

export function HistoryPanel({ height }: { height: number }) {
  const { undoStack } = useEngine()
  const entries = useSyncExternalStore(
    (listener) => undoStack.subscribe(listener),
    () => undoStack.entries,
  )
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((entry) => {
      const type = entry.type.toLowerCase()
      const params = formatParameters(entry.parameters).toLowerCase()
      const source = (entry.source ?? '').toLowerCase()
      return type.includes(term) || params.includes(term) || source.includes(term)
    })
  }, [entries, search])

  return (
    <div className="history-panel" style={{ height, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-panel)',
        }}
      >
        <input
          aria-label="Search history"
          placeholder="Search history..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            fontSize: 12,
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{filtered.length} / {entries.length}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {filtered.length === 0 ? (
          <p className="panel-empty-state" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {entries.length === 0 ? 'No history yet.' : 'No matching entries.'}
          </p>
        ) : (
          <ol aria-label="History" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map((entry) => {
              const isTransaction = entry.type === 'Transaction'
              const children = isTransaction
                ? ((entry.inverse as { children?: { type: string; parameters: Record<string, unknown> }[] })?.children ?? [])
                : []
              const isSelected = selectedId === entry.id
              return (
                <li
                  key={entry.id}
                  onClick={() => setSelectedId(entry.id)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: isSelected ? 'var(--color-bg-hover)' : 'var(--color-bg)',
                    cursor: 'pointer',
                  }}
                  data-testid="history-entry"
                  aria-selected={isSelected}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{entry.type}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                      {entry.source ? ` · ${entry.source}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
                    <code>{formatParameters(entry.parameters)}</code>
                  </div>
                  {isTransaction && children.length > 0 && (
                    <ul style={{ margin: '4px 0 0 12px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {children.map((child, idx) => (
                        <li key={idx} style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          <span style={{ fontWeight: 500 }}>{child.type}</span>{' '}
                          <code>{formatParameters(child.parameters)}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
