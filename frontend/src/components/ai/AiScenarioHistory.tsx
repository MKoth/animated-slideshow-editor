import { useContext, useEffect, useMemo } from 'react'
import { useAiStore } from '../../stores/aiStore'
import { EngineContext } from '../../app/engineContext'
import type { ScenarioMarkdownVersion } from '../../api/aiApi'
import { appendScenarioVersion, createEmptyScenarioSection } from '../../engine/scenarioSection'
import { diffScenarioLines } from '../../engine/scenarioVersions'

const EMPTY_MARKDOWN_VERSIONS: ScenarioMarkdownVersion[] = []

interface AiScenarioHistoryProps {
  projectId: string
  conversationId: string | null
}

/**
 * History tab (issue #462): ordered versions with line-or-block diff and
 * restore-as-new-version. Restore copies forward, never rewrites history,
 * and never touches the engine Undo Stack (plain project.setScenario).
 */
export function AiScenarioHistory({ projectId, conversationId }: AiScenarioHistoryProps) {
  const versions = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] ?? EMPTY_MARKDOWN_VERSIONS,
  )
  const activeId = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] && s.activeMarkdownVersionIdByProject[projectId],
  )
  const busy = useAiStore((s) => s.markdownBusy)
  const error = useAiStore((s) => s.markdownError)
  const store = useAiStore.getState()
  const engine = useContext(EngineContext)?.engine

  useEffect(() => {
    if (projectId) void store.loadMarkdownVersions(projectId, conversationId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, conversationId])

  const ordered = useMemo(() => [...versions], [versions])

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
    })
  }

  if (!conversationId) {
    return <div data-testid="ai-scenario-history-empty">Start a conversation to see history.</div>
  }

  return (
    <div data-testid="ai-scenario-history">
      <div data-testid="ai-scenario-history-count">
        {ordered.length} version(s){activeId ? ` — active ${activeId.slice(0, 8)}` : ''}
      </div>
      {error && <div data-testid="ai-scenario-history-error">{error.message}</div>}
      {ordered.length === 0 ? (
        <div data-testid="ai-scenario-history-none">No versions yet — chat to iterate.</div>
      ) : (
        <ol>
          {ordered.map((version, index) => {
            const previous = index > 0 ? ordered[index - 1]!.content : ''
            const diff = diffScenarioLines(previous, version.content)
            return (
              <li key={version.id} data-testid={`ai-scenario-version-${version.id}`}>
                <div data-testid={`ai-scenario-version-summary-${version.id}`}>
                  {version.summary} — steps {version.touchedSteps.join(', ') || '—'} —{' '}
                  {version.timestamp}
                </div>
                <div data-testid={`ai-scenario-version-diff-${version.id}`}>
                  {diff.map((row, i) => (
                    <div
                      key={i}
                      data-testid={`ai-scenario-version-diff-${version.id}-${row.type}-${i}`}
                      data-type={row.type}
                    >
                      {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '} {row.line}
                    </div>
                  ))}
                </div>
                <button
                  data-testid={`ai-scenario-restore-${version.id}`}
                  disabled={busy}
                  onClick={() => handleRestore(version.id)}
                >
                  Restore as new version
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
