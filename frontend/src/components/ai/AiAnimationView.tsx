import { useMemo, useState } from 'react'
import type { ContextSnapshot } from '../../ai/contextSnapshot'
import {
  analyzeBeats,
  toAnalysisSnapshot,
  type BeatAnalysis,
  type RequestedBeat,
} from '../../ai/animationAnalysis'
import {
  resolveRenderedViews,
  toRenderedViewSnapshot,
  type RenderedView,
  type RenderedViewRequest,
} from '../../ai/renderedViews'
import {
  composeSequence,
  type AlignmentOffsetRequest,
  type ExplicitTransitionRequest,
  type FrozenPoseRequest,
  type SceneTravelLeg,
  type SequenceCollectionInventory,
  type SequenceDraft,
  type SequenceSnapshot,
} from '../../ai/animationSequence'
import {
  proposeShapeDrafts,
  toShapeDraftSnapshot,
  type ShapeDraftResult,
} from '../../ai/shapeDrafts'
import {
  revalidateAnimationProposal,
  toRevalidationSnapshotFromAssistant,
  type RevalidationResult,
  type RevalidationSnapshot,
} from '../../ai/animationRevalidation'
import { planAnimationApply, type AnimationApplyPlan } from '../../ai/animationApply'
import {
  describeSupportedConditions,
  verifyPilot,
  type PilotBeatEvidence,
  type PilotVerification,
  type SupportedConditions,
} from '../../ai/pilotVerification'
import type { CompiledFootprint } from '../../engine/compiledFootprint'

interface AiAnimationViewProps {
  projectId: string
  conversationId: string | null
  context: ContextSnapshot
  disabled?: boolean
  /** strict per-mode chrome label: animation | shape | collection */
  assistantMode?: 'animation' | 'shape' | 'collection'
  /** Requested actions to analyze (issue #440). Empty until the artist describes a performance. */
  beats?: readonly RequestedBeat[]
  /** Requested rendered views (issue #441). Empty until the artist or assistant asks for visual evidence. */
  viewRequests?: readonly RenderedViewRequest[]
  /** Scene-level travel legs per beat (issue #443). Empty until travel is authored. */
  travel?: readonly SceneTravelLeg[]
  /** Explicit authored transitions between beats (issue #443). Gaps without one stay sequential. */
  transitions?: readonly ExplicitTransitionRequest[]
  /** Explicit Frozen Pose holds before/after beats (issue #443). */
  frozenPoses?: readonly FrozenPoseRequest[]
  /** Requested Clip Collection Alignment Offset adjustments (issue #443). */
  alignmentOffsets?: readonly AlignmentOffsetRequest[]
  /** Validated snapshot at dry-run time (issue #445). Null until the proposal is validated. */
  validated?: RevalidationSnapshot | null
  /** Live script footprint for replacement scope (issue #445). Null on first run. */
  footprint?: CompiledFootprint | null
  /** Live project fingerprint for stale detection (issue #445). Null when unknown. */
  liveFingerprint?: string | null
  /** True once the artist has reviewed the refreshed draft and previews (issue #445). */
  reviewed?: boolean
  /** Explicitly approved beat ids for the atomic apply batch (issue #446). Empty until approved. */
  approvedBeats?: readonly string[]
  /** Explicitly approved Shape draft ids for the atomic apply batch (issue #446). Empty until approved. */
  approvedDrafts?: readonly string[]
}

/**
 * Dedicated animation-assistant mode (issue #438). Opens against the active,
 * unsaved Project: every summary reads the live Context Snapshot regenerated
 * from engine state per request — never a saved copy. Summaries are bounded
 * and read-only; analysis and edits flow through the shared conversation and
 * the existing AI Edit Proposal lifecycle, not through scenario/audio/blackboard
 * stages (plan/scenario/reconciliation/narration/calibration/board).
 */
