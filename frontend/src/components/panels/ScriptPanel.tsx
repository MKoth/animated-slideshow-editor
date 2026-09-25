import { useRef, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import type {
  AnimationScriptCompileResult,
  AnimationScriptDiagnostic,
} from '../../engine/animationScriptCompiler'
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
  const { engine, dispatch } = useEngine()
  const gutterRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(source)
  const [syncedFrom, setSyncedFrom] = useState({ slideId, source })
  const [check, setCheck] = useState<{
    source: string
    result: AnimationScriptCompileResult
  } | null>(null)

  if (syncedFrom.slideId !== slideId || syncedFrom.source !== source) {
    if (syncedFrom.slideId !== slideId) {
      setCheck(null)
    }
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

  const runCheck = () => {
    setCheck({ source: draft, result: checkAnimationScript(engine, slideId, draft) })
  }

  const editDraft = (value: string) => {
    setDraft(value)
    setCheck(null)
  }

  const revealDiagnostic = (diagnostic: AnimationScriptDiagnostic) => {
    const editor = editorRef.current
    if (!editor) return
    const offset = offsetForPosition(draft, diagnostic.line, diagnostic.column)
    editor.focus()
    editor.setSelectionRange(offset, offset)
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
          data-testid="script-check"
          onClick={runCheck}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Check
        </button>
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
          ref={editorRef}
          aria-label="Animation Script source"
          value={draft}
          onChange={(event) => editDraft(event.target.value)}
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
      {check !== null && check.source === draft && (
        <CheckResult result={check.result} onReveal={revealDiagnostic} />
      )}
    </div>
  )
}

function CheckResult({
  result,
  onReveal,
}: {
  result: AnimationScriptCompileResult
  onReveal: (diagnostic: AnimationScriptDiagnostic) => void
}) {
  const errorCount = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  ).length
  const blocked = result.runnable ? '' : `Run blocked by ${count(errorCount, 'error')} · `
  const tracks =
    result.summary.tracks.length === 0
      ? 'no tracks'
      : `tracks: ${result.summary.tracks
          .map((track) => `${track.nodeName}.${track.property}`)
          .join(', ')}`
  const summary = [
    `${blocked}Segment ${formatSeconds(result.summary.from)}s → ${formatSeconds(result.summary.to)}s`,
    tracks,
    count(result.summary.keyframeCount, 'keyframe'),
    count(result.summary.instanceCount, 'instance'),
  ].join(' · ')

  return (
    <div
      data-testid="script-check-result"
      style={{
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg-panel)',
        maxHeight: 180,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        data-testid="script-check-summary"
        style={{
          padding: '6px 8px',
          fontSize: 11,
          color: result.runnable ? 'var(--color-text)' : 'var(--color-danger, #d64545)',
          borderBottom: result.diagnostics.length > 0 ? '1px solid var(--color-border)' : 'none',
        }}
      >
        {summary}
      </div>
      {result.diagnostics.map((diagnostic, index) => (
        <button
          key={index}
          type="button"
          data-testid="script-diagnostic"
          data-severity={diagnostic.severity}
          data-line={diagnostic.line}
          data-column={diagnostic.column}
          onClick={() => onReveal(diagnostic)}
          title="Place the editor cursor at this diagnostic"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
            textAlign: 'left',
            padding: '4px 8px',
            border: 'none',
            borderBottom: '1px solid var(--color-border)',
            background: 'transparent',
            color:
              diagnostic.severity === 'error'
                ? 'var(--color-danger, #d64545)'
                : 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
            {diagnostic.severity}
          </span>
          <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            Line {diagnostic.line}, Col {diagnostic.column}
          </span>
          <span>{diagnostic.message}</span>
        </button>
      ))}
    </div>
  )
}

function formatSeconds(seconds: number): string {
  return String(Math.round(seconds * 1e6) / 1e6)
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

function offsetForPosition(text: string, line: number, column: number): number {
  let offset = 0
  let currentLine = 1
  while (currentLine < line && offset < text.length) {
    if (text[offset] === '\n') currentLine += 1
    offset += 1
  }
  return Math.min(text.length, offset + Math.max(0, column - 1))
}
