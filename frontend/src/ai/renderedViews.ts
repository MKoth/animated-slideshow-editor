import type { ContextSnapshot } from './contextSnapshot'

/**
 * Read-only labelled rendered-view requests (issue #441).
 *
 * Pure and read-only: every function derives its result from the bounded
 * live-project snapshot — Slide identity, time, and stable Scene Node ids —
 * and never mutates its inputs. Rendered views complement (never replace)
 * structured project evidence: identity and relationships always come from
 * the Context Snapshot, never from pixels.
 *
 * Two scopes: `current` renders the whole active scene at the selected time;
 * `focused` renders a scoped view of explicitly listed stable node ids at
 * the selected time. Unknown scopes, unknown node ids, empty focused scopes,
 * and off-slide requests never guess — they resolve as `invalid` with the
 * precise fix to take. Independent requests never block each other.
 */

/** Boundedness contract: capped requests per batch and ids per view. */
export const RENDERED_VIEW_LIMITS = {
  maxViews: 6,
  maxNodeIdsPerView: 12,
} as const

export type RenderedViewScope = 'current' | 'focused'

export interface RenderedViewRequest {
  id: string
  scope: RenderedViewScope
  /** Slide second to render. Defaults to 0; clamped to the Slide duration. */
  time?: number | null
  /** Focused scope only: the stable Scene Node ids to include. */
  nodeIds?: readonly string[] | null
  /** Active Slide only: any other Slide id is rejected with the active id. */
  slideId?: string | null
}

export interface RenderedViewSnapshotNode {
  id: string
  name: string
}

/** Minimal snapshot surface a rendered-view request reads. */
export interface RenderedViewSnapshot {
  slideId: string | null
  slideName: string | null
  duration: number | null
  nodes: RenderedViewSnapshotNode[]
}

export type RenderedViewStatus = 'ready' | 'invalid'

export interface RenderedView {
  requestId: string
  scope: RenderedViewScope
  slideId: string
  slideName: string
  time: number
  nodeIds: string[]
  nodeNames: Record<string, string>
  label: string
  status: RenderedViewStatus
  warnings: string[]
  actions: string[]
  /** Authority note: visual evidence complements structured project data. */
  note: string
}

export interface RenderedViewsResult {
  views: RenderedView[]
  truncated: boolean
}

export const RENDERED_VIEW_NOTE =
  'Visual evidence complements structured project data — identity and relationships come ' +
  'from stable Scene Node ids, hierarchy, and names in the Context Snapshot, never from pixels.'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatTime(time: number): string {
  return Number(time.toFixed(2)).toString()
}

export function formatRenderedViewLabel(args: {
  slideName: string
  slideId: string
  time: number
  nodeIds: readonly string[]
  scope: RenderedViewScope
  nodeNames?: Readonly<Record<string, string>>
}): string {
  const scopeWord = args.scope === 'focused' ? 'focused' : 'current scene'
  const nodes =
    args.nodeIds.length === 0
      ? 'no scene nodes'
      : args.nodeIds
          .map((id) => {
            const name = args.nodeNames?.[id]
            return typeof name === 'string' && name ? `${name} [${id}]` : `[${id}]`
          })
          .join(', ')
  return (
    `Slide "${args.slideName}" [${args.slideId}] @ ${formatTime(args.time)}s — ` +
    `${scopeWord} view (nodes: ${nodes})`
  )
}

/**
 * Adapt the live Context Snapshot to the minimal rendered-view surface.
 * Read-only: the returned structure shares no mutable references with the
 * snapshot beyond freshly copied rows.
 */
export function toRenderedViewSnapshot(context: ContextSnapshot): RenderedViewSnapshot {
  const animation = context.animation
  const nodes = (Array.isArray(animation.nodes) ? animation.nodes : []).map((node) => ({
    id: node.id,
    name: node.name,
  }))
  return {
    slideId: animation.timeline.slideId,
    slideName: context.activeSlideName,
    duration: animation.timeline.duration,
    nodes,
  }
}

function invalidView(
  requestId: string,
  scope: RenderedViewScope,
  actions: string[],
  known?: { slideId: string; slideName: string; time: number },
): RenderedView {
  // AC2 holds for failures too: an invalid result still identifies the Slide
  // and time it was requested against (when known) so the artist can relate
  // the precise fix to the right project objects. Unknown node ids are never
  // echoed as resolved — nodeIds stays empty and the action names the fix.
  const slideId = known?.slideId ?? ''
  const slideName = known?.slideName ?? ''
  const time = known?.time ?? 0
  return {
    requestId,
    scope,
    slideId,
    slideName,
    time,
    nodeIds: [],
    nodeNames: {},
    label:
      slideId !== ''
        ? `Slide "${slideName}" [${slideId}] @ ${formatTime(time)}s — no rendered view (${requestId} needs a precise fix; see next step)`
        : `View "${requestId}" — invalid (no rendered view; see next step)`,
    status: 'invalid',
    warnings: [],
    actions,
    note: RENDERED_VIEW_NOTE,
  }
}

