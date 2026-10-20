import { useContext, useEffect } from 'react'
import type { ScenarioMarkdownVersion } from '../../api/aiApi'
import { useAiStore } from '../../stores/aiStore'
import { EngineContext } from '../../app/engineContext'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  withScenarioAcceptedVersion,
} from '../../engine/scenarioSection'
import { AiScenarioModal } from './AiScenarioModal'

const EMPTY_MARKDOWN_VERSIONS: ScenarioMarkdownVersion[] = []

interface AiScenarioViewProps {
  projectId: string
  conversationId: string | null
  context: unknown
  disabled?: boolean
}

export function AiScenarioView({
  projectId,
  conversationId,
  context,
  disabled,
}: AiScenarioViewProps) {
  const activeScenarioId = useAiStore((s) => s.activeScenarioId)
  const scenarioModalOpen = useAiStore((s) => s.scenarioModalOpen ?? false)
  const markdownVersions = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] ?? EMPTY_MARKDOWN_VERSIONS,
  )
  const activeMarkdownVersionId = useAiStore(
    (s) => s.activeMarkdownVersionIdByProject[projectId] ?? null,
  )
  const acceptedMarkdownVersionId = useAiStore(
    (s) => s.acceptedMarkdownVersionIdByProject[projectId] ?? null,
  )
  const store = useAiStore.getState()
  const engineValue = useContext(EngineContext)
  const engine = engineValue?.engine

  useEffect(() => {
    if (projectId) void store.loadScenarios(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (activeScenarioId) void store.loadScenario(activeScenarioId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScenarioId])

  useEffect(() => {
    if (projectId) void store.loadMarkdownVersions(projectId, conversationId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, conversationId])

  // Portable doc sync (issues #462, #466): server versions append to the portable
  // `.lesson` section via plain `project.setScenario` — never through the
  // engine dispatcher, so no Undo Stack entries are created. Canvas undo
  // never touches the doc because no Command touches `scenario`.
  // Last-writer-wins: current tracks the per-project active version.
  // The accepted pointer travels with the doc so download/import/duplicate
  // carry the stable downstream snapshot verbatim.
  useEffect(() => {
    if (!engine?.project || markdownVersions.length === 0) return
    const current = engine.project.scenario ?? createEmptyScenarioSection('')
    const known = new Set(current.versions.map((v) => v.id))
    let next = current
    let changed = false
    for (const v of markdownVersions) {
      if (known.has(v.id)) continue
      next = appendScenarioVersion(next, {
        id: v.id,
        summary: v.summary,
        touchedSteps: [...v.touchedSteps],
        timestamp: v.timestamp,
        content: v.content,
      })
      changed = true
    }
    const activeContent =
      markdownVersions.find((v) => v.id === activeMarkdownVersionId)?.content ??
      markdownVersions[markdownVersions.length - 1]!.content
    if (next.currentMarkdown !== activeContent) {
      next = { ...next, currentMarkdown: activeContent }
      changed = true
    }
    if ((next.acceptedVersionId ?? null) !== (acceptedMarkdownVersionId ?? null)) {
      next = withScenarioAcceptedVersion(next, acceptedMarkdownVersionId ?? null)
      changed = true
    }
    if (changed) engine.project.setScenario(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    markdownVersions.length,
    activeMarkdownVersionId,
    acceptedMarkdownVersionId,
    (engine as { project?: { id?: string } } | undefined)?.project?.id,
  ])

  if (disabled) {
    return (
      <div className="ai-scenario" data-testid="ai-scenario-section">
        <div data-testid="ai-scenario-disabled">
          Action scenarios unavailable — backend unreachable.
        </div>
      </div>
    )
  }

  const handleOpenModal = () => {
    store.setScenarioModalOpen(true)
  }

  // Slim inline surface: the chat keeps a header, an open button, and a
  // one-line status. The full doc, History, request inputs, and legacy
  // editor live in the modal so the message list keeps its scroll height.
  return (
    <div className="ai-scenario" data-testid="ai-scenario-section">
      <div data-testid="ai-scenario-header">
        <span>Scenario mode</span>{' '}
        <button data-testid="ai-scenario-open-modal" onClick={handleOpenModal}>
          Scenario MD
        </button>
      </div>
      {scenarioModalOpen && (
        <AiScenarioModal projectId={projectId} conversationId={conversationId} context={context} />
      )}
      <div data-testid="ai-scenario-status">
        {markdownVersions.length} version(s)
        {acceptedMarkdownVersionId
          ? ` — accepted ${acceptedMarkdownVersionId.slice(0, 8)}`
          : ' — no accepted version'}
      </div>
      <div data-testid="ai-scenario-downstream-gate">
        {acceptedMarkdownVersionId
          ? `Accepted ${acceptedMarkdownVersionId.slice(0, 8)} is the downstream snapshot — later assistants read it, not the active draft.`
          : 'No accepted version — downstream reconciliation blocks until one is accepted in History.'}
      </div>
    </div>
  )
}
