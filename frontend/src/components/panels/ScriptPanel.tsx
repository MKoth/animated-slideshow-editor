import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useEngine } from '../../app/useEngine'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScriptAsync } from '../../engine/animationScriptRun'
import type {
  AnimationScriptRunProgress,
  AnimationScriptRunResult,
} from '../../engine/animationScriptRun'
import { captureAssetSnapshot, captureAudioSnapshot } from '../../app/assetSnapshot'
import { captureMaterialSnapshot, captureShaderSnapshot } from '../../app/definitionSnapshot'
import { ensureMaterialLibrariesLoaded } from '../../app/materialLibraries'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import type {
  AnimationScriptCompileResult,
  AnimationScriptDiagnostic,
  AnimationScriptSummary,
} from '../../engine/animationScriptCompiler'
import { SetSlideAnimationScriptCommand } from '../../engine/commands'
import { findScriptLibraryDrift } from '../../engine/scriptLibrary'
import { highlightAnimationScript } from './AnimationScriptViewer'
import { useClipLibraryStore } from '../../stores/clipLibraryStore'
import { measuredNodeSize } from '../../pixi/renderer/nodeMeasurement'

/** Fresh library uploads Check can resolve by name before anything embeds them. */
function collectGlobalAudioAssets(): readonly { id: string; name: string; duration: number }[] {
  const definitions = useAssetLibraryStore.getState().allDefinitions
  const out: { id: string; name: string; duration: number }[] = []
  for (const definition of definitions) {
    const isAudio =
      definition.category === 'audio' ||
      definition.mimeType?.startsWith('audio/') === true ||
      /\.(wav|mp3|mpeg|ogg|webm)$/i.test(definition.original_filename ?? '')
    if (!isAudio) continue
    const raw = (definition.metadata as Record<string, unknown> | undefined)?.duration
    out.push({
      id: definition.id,
      name: definition.name,
      duration: typeof raw === 'number' ? raw : Number.NaN,
    })
  }
  return out
}

