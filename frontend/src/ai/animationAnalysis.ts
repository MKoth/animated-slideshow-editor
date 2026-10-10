import type { AnimationAssistantSnapshot } from './contextSnapshot'

/**
 * Deterministic analysis of requested animation actions (issue #440).
 *
 * Pure and read-only: every function below derives its result from the
 * bounded live-project snapshot — stable Scene Node identity, hierarchy,
 * Unique Names, Semantic Names, asset metadata, and rig bindings — and never
 * mutates its inputs. Blocked beats never prevent independent beats from
 * being analyzed: {@link analyzeBeats} maps each beat in isolation and
 * contains per-beat failures as `invalid` instead of throwing.
 *
 * Compatibility is evidence-based, never name-based: a Clip Collection only
 * counts as reusable when at least one of its semantic bindings overlaps the
 * resolved target subtree. Name matches without binding overlap are kept as
 * labelled `nameOnly` evidence with an explicit warning — they are never
 * assumed compatible. Rendered-preview verification arrives in #441; until
 * then every reusable candidate carries a preview warning.
 */

/** Per-beat cap so one vague request cannot flood the analysis. */
export const ANALYSIS_LIMITS = {
  candidatesPerTarget: 10,
  motionCandidates: 10,
  shapesPerTarget: 50,
} as const

export interface AnalysisNode {
  id: string
  name: string
  parentId: string | null
  depth: number
  semanticName: string | null
  components: string[]
  assetDefinitionId: string | null
}

export interface AnalysisClip {
  id: string | null
  name: string
  channels: string[]
}

export interface AnalysisCollection {
  id: string | null
  name: string
  bindings: Record<string, string>
}

export interface AnalysisShapeInventory {
  nodeId: string
  shapeCount: number
  shapeNames: string[]
}

/** Minimal snapshot surface the analyzer reads. */
export interface AnimationAnalysisSnapshot {
  nodes: AnalysisNode[]
  clips: AnalysisClip[]
  collections: AnalysisCollection[]
  shapes: AnalysisShapeInventory[]
  hasCamera: boolean
}

export interface TargetQuery {
  nodeId?: string | null
  name?: string | null
  assetDefinitionId?: string | null
}

export interface RequestedBeat {
  id: string
  label: string
  target: TargetQuery
  /** Desired reusable motion, e.g. "walk", "sit", "sleep". Null when undescribed. */
  motion?: string | null
  /** Explicit scene-setup dependency; "camera" in label/motion also implies it. */
  requiresCamera?: boolean
}

export interface TargetCandidate {
  id: string
  name: string
  semanticName: string | null
  parentId: string | null
  /** Hierarchy evidence: the parent's Unique Name, null at the scene root. */
  parentName: string | null
  assetDefinitionId: string | null
}

export type TargetStatus = 'resolved' | 'ambiguous' | 'unresolved'
export type TargetMatchKind = 'id' | 'unique-name' | 'semantic' | 'asset' | 'substring' | 'none'

export interface TargetResolution {
  status: TargetStatus
  matchKind: TargetMatchKind
  nodeIds: string[]
  candidates: TargetCandidate[]
  question: string | null
  /** Non-blocking evidence caveat (e.g. a stale asset reference) for resolved targets. */
  warning: string | null
}

export interface ReusableCandidate {
  collectionId: string | null
  collectionName: string
  matchedSemantics: string[]
  clipIds: string[]
}

export interface NameOnlyMatch {
  id: string | null
  name: string
}

export type BeatStatus =
  'ready' | 'needs-clarification' | 'missing-motion' | 'missing-prerequisite' | 'invalid'

export type GeometryState = 'available' | 'missing-with-suggestion' | 'no-shapes' | 'not-checked'

export interface GeometryFinding {
  state: GeometryState
  matchedShapes: string[]
  closestFit: string | null
  note: string
}

export interface BeatAnalysis {
  beatId: string
  label: string
  status: BeatStatus
  resolvedNodeIds: string[]
  reusable: ReusableCandidate[]
  nameOnly: { collections: NameOnlyMatch[]; clips: NameOnlyMatch[] }
  geometry: GeometryFinding
  prerequisites: string[]
  warnings: string[]
  question: string | null
  actions: string[]
  /** Stable-identity candidates for an ambiguous target; empty otherwise. */
  candidates: TargetCandidate[]
}

export interface AnalysisSummary {
  total: number
  ready: number
  blocked: number
  needsClarification: number
  missingMotion: number
  missingPrerequisite: number
  invalid: number
  missingGeometry: number
}