export function AiAnimationView({
  projectId,
  conversationId,
  context,
  disabled,
  assistantMode = 'animation',
  beats = [],
  viewRequests = [],
  travel = [],
  transitions = [],
  frozenPoses = [],
  alignmentOffsets = [],
  validated = null,
  footprint = null,
  liveFingerprint = null,
  reviewed = false,
  approvedBeats = [],
  approvedDrafts = [],
}: AiAnimationViewProps) {
  // Collapsed by default: the live counts stay visible while the verbose
  // read-only breakdown hides behind a toggle. Must sit before the disabled
  // early return (rules-of-hooks). Children stay mounted so testids resolve.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const analysis = useMemo(
    () => analyzeBeats(beats, toAnalysisSnapshot(context.animation)),
    [beats, context],
  )
  const rendered = useMemo(
    () => resolveRenderedViews(viewRequests, toRenderedViewSnapshot(context)),
    [viewRequests, context],
  )
  const shapeDrafts = useMemo(
    () =>
      proposeShapeDrafts({
        beats: analysis.beats,
        nodes: toShapeDraftSnapshot(context.animation),
      }),
    [analysis, context],
  )
  const sequence = useMemo(() => {
    const snapshot: SequenceSnapshot = {
      slideId: context.animation.timeline.slideId,
      slideName: context.activeSlideName,
      duration: context.activeSlideDuration ?? context.animation.timeline.duration,
      nodes: context.animation.nodes.map((node) => ({
        id: node.id,
        name: node.name,
      })),
    }
    const collections: SequenceCollectionInventory[] = context.animation.collections.map(
      (collection) => ({
        name: collection.name,
        bindings: { ...collection.bindings },
      }),
    )
    return composeSequence({
      beats: analysis.beats,
      views: rendered.views,
      snapshot,
      travel,
      transitions,
      frozenPoses,
      alignmentOffsets,
      collections,
    })
  }, [analysis, rendered, context, travel, transitions, frozenPoses, alignmentOffsets])
  const revalidation = useMemo(() => {
    const live = toRevalidationSnapshotFromAssistant(context.animation, {
      footprint,
      fingerprint: liveFingerprint,
    })
    const validatedSnapshot = validated ?? live
    return revalidateAnimationProposal({
      draft: sequence,
      validated: validatedSnapshot,
      live,
      reviewed,
    })
  }, [sequence, context, validated, footprint, liveFingerprint, reviewed])
  const applyPlan = useMemo(
    () =>
      planAnimationApply({
        draft: sequence,
        shapes: shapeDrafts,
        revalidation,
        approvedBeatIds: approvedBeats,
        approvedDraftIds: approvedDrafts,
      }),
    [sequence, shapeDrafts, revalidation, approvedBeats, approvedDrafts],
  )
  const pilot = useMemo(
    () =>
      verifyPilot({
        requested: [...beats],
        analysis,
        views: rendered.views,
        draft: sequence,
        shapes: shapeDrafts,
        revalidation,
        applyPlan,
      }),
    [beats, analysis, rendered, sequence, shapeDrafts, revalidation, applyPlan],
  )
  const pilotConditions = useMemo(() => describeSupportedConditions(pilot), [pilot])

  if (disabled) {
    return (
      <div className="ai-animation" data-testid="ai-animation-section">
        <div data-testid="ai-animation-disabled">
          {assistantMode === 'collection'
            ? 'Collections assistant unavailable — backend unreachable.'
            : assistantMode === 'shape'
              ? 'Shapes assistant unavailable — backend unreachable.'
              : 'Animation assistant unavailable — backend unreachable.'}
        </div>
      </div>
    )
  }

  const modeTitle =
    assistantMode === 'collection'
      ? 'Collections assistant — author reusable Clips + Collections'
      : assistantMode === 'shape'
        ? 'Shapes assistant — author mesh Shape steps'
        : 'Animation assistant — compose from existing collections + keyframes'

  const animation = context.animation
  const visibleNodes = animation.nodes.slice(0, 10)
  const visibleClips = animation.clips.slice(0, 10)
  const visibleCollections = animation.collections.slice(0, 10)

  return (
    <div className="ai-animation" data-testid="ai-animation-section">
      <div className="ai-animation__header">
        <span>{modeTitle}</span>
        <button
          data-testid="ai-animation-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? 'Hide details' : 'Show details'}
        </button>
      </div>
      <div data-testid="ai-animation-project">
        Project: {context.projectName || 'No project'}
        {projectId ? '' : ' (no active project)'}
      </div>
      <div data-testid="ai-animation-slide">
        Slide: {context.activeSlideName ?? 'none'}
        {context.activeSlideDuration !== null ? ` (${context.activeSlideDuration}s)` : ''}
      </div>
      <div data-testid="ai-animation-counts">
        {animation.nodes.length} node(s) · {animation.clips.length} clip(s) ·{' '}
        {animation.collections.length} collection(s) · {animation.timeline.totalKeyframes}{' '}
        keyframe(s)
      </div>
      <div data-testid="ai-animation-details" hidden={!detailsOpen}>
        {!conversationId && (
          <div data-testid="ai-animation-no-conversation">
            Start a conversation above to discuss this scene — analysis stays in chat until a
            proposal is approved.
          </div>
        )}

        <div data-testid="ai-animation-nodes">
          Scene nodes ({animation.nodes.length}
          {animation.truncated.nodes ? '+, truncated' : ''}):{' '}
          {visibleNodes.map((node) => `${node.name} [${node.id}]`).join(', ') || 'none'}
        </div>
        <div data-testid="ai-animation-rig">
          Rig: {animation.rig.boneCount} bone(s), {animation.rig.shapeInventory.length} shape
          node(s), {animation.rig.morphBindings.length} morph binding(s),{' '}
          {animation.rig.controls.length} control host(s)
        </div>
        <div data-testid="ai-animation-clips">
          Clips ({animation.clips.length}
          {animation.truncated.clips ? '+, truncated' : ''}):{' '}
          {visibleClips.map((clip) => clip.name).join(', ') || 'none'}
        </div>
        <div data-testid="ai-animation-collections">
          Clip Collections ({animation.collections.length}
          {animation.truncated.collections ? '+, truncated' : ''}):{' '}
          {visibleCollections.map((collection) => collection.name).join(', ') || 'none'}
        </div>
        <div data-testid="ai-animation-timeline">
          Timeline: {animation.timeline.duration ?? '—'}s, {animation.timeline.totalKeyframes}{' '}
          keyframe(s), {animation.timeline.clipInstanceCount} clip instance(s),{' '}
          {animation.timeline.placementCount} placement(s)
          {animation.timeline.hasAnimationScript ? ', animation script present' : ''}
        </div>
        <div data-testid="ai-animation-readonly-note">
          Live-project context — reflects unsaved editor state. Summaries are bounded and read-only;
          nothing here mutates the project.
        </div>
        <AiAnimationAnalysis analysis={analysis.beats} summary={analysis.summary} />
        <AiShapeDrafts result={shapeDrafts} />
        <AiRenderedViews views={rendered.views} truncated={rendered.truncated} />
        <AiAnimationSequence draft={sequence} />
        <AiAnimationRevalidation result={revalidation} />
        <AiAnimationApply plan={applyPlan} />
        <AiPilotVerification
          requestedBeatIds={beats.map((beat) => beat.id)}
          verification={pilot}
          conditions={pilotConditions}
        />
      </div>
    </div>
  )
}

