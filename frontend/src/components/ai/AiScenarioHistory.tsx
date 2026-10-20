import { useContext, useEffect, useMemo } from 'react'
import { useAiStore } from '../../stores/aiStore'
import { EngineContext } from '../../app/engineContext'
import type { ScenarioMarkdownVersion } from '../../api/aiApi'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  withScenarioAcceptedVersion,
} from '../../engine/scenarioSection'
import { diffScenarioLines } from '../../engine/scenarioVersions'

const EMPTY_MARKDOWN_VERSIONS: ScenarioMarkdownVersion[] = []

interface AiScenarioHistoryProps {
  projectId: string
  conversationId: string | null
}

/**
 * History tab (issues #462, #466): ordered versions with line-or-block diff and
 * restore-as-new-version. Restore copies forward, never rewrites history,
 * and never touches the engine Undo Stack (plain project.setScenario).
 * Accept marks the stable downstream snapshot: later assistants read the
 * accepted version, never the active draft.
 */
export function AiScenarioHistory({ projectId, conversationId }: AiScenarioHistoryProps) {
  const versions = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] ?? EMPTY_MARKDOWN_VERSIONS,
  )
  const activeId = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] && s.activeMarkdownVersionIdByProject[projectId],
  )
  const acceptedId = useAiStore((s) => s.acceptedMarkdownVersionIdByProject[projectId] ?? null)
  const busy = useAiStore((s) => s.markdownBusy)
  const error = useAiStore((s) => s.markdownError)
  const store = useAiStore.getState()
  const engine = useContext(EngineContext)?.engine
  const persistence = useContext(EngineContext)?.persistence

  useEffect(() => {
    if (projectId) void store.loadMarkdownVersions(projectId, conversationId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, conversationId])

  const ordered = useMemo(() => [...versions], [versions])

  // Restore/accept rewrite the portable section outside the Undo Stack —
  // signal persistence explicitly or the change vanishes on reload.
  const persistScenario = () => persistence?.onCommandSucceeded()

  const handleRestore = (versionId: string) => {
    if (!projectId || !conversationId || busy) return
    void store.restoreMarkdownVersion(projectId, conversationId, versionId).then((restored) => {
      if (!restored || !engine?.project) return
      // Portable doc sync: append copy-forward version, no engine history.
      const current = engine.project.scenario ?? createEmptyScenarioSection('')
      const next = appendScenarioVersion(current, {
        id: restored.id,
        summary: restored.summary,
        touchedSteps: [...restored.touchedSteps],
        timestamp: restored.timestamp,
        content: restored.content,
      })
      engine.project.setScenario(next)
      persistScenario()
    })
  }

  const handleAccept = (versionId: string) => {
    if (!projectId || busy) return
    void store.acceptMarkdownVersion(projectId, versionId, conversationId ?? undefined).then(() => {
      if (!engine?.project?.scenario) return
      // Portable doc sync: accepted pointer travels with the doc so the
      // accepted snapshot survives download/import/duplicate verbatim.
      // Plain setScenario — never through the engine Undo Stack.
      const current = engine.project.scenario
      if (current && current.acceptedVersionId !== versionId) {
        engine.project.setScenario(withScenarioAcceptedVersion(current, versionId))
        persistScenario()
      }
    })
  }

  if (!conversationId) {
    return <div data-testid="ai-scenario-history-empty">Start a conversation to see history.</div>
  }

  return (
    <div data-testid="ai-scenario-history">
      <div data-testid="ai-scenario-history-count">
        {ordered.length} version(s){activeId ? ` — active ${activeId.slice(0, 8)}` : ''}
        {acceptedId ? ` — accepted ${acceptedId.slice(0, 8)}` : ' — no accepted version'}
      </div>
      <div data-testid="ai-scenario-accepted-gate">
        {acceptedId
          ? 'Downstream reconciliation reads the accepted version — newer drafts never move it.'
          : 'No accepted version — downstream reconciliation blocks until one is accepted.'}
      </div>
      {error && <div data-testid="ai-scenario-history-error">{error.message}</div>}
      {ordered.length === 0 ? (
        <div data-testid="ai-scenario-history-none">No versions yet — chat to iterate.</div>
      ) : (
        <ol className="scenario-version-list">
          {ordered.map((version, index) => {
            const previous = index > 0 ? ordered[index - 1]!.content : ''
            const diff = diffScenarioLines(previous, version.content)
            const isAccepted = version.id === acceptedId
            const isActive = version.id === activeId
            return (
              <li
                key={version.id}
                data-testid={`ai-scenario-version-${version.id}`}
                className="scenario-version"
              >
                <div
                  data-testid={`ai-scenario-version-summary-${version.id}`}
                  className="scenario-version-summary"
                >
                  <span>
                    {version.summary} — steps {version.touchedSteps.join(', ') || '—'} —{' '}
                    {version.timestamp}
                  </span>
                  {isActive ? (
                    <span className="scenario-badge scenario-badge-active">active</span>
                  ) : null}
                  {isAccepted ? (
                    <span className="scenario-badge scenario-badge-accepted">
                      accepted · downstream snapshot
                    </span>
                  ) : null}
                </div>
                <div
                  data-testid={`ai-scenario-version-diff-${version.id}`}
                  className="scenario-diff"
                >
                  {diff.map((row, i) => (
                    <div
                      key={i}
                      data-testid={`ai-scenario-version-diff-${version.id}-${row.type}-${i}`}
                      data-type={row.type}
                      className={`scenario-diff-row scenario-diff-${row.type}`}
                    >
                      <span className="scenario-diff-sign" aria-hidden="true">
                        {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
                      </span>{' '}
                      <span className="scenario-diff-line">{row.line}</span>
                    </div>
                  ))}
                </div>
                <div className="scenario-version-actions">
                  <button
                    data-testid={`ai-scenario-restore-${version.id}`}
                    disabled={busy}
                    onClick={() => handleRestore(version.id)}
                  >
                    Restore as new version
                  </button>
                  <button
                    data-testid={`ai-scenario-accept-${version.id}`}
                    disabled={busy || isAccepted}
                    onClick={() => handleAccept(version.id)}
                  >
                    {isAccepted ? 'Accepted' : 'Accept as downstream snapshot'}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