type ScriptOutcome =
  | {
      readonly kind: 'check'
      readonly source: string
      readonly result: AnimationScriptCompileResult
    }
  | { readonly kind: 'run'; readonly source: string; readonly result: AnimationScriptRunResult }

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
  const openLibraryBrowser = useClipLibraryStore((state) => state.openLibraryBrowser)
  const gutterRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const [draft, setDraft] = useState(source)
  const [syncedFrom, setSyncedFrom] = useState({ slideId, source })
  const [outcome, setOutcome] = useState<ScriptOutcome | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<AnimationScriptRunProgress | null>(null)

  if (syncedFrom.slideId !== slideId || syncedFrom.source !== source) {
    if (syncedFrom.slideId !== slideId) {
      setOutcome(null)
    }
    setSyncedFrom({ slideId, source })
    setDraft(source)
  }

  const dirty = draft !== source
  const lineCount = draft.split('\n').length

  // Single editable surface: the transparent textarea sits over a highlighted
  // <pre> with identical metrics, so what you edit is what is highlighted.
  const highlighted = useMemo(() => highlightAnimationScript(draft), [draft])
  // A trailing newline collapses in <pre>; keep a space so its scrollHeight
  // matches the textarea's exactly.
  const displayHtml = draft.endsWith('\n') ? `${highlighted} ` : highlighted

  // Typing at the bottom auto-scrolls the textarea natively; mirror it so
  // the highlight layer never drifts out of alignment between scroll events.
  useEffect(() => {
    const editor = editorRef.current
    const highlight = highlightRef.current
    if (!editor || !highlight) return
    highlight.scrollTop = editor.scrollTop
    highlight.scrollLeft = editor.scrollLeft
  }, [draft])

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget
    if (gutterRef.current) {
      gutterRef.current.scrollTop = target.scrollTop
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop
      highlightRef.current.scrollLeft = target.scrollLeft
    }
  }

  // Library-version drift: recorded entry versions from the last Run versus
  // the live project entries. Computed on every render (the parent re-renders
  // on any engine event) so a library edit surfaces without a memo staleness
  // trap. The indicator is the only drift surface — recompiles stay explicit
  // and scene state never triggers it.
  const drift = (() => {
    let footprint: { entryVersions: Readonly<Record<string, number>> } | null | undefined
    let live: readonly { id: string; name: string; version: number }[] = []
    try {
      footprint = engine.getSlide(slideId).animationScript?.lastCompiled ?? null
    } catch {
      footprint = null
    }
    try {
      live = engine.project?.scriptFunctions ?? []
    } catch {
      live = []
    }
    if (!footprint) return []
    return findScriptLibraryDrift(footprint.entryVersions, live)
  })()

  const commit = () => {
    if (!dirty) {
      return
    }
    dispatch(new SetSlideAnimationScriptCommand({ slideId, source: draft }))
  }

  const runCheck = async () => {
    await ensureMaterialLibrariesLoaded()
    setOutcome({
      kind: 'check',
      source: draft,
      result: checkAnimationScript(engine, slideId, draft, {
        measure: measuredNodeSize,
        globalAudioAssets: collectGlobalAudioAssets(),
      }),
    })
  }

  const runScript = async () => {
    if (running) return
    setRunning(true)
    setProgress(null)
    try {
      await ensureMaterialLibrariesLoaded()
      const result = await runAnimationScriptAsync(engine, dispatch, slideId, source, {
        measure: measuredNodeSize,
        globalAudioAssets: collectGlobalAudioAssets(),
        onProgress: setProgress,
        captureAsset: (definitionId) => captureAssetSnapshot(engine, definitionId),
        captureAudio: (assetId) => captureAudioSnapshot(engine, assetId),
        captureMaterial: (definitionId) => {
          if (!captureMaterialSnapshot(engine, definitionId)) return false
          const shaderId = engine.getMaterialDefinition(definitionId).shaderId
          return shaderId === null || captureShaderSnapshot(engine, shaderId)
        },
      })
      setOutcome({ kind: 'run', source, result })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const editDraft = (value: string) => {
    setDraft(value)
    setOutcome(null)
  }

  const visibleOutcome =
    outcome === null || outcome.source !== (outcome.kind === 'check' ? draft : source)
      ? null
      : outcome

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
          onClick={() => void runCheck()}
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
          data-testid="script-run"
          onClick={() => void runScript()}
          disabled={dirty || running}
          title={dirty ? 'Save your changes before running' : 'Compile and apply this script'}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: !dirty ? 'var(--color-accent)' : 'transparent',
            color: !dirty ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
            cursor: !dirty ? 'pointer' : 'default',
            fontSize: 11,
          }}
        >
          {running ? 'Running…' : 'Run'}
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
        <button
          type="button"
          data-testid="script-functions"
          onClick={() => openLibraryBrowser('scriptFunctions')}
          title="Browse reusable script functions"
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
          Functions
        </button>
      </div>
      {running && (
        <div
          data-testid="script-run-progress"
          role="status"
          style={{
            padding: '4px 8px',
            fontSize: 11,
            color: 'var(--color-text)',
            background: 'var(--color-bg-panel)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {progress === null || progress.total === 0
            ? 'Running…'
            : `Running step ${Math.min(progress.done + 1, progress.total)} of ${progress.total} — ${progress.label}`}
        </div>
      )}
      <div
        data-testid="script-reads-caution"
        style={{
          padding: '3px 8px',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-panel)',
        }}
      >
        Reads (alias.x, worldAt, bounds, cellRect, controlValue, markTime) are compile-time and
        side-effect free. bounds use renderer-measured sizes and ignore rotation; read times must
        stay within the slide. Objects a script creates belong to the run: re-running deletes and
        recreates them.
      </div>
      {drift.length > 0 && (
        <div
          data-testid="script-drift-indicator"
          role="status"
          style={{
            padding: '4px 8px',
            fontSize: 11,
            color: 'var(--color-warning-text, #8a5a00)',
            background: 'var(--color-warning-bg, #fff4d6)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          Library drift:{' '}
          {drift
            .map((entry) =>
              entry.liveVersion === null ? `deleted function ${entry.id.slice(0, 8)}` : entry.name,
            )
            .join(', ')}{' '}
          changed since the last run — re-run recommended, never automatic.
        </div>
      )}
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
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
          <pre
            ref={highlightRef}
            aria-hidden="true"
            data-testid="script-highlight-source"
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              padding: '8px 8px',
              overflow: 'hidden',
              pointerEvents: 'none',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              color: 'var(--color-text)',
            }}
          >
            <code className="anim-code" dangerouslySetInnerHTML={{ __html: displayHtml }} />
          </pre>
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
            onScroll={syncScroll}
            spellCheck={false}
            className="script-editor-textarea"
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              minHeight: 0,
              padding: '8px 8px',
              border: 'none',
              outline: 'none',
              resize: 'none',
              background: 'transparent',
              color: 'transparent',
              caretColor: 'var(--color-text)',
              WebkitTextFillColor: 'transparent',
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
      {visibleOutcome !== null && (
        <CompileOutcome
          kind={visibleOutcome.kind}
          summary={visibleOutcome.result.summary}
          diagnostics={visibleOutcome.result.diagnostics}
          ok={outcomeOk(visibleOutcome)}
          error={visibleOutcome.kind === 'run' ? visibleOutcome.result.error : null}
          onReveal={revealDiagnostic}
        />
      )}
    </div>
  )
}