function AiAnimationAnalysis({
  analysis,
  summary,
}: {
  analysis: BeatAnalysis[]
  summary: { total: number; ready: number; blocked: number }
}) {
  if (analysis.length === 0) {
    return (
      <div data-testid="ai-animation-analysis-empty">
        No requested actions yet — describe the performance in chat and each beat&apos;s target,
        reusable motion, gaps, and prerequisites will be analyzed here before anything is drafted.
      </div>
    )
  }
  return (
    <div data-testid="ai-animation-analysis">
      <div data-testid="ai-analysis-summary">
        Analysis: {summary.ready} ready · {summary.blocked} blocked ({summary.total} beats). Blocked
        beats stay unapplied while independent beats proceed.
      </div>
      {analysis.map((beat) => (
        <div key={beat.beatId} data-testid={`ai-analysis-beat-${beat.beatId}`}>
          <div>
            {beat.label} — {formatStatus(beat.status)}
          </div>
          {beat.resolvedNodeIds.length > 0 && (
            <div>Target: {beat.resolvedNodeIds.map((id) => `[${id}]`).join(', ')}</div>
          )}
          {beat.reusable.map((candidate) => (
            <div key={candidate.collectionId ?? candidate.collectionName}>
              Reusable: {candidate.collectionName} (bindings:{' '}
              {candidate.matchedSemantics.join(', ')}
              {candidate.clipIds.length > 0 ? `; clips: ${candidate.clipIds.join(', ')}` : ''})
            </div>
          ))}
          {beat.question && (
            <div data-testid={`ai-analysis-question-${beat.beatId}`}>{beat.question}</div>
          )}
          {beat.prerequisites.map((prerequisite, index) => (
            <div key={index}>Prerequisite: {prerequisite}</div>
          ))}
          {beat.geometry.state !== 'not-checked' && <div>Geometry: {beat.geometry.note}</div>}
          {beat.warnings.map((warning, index) => (
            <div key={index}>Note: {warning}</div>
          ))}
          {beat.actions.map((action, index) => (
            <div key={index}>Next step: {action}</div>
          ))}
          {beat.candidates.length > 0 && (
            <div>
              Candidates:{' '}
              {beat.candidates
                .map((c) => `${c.name} [${c.id}]${c.parentName ? ` (in ${c.parentName})` : ''}`)
                .join(', ')}
            </div>
          )}
        </div>
      ))}
      <div>
        Read-only analysis — targets resolve by stable Scene Node identity and existing
        names/metadata; ambiguous targets ask instead of guessing, and nothing here changes the
        project.
      </div>
    </div>
  )
}