export interface AnalysisResult {
  beats: BeatAnalysis[]
  summary: AnalysisSummary
}

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function lowerText(value: string): string {
  return value.toLowerCase()
}

function toCandidate(node: AnalysisNode, nameById: ReadonlyMap<string, string>): TargetCandidate {
  return {
    id: node.id,
    name: node.name,
    semanticName: node.semanticName,
    parentId: node.parentId,
    parentName: node.parentId !== null ? (nameById.get(node.parentId) ?? null) : null,
    assetDefinitionId: node.assetDefinitionId,
  }
}

/** Shared bounded-ambiguity shape: slice candidates, label truncation, ask by stable id. */
function ambiguous(
  matchKind: TargetMatchKind,
  matched: readonly AnalysisNode[],
  nameById: ReadonlyMap<string, string>,
  question: (shown: string, truncated: string) => string,
): TargetResolution {
  const candidates = matched
    .slice(0, ANALYSIS_LIMITS.candidatesPerTarget)
    .map((node) => toCandidate(node, nameById))
  const shown = candidates
    .map((c) => `${c.name} [${c.id}]${c.parentName ? ` (in ${c.parentName})` : ''}`)
    .join(', ')
  const truncated =
    matched.length > candidates.length ? ` (showing first ${candidates.length})` : ''
  return {
    status: 'ambiguous',
    matchKind,
    nodeIds: [],
    candidates,
    question: question(shown, truncated),
    warning: null,
  }
}

function describeQuery(query: TargetQuery): string {
  const bits: string[] = []
  const name = trimText(query.name)
  const nodeId = trimText(query.nodeId)
  const asset = trimText(query.assetDefinitionId)
  if (name) bits.push(`“${name}”`)
  if (nodeId) bits.push(`id ${nodeId}`)
  if (asset) bits.push(`asset ${asset}`)
  return bits.length > 0 ? bits.join(', ') : '(no target given)'
}

/**
 * Resolve a requested target against stable identity and existing project
 * structure/metadata. Precedence: stable node id → exact Unique Name →
 * exact Semantic Name (group) → asset metadata. Only exact matches resolve;
 * any partial or multi-candidate evidence asks the artist instead of guessing.
 */
export function resolveTarget(
  query: TargetQuery,
  snapshot: AnimationAnalysisSnapshot,
): TargetResolution {
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const nodeId = trimText(query.nodeId)
  const name = trimText(query.name)
  const asset = trimText(query.assetDefinitionId)
  const nameById = new Map(nodes.map((node) => [node.id, node.name] as const))
  const unresolved = (): TargetResolution => ({
    status: 'unresolved',
    matchKind: 'none',
    nodeIds: [],
    candidates: [],
    question: null,
    warning: null,
  })

  if (nodeId) {
    const exact = nodes.find((node) => node.id === nodeId)
    if (exact) {
      return {
        status: 'resolved',
        matchKind: 'id',
        nodeIds: [exact.id],
        candidates: [],
        question: null,
        warning: null,
      }
    }
    return unresolved()
  }

  // Explicit asset metadata that matches nothing is stale — but the name may
  // still be current, so resolution falls through to name matching and says so.
  const assetMatched = asset ? nodes.filter((node) => node.assetDefinitionId === asset) : []
  const staleAssetWarning = (resolvedId: string): string | null =>
    asset && assetMatched.length === 0
      ? `Asset reference “${asset}” matches no scene node — it may be stale; the target resolves by name to [${resolvedId}]. Confirm it is intended before approving.`
      : null

  if (asset && assetMatched.length === 1) {
    return {
      status: 'resolved',
      matchKind: 'asset',
      nodeIds: [assetMatched[0].id],
      candidates: [],
      question: null,
      warning: null,
    }
  }
  if (asset && assetMatched.length > 1) {
    return ambiguous(
      'asset',
      assetMatched,
      nameById,
      (shown, truncated) =>
        `“${asset}” matches several scene nodes (${shown}${truncated}). ` +
        `Reply with the stable Scene Node id to animate — visual similarity is not project identity.`,
    )
  }

  if (name) {
    const term = lowerText(name)
    const uniqueExact = nodes.filter((node) => lowerText(node.name) === term)
    if (uniqueExact.length === 1) {
      return {
        status: 'resolved',
        matchKind: 'unique-name',
        nodeIds: [uniqueExact[0].id],
        candidates: [],
        question: null,
        warning: staleAssetWarning(uniqueExact[0].id),
      }
    }
    if (uniqueExact.length > 1) {
      return ambiguous(
        'unique-name',
        uniqueExact,
        nameById,
        (shown, truncated) =>
          `“${name}” matches several nodes by Unique Name (${shown}${truncated}). ` +
          `Reply with the stable Scene Node id to animate.`,
      )
    }
    const semanticExact = nodes.filter(
      (node) => node.semanticName !== null && lowerText(node.semanticName) === term,
    )
    if (semanticExact.length > 0) {
      // A Semantic Name is a repeatable tag: every carrier animates together.
      return {
        status: 'resolved',
        matchKind: 'semantic',
        nodeIds: semanticExact.map((node) => node.id),
        candidates: [],
        question: null,
        warning:
          asset && assetMatched.length === 0
            ? `Asset reference “${asset}” matches no scene node — it may be stale; the target resolves by Semantic Name. Confirm before approving.`
            : null,
      }
    }
    const partial = nodes.filter(
      (node) =>
        lowerText(node.name).includes(term) ||
        (node.semanticName !== null && lowerText(node.semanticName).includes(term)),
    )
    if (partial.length >= 1) {
      // Even a single partial match is ambiguous evidence: the request text
      // does not pin the node, so the artist confirms instead of the
      // assistant animating a look-alike.
      return ambiguous(
        'substring',
        partial,
        nameById,
        (shown, truncated) =>
          `“${name}” does not exactly match one scene node — closest: ${shown}${truncated}. ` +
          `Reply with the stable Scene Node id this beat should animate; structured hierarchy and names decide, not text similarity.`,
      )
    }
    return unresolved()
  }

  return unresolved()
}