function resolveOneView(
  request: RenderedViewRequest,
  snapshot: RenderedViewSnapshot,
  index: number,
): RenderedView {
  const requestId =
    typeof request?.id === 'string' && request.id.trim() ? request.id.trim() : `view-${index + 1}`
  const scope = (request as { scope?: unknown })?.scope
  const requestedTime =
    typeof request?.time === 'number' && Number.isFinite(request.time) ? request.time : 0
  const slideContext =
    typeof snapshot.slideId === 'string' && snapshot.slideId
      ? {
          slideId: snapshot.slideId,
          slideName: typeof snapshot.slideName === 'string' ? snapshot.slideName : '',
          time: requestedTime,
        }
      : undefined
  if (scope !== 'current' && scope !== 'focused') {
    return invalidView(
      requestId,
      'current',
      [
        `Unknown view scope ${JSON.stringify(scope)} — use scope "current" for the whole active scene or "focused" with explicit stable Scene Node ids.`,
      ],
      slideContext,
    )
  }

  const slideId = snapshot.slideId
  const slideName = typeof snapshot.slideName === 'string' ? snapshot.slideName : ''
  if (typeof slideId !== 'string' || !slideId) {
    return invalidView(requestId, scope, [
      'No active Slide to render — open a slide in the editor and request the view again.',
    ])
  }
  const requestedSlideId = trimText(request.slideId)
  if (requestedSlideId && requestedSlideId !== slideId) {
    return invalidView(
      requestId,
      scope,
      [
        `Request targets Slide [${requestedSlideId}] but the active Slide is "${slideName}" [${slideId}] — request a view of the active Slide; only the live scene can be rendered.`,
      ],
      { slideId, slideName, time: requestedTime },
    )
  }

  const rawTime = request.time === undefined || request.time === null ? 0 : request.time
  if (typeof rawTime !== 'number' || !Number.isFinite(rawTime)) {
    return invalidView(
      requestId,
      scope,
      [
        'Give this view a finite time in Slide seconds (e.g. 2.5) — the read-only render samples that moment without changing the project.',
      ],
      { slideId, slideName, time: 0 },
    )
  }
  const warnings: string[] = []
  const duration = snapshot.duration
  let time = rawTime
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
    const clamped = Math.min(Math.max(rawTime, 0), duration)
    if (clamped !== rawTime) {
      warnings.push(
        `Requested time ${formatTime(rawTime)}s is outside Slide "${slideName}" [${slideId}] duration [0, ${formatTime(duration)}s] — clamped to ${formatTime(clamped)}s for this read-only view.`,
      )
    }
    time = clamped
  } else if (rawTime < 0) {
    warnings.push(
      `Requested time ${formatTime(rawTime)}s is before the Slide start — clamped to 0s for this read-only view.`,
    )
    time = 0
  }

  const known = new Map(snapshot.nodes.map((node) => [node.id, node.name] as const))
  let nodeIds: string[] = []
  if (scope === 'current') {
    const all = snapshot.nodes.map((node) => node.id)
    if (all.length > RENDERED_VIEW_LIMITS.maxNodeIdsPerView) {
      warnings.push(
        `Scene carries ${all.length} nodes — showing the first ${RENDERED_VIEW_LIMITS.maxNodeIdsPerView} stable ids; request a focused view for a narrower scope.`,
      )
    }
    nodeIds = all.slice(0, RENDERED_VIEW_LIMITS.maxNodeIdsPerView)
  } else {
    const asked = Array.isArray(request.nodeIds)
      ? request.nodeIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : []
    if (asked.length === 0) {
      return invalidView(
        requestId,
        scope,
        [
          'Focused views need at least one stable Scene Node id — list the node ids to scope to, or use scope "current" for the whole active scene.',
        ],
        { slideId, slideName, time },
      )
    }
    const unknown = asked.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      return invalidView(
        requestId,
        scope,
        [
          `Unknown Scene Node ${unknown.map((id) => `[${id}]`).join(', ')} — check the stable id in the Context Snapshot or scene tree; nothing is guessed from names.`,
        ],
        { slideId, slideName, time },
      )
    }
    const deduped = [...new Set(asked)]
    if (deduped.length > RENDERED_VIEW_LIMITS.maxNodeIdsPerView) {
      warnings.push(
        `Focused scope lists ${deduped.length} nodes — showing the first ${RENDERED_VIEW_LIMITS.maxNodeIdsPerView} stable ids; split the request for a wider scope.`,
      )
    }
    nodeIds = deduped.slice(0, RENDERED_VIEW_LIMITS.maxNodeIdsPerView)
  }

  const nodeNames: Record<string, string> = {}
  for (const id of nodeIds) {
    const name = known.get(id)
    if (typeof name === 'string') nodeNames[id] = name
  }
  const label = formatRenderedViewLabel({
    slideName,
    slideId,
    time,
    nodeIds,
    scope,
    nodeNames,
  })
  return {
    requestId,
    scope,
    slideId,
    slideName,
    time,
    nodeIds,
    nodeNames,
    label,
    status: 'ready',
    warnings,
    actions: [],
    note: RENDERED_VIEW_NOTE,
  }
}

/**
 * Resolve every requested view independently. One invalid or out-of-range
 * request never prevents the others from resolving; per-view failures are
 * contained as `invalid` results with the precise fix to take.
 */
export function resolveRenderedViews(
  requests: readonly RenderedViewRequest[],
  snapshot: RenderedViewSnapshot,
): RenderedViewsResult {
  const list = Array.isArray(requests) ? requests : []
  const capped = list.slice(0, RENDERED_VIEW_LIMITS.maxViews)
  const views = capped.map((request, index) => {
    try {
      return resolveOneView(request, snapshot, index)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const fallbackId =
        typeof (request as { id?: unknown })?.id === 'string' &&
        ((request as { id: string }).id as string).trim()
          ? ((request as { id: string }).id as string).trim()
          : `view-${index + 1}`
      const slideContext =
        typeof snapshot.slideId === 'string' && snapshot.slideId
          ? {
              slideId: snapshot.slideId,
              slideName: typeof snapshot.slideName === 'string' ? snapshot.slideName : '',
              time: 0,
            }
          : undefined
      return {
        ...invalidView(
          fallbackId,
          'current',
          [
            `View request failed (${message}) — fix the request and ask again; other views are unaffected.`,
          ],
          slideContext,
        ),
      }
    }
  })
  return { views, truncated: list.length > capped.length }
}
