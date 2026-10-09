import { useEffect, useMemo, useState } from 'react'
import type { AiPlan, AiPlanSlide } from '../../api/aiApi'
import { useAiStore } from '../../stores/aiStore'

interface AiPlanViewProps {
  projectId: string
  conversationId: string | null
  context: unknown
  disabled?: boolean
}

export function AiPlanView({ projectId, conversationId, context, disabled }: AiPlanViewProps) {
  const plans = useAiStore((s) => s.plans)
  const planById = useAiStore((s) => s.planById)
  const activePlanId = useAiStore((s) => s.activePlanId)
  const planGenerating = useAiStore((s) => s.planGenerating)
  const planError = useAiStore((s) => s.planError)
  const planRequest = useAiStore((s) => s.planRequest)
  const store = useAiStore.getState()

  const activePlan = activePlanId ? (planById[activePlanId] ?? null) : null

  useEffect(() => {
    if (projectId) void store.loadPlans(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (activePlanId) void store.loadPlan(activePlanId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlanId])

  if (disabled) {
    return (
      <div className="ai-plan" data-testid="ai-plan-section">
        <div data-testid="ai-plan-disabled">Lesson plans unavailable — backend unreachable.</div>
      </div>
    )
  }

  const handlePropose = () => {
    if (!projectId || !conversationId || !planRequest.trim() || planGenerating) return
    void store.proposePlan(projectId, conversationId, planRequest, context)
  }

  const handleRevise = () => {
    if (!projectId || !conversationId || !planRequest.trim() || !activePlanId || planGenerating)
      return
    void store.proposePlan(projectId, conversationId, planRequest, context, activePlanId)
  }

  return (
    <div className="ai-plan" data-testid="ai-plan-section">
      <div className="ai-plan__request">
        <input
          data-testid="ai-plan-request"
          placeholder="Describe the lesson to plan…"
          value={planRequest}
          onChange={(e) => store.setPlanRequest(e.target.value)}
        />
        <button
          data-testid="ai-plan-propose"
          disabled={!conversationId || !planRequest.trim() || planGenerating}
          onClick={handlePropose}
        >
          Propose plan
        </button>
        <button
          data-testid="ai-plan-revise"
          disabled={!conversationId || !planRequest.trim() || !activePlanId || planGenerating}
          onClick={handleRevise}
        >
          Revise plan
        </button>
        {planGenerating && <span data-testid="ai-plan-generating">Generating plan…</span>}
        {planError && <span data-testid="ai-plan-error">{planError.message}</span>}
      </div>

      {plans.length > 0 && (
        <select
          data-testid="ai-plan-select"
          value={activePlanId ?? ''}
          onChange={(e) => store.setActivePlan(e.target.value || null)}
        >
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.title} ({plan.status})
            </option>
          ))}
        </select>
      )}

      {activePlan ? (
        <AiPlanEditor key={`${activePlan.id}-${activePlan.modified}`} plan={activePlan} />
      ) : (
        <div data-testid="ai-plan-empty">No lesson plan yet — describe the lesson above.</div>
      )}
    </div>
  )
}