function AiShapeDrafts({ result }: { result: ShapeDraftResult }) {
  if (result.drafts.length === 0) {
    return (
      <div data-testid="ai-shape-drafts-empty">
        No missing Shape drafts yet — beats with missing pose geometry will propose a separate
        closest-fit draft here for review before anything is duplicated.
      </div>
    )
  }
  return (
    <div data-testid="ai-shape-drafts">
      <div data-testid="ai-shape-drafts-summary">
        Shape drafts: {result.summary.proposed} proposed · {result.summary.needsArtistGeometry}{' '}
        needing artist-authored geometry ({result.summary.total} missing-pose beats). Sources stay
        unchanged; topology is preserved.
      </div>
      {result.drafts.map((draft) => (
        <div key={draft.draftId} data-testid={`ai-shape-draft-${draft.beatId}`}>
          <div>
            {draft.label} — {formatDraftStatus(draft.status)}
          </div>
          {draft.nodeId && (
            <div>
              Target: {draft.nodeName} [{draft.nodeId}]
            </div>
          )}
          {draft.sourceShapeName && (
            <div>
              Source (unchanged): {draft.sourceShapeName} → draft: {draft.draftName}
            </div>
          )}
          <div>{draft.note}</div>
          {draft.warnings.map((warning, index) => (
            <div key={index}>Note: {warning}</div>
          ))}
          {draft.actions.map((action, index) => (
            <div key={index}>Next step: {action}</div>
          ))}
          {draft.feedback && <div>Review: {draft.feedback}</div>}
        </div>
      ))}
      {result.warnings.map((warning, index) => (
        <div key={index}>Draft note: {warning}</div>
      ))}
      <div>{result.note}</div>
      <div>
        Read-only drafts — duplication mints a separate Shape with the existing DuplicateShape
        command only after approval; the source Shape is never mutated.
      </div>
    </div>
  )
}

function AiRenderedViews({ views, truncated }: { views: RenderedView[]; truncated: boolean }) {
  if (views.length === 0) {
    return (
      <div data-testid="ai-rendered-views-empty">
        No rendered views requested yet — ask for the current scene or a focused view at a selected
        time and each view will be labelled with its Slide, time, and stable Scene Node ids.
      </div>
    )
  }
  return (
    <div data-testid="ai-rendered-views">
      <div data-testid="ai-rendered-views-summary">
        Rendered views: {views.length} requested{truncated ? ' (truncated to the bounded set)' : ''}
        . Read-only — requesting a view never changes the project.
      </div>
      {views.map((view) => (
        <div key={view.requestId} data-testid={`ai-rendered-view-${view.requestId}`}>
          {view.status === 'ready' ? (
            <div data-testid={`ai-rendered-view-label-${view.requestId}`}>{view.label}</div>
          ) : (
            <div>View {view.requestId} — invalid (needs a precise fix)</div>
          )}
          {view.warnings.map((warning, index) => (
            <div key={index}>Note: {warning}</div>
          ))}
          {view.actions.map((action, index) => (
            <div key={index}>Next step: {action}</div>
          ))}
          <div>{view.note}</div>
        </div>
      ))}
      <div>
        Visual evidence complements structured project data — identity and relationships come from
        stable Scene Node ids, hierarchy, and names, never from pixels.
      </div>
    </div>
  )
}

