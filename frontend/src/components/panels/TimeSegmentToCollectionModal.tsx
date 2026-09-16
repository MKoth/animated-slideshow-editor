/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import type { KeyframeTarget } from '../../engine/keyframeTarget'
import {
  defaultSegmentCollectionName,
  defaultSegmentRange,
  formatSec,
  inSegment,
  clipInstanceFits,
  isClipStorableTarget,
  nextClipNameForNode,
  parseSec,
  planSegmentDeletes,
  validateSegmentRange,
} from '../../engine/timeSegmentExtraction'
import type {
  SegmentCollectionPlan,
  SegmentDeleteEntry,
  SegmentSourceClip,
} from '../../engine/timeSegmentExtraction'
import type { BakingEvaluator } from '../../engine/clipExtraction'
import { previewBakingCount } from '../../engine/clipExtraction'

export interface SegmentSourceEntry {
  readonly nodeId: string
  readonly nodeName: string
  readonly semanticName?: string
  readonly paramKey: string
  readonly paramLabel: string
  readonly target: KeyframeTarget
  readonly time: number
  readonly value: ExtractableKeyframe['value']
  readonly interpolation: ExtractableKeyframe['interpolation']
  readonly tangentIn: ExtractableKeyframe['tangentIn']
  readonly tangentOut: ExtractableKeyframe['tangentOut']
  readonly keyframeId: string
}

interface Props {
  readonly parentNodeId: string
  readonly parentName: string
  readonly slideDuration: number
  readonly existingClipNames: readonly string[]
  readonly entries: readonly SegmentSourceEntry[]
  /** All clip placements on descendant nodes (unfiltered); the wizard lists those fully inside the segment. */
  readonly clips: readonly SegmentSourceClip[]
  /** Evaluator for bake previews (engine-backed); null disables live synthetic counts. */
  readonly bakingEvaluator: BakingEvaluator | null
  readonly onClose: () => void
  /**
   * Execute the plan (dispatched by the owner). Returns an error message to
   * display, or null on success (owner closes the modal itself).
   */
  readonly onConfirm: (plan: SegmentCollectionPlan) => string | null
}

interface ObjectGroup {
  readonly nodeId: string
  readonly nodeName: string
  readonly semanticName?: string
  readonly params: {
    readonly key: string
    readonly label: string
    readonly count: number
    readonly entries: SegmentSourceEntry[]
  }[]
  /** Clips fully contained in the current segment (checkable like parameters). */
  readonly clips: SegmentSourceClip[]
  readonly total: number
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--color-border, #ddd)',
  background: 'var(--color-bg, #fff)',
  color: 'var(--color-text, #1c1e21)',
  fontSize: 12,
  boxSizing: 'border-box',
}

