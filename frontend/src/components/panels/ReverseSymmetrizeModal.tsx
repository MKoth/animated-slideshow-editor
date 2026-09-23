/* eslint-disable react-hooks/set-state-in-effect -- sync modal fields when it opens */
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { playheadTimeOf } from '../../app/keyframeActions'
import { walkPreOrder } from '../../engine/sceneNode'
import type { EnginePublic, SceneNode } from '../../engine'
import {
  REVERSE_SYMMETRIZE_CHANNELS,
  buildReverseSymmetrizeCommands,
  guessMorphShapeMappings,
  guessSymmetrySibling,
  reverseSymmetrizeKeyframes,
} from '../../engine/reverseSymmetrize'
import type {
  MorphShapeMappingGuess,
  ReverseSymmetrizePlan,
  ReverseSymmetrizeRow,
  ReverseSymmetrizeShapeMapping,
} from '../../engine/reverseSymmetrize'
import { groupShapesByCategory } from '../../engine/shape'
import type { Shape, ShapeCategoryGroup } from '../../engine/shape'
import type { ShapeCategory } from '../../engine/shapeCategory'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import type { SymmetryAxis } from '../../engine/symmetry'
import { useNotificationStore } from '../../stores/notificationStore'

interface ReverseSymmetrizeModalProps {
  readonly open: boolean
  readonly rootNodeId: string | null
  readonly onClose: () => void
}

interface RowState {
  readonly nodeId: string
  readonly name: string
  readonly self: boolean
  readonly siblingId: string | null
  readonly shapesOpen: boolean
  readonly shapeOverrides: Readonly<Record<string, string>>
  readonly siblingShapeOverrides: Readonly<Record<string, string>>
}

interface ShapeGroup {
  readonly sourceName: string
  readonly targetName: string
  readonly self: boolean
  readonly guesses: readonly MorphShapeMappingGuess[]
  readonly targetGroups: readonly ShapeCategoryGroup[]
  readonly effective: ReadonlyMap<string, string>
  readonly unresolved: readonly MorphShapeMappingGuess[]
}

interface RowShapes {
  readonly nodeId: string
  readonly self: boolean
  readonly targetNodeId: string
  readonly targetName: string
  readonly own: ShapeGroup
  /** Sibling shapes mapped back onto the row node; shown only when the sibling's own row does not cover it. */
  readonly sibling: ShapeGroup | null
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid var(--color-border, #ddd)',
  background: 'var(--color-bg, #fff)',
  color: 'var(--color-text, #1c1e21)',
  fontSize: 12,
}

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted, #666)',
}