function outcomeOk(outcome: ScriptOutcome): boolean {
  return outcome.kind === 'run' ? outcome.result.ran : outcome.result.runnable
}

function outcomeStatus(
  kind: 'check' | 'run',
  ok: boolean,
  error: string | null,
  errorCount: number,
): string {
  if (error !== null) return `Run failed: ${error}`
  if (ok) return kind === 'run' ? 'Ran' : ''
  return `Run blocked by ${count(errorCount, 'error')}`
}

function CompileOutcome({
  kind,
  summary,
  diagnostics,
  ok,
  error,
  onReveal,
}: {
  kind: 'check' | 'run'
  summary: AnimationScriptSummary
  diagnostics: readonly AnimationScriptDiagnostic[]
  ok: boolean
  error: string | null
  onReveal: (diagnostic: AnimationScriptDiagnostic) => void
}) {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  const status = outcomeStatus(kind, ok, error, errorCount)
  const testIds =
    kind === 'check'
      ? { result: 'script-check-result', summary: 'script-check-summary' }
      : { result: 'script-run-result', summary: 'script-run-summary' }
  const tracks =
    summary.tracks.length === 0
      ? 'no tracks'
      : `tracks: ${summary.tracks.map((track) => `${track.nodeName}.${track.property}`).join(', ')}`
  const line = [
    status,
    `Segment ${formatSeconds(summary.from)}s → ${formatSeconds(summary.to)}s`,
    tracks,
    count(summary.keyframeCount, 'keyframe'),
    count(summary.instanceCount, 'instance'),
    ...(summary.createdNodeCount > 0 ? [count(summary.createdNodeCount, 'created node')] : []),
    ...(summary.createdDataSourceCount > 0
      ? [count(summary.createdDataSourceCount, 'data source')]
      : []),
  ]
    .filter((part) => part.length > 0)
    .join(' · ')

  return (
    <div
      data-testid={testIds.result}
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
        data-testid={testIds.summary}
        style={{
          padding: '6px 8px',
          fontSize: 11,
          color: ok ? 'var(--color-text)' : 'var(--color-danger, #d64545)',
          borderBottom: diagnostics.length > 0 ? '1px solid var(--color-border)' : 'none',
        }}
      >
        {line}
      </div>
      {diagnostics.map((diagnostic, index) => (
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