function AiPlanEditor({ plan }: { plan: AiPlan }) {
  const [titleDraft, setTitleDraft] = useState(plan.title)
  const [strategyDraft, setStrategyDraft] = useState(plan.teachingStrategy)
  const [slideDrafts, setSlideDrafts] = useState<Record<string, Partial<AiPlanSlide>>>({})
  const store = useAiStore.getState()

  const missingAssets = useMemo(() => {
    const missing: { slideTitle: string; name: string }[] = []
    for (const slide of plan.slides) {
      for (const asset of slide.requiredAssets) {
        if (asset.classification === 'missing') {
          missing.push({ slideTitle: slide.title, name: asset.name })
        }
      }
    }
    return missing
  }, [plan])

  const handleSaveEdits = () => {
    const patch: {
      title?: string
      teachingStrategy?: string
      slides?: {
        id: string
        title?: string
        goal?: string
        explanation?: string
        estimatedDurationSec?: number
      }[]
    } = {}
    if (titleDraft.trim() && titleDraft !== plan.title) patch.title = titleDraft.trim()
    if (strategyDraft !== plan.teachingStrategy) patch.teachingStrategy = strategyDraft
    const slidePatches = plan.slides
      .map((slide) => {
        const draft = slideDrafts[slide.id]
        if (!draft) return null
        const item: {
          id: string
          title?: string
          goal?: string
          explanation?: string
          estimatedDurationSec?: number
        } = { id: slide.id }
        let touched = false
        if (draft.title !== undefined && draft.title !== slide.title) {
          item.title = draft.title
          touched = true
        }
        if (draft.goal !== undefined && draft.goal !== slide.goal) {
          item.goal = draft.goal
          touched = true
        }
        if (draft.explanation !== undefined && draft.explanation !== slide.explanation) {
          item.explanation = draft.explanation
          touched = true
        }
        if (
          draft.estimatedDurationSec !== undefined &&
          draft.estimatedDurationSec !== slide.estimatedDurationSec
        ) {
          item.estimatedDurationSec = draft.estimatedDurationSec
          touched = true
        }
        return touched ? item : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (slidePatches.length > 0) patch.slides = slidePatches
    if (Object.keys(patch).length === 0) return
    void store.updatePlan(plan.id, patch)
  }

  const handleMoveSlide = (slideId: string, direction: -1 | 1) => {
    const ordered = [...plan.slides].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((s) => s.id === slideId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    const swapped = [...ordered]
    const [moved] = swapped.splice(index, 1)
    swapped.splice(target, 0, moved)
    void store.updatePlan(
      plan.id,
      // Order is the list order; durations/descriptions ride along unchanged.
      { slides: swapped.map((s) => ({ id: s.id })) },
    )
  }

  return (
    <div data-testid={`ai-plan-${plan.id}`}>
      <div className="ai-plan__overview">
        <h4>Lesson Overview</h4>
        <label>
          Title
          <input
            data-testid="ai-plan-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
          />
        </label>
        <div data-testid="ai-plan-description">{plan.description}</div>
        <div data-testid="ai-plan-language">Language: {plan.language}</div>
        <div data-testid="ai-plan-duration">Estimated duration: {plan.estimatedDurationSec}s</div>
        <div data-testid="ai-plan-objective">{plan.learningObjective}</div>
        <label>
          Teaching strategy
          <textarea
            data-testid="ai-plan-strategy"
            value={strategyDraft}
            onChange={(e) => setStrategyDraft(e.target.value)}
          />
        </label>
        <div data-testid="ai-plan-status">Status: {plan.status}</div>
        <div data-testid="ai-plan-revisions">Revisions: {plan.revisions.length}</div>
      </div>

      <div className="ai-plan__slides">
        <h4>Slides</h4>
        {[...plan.slides]
          .sort((a, b) => a.order - b.order)
          .map((slide) => (
            <div key={slide.id} data-testid={`ai-plan-slide-${slide.id}`}>
              <div data-testid={`ai-plan-slide-title-${slide.id}`}>{slide.title}</div>
              <input
                data-testid={`ai-plan-slide-title-input-${slide.id}`}
                aria-label={`Slide title ${slide.title}`}
                value={slideDrafts[slide.id]?.title ?? slide.title}
                onChange={(e) =>
                  setSlideDrafts((prev) => ({
                    ...prev,
                    [slide.id]: { ...prev[slide.id], title: e.target.value },
                  }))
                }
              />
              <div>{slide.goal}</div>
              <input
                data-testid={`ai-plan-slide-duration-${slide.id}`}
                aria-label={`Slide duration ${slide.title}`}
                type="number"
                min={0}
                value={slideDrafts[slide.id]?.estimatedDurationSec ?? slide.estimatedDurationSec}
                onChange={(e) =>
                  setSlideDrafts((prev) => ({
                    ...prev,
                    [slide.id]: {
                      ...prev[slide.id],
                      estimatedDurationSec: Number(e.target.value),
                    },
                  }))
                }
              />
              <div>{slide.explanation}</div>
              <textarea
                data-testid={`ai-plan-slide-explanation-${slide.id}`}
                aria-label={`Slide explanation ${slide.title}`}
                value={slideDrafts[slide.id]?.explanation ?? slide.explanation}
                onChange={(e) =>
                  setSlideDrafts((prev) => ({
                    ...prev,
                    [slide.id]: { ...prev[slide.id], explanation: e.target.value },
                  }))
                }
              />
              <div data-testid={`ai-plan-slide-narration-${slide.id}`}>
                {slide.suggestedNarration}
              </div>
              <button
                data-testid={`ai-plan-slide-up-${slide.id}`}
                onClick={() => handleMoveSlide(slide.id, -1)}
              >
                Move up
              </button>
              <button
                data-testid={`ai-plan-slide-down-${slide.id}`}
                onClick={() => handleMoveSlide(slide.id, 1)}
              >
                Move down
              </button>
            </div>
          ))}
      </div>

      <div className="ai-plan__assets">
        <h4>Assets</h4>
        {plan.slides.map((slide) => (
          <div key={slide.id} data-testid={`ai-plan-assets-${slide.id}`}>
            {slide.requiredAssets.map((asset, index) => (
              <span
                key={`${asset.name}-${index}`}
                data-testid={`ai-plan-asset-${slide.id}-${index}`}
                data-classification={asset.classification}
              >
                {asset.name} ({asset.classification})
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="ai-plan__materials">
        <h4>Materials &amp; Shaders</h4>
        {plan.slides.map((slide) => (
          <div key={slide.id}>
            <span data-testid={`ai-plan-materials-${slide.id}`}>
              {(slide.recommendedMaterials ?? []).join(', ')}
            </span>
            <span data-testid={`ai-plan-shaders-${slide.id}`}>
              {(slide.recommendedShaders ?? []).join(', ')}
            </span>
          </div>
        ))}
      </div>

      <div className="ai-plan__animations">
        <h4>Animations</h4>
        {plan.slides.map((slide) => (
          <div key={slide.id} data-testid={`ai-plan-clips-${slide.id}`}>
            {(slide.recommendedClips ?? []).join(', ')}
          </div>
        ))}
      </div>

      <div className="ai-plan__missing" data-testid="ai-plan-missing">
        <h4>Missing Resources</h4>
        {missingAssets.length === 0 ? (
          <span data-testid="ai-plan-missing-empty">No missing assets.</span>
        ) : (
          missingAssets.map((asset, index) => (
            <div key={`${asset.name}-${index}`} data-testid={`ai-plan-missing-${index}`}>
              {asset.name} (slide: {asset.slideTitle})
            </div>
          ))
        )}
      </div>

      <div className="ai-plan__actions">
        <button data-testid="ai-plan-save" onClick={handleSaveEdits}>
          Save edits
        </button>
        <button
          data-testid="ai-plan-accept"
          disabled={plan.status === 'accepted'}
          onClick={() => void store.acceptPlan(plan.id)}
        >
          Accept
        </button>
        <button
          data-testid="ai-plan-reject"
          disabled={plan.status === 'rejected'}
          onClick={() => void store.rejectPlan(plan.id)}
        >
          Reject
        </button>
        <button
          data-testid="ai-plan-reconcile"
          disabled
          title="Asset reconciliation lives here (Spec 13 owns the workflow)"
        >
          Reconcile assets
        </button>
      </div>
    </div>
  )
}