function AiAnimationSequence({ draft }: { draft: SequenceDraft }) {
  if (draft.beats.length === 0) {
    return (
      <div data-testid="ai-animation-sequence">
        <div data-testid="ai-animation-sequence-empty">
          No sequence drafted yet — ordered beats, per-beat previews, the full-sequence preview, and
          the retained Animation Script will appear here before anything is applied.
        </div>
      </div>
    )
  }
  return (
    <div data-testid="ai-animation-sequence">
      <div data-testid="ai-sequence-summary">
        Sequence: {draft.summary.draftable} draftable · {draft.summary.blocked} blocked (
        {draft.summary.total} beats). Blocked beats stay undrafted while independent beats proceed.
      </div>
      {draft.beats.map((beat) => (
        <div key={beat.beatId} data-testid={`ai-sequence-beat-${beat.beatId}`}>
          <div>
            Beat {beat.order + 1}: {beat.label} —{' '}
            {beat.status === 'draftable' ? 'draftable' : 'blocked (undrafted)'}
          </div>
          {beat.targetNodeIds.length > 0 && (
            <div>Target: {beat.targetNodeIds.map((id) => `[${id}]`).join(', ')}</div>
          )}
          {beat.collectionName && <div>Reusable: {beat.collectionName}</div>}
          {beat.travel.map((leg, index) => (
            <div key={index}>
              Travel: [{leg.targetNodeId}] to ({leg.to.x}, {leg.to.y}
              {typeof leg.to.scaleX === 'number' ? `, scale ${leg.to.scaleX}` : ''}
              {typeof leg.to.scaleY === 'number' ? ` × ${leg.to.scaleY}` : ''}) over {leg.duration}s
              — scene-level, separate from character-local motion
            </div>
          ))}
          {(beat.frozenBefore || beat.frozenAfter) && (
            <div>
              Frozen pose{beat.frozenBefore && beat.frozenAfter ? 's' : ''}:{' '}
              {[beat.frozenBefore ? 'holds before' : null, beat.frozenAfter ? 'holds after' : null]
                .filter(Boolean)
                .join(' and ')}{' '}
              with hold interpolation
            </div>
          )}
          {beat.transitionAfter && (
            <div>
              Transition to [{beat.transitionAfter.toBeatId}]: {beat.transitionAfter.kind}
              {beat.transitionAfter.explicit ? ' (explicit)' : ' (sequential)'} — lane priority does
              not crossfade
            </div>
          )}
          {beat.jumps.map((jump, index) => (
            <div key={index}>Handoff: {jump}</div>
          ))}
          {beat.alignmentNotes.map((note, index) => (
            <div key={index}>Alignment: {note}</div>
          ))}
          {beat.dependencies.map((dependency, index) => (
            <div key={index}>Dependency: {dependency}</div>
          ))}
          {beat.assumptions.map((assumption, index) => (
            <div key={index}>Assumption: {assumption}</div>
          ))}
          {beat.warnings.map((warning, index) => (
            <div key={index}>Note: {warning}</div>
          ))}
          {beat.blockers.map((blocker, index) => (
            <div key={index}>Blocked: {blocker}</div>
          ))}
          {beat.actions.map((action, index) => (
            <div key={index}>Next step: {action}</div>
          ))}
          {beat.previewViewIds.length > 0 && (
            <div>Verified by: {beat.previewViewIds.join(', ')}</div>
          )}
        </div>
      ))}
      {draft.transitions
        .filter((entry) => entry.explicit)
        .map((entry) => (
          <div
            key={`${entry.fromBeatId}-${entry.toBeatId}`}
            data-testid={`ai-sequence-transition-${entry.fromBeatId}-${entry.toBeatId}`}
          >
            Explicit {entry.kind} transition: {entry.label}
          </div>
        ))}
      {draft.frozen.map((hold) => (
        <div
          key={`${hold.beatId}-${hold.edge}`}
          data-testid={`ai-sequence-frozen-${hold.beatId}-${hold.edge}`}
        >
          Frozen pose {hold.edge} [{hold.beatId}]: {hold.label}
        </div>
      ))}
      {draft.alignmentEffects.map((effect, index) => (
        <div
          key={`${effect.collectionName}-${effect.semanticName}-${index}`}
          data-testid={`ai-sequence-alignment-${index}`}
        >
          Alignment offset: {effect.label} {effect.scope}
        </div>
      ))}
      {draft.previews.map((preview) => (
        <div
          key={preview.beatId ?? 'full'}
          data-testid={`ai-sequence-preview-${preview.beatId ?? 'full'}`}
        >
          <div data-testid={`ai-sequence-preview-label-${preview.beatId ?? 'full'}`}>
            {preview.label}
          </div>
        </div>
      ))}
      <div data-testid="ai-sequence-script">{draft.scriptSource}</div>
      {draft.warnings.map((warning, index) => (
        <div key={index}>Sequence note: {warning}</div>
      ))}
      <div>{draft.note}</div>
      <div>
        Read-only sequence — binding-compatible reusable motion only, labelled previews before
        approval, and the retained script compiles to ordinary timeline data.
      </div>
    </div>
  )
}

