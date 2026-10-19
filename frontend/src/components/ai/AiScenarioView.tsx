import { useContext, useEffect, useState } from 'react'
import type { AiScenario, AiScenarioStep, ScenarioMarkdownVersion } from '../../api/aiApi'
import { useAiStore } from '../../stores/aiStore'
import { EngineContext } from '../../app/engineContext'
import { appendScenarioVersion, createEmptyScenarioSection } from '../../engine/scenarioSection'
import { AiScenarioHistory } from './AiScenarioHistory'
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
  const scenarios = useAiStore((s) => s.scenarios)
  const scenarioById = useAiStore((s) => s.scenarioById)
  const activeScenarioId = useAiStore((s) => s.activeScenarioId)
  const scenarioGenerating = useAiStore((s) => s.scenarioGenerating)
  const scenarioError = useAiStore((s) => s.scenarioError)
  const scenarioRequest = useAiStore((s) => s.scenarioRequest)
  const scenarioTab = useAiStore((s) => s.scenarioTab)
  const scenarioModalOpen = useAiStore((s) => s.scenarioModalOpen ?? false)
  const markdownVersions = useAiStore(
    (s) => s.markdownVersionsByProject[projectId] ?? EMPTY_MARKDOWN_VERSIONS,
  )
  const activeMarkdownVersionId = useAiStore(
    (s) => s.activeMarkdownVersionIdByProject[projectId] ?? null,
  )
  const store = useAiStore.getState()
  const engineValue = useContext(EngineContext)
  const engine = engineValue?.engine

  const activeScenario = activeScenarioId ? (scenarioById[activeScenarioId] ?? null) : null

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

  // Portable doc sync (issue #462): server versions append to the portable
  // `.lesson` section via plain `project.setScenario` — never through the
  // engine dispatcher, so no Undo Stack entries are created. Canvas undo
  // never touches the doc because no Command touches `scenario`.
  // Last-writer-wins: current tracks the per-project active version.
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
    if (changed) engine.project.setScenario(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    markdownVersions.length,
    activeMarkdownVersionId,
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

  const handlePropose = () => {
    if (!projectId || !conversationId || !scenarioRequest.trim() || scenarioGenerating) return
    void store.proposeScenario(projectId, conversationId, scenarioRequest, context)
  }

  const handleRevise = () => {
    if (
      !projectId ||
      !conversationId ||
      !scenarioRequest.trim() ||
      !activeScenarioId ||
      scenarioGenerating
    )
      return
    void store.proposeScenario(
      projectId,
      conversationId,
      scenarioRequest,
      context,
      activeScenarioId,
    )
  }

  return (
    <div className="ai-scenario" data-testid="ai-scenario-section">
      <div data-testid="ai-scenario-header">
        <span>Scenario mode</span>{' '}
        <button data-testid="ai-scenario-open-modal" onClick={handleOpenModal}>
          Scenario MD
        </button>
      </div>
      {scenarioModalOpen && (
        <AiScenarioModal projectId={projectId} conversationId={conversationId} />
      )}
      <div data-testid="ai-scenario-tabs">
        <button
          data-testid="ai-scenario-tab-doc"
          disabled={scenarioTab === 'doc'}
          onClick={() => store.setScenarioTab('doc')}
        >
          Doc
        </button>
        <button
          data-testid="ai-scenario-tab-history"
          disabled={scenarioTab === 'history'}
          onClick={() => store.setScenarioTab('history')}
        >
          History
        </button>
      </div>
      {scenarioTab === 'history' ? (
        <AiScenarioHistory projectId={projectId} conversationId={conversationId} />
      ) : (
        <>
          <div data-testid="ai-scenario-doc">
            <div data-testid="ai-scenario-doc-markdown">
              {engine?.project?.scenario?.currentMarkdown || 'No scenario markdown yet.'}
            </div>
            <div data-testid="ai-scenario-doc-count">
              {markdownVersions.length} version(s) — restores copy forward, canvas undo never
              touches the doc.
            </div>
          </div>
          <div className="ai-scenario__request">
            <input
              data-testid="ai-scenario-request"
              placeholder="Describe the lesson to scenario…"
              value={scenarioRequest}
              onChange={(e) => store.setScenarioRequest(e.target.value)}
            />
            <button
              data-testid="ai-scenario-propose"
              disabled={!conversationId || !scenarioRequest.trim() || scenarioGenerating}
              onClick={handlePropose}
            >
              Draft scenario
            </button>
            <button
              data-testid="ai-scenario-revise"
              disabled={
                !conversationId ||
                !scenarioRequest.trim() ||
                !activeScenarioId ||
                scenarioGenerating
              }
              onClick={handleRevise}
            >
              Revise scenario
            </button>
            {scenarioGenerating && (
              <span data-testid="ai-scenario-generating">Drafting scenario…</span>
            )}
            {scenarioError && <span data-testid="ai-scenario-error">{scenarioError.message}</span>}
          </div>

          {scenarios.length > 0 && (
            <select
              data-testid="ai-scenario-select"
              value={activeScenarioId ?? ''}
              onChange={(e) => store.setActiveScenario(e.target.value || null)}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title} ({scenario.status})
                </option>
              ))}
            </select>
          )}

          {activeScenario ? (
            <AiScenarioEditor
              key={`${activeScenario.id}-${activeScenario.modified}`}
              scenario={activeScenario}
            />
          ) : (
            <div data-testid="ai-scenario-empty">
              No action scenario yet — describe the lesson above.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AiScenarioEditor({ scenario }: { scenario: AiScenario }) {
  const [titleDraft, setTitleDraft] = useState(scenario.title)
  const [descriptionDraft, setDescriptionDraft] = useState(scenario.description)
  const [stepDrafts, setStepDrafts] = useState<Record<string, Partial<AiScenarioStep>>>({})
  const store = useAiStore.getState()

  const handleSaveEdits = () => {
    const patch: {
      title?: string
      description?: string
      steps?: {
        id: string
        partTag?: AiScenarioStep['partTag']
        spokenLine?: string
        onScreenAction?: string
        assetHints?: string[]
        estimatedDurationSec?: number
      }[]
    } = {}
    if (titleDraft.trim() && titleDraft !== scenario.title) patch.title = titleDraft.trim()
    if (descriptionDraft !== scenario.description) patch.description = descriptionDraft
    const stepPatches = scenario.steps
      .map((step) => {
        const draft = stepDrafts[step.id]
        if (!draft) return null
        const item: {
          id: string
          partTag?: AiScenarioStep['partTag']
          spokenLine?: string
          onScreenAction?: string
          assetHints?: string[]
          estimatedDurationSec?: number
        } = { id: step.id }
        let touched = false
        if (draft.partTag !== undefined && draft.partTag !== step.partTag) {
          item.partTag = draft.partTag
          touched = true
        }
        if (draft.spokenLine !== undefined && draft.spokenLine !== step.spokenLine) {
          item.spokenLine = draft.spokenLine
          touched = true
        }
        if (draft.onScreenAction !== undefined && draft.onScreenAction !== step.onScreenAction) {
          item.onScreenAction = draft.onScreenAction
          touched = true
        }
        if (draft.assetHints !== undefined && draft.assetHints !== step.assetHints) {
          item.assetHints = draft.assetHints
          touched = true
        }
        if (
          draft.estimatedDurationSec !== undefined &&
          draft.estimatedDurationSec !== step.estimatedDurationSec
        ) {
          item.estimatedDurationSec = draft.estimatedDurationSec
          touched = true
        }
        return touched ? item : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (stepPatches.length > 0) patch.steps = stepPatches
    if (Object.keys(patch).length === 0) return
    void store.updateScenario(scenario.id, patch)
  }

  const handleMoveStep = (stepId: string, direction: -1 | 1) => {
    const ordered = [...scenario.steps].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((s) => s.id === stepId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    const swapped = [...ordered]
    const [moved] = swapped.splice(index, 1)
    swapped.splice(target, 0, moved)
    void store.updateScenario(
      scenario.id,
      // Order is the list order; lines/actions/hints ride along unchanged.
      { steps: swapped.map((s) => ({ id: s.id })) },
    )
  }

  const setStepDraft = (stepId: string, patch: Partial<AiScenarioStep>) => {
    setStepDrafts((prev) => ({ ...prev, [stepId]: { ...prev[stepId], ...patch } }))
  }

  return (
    <div data-testid={`ai-scenario-${scenario.id}`}>
      <div className="ai-scenario__overview">
        <h4>Action Scenario</h4>
        <label>
          Title
          <input
            data-testid="ai-scenario-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            data-testid="ai-scenario-description"
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
          />
        </label>
        <div data-testid="ai-scenario-status">Status: {scenario.status}</div>
        <div data-testid="ai-scenario-revisions">Revisions: {scenario.revisions.length}</div>
        <div data-testid="ai-scenario-gate">
          {scenario.status === 'accepted'
            ? 'Accepted — Stage B reconciliation reads this version.'
            : 'Stage B runs only on the accepted version.'}
        </div>
      </div>

      <div className="ai-scenario__steps">
        <h4>Steps</h4>
        {[...scenario.steps]
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <div key={step.id} data-testid={`ai-scenario-step-${step.id}`}>
              <div data-testid={`ai-scenario-step-tag-${step.id}`}>Part: {step.partTag}</div>
              <select
                data-testid={`ai-scenario-step-tag-input-${step.id}`}
                aria-label={`Step part tag ${step.id}`}
                value={stepDrafts[step.id]?.partTag ?? step.partTag}
                onChange={(e) =>
                  setStepDraft(step.id, {
                    partTag: e.target.value as AiScenarioStep['partTag'],
                  })
                }
              >
                <option value="intro">intro</option>
                <option value="middle">middle</option>
                <option value="outro">outro</option>
              </select>
              <div data-testid={`ai-scenario-step-spoken-${step.id}`}>{step.spokenLine}</div>
              <textarea
                data-testid={`ai-scenario-step-spoken-input-${step.id}`}
                aria-label={`Spoken line ${step.id}`}
                value={stepDrafts[step.id]?.spokenLine ?? step.spokenLine}
                onChange={(e) => setStepDraft(step.id, { spokenLine: e.target.value })}
              />
              <div data-testid={`ai-scenario-step-action-${step.id}`}>{step.onScreenAction}</div>
              <textarea
                data-testid={`ai-scenario-step-action-input-${step.id}`}
                aria-label={`On-screen action ${step.id}`}
                value={stepDrafts[step.id]?.onScreenAction ?? step.onScreenAction}
                onChange={(e) => setStepDraft(step.id, { onScreenAction: e.target.value })}
              />
              <div data-testid={`ai-scenario-step-hints-${step.id}`}>
                {(stepDrafts[step.id]?.assetHints ?? step.assetHints).join(', ')}
              </div>
              <input
                data-testid={`ai-scenario-step-hints-input-${step.id}`}
                aria-label={`Asset hints ${step.id}`}
                value={(stepDrafts[step.id]?.assetHints ?? step.assetHints).join(', ')}
                onChange={(e) =>
                  setStepDraft(step.id, {
                    assetHints: e.target.value
                      .split(',')
                      .map((h) => h.trim())
                      .filter(Boolean),
                  })
                }
              />
              <input
                data-testid={`ai-scenario-step-duration-${step.id}`}
                aria-label={`Step duration ${step.id}`}
                type="number"
                min={0}
                value={stepDrafts[step.id]?.estimatedDurationSec ?? step.estimatedDurationSec}
                onChange={(e) =>
                  setStepDraft(step.id, { estimatedDurationSec: Number(e.target.value) })
                }
              />
              <button
                data-testid={`ai-scenario-step-up-${step.id}`}
                onClick={() => handleMoveStep(step.id, -1)}
              >
                Move up
              </button>
              <button
                data-testid={`ai-scenario-step-down-${step.id}`}
                onClick={() => handleMoveStep(step.id, 1)}
              >
                Move down
              </button>
            </div>
          ))}
      </div>

      <div className="ai-scenario__actions">
        <button data-testid="ai-scenario-save" onClick={handleSaveEdits}>
          Save edits
        </button>
        <button
          data-testid="ai-scenario-accept"
          disabled={scenario.status === 'accepted'}
          onClick={() => void store.acceptScenario(scenario.id)}
        >
          Accept
        </button>
        <button
          data-testid="ai-scenario-reject"
          disabled={scenario.status === 'rejected'}
          onClick={() => void store.rejectScenario(scenario.id)}
        >
          Reject
        </button>
      </div>
    </div>
  )
}