function keyframeRange(
  engine: EnginePublic,
  nodeIds: Iterable<string>,
  duration: number,
): { from: number; to: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const nodeId of nodeIds) {
    for (const channel of REVERSE_SYMMETRIZE_CHANNELS) {
      for (const keyframe of reverseSymmetrizeKeyframes(engine, nodeId, channel)) {
        if (keyframe.time < min) min = keyframe.time
        if (keyframe.time > max) max = keyframe.time
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { from: 0, to: duration }
  return { from: min, to: max }
}

function readShapes(engine: EnginePublic, nodeId: string): readonly Shape[] {
  try {
    return engine.getShapes(nodeId)
  } catch {
    return []
  }
}

function readCategories(engine: EnginePublic, nodeId: string): readonly ShapeCategory[] {
  try {
    return engine.getShapeCategories(nodeId)
  } catch {
    return []
  }
}

function buildShapeGroup(
  engine: EnginePublic,
  sourceNodeId: string,
  sourceName: string,
  targetNodeId: string,
  targetName: string,
  axis: SymmetryAxis,
  self: boolean,
  overrides: Readonly<Record<string, string>>,
): ShapeGroup {
  const targetShapes = readShapes(engine, targetNodeId)
  const targetShapeIds = new Set(targetShapes.map((shape) => shape.id))
  const guesses = guessMorphShapeMappings(engine, sourceNodeId, targetNodeId, axis)
  const effective = new Map<string, string>()
  const unresolved: MorphShapeMappingGuess[] = []
  for (const guess of guesses) {
    const override = overrides[guess.sourceShapeId]
    const resolved =
      override !== undefined && targetShapeIds.has(override)
        ? override
        : (guess.targetShapeId ??
          (self && targetShapeIds.has(guess.sourceShapeId) ? guess.sourceShapeId : null))
    if (resolved === null) unresolved.push(guess)
    else effective.set(guess.sourceShapeId, resolved)
  }
  return {
    sourceName,
    targetName,
    self,
    guesses,
    targetGroups: groupShapesByCategory(targetShapes, readCategories(engine, targetNodeId)),
    effective,
    unresolved,
  }
}

function shapeMappingsOf(group: ShapeGroup | null | undefined): {
  shapeMappings?: readonly ReverseSymmetrizeShapeMapping[]
} {
  if (!group || group.effective.size === 0) return {}
  return {
    shapeMappings: [...group.effective].map(([sourceShapeId, targetShapeId]) => ({
      sourceShapeId,
      targetShapeId,
    })),
  }
}

/**
 * Expand the modal's object rows into directed mirror rows. Every sibling
 * pair emits both directions (each side's shape mappings feed its own
 * direction) while self rows mirror onto themselves; a pair is emitted once.
 */
function buildRequestRows(
  rows: readonly RowState[],
  shapesByNode: ReadonlyMap<string, RowShapes>,
): readonly ReverseSymmetrizeRow[] {
  const requestRows: ReverseSymmetrizeRow[] = []
  const emittedPairs = new Set<string>()
  for (const row of rows) {
    const info = shapesByNode.get(row.nodeId)
    if (row.self || row.siblingId === null) {
      requestRows.push({
        sourceNodeId: row.nodeId,
        targetNodeId: null,
        ...shapeMappingsOf(info?.own),
      })
      continue
    }
    const pairKey = [row.nodeId, row.siblingId].sort().join('|')
    if (emittedPairs.has(pairKey)) continue
    emittedPairs.add(pairKey)
    requestRows.push({
      sourceNodeId: row.nodeId,
      targetNodeId: row.siblingId,
      ...shapeMappingsOf(info?.own),
    })
    const siblingRow = rows.find((candidate) => candidate.nodeId === row.siblingId)
    const siblingCoversReverse =
      siblingRow !== undefined && !siblingRow.self && siblingRow.siblingId === row.nodeId
    const reverseGroup = siblingCoversReverse
      ? shapesByNode.get(siblingRow.nodeId)?.own
      : info?.sibling
    requestRows.push({
      sourceNodeId: row.siblingId,
      targetNodeId: row.nodeId,
      ...shapeMappingsOf(reverseGroup),
    })
  }
  return requestRows
}

/** First sibling-mode shape that has no counterpart, with the node it maps onto. */
function findUnresolvedShape(
  rowShapes: readonly RowShapes[],
): { readonly guess: MorphShapeMappingGuess; readonly targetName: string } | null {
  for (const info of rowShapes) {
    if (info.own.unresolved.length > 0) {
      return { guess: info.own.unresolved[0]!, targetName: info.own.targetName }
    }
    if (info.sibling && info.sibling.unresolved.length > 0) {
      return { guess: info.sibling.unresolved[0]!, targetName: info.sibling.targetName }
    }
  }
  return null
}

export function ReverseSymmetrizeModal({ open, rootNodeId, onClose }: ReverseSymmetrizeModalProps) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const [centerTime, setCenterTime] = useState(0)
  const [axis, setAxis] = useState<SymmetryAxis>('x')
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(0)
  const [rows, setRows] = useState<RowState[]>([])
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || rootNodeId === null) return
    const slide = engine.getActiveSlide()
    if (!slide) return
    let root: SceneNode
    try {
      root = engine.getNode(rootNodeId)
    } catch {
      return
    }
    const nodes = [...walkPreOrder(root)].filter((node) => !node.components.camera)
    const rowStates: RowState[] = nodes.map((node) => {
      const guess = guessSymmetrySibling(engine, node.id)
      return {
        nodeId: node.id,
        name: node.name,
        self: guess === null,
        siblingId: guess ? guess.id : null,
        shapesOpen: false,
        shapeOverrides: {},
        siblingShapeOverrides: {},
      }
    })
    setRows(rowStates)
    // Pairs exchange keys in both directions, so the sibling's keyframes count
    // toward the default source interval too.
    const rangeIds = new Set(nodes.map((node) => node.id))
    for (const state of rowStates) {
      if (state.siblingId) rangeIds.add(state.siblingId)
    }
    const range = keyframeRange(engine, rangeIds, slide.duration)
    const playhead = playheadTimeOf(engine, rootNodeId)
    const playheadInRange = playhead !== null && playhead >= range.from && playhead <= range.to
    setCenterTime(playheadInRange ? playhead : (range.from + range.to) / 2)
    setAxis('x')
    setFrom(range.from)
    setTo(range.to)
    // Snapshot the scene's candidates when the modal opens so later node
    // creations/renames are visible and guessed siblings always have an option.
    setCandidates(
      [...walkPreOrder(slide.scene.root)]
        .filter((node) => !node.components.camera)
        .map((node) => ({ id: node.id, name: node.name })),
    )
    setSubmitError(null)
  }, [open, rootNodeId, engine])

  const rowShapes = useMemo((): readonly RowShapes[] => {
    if (!open || rootNodeId === null) return []
    return rows.map((row) => {
      const self = row.self
      const targetNodeId = self ? row.nodeId : (row.siblingId as string)
      const emptyGroup = (): ShapeGroup => ({
        sourceName: row.name,
        targetName: row.name,
        self,
        guesses: [],
        targetGroups: [],
        effective: new Map(),
        unresolved: [],
      })
      const empty: RowShapes = {
        nodeId: row.nodeId,
        self,
        targetNodeId,
        targetName: row.name,
        own: emptyGroup(),
        sibling: null,
      }
      if (!self && row.siblingId === null) return empty
      let targetName = targetNodeId
      try {
        targetName = engine.getNode(targetNodeId).name
      } catch {
        return empty
      }
      const own = buildShapeGroup(
        engine,
        row.nodeId,
        row.name,
        targetNodeId,
        targetName,
        axis,
        self,
        row.shapeOverrides,
      )
      let sibling: ShapeGroup | null = null
      if (!self) {
        const siblingRow = rows.find((candidate) => candidate.nodeId === row.siblingId)
        const siblingCoversReverse =
          siblingRow !== undefined && !siblingRow.self && siblingRow.siblingId === row.nodeId
        if (!siblingCoversReverse) {
          sibling = buildShapeGroup(
            engine,
            row.siblingId as string,
            targetName,
            row.nodeId,
            row.name,
            axis,
            false,
            row.siblingShapeOverrides,
          )
        }
      }
      return { nodeId: row.nodeId, self, targetNodeId, targetName, own, sibling }
    })
  }, [engine, open, rootNodeId, rows, axis])

  const shapesByNode = useMemo(
    () => new Map(rowShapes.map((info) => [info.nodeId, info])),
    [rowShapes],
  )

  const preview = useMemo((): { plan: ReverseSymmetrizePlan | null; error: string | null } => {
    if (!open || rootNodeId === null) return { plan: null, error: null }
    const missingSibling = rows.find((row) => !row.self && row.siblingId === null)
    if (missingSibling) {
      return { plan: null, error: `Select a sibling for "${missingSibling.name}"` }
    }
    const unresolved = findUnresolvedShape(rowShapes)
    if (unresolved) {
      return {
        plan: null,
        error: `Select a symmetrical shape for "${
          unresolved.guess.sourceShapeName ?? unresolved.guess.sourceShapeId
        }" on "${unresolved.targetName}"`,
      }
    }
    try {
      return {
        plan: buildReverseSymmetrizeCommands(engine, {
          rootNodeId,
          centerTime,
          axis,
          from,
          to,
          rows: buildRequestRows(rows, shapesByNode),
        }),
        error: null,
      }
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [engine, open, rootNodeId, centerTime, axis, from, to, rows, rowShapes, shapesByNode])

  if (!open || rootNodeId === null) return null

  const slide = engine.getActiveSlide()
  const duration = slide ? slide.duration : 0
  const mirroredFrom = 2 * centerTime - to
  const mirroredTo = 2 * centerTime - from
  const plan = preview.plan
  const error = submitError ?? preview.error

  const updateRow = (nodeId: string, patch: Partial<RowState>): void => {
    setRows((previous) =>
      previous.map((row) => (row.nodeId === nodeId ? { ...row, ...patch } : row)),
    )
  }

  const handleConfirm = (): void => {
    setSubmitError(null)
    if (preview.error) {
      setSubmitError(preview.error)
      return
    }
    if (!plan || plan.commands.length === 0) {
      setSubmitError('Nothing to mirror — no keyframes in the selected range')
      return
    }
    const result = dispatchKeyframeCommands(dispatch, plan.commands)
    if (result && !result.ok) {
      setSubmitError(result.error.message)
      return
    }
    const { added, updated, droppedOutOfRange } = plan.summary
    notify(
      `Reverse symmetrized — ${added} added, ${updated} updated${
        droppedOutOfRange > 0 ? `, ${droppedOutOfRange} skipped out of range` : ''
      }`,
    )
    onClose()
  }

  const summaryByDirection = new Map(
    plan?.summary.rows.map((row) => [`${row.sourceNodeId}|${row.targetNodeId}`, row]) ?? [],
  )

  const renderShapeSelect = (
    row: RowState,
    group: ShapeGroup,
    guess: MorphShapeMappingGuess,
    reverse: boolean,
  ): React.ReactNode => (
    <div
      key={`${reverse ? 'sibling' : 'own'}-${guess.sourceShapeId}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.4fr',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span>{guess.sourceShapeName ?? '(unknown shape)'}</span>
      <select
        data-testid={`reverse-symmetrize-shape-${row.nodeId}-${guess.sourceShapeId}`}
        value={group.effective.get(guess.sourceShapeId) ?? ''}
        onChange={(event) =>
          updateRow(
            row.nodeId,
            reverse
              ? {
                  siblingShapeOverrides: {
                    ...row.siblingShapeOverrides,
                    [guess.sourceShapeId]: event.target.value,
                  },
                }
              : {
                  shapeOverrides: {
                    ...row.shapeOverrides,
                    [guess.sourceShapeId]: event.target.value,
                  },
                },
          )
        }
        style={inputStyle}
      >
        {!group.self && <option value="">— select shape —</option>}
        {group.targetGroups.map((category) => (
          <optgroup key={category.label} label={category.label}>
            {category.shapes.map((shape) => (
              <option key={shape.id} value={shape.id}>
                {shape.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reverse Symmetrize"
      data-testid="reverse-symmetrize-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg, #fff)',
          color: 'var(--color-text, #1c1e21)',
          borderRadius: 8,
          padding: 16,
          minWidth: 560,
          maxWidth: 760,
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>Reverse Symmetrize</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: 0 }}>
          Mirror keyframes in time about the center. Each sibling pair exchanges mirrored keys in
          both directions; position, rotation, and scale reflect the delta against the pose each
          object holds at the center, while opacity, z-index, and morph are copied as-is with morph
          shapes remapped to their symmetrical counterparts.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <label style={labelStyle}>
            Center (s)
            <input
              type="number"
              step={0.01}
              data-testid="reverse-symmetrize-center"
              value={centerTime}
              onChange={(event) => setCenterTime(Number(event.target.value))}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Axis
            <select
              data-testid="reverse-symmetrize-axis"
              value={axis}
              onChange={(event) => setAxis(event.target.value as SymmetryAxis)}
              style={inputStyle}
            >
              <option value="x">X (mirror left↔right)</option>
              <option value="y">Y (mirror top↔bottom)</option>
            </select>
          </label>
          <label style={labelStyle}>
            From (s)
            <input
              type="number"
              step={0.01}
              data-testid="reverse-symmetrize-from"
              value={from}
              onChange={(event) => setFrom(Number(event.target.value))}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            To (s)
            <input
              type="number"
              step={0.01}
              data-testid="reverse-symmetrize-to"
              value={to}
              onChange={(event) => setTo(Number(event.target.value))}
              style={inputStyle}
            />
          </label>
        </div>
        <div
          data-testid="reverse-symmetrize-range-hint"
          style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}
        >
          Source [{from.toFixed(2)}, {to.toFixed(2)}] → mirrored to [{mirroredFrom.toFixed(2)},{' '}
          {mirroredTo.toFixed(2)}] of {duration.toFixed(2)}s
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Objects</div>
          {rows.map((row) => {
            const info = shapesByNode.get(row.nodeId)
            const forward = summaryByDirection.get(
              `${row.nodeId}|${row.self ? row.nodeId : row.siblingId}`,
            )
            const reverse = row.self
              ? undefined
              : summaryByDirection.get(`${row.siblingId}|${row.nodeId}`)
            const keyframesInRange =
              forward || reverse
                ? (forward?.keyframesInRange ?? 0) + (reverse?.keyframesInRange ?? 0)
                : null
            const ownGuesses = info?.own.guesses ?? []
            const siblingGroup = info?.sibling ?? null
            const siblingGuesses = siblingGroup?.guesses ?? []
            const shapeCount = ownGuesses.length + siblingGuesses.length
            return (
              <div
                key={row.nodeId}
                data-testid={`reverse-symmetrize-row-${row.nodeId}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  border: '1px solid var(--color-border, #ddd)',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 1fr 1.4fr',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{row.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                      {keyframesInRange !== null ? `${keyframesInRange} keyframe(s) in range` : '—'}
                    </span>
                  </div>
                  <select
                    data-testid={`reverse-symmetrize-type-${row.nodeId}`}
                    value={row.self ? 'self' : 'sibling'}
                    onChange={(event) =>
                      updateRow(row.nodeId, { self: event.target.value === 'self' })
                    }
                    style={inputStyle}
                  >
                    <option value="sibling">Has sibling</option>
                    <option value="self">No sibling (self)</option>
                  </select>
                  <select
                    data-testid={`reverse-symmetrize-sibling-${row.nodeId}`}
                    value={row.siblingId ?? ''}
                    disabled={row.self}
                    onChange={(event) =>
                      updateRow(row.nodeId, { siblingId: event.target.value || null })
                    }
                    style={inputStyle}
                  >
                    <option value="">— select sibling —</option>
                    {candidates
                      .filter((candidate) => candidate.id !== row.nodeId)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                </div>
                {shapeCount > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button
                      data-testid={`reverse-symmetrize-shapes-toggle-${row.nodeId}`}
                      onClick={() => updateRow(row.nodeId, { shapesOpen: !row.shapesOpen })}
                      style={{
                        alignSelf: 'flex-start',
                        padding: 0,
                        border: 'none',
                        background: 'none',
                        color: 'var(--color-text-muted, #666)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {row.shapesOpen ? '▾' : '▸'} Shapes ({shapeCount})
                    </button>
                    {row.shapesOpen && (
                      <div
                        data-testid={`reverse-symmetrize-shapes-${row.nodeId}`}
                        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                      >
                        {ownGuesses.length > 0 && (
                          <div
                            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                            data-testid={`reverse-symmetrize-shapes-own-${row.nodeId}`}
                          >
                            {siblingGroup && <div style={groupHeaderStyle}>{row.name}</div>}
                            {ownGuesses.map((guess) =>
                              renderShapeSelect(row, info!.own, guess, false),
                            )}
                          </div>
                        )}
                        {siblingGroup && siblingGuesses.length > 0 && (
                          <div
                            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                            data-testid={`reverse-symmetrize-shapes-sibling-${row.nodeId}`}
                          >
                            <div style={groupHeaderStyle}>{siblingGroup.sourceName} (sibling)</div>
                            {siblingGuesses.map((guess) =>
                              renderShapeSelect(row, siblingGroup, guess, true),
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div data-testid="reverse-symmetrize-summary" style={{ fontSize: 12 }}>
          {plan
            ? `${plan.summary.added} to add · ${plan.summary.updated} to update · ${plan.summary.unchanged} unchanged`
            : '—'}
        </div>

        {plan && plan.warnings.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
            {plan.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}

        {error && (
          <div
            data-testid="reverse-symmetrize-error"
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="reverse-symmetrize-cancel"
            onClick={onClose}
            style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            data-testid="reverse-symmetrize-confirm"
            onClick={handleConfirm}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: 'var(--color-accent, #7c5cff)',
              color: 'var(--color-accent-text, #fff)',
              cursor: 'pointer',
            }}
          >
            Reverse Symmetrize
          </button>
        </div>
      </div>
    </div>
  )
}