/** Collect the lower-cased Semantic Names of nodes plus their descendants. */
function subtreeSemanticNames(
  resolvedIds: readonly string[],
  nodes: readonly AnalysisNode[],
): Set<string> {
  const byParent = new Map<string, AnalysisNode[]>()
  for (const node of nodes) {
    if (node.parentId === null) continue
    const siblings = byParent.get(node.parentId)
    if (siblings) siblings.push(node)
    else byParent.set(node.parentId, [node])
  }
  const visited = new Set<string>()
  const semantics = new Set<string>()
  const stack = [...resolvedIds]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (visited.has(id)) continue
    visited.add(id)
    const node = nodes.find((entry) => entry.id === id)
    if (!node) continue
    if (node.semanticName !== null && node.semanticName.trim()) {
      semantics.add(lowerText(node.semanticName.trim()))
    }
    for (const child of byParent.get(id) ?? []) stack.push(child.id)
  }
  return semantics
}

function motionText(motion: string | null | undefined): string {
  return lowerText(trimText(motion ?? null))
}

function findNameMatches<T extends { name: string }>(entries: readonly T[], term: string): T[] {
  if (!term) return []
  return entries
    .filter((entry) => lowerText(entry.name).includes(term))
    .slice(0, ANALYSIS_LIMITS.motionCandidates)
}

/** Small edit distance for closest-fit Shape suggestions (bounded short names). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const grid: number[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r === 0 ? c : c === 0 ? r : 0)),
  )
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const substitution = grid[r - 1][c - 1] + (a[r - 1] === b[c - 1] ? 0 : 1)
      grid[r][c] = Math.min(grid[r - 1][c] + 1, grid[r][c - 1] + 1, substitution)
    }
  }
  return grid[a.length][b.length]
}

function closestShapeName(available: readonly string[], term: string): string | null {
  if (available.length === 0) return null
  let best: string | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const shape of available.slice(0, ANALYSIS_LIMITS.shapesPerTarget)) {
    const score = editDistance(lowerText(shape), term)
    if (score < bestScore) {
      bestScore = score
      best = shape
    }
  }
  return best
}

function shapesForTarget(
  resolvedIds: readonly string[],
  snapshot: AnimationAnalysisSnapshot,
): string[] {
  const out: string[] = []
  const inventories = Array.isArray(snapshot.shapes) ? snapshot.shapes : []
  for (const id of resolvedIds) {
    const entry = inventories.find((shape) => shape.nodeId === id)
    if (!entry || !Array.isArray(entry.shapeNames)) continue
    for (const shape of entry.shapeNames.slice(0, ANALYSIS_LIMITS.shapesPerTarget)) {
      if (typeof shape === 'string' && shape.trim() && !out.includes(shape.trim())) {
        out.push(shape.trim())
      }
    }
  }
  return out
}

/** Shared unchecked-geometry finding: no described motion or no resolved target yet. */
function uncheckedGeometry(): GeometryFinding {
  return {
    state: 'not-checked',
    matchedShapes: [],
    closestFit: null,
    note: 'Geometry is assessed once the beat has a described motion and a resolved target.',
  }
}