function formatStatus(status: BeatAnalysis['status']): string {
  switch (status) {
    case 'ready':
      return 'ready (compatible reusable motion)'
    case 'needs-clarification':
      return 'needs clarification (ambiguous target)'
    case 'missing-motion':
      return 'missing motion (no compatible reusable motion)'
    case 'missing-prerequisite':
      return 'blocked (missing prerequisite)'
    case 'invalid':
      return 'invalid (needs a precise fix)'
  }
}

function formatDraftStatus(status: ShapeDraftResult['drafts'][number]['status']): string {
  switch (status) {
    case 'proposed':
      return 'proposed (separate closest-fit copy for review)'
    case 'accepted':
      return 'accepted (artist-approved copy)'
    case 'edited':
      return 'edited (renamed review copy)'
    case 'rejected':
      return 'rejected (source unchanged)'
    case 'needs-artist-geometry':
      return 'needs artist-authored geometry (topology cannot express the pose)'
  }
}

function AiAnimationRevalidation({ result }: { result: RevalidationResult }) {
  if (result.beats.length === 0) {
    return (
      <div data-testid="ai-animation-revalidation">
        <div data-testid="ai-revalidation-empty">
          No proposal to revalidate yet — affected beats, dependencies, and the exact script-created
          output a rerun would replace will appear here before approval.
        </div>
      </div>
    )
  }
  return (
    <div data-testid="ai-animation-revalidation">
      <div data-testid="ai-revalidation-summary">
        Revalidation: {result.affectedBeatIds.length} affected · {result.summary.draftable}{' '}
        draftable ({result.summary.total} beats). Relevant live changes block stale work until
        analysis and previews are refreshed and reviewed again.
      </div>
      {result.beats.map((beat) => (
        <div key={beat.beatId} data-testid={`ai-revalidation-beat-${beat.beatId}`}>
          <div>
            Beat {beat.order + 1}: {beat.label} —{' '}
            {beat.affected
              ? 'affected (stale)'
              : beat.draftStatus === 'draftable'
                ? 'current'
                : 'blocked (undrafted)'}
          </div>
          {beat.dependencies.map((dependency, index) => (
            <div key={index}>Dependency: {dependency}</div>
          ))}
          {beat.reasons.map((reason, index) => (
            <div key={index}>Affected: {reason}</div>
          ))}
          {beat.actions.map((action, index) => (
            <div key={index}>Next step: {action}</div>
          ))}
        </div>
      ))}
      <div data-testid="ai-revalidation-replacement">
        <div data-testid="ai-revalidation-replacement-label">{result.replacement.label}</div>
        <div>Replacement requires approval — {result.replacement.warning}</div>
      </div>
      {result.blocked && (
        <div data-testid="ai-revalidation-stale">
          Stale — the live Project changed since validation
          {result.affectedBeatIds.length > 0
            ? ` (affected: ${result.affectedBeatIds.map((id) => `[${id}]`).join(', ')})`
            : ''}
          . Refresh analysis and previews, then review again before approval; blocked beats stay
          unapplied.
        </div>
      )}
      {result.needsReview && (
        <div data-testid="ai-revalidation-review">
          Requires renewed review before approval — review the affected beats, dependencies,
          replacement scope, and labelled previews, then approve through the existing proposal
          lifecycle.
        </div>
      )}
      {result.approvable ? (
        <div data-testid="ai-revalidation-approvable">
          Ready for approval — relevant-current and reviewed; approval applies through one
          Transaction with one undo entry.
        </div>
      ) : (
        <div data-testid="ai-revalidation-blocked">
          Not ready for approval —{' '}
          {result.blocked
            ? 'stale work is blocked until refreshed and reviewed again.'
            : 'review the refreshed draft and previews before approving.'}
        </div>
      )}
      {result.warnings.map((warning, index) => (
        <div key={index}>Revalidation note: {warning}</div>
      ))}
      <div>{result.note}</div>
      <div>
        Read-only revalidation — relevant live changes block stale proposals and identify affected
        work; refreshed analysis and previews require renewed review before approval.
      </div>
    </div>
  )
}

