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

  // Headless host: loads scenario data, syncs server versions into the
  // portable `.lesson` doc, and renders the modal when the store flag (set
  // from the AiPanel input bar) is on. No inline section — the chat keeps
  // its scroll height; everything lives in the modal.
  if (disabled) return null
  return scenarioModalOpen ? (
    <AiScenarioModal projectId={projectId} conversationId={conversationId} context={context} />
  ) : null
}