function assessGeometry(
  motion: string | null | undefined,
  resolvedIds: readonly string[],
  snapshot: AnimationAnalysisSnapshot,
): GeometryFinding {
  const term = motionText(motion)
  if (!term || resolvedIds.length === 0) {
    return uncheckedGeometry()
  }
  const available = shapesForTarget(resolvedIds, snapshot)
  const matched = available.filter((shape) => lowerText(shape).includes(term))
  if (matched.length > 0) {
    return {
      state: 'available',
      matchedShapes: matched,
      closestFit: null,
      // Name-only evidence: a matching Shape name suggests pose geometry may
      // exist, but names never prove fit — the artist verifies before drafting.
      note: `Shape name(s) matching “${trimText(motion)}” exist on the target: ${matched.join(', ')} (name evidence only — verify fit before drafting).`,
    }
  }
  if (available.length > 0) {
    const closestFit = closestShapeName(available, term)
    return {
      state: 'missing-with-suggestion',
      matchedShapes: [],
      closestFit,
      note:
        `No existing Shape on the target matches “${trimText(motion)}”. ` +
        (closestFit
          ? `Closest fit by name is “${closestFit}” — decide whether a reviewable draft from it or artist-authored geometry is appropriate.`
          : `No Shape can express it — artist-authored geometry is required.`),
    }
  }
  return {
    state: 'no-shapes',
    matchedShapes: [],
    closestFit: null,
    note:
      `The target carries no Shape inventory for “${trimText(motion)}” — ` +
      `artist-authored geometry is required; nothing is inferred or substituted.`,
  }
}

function cameraDependency(beat: RequestedBeat): 'explicit' | 'inferred' | 'none' {
  if (beat.requiresCamera === true) return 'explicit'
  // Free-text fallback: a beat about the camera depends on camera setup even
  // when the flag is unset. Inferred, never silent — the caller sees it as a
  // warning and can confirm or dismiss it.
  if (/camera/i.test(beat.label) || /camera/i.test(beat.motion ?? '')) return 'inferred'
  return 'none'
}

/**
 * Adapt the live Context Snapshot digest to the minimal analysis surface.
 * Read-only: the returned structure shares no mutable references with the
 * snapshot beyond freshly copied rows.
 */
export function toAnalysisSnapshot(
  animation: AnimationAssistantSnapshot,
): AnimationAnalysisSnapshot {
  const nodes: AnalysisNode[] = (Array.isArray(animation.nodes) ? animation.nodes : []).map(
    (node) => ({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      depth: node.depth,
      semanticName: node.semanticName,
      components: [...node.components],
      assetDefinitionId: node.assetDefinitionId,
    }),
  )
  return {
    nodes,
    clips: (Array.isArray(animation.clips) ? animation.clips : []).map((clip) => ({
      id: clip.id,
      name: clip.name,
      channels: [...clip.channels],
    })),
    collections: (Array.isArray(animation.collections) ? animation.collections : []).map(
      (collection) => ({
        id: collection.id,
        name: collection.name,
        bindings: { ...collection.bindings },
      }),
    ),
    shapes: (Array.isArray(animation.rig.shapeInventory) ? animation.rig.shapeInventory : []).map(
      (entry) => ({
        nodeId: entry.nodeId,
        shapeCount: entry.shapeCount,
        shapeNames: [...entry.shapeNames],
      }),
    ),
    hasCamera: nodes.some((node) => node.components.includes('camera')),
  }
}

function invalidBeat(beatId: string, label: string, actions: string[]): BeatAnalysis {
  return {
    beatId,
    label,
    status: 'invalid',
    resolvedNodeIds: [],
    reusable: [],
    nameOnly: { collections: [], clips: [] },
    geometry: uncheckedGeometry(),
    prerequisites: [],
    warnings: [],
    question: null,
    actions,
    candidates: [],
  }
}