function AiAnimationApply({ plan }: { plan: AnimationApplyPlan }) {
  if (!plan.appliable && plan.skippedBeats.length === 0 && plan.skippedDrafts.length === 0) {
    return (
      <div data-testid="ai-animation-apply">
        <div data-testid="ai-apply-empty">
          No approved batch yet — approve coherent valid beats and accepted Shape drafts and the
          atomic apply plan will appear here before anything changes the project.
        </div>
      </div>
    )
  }
  return (
    <div data-testid="ai-animation-apply">
      <div data-testid="ai-apply-summary">
        Apply: {plan.summary.appliableBeats} appliable beat(s) · {plan.summary.appliableDrafts}{' '}
        appliable draft(s) ({plan.summary.skippedBeats + plan.summary.skippedDrafts} remaining
        unapplied). One approved batch is one Transaction with one undo entry.
      </div>
      {plan.appliableBeats.map((beat) => (
        <div key={beat.beatId} data-testid={`ai-apply-beat-${beat.beatId}`}>
          <div>
            Beat {beat.order + 1}: {beat.label} — appliable (explicitly approved and valid)
          </div>
        </div>
      ))}
      {plan.skippedBeats.map((beat) => (
        <div key={beat.beatId} data-testid={`ai-apply-beat-${beat.beatId}`}>
          <div>
            Beat {beat.order + 1}: {beat.label} — remains unapplied
          </div>
          <div>Reason: {beat.reason}</div>
          <div>Next step: {beat.action}</div>
        </div>
      ))}
      {plan.appliableDrafts.map((draft) => (
        <div key={draft.draftId} data-testid={`ai-apply-draft-${draft.draftId}`}>
          <div>
            Shape draft {draft.draftId} — appliable (accepted review copy; the source stays
            unchanged)
          </div>
        </div>
      ))}
      {plan.skippedDrafts.map((draft) => (
        <div key={draft.draftId} data-testid={`ai-apply-draft-${draft.draftId}`}>
          <div>Shape draft {draft.draftId} — remains unapplied</div>
          <div>Reason: {draft.reason}</div>
          <div>Next step: {draft.action}</div>
        </div>
      ))}
      {plan.approvable ? (
        <div data-testid="ai-apply-approvable">
          Ready to apply — relevant-current and reviewed; one approved batch applies as one
          Transaction with one undo entry.
        </div>
      ) : (
        <div data-testid="ai-apply-blocked">
          Not ready to apply —{' '}
          {plan.blocked
            ? 'stale work is blocked until refreshed and reviewed again.'
            : 'review and approve valid work before applying.'}
        </div>
      )}
      {plan.needsReview && (
        <div data-testid="ai-apply-review">
          Requires renewed review before applying — review the refreshed draft and previews, then
          approve again.
        </div>
      )}
      <div data-testid="ai-apply-save">
        Applying changes the active Project in memory; persistence uses the existing Save flow —
        nothing is saved implicitly.
      </div>
      {plan.warnings.map((warning, index) => (
        <div key={index}>Apply note: {warning}</div>
      ))}
      <div>{plan.note}</div>
      <div>
        Read-only apply plan — only explicitly approved, valid beats and accepted Shape drafts
        apply; blocked, rejected, stale, or dependency-incomplete work remains unapplied.
      </div>
    </div>
  )
}