export function TimeSegmentToCollectionModal({
  parentNodeId,
  parentName,
  slideDuration,
  existingClipNames,
  entries,
  clips,
  bakingEvaluator,
  onClose,
  onConfirm,
}: Props) {
  // Range + collection defaults are seeded once per mount (entries are stable while open).
  const [initialRange] = useState(() =>
    defaultSegmentRange(
      entries.map((e) => e.time),
      slideDuration,
    ),
  )

  const [fromStr, setFromStr] = useState(() => formatSec(initialRange.from))
  const [toStr, setToStr] = useState(() => formatSec(initialRange.to))
  const [lenStr, setLenStr] = useState(() => formatSec(initialRange.to - initialRange.from))
  const [collectionName, setCollectionName] = useState(() =>
    defaultSegmentCollectionName(parentName, initialRange.from, initialRange.to),
  )
  const [collectionTouched, setCollectionTouched] = useState(false)
  const [masterName, setMasterName] = useState('')
  const [deleteOrphans, setDeleteOrphans] = useState(true)
  const [keepFirst, setKeepFirst] = useState(false)
  const [keepLast, setKeepLast] = useState(false)
  const [removeClipInstances, setRemoveClipInstances] = useState(false)
  const [bakeStart, setBakeStart] = useState(true)
  const [bakeEnd, setBakeEnd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Object / param / clip selection + per-object clip naming
  const [selectedObjects, setSelectedObjects] = useState<Record<string, boolean>>({})
  const [selectedParams, setSelectedParams] = useState<Record<string, boolean>>({})
  const [selectedClips, setSelectedClips] = useState<Record<string, boolean>>({})
  const [clipNames, setClipNames] = useState<Record<string, string>>({})
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [namesSeeded, setNamesSeeded] = useState(false)

  const range = useMemo(() => {
    const f = parseSec(fromStr)
    const t = parseSec(toStr)
    if (f === null || t === null) return null
    return { from: f, to: t }
  }, [fromStr, toStr])
  const rangeValid =
    range !== null && validateSegmentRange(range.from, range.to, slideDuration) === null
  const rangeError =
    range === null
      ? 'Enter numeric From, To and Length.'
      : validateSegmentRange(range.from, range.to, slideDuration)

  const inRange = useMemo(
    () => (range ? entries.filter((e) => inSegment(e.time, range.from, range.to)) : []),
    [entries, range],
  )

  const objects: ObjectGroup[] = useMemo(() => {
    const byNode = new Map<
      string,
      {
        nodeId: string
        nodeName: string
        semanticName?: string
        params: { key: string; label: string; entries: SegmentSourceEntry[] }[]
        clips: SegmentSourceClip[]
        total: number
      }
    >()
    const order: string[] = []
    const ensure = (nodeId: string, nodeName: string, semanticName?: string) => {
      let g = byNode.get(nodeId)
      if (!g) {
        g = { nodeId, nodeName, semanticName, params: [], clips: [], total: 0 }
        byNode.set(nodeId, g)
        order.push(nodeId)
      }
      return g
    }
    for (const e of inRange) {
      const g = ensure(e.nodeId, e.nodeName, e.semanticName)
      const p = g.params.find((x) => x.key === e.paramKey)
      if (p) p.entries.push(e)
      else g.params.push({ key: e.paramKey, label: e.paramLabel, entries: [e] })
      g.total += 1
    }
    if (range) {
      for (const c of clips) {
        if (!clipInstanceFits(c.start, c.end, range.from, range.to)) continue
        const g = ensure(c.nodeId, c.nodeName, c.semanticName)
        if (!g.clips.some((x) => x.instanceId === c.instanceId)) {
          g.clips.push(c)
          g.total += 1
        }
      }
    }
    return order
      .map((id) => byNode.get(id)!)
      .map((g) => ({
        ...g,
        clips: [...g.clips].sort((a, b) => a.start - b.start),
        params: g.params.map((p) => ({
          key: p.key,
          label: p.label,
          count: p.entries.length,
          entries: p.entries,
        })),
      }))
      .sort((a, b) => a.nodeName.localeCompare(b.nodeName))
  }, [inRange, clips, range])

  // Seed per-object defaults for objects revealed later by range changes
  // (never overwrites user edits).
  useEffect(() => {
    const taken = new Set([...existingClipNames, ...Object.values(clipNames)])
    let changed = false
    const names = { ...clipNames }
    const cats = { ...categories }
    for (const o of objects) {
      if (names[o.nodeId] === undefined) {
        const master = masterName.trim()
        names[o.nodeId] =
          master ||
          nextClipNameForNode(
            o.nodeName,
            [...taken].map((n) => ({ name: n })),
          )
        taken.add(names[o.nodeId]!)
        changed = true
      }
      if (cats[o.nodeId] === undefined) {
        cats[o.nodeId] = o.semanticName?.trim() ?? ''
        changed = true
      }
    }
    if (changed) {
      setClipNames(names)
      setCategories(cats)
    }
    if (!namesSeeded && objects.length > 0) {
      const objs: Record<string, boolean> = {}
      const params: Record<string, boolean> = {}
      const clipSel: Record<string, boolean> = {}
      for (const o of objects) {
        objs[o.nodeId] = true
        for (const p of o.params) params[`${o.nodeId}::${p.key}`] = true
        for (const c of o.clips) clipSel[c.instanceId] = true
      }
      setSelectedObjects(objs)
      setSelectedParams(params)
      setSelectedClips(clipSel)
      setNamesSeeded(true)
    }
  }, [objects, existingClipNames, namesSeeded, clipNames, categories, masterName])

  const paramSelected = (nodeId: string, key: string): boolean =>
    selectedParams[`${nodeId}::${key}`] ?? true
  const clipSelected = (instanceId: string): boolean => selectedClips[instanceId] ?? true
  const objectOn = (nodeId: string): boolean => selectedObjects[nodeId] ?? true
  const objectSelectedParams = (o: ObjectGroup): typeof o.params =>
    o.params.filter((p) => paramSelected(o.nodeId, p.key))
  const objectSelectedClips = (o: ObjectGroup): SegmentSourceClip[] =>
    o.clips.filter((c) => clipSelected(c.instanceId))

  const selectedEntries = useMemo(
    () => inRange.filter((e) => objectOn(e.nodeId) && paramSelected(e.nodeId, e.paramKey)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inRange, selectedObjects, selectedParams],
  )
  const selectedClipRefs = useMemo(
    () => objects.flatMap((o) => (objectOn(o.nodeId) ? objectSelectedClips(o) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, selectedObjects, selectedClips],
  )
  const storableCount = useMemo(
    () => selectedEntries.filter((e) => isClipStorableTarget(e.target)).length,
    [selectedEntries],
  )
  const skippedCount = selectedEntries.length - storableCount

  const missingSemantic = useMemo(
    () =>
      objects.filter(
        (o) =>
          objectOn(o.nodeId) &&
          (objectSelectedParams(o).length > 0 || objectSelectedClips(o).length > 0) &&
          !o.semanticName?.trim(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, selectedObjects, selectedParams, selectedClips],
  )

  // One binding per object: keyframes and clips cannot both be selected on it.
  const conflicts = useMemo(
    () =>
      objects.filter(
        (o) =>
          objectOn(o.nodeId) &&
          objectSelectedParams(o).length > 0 &&
          objectSelectedClips(o).length > 0,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, selectedObjects, selectedParams, selectedClips],
  )

  const deletePreview = useMemo((): number => {
    if (!deleteOrphans) return 0
    const dels: SegmentDeleteEntry[] = selectedEntries.map((e) => ({
      target: e.target,
      time: e.time,
      keyframeId: e.keyframeId,
    }))
    return planSegmentDeletes(dels, keepFirst, keepLast).reduce(
      (n, g) => n + g.keyframeIds.length,
      0,
    )
  }, [selectedEntries, deleteOrphans, keepFirst, keepLast])

  const canConfirm =
    rangeError === null &&
    collectionName.trim().length > 0 &&
    (storableCount > 0 || selectedClipRefs.length > 0) &&
    missingSemantic.length === 0 &&
    conflicts.length === 0

  const confirmError = (): string | null => {
    if (rangeError) return rangeError
    if (!collectionName.trim()) return 'Collection name is required.'
    if (missingSemantic.length > 0)
      return `Cannot create: ${missingSemantic.map((o) => o.nodeName).join(', ')} has no Semantic Name. Set it in Inspector first.`
    if (conflicts.length > 0)
      return `Cannot create: ${conflicts.map((o) => o.nodeName).join(', ')} has both keyframes and a clip selected — deselect either its parameters or its clip (one clip per object).`
    if (storableCount === 0 && selectedClipRefs.length === 0)
      return selectedEntries.length > 0
        ? 'No clip-storable keyframes selected in this segment (only table / label / symmetry tracks).'
        : 'Nothing selected: check parameters or clips to include in the segment.'
    return null
  }

  const confirmObjects = useMemo(
    () =>
      objects
        .filter((o) => objectOn(o.nodeId))
        .map((o) => {
          const kfs: ExtractableKeyframe[] = []
          for (const p of o.params) {
            if (!paramSelected(o.nodeId, p.key)) continue
            for (const e of p.entries) {
              kfs.push({
                target: e.target,
                time: e.time,
                value: e.value,
                interpolation: e.interpolation,
                tangentIn: { ...e.tangentIn },
                tangentOut: { ...e.tangentOut },
                keyframeId: e.keyframeId,
              })
            }
          }
          const refs = objectSelectedClips(o).map((c) => ({
            nodeId: c.nodeId,
            instanceId: c.instanceId,
            clipId: c.clipId,
            clipName: c.clipName,
            start: c.start,
            end: c.end,
          }))
          return {
            nodeId: o.nodeId,
            nodeName: o.nodeName,
            semanticName: (o.semanticName ?? '').trim(),
            clipName: (clipNames[o.nodeId] ?? '').trim() || nextClipNameForNode(o.nodeName, []),
            category: (categories[o.nodeId] ?? '').trim() || (o.semanticName ?? '').trim(),
            keyframes: kfs,
            clips: refs,
          }
        })
        .filter((o) => o.keyframes.length > 0 || o.clips.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, selectedObjects, selectedParams, selectedClips, clipNames, categories],
  )

  const bakeBounds = useMemo(
    () =>
      range
        ? {
            selStart: range.from,
            selEnd: range.to,
            selDuration: range.to - range.from,
            clipDuration: range.to - range.from,
          }
        : null,
    [range],
  )

  const bakeStartPreview = useMemo(() => {
    if (!bakeBounds) return 0
    return confirmObjects.reduce(
      (n, o) =>
        n +
        (o.keyframes.length > 0 && o.clips.length === 0
          ? previewBakingCount(bakeBounds, o.keyframes, bakingEvaluator, 'start')
          : 0),
      0,
    )
  }, [bakeBounds, confirmObjects, bakingEvaluator])

  const bakeEndPreview = useMemo(() => {
    if (!bakeBounds) return 0
    return confirmObjects.reduce(
      (n, o) =>
        n +
        (o.keyframes.length > 0 && o.clips.length === 0
          ? previewBakingCount(bakeBounds, o.keyframes, bakingEvaluator, 'end')
          : 0),
      0,
    )
  }, [bakeBounds, confirmObjects, bakingEvaluator])

  const handleConfirm = () => {
    setError(null)
    const err = confirmError()
    if (err || !range) {
      setError(err ?? 'Invalid time segment.')
      return
    }
    const objs = confirmObjects
    if (objs.length === 0) {
      setError('Select at least one keyframe or clip.')
      return
    }
    const result = onConfirm({
      parentNodeId,
      from: range.from,
      to: range.to,
      objects: objs,
      collectionName: collectionName.trim(),
      deleteOrphans,
      keepFirst: deleteOrphans && keepFirst,
      keepLast: deleteOrphans && keepLast,
      removeClipInstances,
      bakeStart,
      bakeEnd,
      // the wizard seeds unique defaults and the master field may intentionally
      // repeat one name across categories — keep names exactly as shown.
      dedupeClipNames: false,
    })
    if (result) setError(result)
  }

  const setRange = (nextFrom: number | null, nextTo: number | null) => {
    if (nextFrom !== null && nextTo !== null) {
      setLenStr(formatSec(nextTo - nextFrom))
      if (!collectionTouched) {
        setCollectionName(defaultSegmentCollectionName(parentName, nextFrom, nextTo))
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create collection from time segment"
      data-testid="segment-to-collection-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg, #fff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 520,
          maxWidth: 680,
          width: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>Create collection from time segment</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: 0 }}>
          Parent <strong>{parentName}</strong> · {entries.length} orphan keyframe(s) and{' '}
          {clips.length} clip placement(s) in hierarchy. Check orphan parameters to mint one clip
          per object (category = its semantic name), and/or check fully-contained clips to reuse
          them as-is — all grouped into one collection. Minted clips share the segment time base, so
          members stay in sync.
        </p>

        <label style={{ fontSize: 12 }}>
          Name for everything
          <input
            data-testid="segment-master-name"
            value={masterName}
            placeholder="Type once to rename all clips and the collection below"
            onChange={(e) => {
              const v = e.target.value
              setMasterName(v)
              const trimmed = v.trim()
              if (!trimmed) return
              setClipNames((prev) => {
                const next = { ...prev }
                for (const o of objects) next[o.nodeId] = trimmed
                return next
              })
              setCollectionName(trimmed)
              setCollectionTouched(true)
            }}
            style={inputStyle}
          />
        </label>

        {/* Range */}
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1, fontSize: 12 }}>
            From (s)
            <input
              data-testid="segment-from-input"
              value={fromStr}
              onChange={(e) => {
                setFromStr(e.target.value)
                const f = parseSec(e.target.value)
                const t = parseSec(toStr)
                if (f !== null && t !== null) setRange(f, t)
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ flex: 1, fontSize: 12 }}>
            To (s)
            <input
              data-testid="segment-to-input"
              value={toStr}
              onChange={(e) => {
                setToStr(e.target.value)
                const f = parseSec(fromStr)
                const t = parseSec(e.target.value)
                if (f !== null && t !== null) setRange(f, t)
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ flex: 1, fontSize: 12 }}>
            Length (s)
            <input
              data-testid="segment-length-input"
              value={lenStr}
              onChange={(e) => {
                setLenStr(e.target.value)
                const f = parseSec(fromStr)
                const l = parseSec(e.target.value)
                if (f !== null && l !== null && l > 0) {
                  const t = f + l
                  setToStr(formatSec(t))
                  if (!collectionTouched)
                    setCollectionName(defaultSegmentCollectionName(parentName, f, t))
                }
              }}
              style={inputStyle}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            data-testid="segment-preset-span"
            onClick={() => {
              const r = defaultSegmentRange(
                entries.map((e) => e.time),
                slideDuration,
              )
              setFromStr(formatSec(r.from))
              setToStr(formatSec(r.to))
              setRange(r.from, r.to)
            }}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
          >
            Orphan span
          </button>
          <button
            data-testid="segment-preset-slide"
            onClick={() => {
              setFromStr(formatSec(0))
              setToStr(formatSec(slideDuration))
              setRange(0, slideDuration)
            }}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
          >
            Whole slide ({formatSec(slideDuration)}s)
          </button>
          <span
            data-testid="segment-summary"
            style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}
          >
            {rangeValid && range
              ? `${selectedEntries.length} keyframe(s) · ${selectedClipRefs.length} clip(s) · ${objects.filter((o) => objectOn(o.nodeId)).length} object(s) in [${formatSec(range.from)}s, ${formatSec(range.to)}s]`
              : 'Enter a valid segment to list objects and clips'}
          </span>
        </div>
        {rangeError && (
          <div
            data-testid="segment-range-error"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            {rangeError}
          </div>
        )}

        {/* Objects */}
        {rangeValid && objects.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
            No orphan keyframes or fully-contained clips in this segment — adjust From / To.
          </div>
        )}
        {objects.map((o) => {
          const on = objectOn(o.nodeId)
          const missing = !o.semanticName?.trim()
          return (
            <div
              key={o.nodeId}
              data-testid={`segment-object-${o.nodeId}`}
              style={{
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 6,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                opacity: on ? 1 : 0.6,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  data-testid={`segment-object-toggle-${o.nodeId}`}
                  checked={on}
                  onChange={(e) =>
                    setSelectedObjects((p) => ({ ...p, [o.nodeId]: e.target.checked }))
                  }
                />
                {o.nodeName}
                <span
                  style={{
                    fontWeight: 400,
                    fontSize: 11,
                    color: missing ? 'var(--color-danger, #c00)' : 'var(--color-text-muted, #666)',
                  }}
                >
                  {missing
                    ? 'no Semantic Name — set in Inspector'
                    : `semantic: ${o.semanticName!.trim()}`}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontWeight: 400,
                    fontSize: 11,
                    color: 'var(--color-text-muted, #666)',
                  }}
                >
                  {o.total} item(s)
                </span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 24 }}>
                {o.params.map((p) => (
                  <label
                    key={p.key}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`segment-param-${o.nodeId}-${p.key}`}
                      checked={paramSelected(o.nodeId, p.key)}
                      onChange={(e) =>
                        setSelectedParams((prev) => ({
                          ...prev,
                          [`${o.nodeId}::${p.key}`]: e.target.checked,
                        }))
                      }
                    />
                    {p.label} ×{p.entries.length}
                  </label>
                ))}
                {o.clips.map((c) => (
                  <label
                    key={c.instanceId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                    title={`Clip instance on this object, fully inside the segment (${formatSec(c.start)}s–${formatSec(c.end)}s). Checked = reuse this clip in the collection.`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`segment-clip-${c.instanceId}`}
                      checked={clipSelected(c.instanceId)}
                      onChange={(e) =>
                        setSelectedClips((prev) => ({
                          ...prev,
                          [c.instanceId]: e.target.checked,
                        }))
                      }
                    />
                    🎬 {c.clipName} [{formatSec(c.start)}–{formatSec(c.end)}s]
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, paddingLeft: 24 }}>
                <label style={{ flex: 2, fontSize: 12 }}>
                  Clip name
                  <input
                    data-testid={`segment-clipname-${o.nodeId}`}
                    value={clipNames[o.nodeId] ?? ''}
                    onChange={(e) => setClipNames((p) => ({ ...p, [o.nodeId]: e.target.value }))}
                    style={inputStyle}
                  />
                </label>
                <label style={{ flex: 1, fontSize: 12 }}>
                  Category
                  <input
                    data-testid={`segment-category-${o.nodeId}`}
                    value={categories[o.nodeId] ?? ''}
                    onChange={(e) => setCategories((p) => ({ ...p, [o.nodeId]: e.target.value }))}
                    style={inputStyle}
                  />
                </label>
              </div>
            </div>
          )
        })}
        {missingSemantic.length > 0 && (
          <div
            data-testid="segment-missing-semantic"
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            Cannot create: {missingSemantic.map((o) => o.nodeName).join(', ')} has no Semantic Name.
            Set it in Inspector → General → Semantic Name first.
          </div>
        )}

        {/* Collection + cleanup */}
        <label style={{ fontSize: 12 }}>
          Collection name
          <input
            data-testid="segment-collection-name"
            value={collectionName}
            onChange={(e) => {
              setCollectionName(e.target.value)
              setCollectionTouched(true)
            }}
            style={inputStyle}
          />
        </label>
        <div
          style={{
            border: '1px solid var(--color-border, #ddd)',
            borderRadius: 6,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}
          >
            <input
              type="checkbox"
              data-testid="segment-delete-checkbox"
              checked={deleteOrphans}
              onChange={(e) => setDeleteOrphans(e.target.checked)}
            />
            Delete source orphan keyframes after creation
            {deleteOrphans && (
              <span
                style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted, #666)' }}
              >
                ({deletePreview} of {selectedEntries.length} selected)
              </span>
            )}
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              paddingLeft: 24,
              opacity: deleteOrphans ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              data-testid="segment-keep-first"
              checked={keepFirst}
              disabled={!deleteOrphans}
              onChange={(e) => setKeepFirst(e.target.checked)}
            />
            Keep first keyframe in segment (for 1-frame overlaps with the previous clip)
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              paddingLeft: 24,
              opacity: deleteOrphans ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              data-testid="segment-keep-last"
              checked={keepLast}
              disabled={!deleteOrphans}
              onChange={(e) => setKeepLast(e.target.checked)}
            />
            Keep last keyframe in segment (for 1-frame overlaps with the next clip)
          </label>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}
          >
            <input
              type="checkbox"
              data-testid="segment-remove-instances"
              checked={removeClipInstances}
              onChange={(e) => setRemoveClipInstances(e.target.checked)}
            />
            Remove included clip placements from the timeline
            {selectedClipRefs.length > 0 && (
              <span
                style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted, #666)' }}
              >
                ({selectedClipRefs.length} selected — library clips are kept, only placements
                removed)
              </span>
            )}
          </label>
        </div>
        {conflicts.length > 0 && (
          <div
            data-testid="segment-conflict"
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            Cannot create: {conflicts.map((o) => o.nodeName).join(', ')} has both keyframes and a
            clip selected — deselect either its parameters or its clip (one clip per object in a
            collection).
          </div>
        )}

        <div
          style={{
            border: '1px solid var(--color-border, #ddd)',
            borderRadius: 6,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>Bake endpoints</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
            Pin each minted clip to the evaluated pose for parameters with no keyframes at that end
            (position, rotation, scale, opacity, circle, shadow numerics). Reused clips are
            unaffected.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              data-testid="segment-bake-start"
              checked={bakeStart}
              onChange={(e) => setBakeStart(e.target.checked)}
            />
            Bake at the beginning (t=0 from pose at From)
            {bakeStart && bakeStartPreview > 0 && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                (+{bakeStartPreview} synthetic keyframe{bakeStartPreview === 1 ? '' : 's'})
              </span>
            )}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              data-testid="segment-bake-end"
              checked={bakeEnd}
              onChange={(e) => setBakeEnd(e.target.checked)}
            />
            Bake at the end (t=1 from pose at To)
            {bakeEnd && bakeEndPreview > 0 && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                (+{bakeEndPreview} synthetic keyframe{bakeEndPreview === 1 ? '' : 's'})
              </span>
            )}
          </label>
        </div>

        {skippedCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
            {skippedCount} selected keyframe(s) are on tracks clips cannot store (table / labels /
            symmetry) — excluded from clips{deleteOrphans ? ', still deleted' : ''}.
          </div>
        )}
        {error && (
          <div
            data-testid="segment-error"
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            data-testid="segment-confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            title={
              !canConfirm
                ? (confirmError() ?? 'Resolve errors first')
                : `Create ${objects.filter((o) => objectOn(o.nodeId)).length} clip(s) + collection`
            }
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: canConfirm
                ? 'var(--color-accent, #7c5cff)'
                : 'var(--color-bg-elevated, #eceef1)',
              color: canConfirm
                ? 'var(--color-accent-text, #fff)'
                : 'var(--color-text-muted, #666)',
              cursor: canConfirm ? 'pointer' : 'default',
            }}
          >
            Create clips + collection
          </button>
        </div>
      </div>
    </div>
  )
}