function analyzeOneBeat(beat: RequestedBeat, snapshot: AnimationAnalysisSnapshot): BeatAnalysis {
  const label = trimText(beat.label)
  const motion = trimText(beat.motion ?? null) || null
  const hasTargetQuery =
    trimText(beat.target.nodeId) !== '' ||
    trimText(beat.target.name) !== '' ||
    trimText(beat.target.assetDefinitionId) !== ''

  if (!label || (!hasTargetQuery && motion === null)) {
    const actions: string[] = []
    if (!label) actions.push('Give this beat a label describing one coherent action.')
    if (!hasTargetQuery) {
      actions.push('Identify a target Scene Node by stable id, Unique Name, or Semantic Name.')
    }
    if (motion === null)
      actions.push('Describe the requested motion so reusable clips can be checked.')
    return invalidBeat(beat.id, beat.label, actions)
  }

  const resolution = resolveTarget(beat.target, snapshot)
  if (resolution.status === 'ambiguous') {
    return {
      beatId: beat.id,
      label: beat.label,
      status: 'needs-clarification',
      resolvedNodeIds: [],
      reusable: [],
      nameOnly: { collections: [], clips: [] },
      geometry: {
        state: 'not-checked',
        matchedShapes: [],
        closestFit: null,
        note: 'Geometry is assessed once the target ambiguity is resolved.',
      },
      prerequisites: [],
      warnings: [],
      question: resolution.question,
      actions: [
        `Reply with the stable Scene Node id for ${describeQuery(beat.target)} — the beat stays blocked until the target is unambiguous.`,
      ],
      candidates: resolution.candidates,
    }
  }
  if (resolution.status === 'unresolved') {
    return {
      beatId: beat.id,
      label: beat.label,
      status: 'invalid',
      resolvedNodeIds: [],
      reusable: [],
      nameOnly: { collections: [], clips: [] },
      geometry: uncheckedGeometry(),
      prerequisites: [],
      warnings: [],
      question: null,
      actions: [
        `No scene node matches ${describeQuery(beat.target)} — check the Unique Name or stable id, or add the node to the scene. Structured project data decides identity; nothing is guessed from the request text.`,
      ],
      candidates: [],
    }
  }

  const resolvedNodeIds = resolution.nodeIds
  const warnings: string[] = []
  // Only exact matches resolve now; asset-metadata resolution still carries
  // weaker evidence than stable id or Unique Name, so it asks for confirmation.
  if (resolution.warning !== null) warnings.push(resolution.warning)
  if (resolution.matchKind === 'asset') {
    warnings.push(
      `Target resolved by asset metadata — confirm ${resolvedNodeIds.map((id) => `[${id}]`).join(', ')} is the intended node before approving.`,
    )
  }

  const prerequisites: string[] = []
  const actions: string[] = []
  const camera = cameraDependency(beat)
  if (camera !== 'none' && !snapshot.hasCamera) {
    prerequisites.push(
      'Missing camera: the toward-camera beat needs human-authored camera setup — framing is never fabricated from transforms alone.',
    )
    actions.push(
      'Supply a usable camera context in the live Project (or remove the toward-camera requirement) and re-run analysis.',
    )
  }
  if (camera === 'inferred') {
    warnings.push(
      'Camera dependency was inferred from the request text, not an explicit requirement — confirm the beat really needs camera setup.',
    )
  }

  const term = motionText(motion)
  const clips = Array.isArray(snapshot.clips) ? snapshot.clips : []
  const collections = Array.isArray(snapshot.collections) ? snapshot.collections : []
  const matchedClips = findNameMatches(clips, term)
  const matchedCollections = findNameMatches(collections, term)

  const semantics = subtreeSemanticNames(resolvedNodeIds, snapshot.nodes)
  const reusable: ReusableCandidate[] = []
  const nameOnlyCollections: NameOnlyMatch[] = []
  for (const collection of matchedCollections) {
    const bindingKeys = Object.keys(collection.bindings ?? {})
    const matchedSemantics = bindingKeys.filter((key) => semantics.has(lowerText(key.trim())))
    if (matchedSemantics.length > 0) {
      const clipIds = matchedSemantics
        .map((key) => {
          const hit = Object.entries(collection.bindings).find(
            ([bindingKey]) => lowerText(bindingKey.trim()) === lowerText(key.trim()),
          )
          return hit ? hit[1] : ''
        })
        .filter((id) => id !== '')
      reusable.push({
        collectionId: collection.id,
        collectionName: collection.name,
        matchedSemantics,
        clipIds,
      })
    } else {
      nameOnlyCollections.push({ id: collection.id, name: collection.name })
    }
  }
  const nameOnlyClips: NameOnlyMatch[] = matchedClips.map((clip) => ({
    id: clip.id,
    name: clip.name,
  }))

  if (nameOnlyCollections.length > 0 || (matchedClips.length > 0 && reusable.length === 0)) {
    const names = [
      ...nameOnlyCollections.map((c) => `collection “${c.name}”`),
      ...(reusable.length === 0 ? nameOnlyClips.map((c) => `clip “${c.name}”`) : []),
    ].join(', ')
    if (names) {
      warnings.push(
        `Similarly named motion is not assumed compatible without evidence: ${names} match by name but no rig binding overlaps the target — verify with a rendered preview before reuse.`,
      )
    }
  }
  if (reusable.length > 0) {
    warnings.push(
      'Reusable candidates are binding-compatible, not proven visually — confirm fit with a rendered preview before drafting.',
    )
  }

  const geometry = assessGeometry(motion, resolvedNodeIds, snapshot)

  if (prerequisites.length > 0) {
    return {
      beatId: beat.id,
      label: beat.label,
      status: 'missing-prerequisite',
      resolvedNodeIds,
      reusable,
      nameOnly: { collections: nameOnlyCollections, clips: nameOnlyClips },
      geometry,
      prerequisites,
      warnings,
      question: null,
      actions,
      candidates: [],
    }
  }

  if (motion === null) {
    return {
      beatId: beat.id,
      label: beat.label,
      status: 'missing-motion',
      resolvedNodeIds,
      reusable,
      nameOnly: { collections: nameOnlyCollections, clips: nameOnlyClips },
      geometry,
      prerequisites,
      warnings,
      question: null,
      actions: [
        'Describe the requested motion (e.g. walk, sit, stretch) so reusable Clips and Clip Collections can be checked against rig bindings.',
      ],
      candidates: [],
    }
  }

  if (reusable.length > 0) {
    return {
      beatId: beat.id,
      label: beat.label,
      status: 'ready',
      resolvedNodeIds,
      reusable,
      nameOnly: { collections: nameOnlyCollections, clips: nameOnlyClips },
      geometry,
      prerequisites,
      warnings,
      question: null,
      actions: [],
      candidates: [],
    }
  }

  return {
    beatId: beat.id,
    label: beat.label,
    status: 'missing-motion',
    resolvedNodeIds,
    reusable,
    nameOnly: { collections: nameOnlyCollections, clips: nameOnlyClips },
    geometry,
    prerequisites,
    warnings,
    question: null,
    actions: [
      `No compatible reusable motion for “${motion}” on the resolved target — author new motion or approve a draft; similarly named library entries without binding overlap do not count.`,
    ],
    candidates: [],
  }
}

