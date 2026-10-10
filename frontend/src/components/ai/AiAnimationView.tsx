import type { ContextSnapshot } from '../../ai/contextSnapshot'

interface AiAnimationViewProps {
  projectId: string
  conversationId: string | null
  context: ContextSnapshot
  disabled?: boolean
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
}: AiAnimationViewProps) {
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
    </div>
  )
}
