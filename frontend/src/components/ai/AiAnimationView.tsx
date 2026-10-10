import { useMemo } from 'react'
import type { ContextSnapshot } from '../../ai/contextSnapshot'
import {
  analyzeBeats,
  toAnalysisSnapshot,
  type BeatAnalysis,
  type RequestedBeat,
} from '../../ai/animationAnalysis'

interface AiAnimationViewProps {
  projectId: string
  conversationId: string | null
  context: ContextSnapshot
  disabled?: boolean
  /** Requested actions to analyze (issue #440). Empty until the artist describes a performance. */
  beats?: readonly RequestedBeat[]
}

/**
 * Dedicated animation-assistant mode (issue #438). Opens against the active,
 * unsaved Project: every summary reads the live Context Snapshot regenerated
 * from engine state per request — never a saved copy. Summaries are bounded
 * and read-only; analysis and edits flow through the shared conversation and
 * the existing AI Edit Proposal lifecycle, not through lesson-production
 * stages (plan/scenario/reconciliation/narration/calibration/board).
 */
export function AiAnimationView({
  projectId,
  conversationId,
  context,
  disabled,
  beats = [],
}: AiAnimationViewProps) {
  const analysis = useMemo(
    () => analyzeBeats(beats, toAnalysisSnapshot(context.animation)),
    [beats, context],
  )

  if (disabled) {
    return (
      <div className="ai-animation" data-testid="ai-animation-section">
        <div data-testid="ai-animation-disabled">
          Animation assistant unavailable — backend unreachable.
        </div>
      </div>
    )
  }

  const animation = context.animation
  const visibleNodes = animation.nodes.slice(0, 10)
  const visibleClips = animation.clips.slice(0, 10)
  const visibleCollections = animation.collections.slice(0, 10)

  return (
    <div className="ai-animation" data-testid="ai-animation-section">
      <div className="ai-animation__header">
        <span>Animation assistant</span>
      </div>
      <div data-testid="ai-animation-project">
        Project: {context.projectName || 'No project'}
        {projectId ? '' : ' (no active project)'}
      </div>
      <div data-testid="ai-animation-slide">
        Slide: {context.activeSlideName ?? 'none'}
        {context.activeSlideDuration !== null ? ` (${context.activeSlideDuration}s)` : ''}
      </div>
      {!conversationId && (
        <div data-testid="ai-animation-no-conversation">
          Start a conversation above to discuss this scene — analysis stays in chat until a proposal
          is approved.
        </div>
      )}

      <div data-testid="ai-animation-nodes">
        Scene nodes ({animation.nodes.length}
        {animation.truncated.nodes ? '+, truncated' : ''}):{' '}
        {visibleNodes.map((node) => `${node.name} [${node.id}]`).join(', ') || 'none'}
      </div>
      <div data-testid="ai-animation-rig">
        Rig: {animation.rig.boneCount} bone(s), {animation.rig.shapeInventory.length} shape node(s),{' '}
        {animation.rig.morphBindings.length} morph binding(s), {animation.rig.controls.length}{' '}
        control host(s)
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
