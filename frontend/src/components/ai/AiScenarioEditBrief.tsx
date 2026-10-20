import { useMemo } from 'react'
import { diffScenarioLines } from '../../engine/scenarioVersions'
import type { ScenarioMarkdownVersion } from '../../api/aiApi'

interface EditBriefMessage {
  readonly id: string
  readonly scenarioVersionId?: string | null
  readonly scenarioSummary?: string | null
  readonly scenarioTouchedSteps?: number[]
}

/**
 * Compact chat replacement for full scenario markdown: edit messages show
 * what changed (added/removed line counts against the previous version)
 * instead of reprinting the whole doc — the doc itself lives in the
 * Scenario MD modal. Falls back to the stored summary when the version
 * is not in the loaded list (portable-only or trimmed history).
 */
export function AiScenarioEditBrief({
  message,
  versions,
}: {
  message: EditBriefMessage
  versions: readonly ScenarioMarkdownVersion[]
}) {
  const counts = useMemo(() => {
    if (!message.scenarioVersionId) return null
    const version = versions.find((v) => v.id === message.scenarioVersionId)
    if (!version) return null
    const previous = versions.slice(0, versions.indexOf(version)).at(-1)?.content ?? ''
    let added = 0
    let removed = 0
    for (const row of diffScenarioLines(previous, version.content)) {
      if (row.line.trim() === '') continue
      if (row.type === 'add') added += 1
      else if (row.type === 'del') removed += 1
    }
    return { added, removed }
  }, [message.scenarioVersionId, versions])
  const summary = message.scenarioSummary?.trim() || null
  const touched = message.scenarioTouchedSteps ?? []
  const short = message.scenarioVersionId?.slice(0, 8) ?? null
  return (
    <div data-testid={`ai-message-scenario-edit-${message.id}`} className="ai-scenario-edit-brief">
      <span className="ai-scenario-edit-brief-title">Doc edit{summary ? ` — ${summary}` : ''}</span>
      {counts && (
        <span className="ai-scenario-edit-brief-counts">
          <span className="is-added">{counts.added} added</span>
          {' · '}
          <span className="is-removed">{counts.removed} removed</span>
        </span>
      )}
      {touched.length > 0 && (
        <span className="ai-scenario-edit-brief-steps">steps {touched.join(', ')}</span>
      )}
      {short && <span className="ai-scenario-edit-brief-version">version {short}</span>}
    </div>
  )
}