/**
 * Analyze every requested beat independently. One blocked or malformed beat
 * never prevents the others from being analyzed; per-beat failures are
 * contained as `invalid` results.
 */
export function analyzeBeats(
  beats: readonly RequestedBeat[],
  snapshot: AnimationAnalysisSnapshot,
): AnalysisResult {
  const list = Array.isArray(beats) ? beats : []
  const analyzed: BeatAnalysis[] = list.map((beat) => {
    try {
      return analyzeOneBeat(beat, snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...invalidBeat(
          typeof beat?.id === 'string' && beat.id ? beat.id : 'unknown',
          typeof beat?.label === 'string' ? beat.label : '',
          [
            `Analysis failed for this beat (${message}) — fix the request and re-run; other beats are unaffected.`,
          ],
        ),
      }
    }
  })
  const summary: AnalysisSummary = {
    total: analyzed.length,
    ready: 0,
    blocked: 0,
    needsClarification: 0,
    missingMotion: 0,
    missingPrerequisite: 0,
    invalid: 0,
    missingGeometry: 0,
  }
  for (const beat of analyzed) {
    if (beat.status === 'ready') summary.ready += 1
    else summary.blocked += 1
    if (beat.status === 'needs-clarification') summary.needsClarification += 1
    else if (beat.status === 'missing-motion') summary.missingMotion += 1
    else if (beat.status === 'missing-prerequisite') summary.missingPrerequisite += 1
    else if (beat.status === 'invalid') summary.invalid += 1
    if (beat.geometry.state === 'missing-with-suggestion' || beat.geometry.state === 'no-shapes') {
      summary.missingGeometry += 1
    }
  }
  return { beats: analyzed, summary }
}
