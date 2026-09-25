import { useRef, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { SetSlideAnimationScriptCommand } from '../../engine/commands'

export function ScriptPanel({
  slideId,
  slideName,
  source,
  height,
}: {
  slideId: string
  slideName: string
  source: string
  height: number
}) {
  const { dispatch } = useEngine()
  const gutterRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(source)
  const [syncedFrom, setSyncedFrom] = useState({ slideId, source })

  if (syncedFrom.slideId !== slideId || syncedFrom.source !== source) {
    setSyncedFrom({ slideId, source })
    setDraft(source)
  }

  const dirty = draft !== source
  const lineCount = draft.split('\n').length

  const commit = () => {
    if (!dirty) {
      return
    }
    dispatch(new SetSlideAnimationScriptCommand({ slideId, source: draft }))
  }

  return (
    <div
      data-testid="script-panel"
      style={{ height, display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
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
        <span style={{ fontSize: 12, fontWeight: 600 }}>Animation Script — {slideName}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1 }}>
          {dirty ? 'Unsaved changes (Ctrl/Cmd+Enter to save)' : 'Saved'}
        </span>
        <button
          type="button"
          onClick={commit}
          disabled={!dirty}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: dirty ? 'var(--color-accent)' : 'transparent',
            color: dirty ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
            cursor: dirty ? 'pointer' : 'default',
            fontSize: 11,
          }}
        >
          Save
        </button>
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          background: 'var(--color-bg)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          lineHeight: '18px',
        }}
      >
        <div
          ref={gutterRef}
          data-testid="script-line-numbers"
          aria-hidden="true"
          style={{
            padding: '8px 8px',
            textAlign: 'right',
            color: 'var(--color-text-muted)',
            userSelect: 'none',
            overflow: 'hidden',
          }}
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          aria-label="Animation Script source"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              commit()
            }
          }}
          onScroll={(event) => {
            if (gutterRef.current) {
              gutterRef.current.scrollTop = event.currentTarget.scrollTop
            }
          }}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 0,
            padding: '8px 8px',
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'transparent',
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
            whiteSpace: 'pre',
            overflowWrap: 'normal',
            overflow: 'auto',
          }}
        />
      </div>
    </div>
  )
}