function AiPilotVerification({
  requestedBeatIds,
  verification,
  conditions,
}: {
  requestedBeatIds: readonly string[]
  verification: PilotVerification
  conditions: SupportedConditions
}) {
  const requestedPilotIds = requestedBeatIds.filter((id) =>
    verification.beats.some((beat) => beat.beatId === id),
  )
  if (requestedPilotIds.length === 0) {
    return (
      <div data-testid="ai-pilot-verification">
        <div data-testid="ai-pilot-empty">
          No pilot route requested yet — describe the six-beat sofa-to-blackboard performance
          (sleep, wake/stretch, get-down, room travel, turn/move toward the camera, sit) and the
          end-to-end verification with its supported conditions will appear here.
        </div>
      </div>
    )
  }
  return (
    <div data-testid="ai-pilot-verification">
      <div data-testid="ai-pilot-summary">
        Pilot: {verification.summary.draftable} draftable · {verification.summary.blocked} blocked (
        {verification.summary.total} beats).{' '}
        {verification.coversAllSix
          ? 'Covers the six-beat sofa-to-blackboard route.'
          : 'Partial pilot route — request all six beats for full coverage.'}{' '}
        {verification.summary.visuallyVerified} visually verified · {verification.summary.appliable}{' '}
        appliable.
      </div>
      {verification.beats.map((beat) => (
        <div key={beat.beatId} data-testid={`ai-pilot-beat-${beat.beatId}`}>
          <div>
            {beat.label} — {formatPilotStatus(beat.status)}
          </div>
          {beat.targetNodeIds.length > 0 && (
            <div>Target: {beat.targetNodeIds.map((id) => `[${id}]`).join(', ')}</div>
          )}
          {beat.reusableNames.map((name) => (
            <div key={name}>Reusable: {name} (binding-compatible, not name-inferred)</div>
          ))}
          {beat.nameOnlyNames.length > 0 && (
            <div>Name-only (not reusable): {beat.nameOnlyNames.join(', ')}</div>
          )}
          {beat.prerequisites.map((prerequisite, index) => (
            <div key={index}>Prerequisite: {prerequisite}</div>
          ))}
          {beat.previewLabels.map((label, index) => (
            <div key={index}>Preview: {label}</div>
          ))}
          {!beat.visuallyVerified && beat.reusableNames.length > 0 && (
            <div>Visual fit unverified — request a focused rendered view before approving.</div>
          )}
          {beat.blockers.map((blocker, index) => (
            <div key={index}>Blocked: {blocker}</div>
          ))}
          {beat.actions.map((action, index) => (
            <div key={index}>Next step: {action}</div>
          ))}
          {beat.affected && <div>Affected (stale) — refresh and review again before approval.</div>}
          {beat.appliable && <div>Appliable in the approved batch.</div>}
        </div>
      ))}
      {verification.successes.map((success, index) => (
        <div key={`success-${index}`}>Success: {success}</div>
      ))}
      {verification.limitations.map((limitation, index) => (
        <div key={`limitation-${index}`}>Limitation: {limitation}</div>
      ))}
      <div data-testid="ai-pilot-conditions">
        <div>Supported conditions — demonstrated:</div>
        {conditions.demonstrated.map((entry, index) => (
          <div key={`demonstrated-${index}`}>{entry}</div>
        ))}
        <div>Prerequisites:</div>
        {conditions.prerequisites.map((entry, index) => (
          <div key={`prerequisite-${index}`}>{entry}</div>
        ))}
        <div>Limitations:</div>
        {conditions.limitations.map((entry, index) => (
          <div key={`condition-limitation-${index}`}>{entry}</div>
        ))}
        <div>Support claim: {conditions.claim}</div>
      </div>
      <div data-testid="ai-pilot-review-gate">
        {conditions.requiresHumanEvidenceReview
          ? 'Expansion beyond the pilot requires a later human evidence review that approves an explicit support envelope — no broader claim is made from the pilot alone.'
          : 'Human evidence review recorded.'}
      </div>
      <div>{verification.note}</div>
      <div>
        Read-only pilot evidence — successes, blockers, and limitations are recorded per beat;
        equivalent rigs and scenes re-run this verification with their own stable node ids.
      </div>
    </div>
  )
}

function formatPilotStatus(status: PilotBeatEvidence['status']): string {
  switch (status) {
    case 'ready':
      return 'ready (compatible reusable motion)'
    case 'needs-clarification':
      return 'needs clarification (ambiguous target)'
    case 'missing-motion':
      return 'missing motion (no compatible reusable motion)'
    case 'missing-prerequisite':
      return 'blocked (missing prerequisite)'
    case 'invalid':
      return 'invalid (needs a precise fix)'
  }
}
