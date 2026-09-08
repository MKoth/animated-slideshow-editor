/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  getManagerRows,
  type ManagerTab,
  getOrphanKeyframes,
  packClipLanesForNode,
  collectBarEdgesForSnap,
  MIN_VISUAL_DURATION,
  MIN_CLIP_SPEED,
  CLIP_HANDLE_WIDTH_PX,
  CLIP_LANE_HEIGHT_PX,
  CLIP_LANE_BAR_HEIGHT_PX,
  clampedSpeedForVisual,
  snapStartTime,
} from '../../engine/animationManagerModel'
import { useTimelineViewStore, pixelsPerSecond } from '../../stores/timelineViewStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { walkPreOrder } from '../../engine/sceneNode'
import {
  clipChannelRows,
  type ClipEditorRow,
  ROW_HEIGHT,
  TRACK_HEADER_WIDTH,
} from './timelineTracks'
import type { ClipDefinition } from '../../engine/clipDefinition'
import {
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
  TransactionCommand,
  SetClipDurationCommand,
  AddClipChannelCommand,
  RemoveClipChannelCommand,
  AddClipKeyframeCommand,
  DeleteClipKeyframesCommand,
  MoveClipKeyframesCommand,
  AssignClipCommand,
  CreateClipCollectionCommand,
  DeleteClipCollectionCommand,
  SetClipCollectionBindingsCommand,
  RenameClipCollectionCommand,
} from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { computeExtractionBounds } from '../../engine/clipExtraction'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import { ClipExtractionModal } from './ClipExtractionModal'
import type { AnimatedParam } from '../../engine/animationManagerModel'
import type { KeyframeTarget } from '../../engine/keyframeTarget'

interface AnimationManagerModalProps {
  open: boolean
  parentNodeId: string | null
  onClose: () => void
}

type DragState =
  | {
      mode: 'move'
      nodeId: string
      instanceId: string
      clipId: string
      clipDuration: number
      initialStart: number
      initialSpeed: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewStart: number
      previewSpeed: number
      previewVisual: number
    }
  | {
      mode: 'resize-right'
      nodeId: string
      instanceId: string
      clipId: string
      clipDuration: number
      initialStart: number
      initialSpeed: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewStart: number
      previewSpeed: number
      previewVisual: number
    }
  | {
      mode: 'resize-left'
      nodeId: string
      instanceId: string
      clipId: string
      clipDuration: number
      initialStart: number
      initialSpeed: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewStart: number
      previewSpeed: number
      previewVisual: number
    }

function countClipUses(engine: ReturnType<typeof useEngine>['engine'], clipId: string): number {
  const project = engine.project
  if (!project) return 0
  let n = 0
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      for (const inst of node.clipInstances) if (inst.clipId === clipId) n++
    }
  }
  return n
}

function paramToTarget(param: AnimatedParam, nodeId: string): KeyframeTarget {
  if (param.kind === 'property') return { kind: 'node', nodeId, property: param.key as never }
  if (param.kind === 'visible') return { kind: 'visible', nodeId }
  if (param.kind === 'morph') return { kind: 'morph', nodeId }
  if (param.kind === 'circle') return { kind: 'circle', nodeId, property: param.key as never }
  if (param.kind === 'shadow') return { kind: 'shadow', nodeId, property: param.key as never }
  if (param.kind === 'material')
    return { kind: 'node', nodeId, parameter: param.key } as KeyframeTarget
  if (param.kind === 'symmetry') return { kind: 'symmetry', nodeId }
  if (param.kind === 'table') return { kind: 'table', nodeId, property: param.key as never }
  return { kind: 'node', nodeId, property: param.key as never }
}

export interface OrphanEntry {
  readonly keyframeId: string
  readonly nodeId: string
  readonly param: AnimatedParam
  readonly keyframe: import('../../engine/keyframe').Keyframe
  readonly target: KeyframeTarget
}

function nextClipNameForNode(nodeName: string, clips: readonly { name: string }[]): string {
  const prefix = `${nodeName} Clip `
  let max = 0
  for (const c of clips) {
    if (c.name.startsWith(prefix)) {
      const suffix = c.name.slice(prefix.length).trim()
      const n = parseInt(suffix, 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

export function AnimationManagerModal({ open, parentNodeId, onClose }: AnimationManagerModalProps) {
  const { engine, dispatch, undoStack } = useEngine()
  const [tick, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<ManagerTab>('clips')
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ clipId: string; nodeId: string } | null>(null)
  const [savedZoom, setSavedZoom] = useState<number | null>(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [clipMenu, setClipMenu] = useState<{
    x: number
    y: number
    clipId: string
    nodeId: string
    instanceId: string
  } | null>(null)
  // Orphan multi-select (modal-scoped)
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<Set<string>>(new Set())
  const [orphanAnchorId, setOrphanAnchorId] = useState<string | null>(null)
  const [orphanContextMenu, setOrphanContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [orphanMarquee, setOrphanMarquee] = useState<{
    startX: number
    startY: number
    curX: number
    curY: number
    active: boolean
  } | null>(null)
  const [orphanExtraction, setOrphanExtraction] = useState<{
    keyframes: ExtractableKeyframe[]
    nodeId: string
    nodeName: string
    semanticName?: string
  } | null>(null)
  const [orphanScopeMessage, setOrphanScopeMessage] = useState<string | null>(null)
  const [highlightedClipInstanceId, setHighlightedClipInstanceId] = useState<string | null>(null)
  // Clip Lane multi-select for Collection grouping (15-05)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [clipAnchorId, setClipAnchorId] = useState<string | null>(null)
  const [collectionCreateOpen, setCollectionCreateOpen] = useState(false)
  const [collectionNameDraft, setCollectionNameDraft] = useState('')
  const [collectionLocalError, setCollectionLocalError] = useState<string | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [editingBindingsDraft, setEditingBindingsDraft] = useState<Record<string, string>>({})
  const [editingNameDraft, setEditingNameDraft] = useState('')
  const [deleteConfirmCollectionId, setDeleteConfirmCollectionId] = useState<string | null>(null)
  const orphansContainerRef = useRef<HTMLDivElement>(null)
  const notify = useNotificationStore((s) => s.notify)

  const zoomLevel = useTimelineViewStore((s) => s.zoomLevel)
  const gridSnapEnabled = useTimelineViewStore((s) => s.gridSnapEnabled)
  const pps = pixelsPerSecond(zoomLevel)

  useEngineEvent(() => setTick((t) => t + 1))

  // Reset tab and expanded when opening parent changes
  useEffect(() => {
    if (open) {
      setActiveTab('clips')
      setExpandedMap({})
      setEditing(null)
      setSelectedInstanceId(null)
      setDragState(null)
      setClipMenu(null)
      setSavedZoom(null)
      setSelectedOrphanIds(new Set())
      setOrphanAnchorId(null)
      setOrphanContextMenu(null)
      setOrphanMarquee(null)
      setOrphanExtraction(null)
      setOrphanScopeMessage(null)
      setHighlightedClipInstanceId(null)
      setSelectedClipIds(new Set())
      setClipAnchorId(null)
      setCollectionCreateOpen(false)
      setCollectionNameDraft('')
      setCollectionLocalError(null)
      setEditingCollectionId(null)
      setEditingBindingsDraft({})
      setEditingNameDraft('')
      setDeleteConfirmCollectionId(null)
    }
  }, [open, parentNodeId])

  const restorePpsAndBack = useCallback(() => {
    if (savedZoom !== null) {
      useTimelineViewStore.setState({ zoomLevel: savedZoom })
      setSavedZoom(null)
    }
    setEditing(null)
  }, [savedZoom])

  // Esc handling: drills back from editor (restoring pps), second Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (collectionCreateOpen) {
          setCollectionCreateOpen(false)
          e.stopPropagation()
        } else if (editingCollectionId) {
          setEditingCollectionId(null)
          e.stopPropagation()
        } else if (deleteConfirmCollectionId) {
          setDeleteConfirmCollectionId(null)
          e.stopPropagation()
        } else if (orphanExtraction) {
          setOrphanExtraction(null)
          e.stopPropagation()
        } else if (orphanContextMenu) {
          setOrphanContextMenu(null)
          e.stopPropagation()
        } else if (orphanScopeMessage) {
          setOrphanScopeMessage(null)
          e.stopPropagation()
        } else if (editing) {
          restorePpsAndBack()
          e.stopPropagation()
        } else if (dragState) {
          setDragState(null)
          e.stopPropagation()
        } else if (clipMenu) {
          setClipMenu(null)
          e.stopPropagation()
        } else if (orphanMarquee) {
          setOrphanMarquee(null)
          e.stopPropagation()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    open,
    editing,
    dragState,
    clipMenu,
    orphanContextMenu,
    orphanExtraction,
    orphanScopeMessage,
    orphanMarquee,
    collectionCreateOpen,
    editingCollectionId,
    deleteConfirmCollectionId,
    onClose,
    restorePpsAndBack,
  ])

  const activeSlide = open ? engine.getActiveSlide() : null
  const parentNode = useMemo(() => {
    if (!open || !parentNodeId) return null
    try {
      return engine.getNode(parentNodeId)
    } catch {
      return null
    }
  }, [open, parentNodeId, engine])

  const managerRows = useMemo(() => {
    void tick
    if (!activeSlide || !parentNode) return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    return getManagerRows(parentNode, activeSlide, engine.materialDefinitions, getClip)
  }, [activeSlide, parentNode, engine, tick])

  const overlayLabel = parentNode ? `Animation Manager — ${parentNode.name}` : 'Animation Manager'

  // Flat ordered orphan entries for Shift-range and marquee (display order: rows pre-order, param order, time asc)
  const flatOrphanEntries = useMemo((): OrphanEntry[] => {
    void tick
    if (!activeSlide) return []
    const entries: OrphanEntry[] = []
    for (const row of managerRows) {
      for (const param of row.animatedParams) {
        const kfs = getOrphanKeyframes(row.node, activeSlide, param)
        for (const kf of kfs) {
          entries.push({
            keyframeId: kf.id,
            nodeId: row.node.id,
            param,
            keyframe: kf,
            target: paramToTarget(param, row.node.id),
          })
        }
      }
    }
    return entries
  }, [activeSlide, managerRows, tick])

  // --- Collection grouping helpers (15-05): flat clip lanes, validation, bindings preview ---

  // Flat clip lane list in display order (for Shift-range selection)
  const flatClipLanes = useMemo(() => {
    void tick
    const lanes: { instanceId: string; nodeId: string; clipId: string; nodeName: string }[] = []
    for (const row of managerRows) {
      for (const inst of row.node.clipInstances) {
        // verify clip exists
        try {
          const clip = engine.getClip(inst.clipId)
          if (!clip) continue
          lanes.push({
            instanceId: inst.id,
            nodeId: row.node.id,
            clipId: inst.clipId,
            nodeName: row.node.name,
          })
        } catch {
          continue
        }
      }
    }
    return lanes
  }, [managerRows, engine, tick])

  // Map instanceId -> node lookup for validation
  const instanceToNode = useMemo(() => {
    void tick
    const m = new Map<
      string,
      { nodeId: string; nodeName: string; semanticName?: string; clipId: string }
    >()
    for (const lane of flatClipLanes) {
      try {
        const node = engine.getNode(lane.nodeId)
        m.set(lane.instanceId, {
          nodeId: lane.nodeId,
          nodeName: node.name,
          semanticName: node.semanticName,
          clipId: lane.clipId,
        })
      } catch {
        // skip
      }
    }
    return m
  }, [flatClipLanes, engine, tick])

  const collectionMissingSemantic = useMemo(() => {
    const missing: { instanceId: string; nodeId: string; nodeName: string; clipId: string }[] = []
    for (const id of selectedClipIds) {
      const info = instanceToNode.get(id)
      if (!info) continue
      if (!info.semanticName || info.semanticName.trim() === '') {
        missing.push({
          instanceId: id,
          nodeId: info.nodeId,
          nodeName: info.nodeName,
          clipId: info.clipId,
        })
      }
    }
    return missing
  }, [selectedClipIds, instanceToNode])

  const collectionBindingsPreview = useMemo(() => {
    const bindings: {
      semanticName: string
      clipId: string
      clipName: string
      nodeId: string
      nodeName: string
    }[] = []
    const seen = new Set<string>()
    for (const id of selectedClipIds) {
      const info = instanceToNode.get(id)
      if (!info) continue
      const sem = info.semanticName?.trim()
      if (!sem) continue
      if (seen.has(sem)) continue
      try {
        const clip = engine.getClip(info.clipId)
        bindings.push({
          semanticName: sem,
          clipId: info.clipId,
          clipName: clip.name,
          nodeId: info.nodeId,
          nodeName: info.nodeName,
        })
        seen.add(sem)
      } catch {
        // skip missing clip
      }
    }
    return bindings
  }, [selectedClipIds, instanceToNode, engine])

  // Orphan validation for collections: any orphan in parent subtree blocks
  const hasOrphanInSubtree = flatOrphanEntries.length > 0
  const distinctOrphanNodes = useMemo(() => {
    void tick
    const map = new Map<string, { id: string; name: string }>()
    for (const e of flatOrphanEntries) {
      if (!map.has(e.nodeId)) {
        try {
          const n = engine.getNode(e.nodeId)
          map.set(e.nodeId, { id: e.nodeId, name: n.name })
        } catch {
          map.set(e.nodeId, { id: e.nodeId, name: e.nodeId.slice(0, 8) })
        }
      }
    }
    return [...map.values()]
  }, [flatOrphanEntries, engine, tick])

  const collectionBlockingError = useMemo(() => {
    if (hasOrphanInSubtree)
      return `Cannot create: ${flatOrphanEntries.length} orphan keyframe(s) in hierarchy. Fix in Orphans tab before creating a collection.`
    if (collectionMissingSemantic.length > 0) {
      const names = collectionMissingSemantic.map((m) => m.nodeName).join(', ')
      return `Cannot create: ${collectionMissingSemantic.length} selected clip(s) on nodes with no Semantic Name: ${names}. Set Semantic Name in Inspector.`
    }
    if (selectedClipIds.size === 0) return null
    if (collectionBindingsPreview.length === 0)
      return 'No valid bindings — selected clips have no semanticName or missing clip definitions.'
    return null
  }, [
    hasOrphanInSubtree,
    flatOrphanEntries,
    collectionMissingSemantic,
    selectedClipIds,
    collectionBindingsPreview,
  ])

  const canCreateCollection = Boolean(
    !collectionBlockingError &&
    selectedClipIds.size > 0 &&
    collectionNameDraft.trim() &&
    parentNodeId,
  )

  const collectionsForParent = useMemo(() => {
    void tick
    if (!parentNodeId) return []
    return engine.clipCollections.filter((c) => c.sourceNodeId === parentNodeId)
  }, [engine, parentNodeId, tick])

  // Candidate times for snap – computed from committed state, excluding dragging instance
  const snapCandidateTimes = useMemo(() => {
    if (!dragState || dragState.mode !== 'move') return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    const nodes = managerRows.map((r) => r.node)
    const edges = collectBarEdgesForSnap(nodes, getClip, {
      nodeId: dragState.nodeId,
      instanceId: dragState.instanceId,
    })
    // Add playhead time
    if (activeSlide) {
      const playhead = usePlaybackController.getState().getTime(activeSlide.id)
      // Include playhead as candidate – snapKeyframeTime will apply 5px threshold
      return [...edges, playhead]
    }
    return [...edges]
  }, [managerRows, engine, dragState, activeSlide])

  // --- Orphan multi-select helpers ---
  const handleOrphanDiamondClick = useCallback(
    (e: React.MouseEvent, entry: OrphanEntry) => {
      e.stopPropagation()
      setOrphanScopeMessage(null)
      const isCtrl = e.ctrlKey || e.metaKey
      const isShift = e.shiftKey
      const idx = flatOrphanEntries.findIndex((x) => x.keyframeId === entry.keyframeId)
      if (idx === -1) return
      if (isShift && orphanAnchorId) {
        const anchorIdx = flatOrphanEntries.findIndex((x) => x.keyframeId === orphanAnchorId)
        if (anchorIdx !== -1) {
          const start = Math.min(anchorIdx, idx)
          const end = Math.max(anchorIdx, idx)
          const rangeIds = flatOrphanEntries.slice(start, end + 1).map((x) => x.keyframeId)
          if (isCtrl) {
            setSelectedOrphanIds((prev) => {
              const next = new Set(prev)
              for (const id of rangeIds) next.add(id)
              return next
            })
          } else {
            setSelectedOrphanIds(new Set(rangeIds))
          }
          return
        }
      }
      if (isCtrl) {
        setSelectedOrphanIds((prev) => {
          const next = new Set(prev)
          if (next.has(entry.keyframeId)) next.delete(entry.keyframeId)
          else next.add(entry.keyframeId)
          return next
        })
        setOrphanAnchorId(entry.keyframeId)
      } else {
        setSelectedOrphanIds(new Set([entry.keyframeId]))
        setOrphanAnchorId(entry.keyframeId)
      }
    },
    [flatOrphanEntries, orphanAnchorId],
  )

  const handleOrphanContextMenu = useCallback(
    (e: React.MouseEvent, entry?: OrphanEntry) => {
      e.preventDefault()
      e.stopPropagation()
      if (entry && !selectedOrphanIds.has(entry.keyframeId)) {
        setSelectedOrphanIds(new Set([entry.keyframeId]))
        setOrphanAnchorId(entry.keyframeId)
      }
      setOrphanContextMenu({ x: e.clientX, y: e.clientY })
    },
    [selectedOrphanIds],
  )

  const openOrphanExtraction = useCallback(() => {
    if (selectedOrphanIds.size === 0) {
      setOrphanScopeMessage('Select at least one orphan keyframe before Add to clip.')
      notify('Select at least one orphan keyframe')
      return
    }
    const selectedEntries = flatOrphanEntries.filter((e) => selectedOrphanIds.has(e.keyframeId))
    const distinctNodes = new Set(selectedEntries.map((e) => e.nodeId))
    if (distinctNodes.size > 1) {
      const msg =
        'Multi-object selection is not supported — select keyframes from a single object only.'
      setOrphanScopeMessage(msg)
      notify(msg)
      return
    }
    const nodeId = [...distinctNodes][0]!
    const node = managerRows.find((r) => r.node.id === nodeId)?.node
    if (!node) {
      setOrphanScopeMessage('Selected node no longer exists.')
      return
    }
    // Build ExtractableKeyframe array (values copied verbatim)
    const extractable: ExtractableKeyframe[] = selectedEntries.map((en) => ({
      target: en.target,
      time: en.keyframe.time,
      value: en.keyframe.value as unknown as ExtractableKeyframe['value'],
      interpolation: en.keyframe.interpolation,
      tangentIn: { time: en.keyframe.tangentIn.time, value: en.keyframe.tangentIn.value },
      tangentOut: { time: en.keyframe.tangentOut.time, value: en.keyframe.tangentOut.value },
      keyframeId: en.keyframe.id,
    }))
    // Validate duplicate normalized times upfront via computeExtractionBounds + validate? Let command handle, but we can pre-check
    try {
      computeExtractionBounds(extractable)
    } catch (err) {
      setOrphanScopeMessage(err instanceof Error ? err.message : String(err))
      return
    }
    setOrphanScopeMessage(null)
    setOrphanContextMenu(null)
    setOrphanExtraction({
      keyframes: extractable,
      nodeId,
      nodeName: node.name,
      semanticName: node.semanticName,
    })
  }, [selectedOrphanIds, flatOrphanEntries, managerRows, notify])

  // --- Collection grouping handlers (15-05) ---
  const handleClipLaneSelect = useCallback(
    (e: React.MouseEvent, instanceId: string) => {
      // Ignore if clicking handle – handle already stopped
      const target = e.target as HTMLElement
      if (target.dataset.testid?.startsWith('clip-handle')) return
      e.stopPropagation()
      const isCtrl = e.ctrlKey || e.metaKey
      const isShift = e.shiftKey
      if (isShift && clipAnchorId) {
        const anchorIdx = flatClipLanes.findIndex((l) => l.instanceId === clipAnchorId)
        const idx = flatClipLanes.findIndex((l) => l.instanceId === instanceId)
        if (anchorIdx !== -1 && idx !== -1) {
          const start = Math.min(anchorIdx, idx)
          const end = Math.max(anchorIdx, idx)
          const rangeIds = flatClipLanes.slice(start, end + 1).map((l) => l.instanceId)
          if (isCtrl) {
            setSelectedClipIds((prev) => {
              const next = new Set(prev)
              for (const id of rangeIds) next.add(id)
              return next
            })
          } else {
            setSelectedClipIds(new Set(rangeIds))
          }
          return
        }
      }
      if (isCtrl) {
        setSelectedClipIds((prev) => {
          const next = new Set(prev)
          if (next.has(instanceId)) next.delete(instanceId)
          else next.add(instanceId)
          return next
        })
        setClipAnchorId(instanceId)
        // also keep single-select for drag compatibility
        setSelectedInstanceId(instanceId)
      } else {
        setSelectedClipIds(new Set([instanceId]))
        setClipAnchorId(instanceId)
        setSelectedInstanceId(instanceId)
      }
    },
    [flatClipLanes, clipAnchorId],
  )

  const handleCreateCollection = useCallback(() => {
    if (selectedClipIds.size === 0) {
      notify('Select at least one Clip Lane')
      return
    }
    if (hasOrphanInSubtree) {
      setCollectionLocalError(
        `Cannot create: ${flatOrphanEntries.length} orphan keyframe(s) in hierarchy. Fix in Orphans tab.`,
      )
      return
    }
    if (collectionMissingSemantic.length > 0) {
      setCollectionLocalError(
        `Cannot create: ${collectionMissingSemantic.length} selected clip(s) on nodes with no Semantic Name.`,
      )
      return
    }
    // default name from parent
    const defaultName = parentNode ? `${parentNode.name} Collection` : 'New Collection'
    if (!collectionNameDraft.trim()) setCollectionNameDraft(defaultName)
    setCollectionLocalError(null)
    setCollectionCreateOpen(true)
  }, [
    selectedClipIds,
    hasOrphanInSubtree,
    flatOrphanEntries,
    collectionMissingSemantic,
    collectionNameDraft,
    parentNode,
    notify,
  ])

  const confirmCreateCollection = useCallback(() => {
    if (!parentNodeId) {
      setCollectionLocalError('No parent selected')
      return
    }
    if (hasOrphanInSubtree) {
      setCollectionLocalError(
        `Cannot create: ${flatOrphanEntries.length} orphan keyframe(s) in hierarchy.`,
      )
      return
    }
    if (collectionMissingSemantic.length > 0) {
      setCollectionLocalError(
        `Cannot create: ${collectionMissingSemantic.length} selected node(s) have no Semantic Name.`,
      )
      return
    }
    const name = collectionNameDraft.trim()
    if (!name) {
      setCollectionLocalError('Name is required')
      return
    }
    const bindings: Record<string, string> = {}
    for (const b of collectionBindingsPreview) {
      bindings[b.semanticName] = b.clipId
    }
    if (Object.keys(bindings).length === 0) {
      setCollectionLocalError('No valid bindings to create collection')
      return
    }
    const result = dispatch(
      new CreateClipCollectionCommand({ name, bindings, sourceNodeId: parentNodeId }),
    )
    if (!result.ok) {
      setCollectionLocalError(result.error.message)
      return
    }
    notify(`Created ClipCollection "${name}" (${Object.keys(bindings).length} bindings)`)
    setCollectionCreateOpen(false)
    setCollectionNameDraft('')
    setCollectionLocalError(null)
    // keep selection but maybe clear? Keep for edit
    // Do not clear selection to allow shared clip test
  }, [
    parentNodeId,
    hasOrphanInSubtree,
    flatOrphanEntries,
    collectionMissingSemantic,
    collectionNameDraft,
    collectionBindingsPreview,
    dispatch,
    notify,
  ])

  const handleDeleteCollection = useCallback(
    (collectionId: string) => {
      const result = dispatch(new DeleteClipCollectionCommand({ collectionId }))
      if (!result.ok) notify(result.error.message)
      else notify('Collection deleted — placed lanes remain as plain ClipInstances')
      setDeleteConfirmCollectionId(null)
    },
    [dispatch, notify],
  )

  const openEditCollection = useCallback(
    (collectionId: string) => {
      try {
        const col = engine.getClipCollection(collectionId)
        setEditingCollectionId(collectionId)
        setEditingBindingsDraft({ ...col.getBindingsObject() })
        setEditingNameDraft(col.name)
        setCollectionLocalError(null)
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e))
      }
    },
    [engine, notify],
  )

  const confirmEditCollection = useCallback(() => {
    if (!editingCollectionId) return
    const bindings = { ...editingBindingsDraft }
    // Validate bindings non-empty keys and clip existence
    for (const [k, v] of Object.entries(bindings)) {
      if (!k.trim() || !v) {
        setCollectionLocalError('Bindings must have non-empty semanticName and clipId')
        return
      }
      try {
        engine.getClip(v)
      } catch {
        setCollectionLocalError(`Clip not found: ${v.slice(0, 8)}`)
        return
      }
    }
    // If name changed, need rename? Do bindings update first, then rename if needed
    try {
      const col = engine.getClipCollection(editingCollectionId)
      if (editingNameDraft.trim() && editingNameDraft.trim() !== col.name) {
        const bindResult = dispatch(
          new SetClipCollectionBindingsCommand({ collectionId: editingCollectionId, bindings }),
        )
        if (!bindResult.ok) {
          setCollectionLocalError(bindResult.error.message)
          return
        }
        const renameResult = dispatch(
          new RenameClipCollectionCommand({
            collectionId: editingCollectionId,
            name: editingNameDraft.trim(),
          }),
        )
        if (!renameResult.ok) {
          setCollectionLocalError(renameResult.error.message)
          return
        }
      } else {
        const bindResult = dispatch(
          new SetClipCollectionBindingsCommand({ collectionId: editingCollectionId, bindings }),
        )
        if (!bindResult.ok) {
          setCollectionLocalError(bindResult.error.message)
          return
        }
      }
    } catch (e) {
      setCollectionLocalError(e instanceof Error ? e.message : String(e))
      return
    }
    notify('Collection updated')
    setEditingCollectionId(null)
    setEditingBindingsDraft({})
    setCollectionLocalError(null)
  }, [editingCollectionId, editingBindingsDraft, editingNameDraft, engine, dispatch, notify])

  // Marquee drag for orphans – threshold 5px, handle-excluded
  const handleOrphansPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (activeTab !== 'orphans') return
      const target = e.target as HTMLElement
      // handle-excluded: if click is on diamond or its handle area, don't start marquee
      if (target.closest('[data-testid^="orphan-diamond"]')) return
      if (target.closest('[data-testid="orphan-context-menu"]')) return
      if (target.closest('[data-testid="clip-extraction-modal"]')) return
      if (e.button !== 0) return
      // Only start marquee on background of orphans container
      if (!orphansContainerRef.current?.contains(target as Node)) return
      setOrphanMarquee({
        startX: e.clientX,
        startY: e.clientY,
        curX: e.clientX,
        curY: e.clientY,
        active: false,
      })
      // capture pointer
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      e.preventDefault()
    },
    [activeTab],
  )

  useEffect(() => {
    if (!orphanMarquee) return
    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - orphanMarquee.startX
      const dy = e.clientY - orphanMarquee.startY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const shouldActivate = dist >= 5 || orphanMarquee.active
      setOrphanMarquee((prev) =>
        prev ? { ...prev, curX: e.clientX, curY: e.clientY, active: shouldActivate } : prev,
      )
    }
    const onPointerUp = () => {
      if (!orphanMarquee.active) {
        setOrphanMarquee(null)
        return
      }
      const { startX, startY, curX, curY } = orphanMarquee
      const left = Math.min(startX, curX)
      const right = Math.max(startX, curX)
      const top = Math.min(startY, curY)
      const bottom = Math.max(startY, curY)
      const container = orphansContainerRef.current
      if (!container) {
        setOrphanMarquee(null)
        return
      }
      const diamonds = container.querySelectorAll<HTMLElement>('[data-testid^="orphan-diamond-"]')
      const hitIds = new Set<string>()
      for (const el of diamonds) {
        const rect = el.getBoundingClientRect()
        // handle-excluded hit test: shrink hit rect by 6px handle zone? Use full rect but exclude 6px edge? We'll just use center point check
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
          const id = el.getAttribute('data-testid')?.replace('orphan-diamond-', '')
          if (id) hitIds.add(id)
        }
      }
      if (hitIds.size > 0) {
        // Marquee replaces selection (or adds if ctrl held? Simplistic: replace)
        // Check if pointer up had ctrl? We didn't track; assume replace
        setSelectedOrphanIds(hitIds)
        const last = [...hitIds][hitIds.size - 1] as string | undefined
        if (last) setOrphanAnchorId(last)
      }
      setOrphanMarquee(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [orphanMarquee])

  // Window drag listeners
  useEffect(() => {
    if (!dragState) return
    const onPointerMove = (e: PointerEvent) => {
      const deltaPx = e.clientX - dragState.startX
      if (dragState.mode === 'move') {
        const raw = dragState.initialStart + deltaPx / pps
        const clampedRaw = Math.max(0, raw)
        const snapped = gridSnapEnabled
          ? snapStartTime(clampedRaw, pps, true, snapCandidateTimes)
          : clampedRaw
        setDragState((prev) => (prev ? ({ ...prev, previewStart: snapped } as DragState) : prev))
      } else if (dragState.mode === 'resize-right') {
        const newWidthPx = dragState.initialVisual * pps + deltaPx
        let newVisual = newWidthPx / pps
        if (newVisual < MIN_VISUAL_DURATION) newVisual = MIN_VISUAL_DURATION
        const newSpeed = clampedSpeedForVisual(dragState.clipDuration, newVisual)
        // Recompute visual to reflect speed clamp (in case speed hit MIN)
        let finalVisual = dragState.clipDuration / newSpeed
        if (finalVisual < MIN_VISUAL_DURATION) finalVisual = MIN_VISUAL_DURATION
        // If speed clamped to MIN, finalVisual may differ from newVisual; use finalVisual
        setDragState((prev) =>
          prev
            ? ({
                ...prev,
                previewVisual: finalVisual,
                previewSpeed: newSpeed,
              } as DragState)
            : prev,
        )
      } else if (dragState.mode === 'resize-left') {
        const deltaSec = deltaPx / pps
        const rawStart = dragState.initialStart + deltaSec
        const rightEdge = dragState.rightEdge
        let newVisualRaw = rightEdge - rawStart
        if (newVisualRaw < MIN_VISUAL_DURATION) newVisualRaw = MIN_VISUAL_DURATION
        let newSpeed = clampedSpeedForVisual(dragState.clipDuration, newVisualRaw)
        let finalVisual = dragState.clipDuration / newSpeed
        if (finalVisual < MIN_VISUAL_DURATION) finalVisual = MIN_VISUAL_DURATION
        // right edge pinned: previewStart = rightEdge - finalVisual
        let previewStart = rightEdge - finalVisual
        if (previewStart < 0) {
          // Clamp start to 0, recompute visual as rightEdge - 0 = rightEdge, then speed
          previewStart = 0
          const clampedVisual2 = Math.max(rightEdge - previewStart, MIN_VISUAL_DURATION)
          const speed2 = clampedSpeedForVisual(dragState.clipDuration, clampedVisual2)
          const visual2 = dragState.clipDuration / speed2
          finalVisual = visual2 < MIN_VISUAL_DURATION ? MIN_VISUAL_DURATION : visual2
          previewStart = rightEdge - finalVisual
          if (previewStart < 0) previewStart = 0
          newSpeed = speed2
        }
        setDragState((prev) =>
          prev
            ? ({
                ...prev,
                previewStart,
                previewSpeed: newSpeed,
                previewVisual: finalVisual,
              } as DragState)
            : prev,
        )
      }
    }
    const onPointerUp = () => {
      if (!dragState) return
      const current = dragState
      if (current.mode === 'move') {
        const delta = Math.abs(current.previewStart - current.initialStart)
        if (delta > 1e-6) {
          const cmd = new SetClipInstanceStartTimeCommand({
            nodeId: current.nodeId,
            instanceId: current.instanceId,
            startTime: current.previewStart,
          })
          dispatch(cmd)
        }
      } else if (current.mode === 'resize-right') {
        const delta = Math.abs(current.previewSpeed - current.initialSpeed)
        if (delta > 1e-9) {
          // Reject zero speed
          const speedToSet =
            current.previewSpeed < MIN_CLIP_SPEED ? MIN_CLIP_SPEED : current.previewSpeed
          if (speedToSet >= MIN_CLIP_SPEED && speedToSet !== 0) {
            const cmd = new SetClipInstanceSpeedCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              speed: speedToSet,
            })
            dispatch(cmd)
          }
        }
      } else if (current.mode === 'resize-left') {
        const startDelta = Math.abs(current.previewStart - current.initialStart)
        const speedDelta = Math.abs(current.previewSpeed - current.initialSpeed)
        if (startDelta > 1e-6 || speedDelta > 1e-9) {
          const speedToSet =
            current.previewSpeed < MIN_CLIP_SPEED ? MIN_CLIP_SPEED : current.previewSpeed
          if (speedToSet >= MIN_CLIP_SPEED && speedToSet !== 0) {
            const startCmd = new SetClipInstanceStartTimeCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              startTime: Math.max(0, current.previewStart),
            })
            const speedCmd = new SetClipInstanceSpeedCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              speed: speedToSet,
            })
            const tx = new TransactionCommand([startCmd, speedCmd])
            dispatch(tx)
          }
        }
      }
      setDragState(null)
    }
    window.addEventListener('pointermove', onPointerMove as unknown as EventListener)
    window.addEventListener('pointerup', onPointerUp as unknown as EventListener)
    return () => {
      window.removeEventListener('pointermove', onPointerMove as unknown as EventListener)
      window.removeEventListener('pointerup', onPointerUp as unknown as EventListener)
    }
  }, [dragState, pps, gridSnapEnabled, snapCandidateTimes, dispatch])

  if (!open) return null

  const handleBackdropClick = () => {
    if (collectionCreateOpen) {
      setCollectionCreateOpen(false)
      return
    }
    if (editingCollectionId) {
      setEditingCollectionId(null)
      return
    }
    if (deleteConfirmCollectionId) {
      setDeleteConfirmCollectionId(null)
      return
    }
    if (dragState) {
      setDragState(null)
      return
    }
    if (orphanExtraction) {
      setOrphanExtraction(null)
      return
    }
    if (orphanContextMenu) {
      setOrphanContextMenu(null)
      return
    }
    if (orphanMarquee) {
      setOrphanMarquee(null)
      return
    }
    if (clipMenu) {
      setClipMenu(null)
      return
    }
    if (orphanScopeMessage) {
      setOrphanScopeMessage(null)
      return
    }
    if (editing) {
      restorePpsAndBack()
    } else {
      onClose()
    }
  }

  const editingClip: ClipDefinition | null = (() => {
    if (!editing) return null
    try {
      return engine.getClip(editing.clipId)
    } catch {
      return null
    }
  })()

  const editingNodeName = (() => {
    if (!editing) return ''
    try {
      return engine.getNode(editing.nodeId).name
    } catch {
      return editing.nodeId
    }
  })()

  const handleEdit = (clipId: string, nodeId: string) => {
    // save pps before drill-in
    const currentZoom = useTimelineViewStore.getState().zoomLevel
    setSavedZoom(currentZoom)
    setEditing({ clipId, nodeId })
    setClipMenu(null)
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={overlayLabel}
      data-testid="animation-manager-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="modal"
        data-testid="animation-manager-modal"
        style={{
          background: 'var(--color-bg, #ffffff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 760,
          maxWidth: 960,
          width: '92vw',
          minHeight: 520,
          maxHeight: '88vh',
          overflow: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16 }} data-testid="animation-manager-title">
            {editing && editingClip ? (
              <>
                <button
                  onClick={restorePpsAndBack}
                  data-testid="manager-back-button"
                  style={{
                    marginRight: 8,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg-elevated, #f5f5f5)',
                    cursor: 'pointer',
                  }}
                >
                  ← Back
                </button>
                <span data-testid="manager-editing-header">
                  Editing {editingClip.name} — {editingNodeName}
                </span>
              </>
            ) : parentNode ? (
              `Animation Manager — ${parentNode.name}`
            ) : (
              'Animation Manager'
            )}
          </h3>
          <button
            onClick={() => (editing ? restorePpsAndBack() : onClose())}
            data-testid="animation-manager-close"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg, #fff)',
              cursor: 'pointer',
            }}
          >
            {editing ? 'Back' : 'Close'}
          </button>
        </div>

        {/* Banner for shared clip */}
        {editing &&
          editingClip &&
          (() => {
            const uses = countClipUses(engine, editingClip.id)
            if (uses <= 1) return null
            return (
              <div
                data-testid="clip-editor-banner"
                style={{
                  fontSize: 12,
                  color: 'var(--color-warning-text, #7a4a00)',
                  background: 'var(--color-warning-bg, #fff3cd)',
                  border: '1px solid var(--color-warning-border, #ffecb5)',
                  padding: '6px 8px',
                  borderRadius: 4,
                }}
              >
                Edits affect all {uses} uses
              </div>
            )
          })()}

        {/* Tabs – hidden in editor */}
        {!editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              role="tablist"
              aria-label="Manager views"
              style={{
                display: 'flex',
                gap: 4,
                background: 'var(--color-bg-elevated, #f0f0f0)',
                borderRadius: 6,
                padding: 2,
                width: 'fit-content',
              }}
              data-testid="manager-tabs"
            >
              <button
                role="tab"
                aria-selected={activeTab === 'collections'}
                data-testid="manager-tab-collections"
                onClick={() => setActiveTab('collections')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: 'none',
                  background:
                    activeTab === 'collections' ? 'var(--color-accent, #7c5cff)' : 'transparent',
                  color: activeTab === 'collections' ? '#fff' : 'var(--color-text-muted, #666)',
                }}
              >
                Collections
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'clips'}
                data-testid="manager-tab-clips"
                onClick={() => setActiveTab('clips')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: 'none',
                  background:
                    activeTab === 'clips' ? 'var(--color-accent, #7c5cff)' : 'transparent',
                  color: activeTab === 'clips' ? '#fff' : 'var(--color-text-muted, #666)',
                }}
              >
                Clips
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'orphans'}
                data-testid="manager-tab-orphans"
                onClick={() => {
                  setActiveTab('orphans')
                  setOrphanScopeMessage(null)
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: 'none',
                  background:
                    activeTab === 'orphans' ? 'var(--color-accent, #7c5cff)' : 'transparent',
                  color: activeTab === 'orphans' ? '#fff' : 'var(--color-text-muted, #666)',
                }}
              >
                Orphans
              </button>
            </div>
            {activeTab === 'orphans' && (
              <button
                data-testid="orphan-add-to-clip-button"
                onClick={openOrphanExtraction}
                disabled={selectedOrphanIds.size === 0}
                title={
                  selectedOrphanIds.size === 0
                    ? 'Select orphan diamonds first'
                    : 'Add selected orphans to clip'
                }
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background: selectedOrphanIds.size > 0 ? 'var(--color-accent, #7c5cff)' : '#eee',
                  color: selectedOrphanIds.size > 0 ? '#fff' : '#999',
                  cursor: selectedOrphanIds.size > 0 ? 'pointer' : 'default',
                  fontSize: 12,
                  opacity: selectedOrphanIds.size > 0 ? 1 : 0.6,
                }}
              >
                Add to clip… {selectedOrphanIds.size > 0 ? `(${selectedOrphanIds.size})` : ''}
              </button>
            )}
            {activeTab === 'orphans' && selectedOrphanIds.size > 0 && (
              <span
                data-testid="orphan-selected-count"
                style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}
              >
                {selectedOrphanIds.size} selected
              </span>
            )}
            {activeTab === 'clips' && (
              <>
                <button
                  data-testid="manager-create-collection"
                  onClick={handleCreateCollection}
                  disabled={selectedClipIds.size === 0 || !!collectionBlockingError}
                  title={
                    selectedClipIds.size === 0
                      ? 'Select Clip Lanes first (Ctrl+click multi-select)'
                      : collectionBlockingError
                        ? collectionBlockingError
                        : `Create Collection from ${selectedClipIds.size} lane(s)`
                  }
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background:
                      selectedClipIds.size > 0 && !collectionBlockingError
                        ? 'var(--color-accent, #7c5cff)'
                        : '#eee',
                    color: selectedClipIds.size > 0 && !collectionBlockingError ? '#fff' : '#999',
                    cursor:
                      selectedClipIds.size > 0 && !collectionBlockingError ? 'pointer' : 'default',
                    fontSize: 12,
                    opacity: selectedClipIds.size > 0 ? 1 : 0.6,
                  }}
                >
                  Create Collection{selectedClipIds.size > 0 ? ` (${selectedClipIds.size})` : ''}
                </button>
                {selectedClipIds.size > 0 && (
                  <span
                    data-testid="clip-selected-count"
                    style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}
                  >
                    {selectedClipIds.size} selected
                    {collectionMissingSemantic.length > 0
                      ? ` · ${collectionMissingSemantic.length} missing semantic`
                      : ''}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {activeTab === 'orphans' && orphanScopeMessage && (
          <div
            data-testid="orphan-scope-message"
            style={{
              fontSize: 12,
              color: 'var(--color-error, #d00)',
              background: '#fff0f0',
              border: '1px solid #ffcccc',
              padding: '6px 8px',
              borderRadius: 4,
            }}
          >
            {orphanScopeMessage}
          </div>
        )}
        {/* Continuous validation banners (15-05): orphan + missing semantic, reusing export pattern */}
        {!editing && hasOrphanInSubtree && (
          <div
            className="panel-status panel-status--error"
            role="alert"
            data-testid="collection-orphan-error"
            style={{ marginBottom: 4, flexDirection: 'column', alignItems: 'stretch' }}
          >
            <p style={{ fontSize: 12, margin: 0 }}>
              {flatOrphanEntries.length} orphan keyframe(s) in hierarchy — fix before creating a
              collection:
            </p>
            <ul style={{ margin: '6px 0 0 16px', fontSize: 12, listStyle: 'disc' }}>
              {distinctOrphanNodes.map((n) => (
                <li key={n.id} style={{ marginBottom: 2 }}>
                  <button
                    onClick={() => {
                      useSelectionStore.getState().select(n.id)
                      setActiveTab('orphans')
                      notify(
                        `Selected "${n.name}" — resolve orphan keyframes in Orphans tab or Timeline`,
                      )
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--color-danger)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                    data-testid={`orphan-node-${n.id}`}
                    title="Select this node to fix orphan"
                  >
                    {n.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!editing && collectionMissingSemantic.length > 0 && (
          <div
            className="panel-status panel-status--error"
            role="alert"
            data-testid="collection-missing-semantic"
            style={{ marginBottom: 4, flexDirection: 'column', alignItems: 'stretch' }}
          >
            <p style={{ fontSize: 12, margin: 0 }}>
              {collectionMissingSemantic.length} selected clip(s) on nodes with no Semantic Name —
              fix before create:
            </p>
            <ul style={{ margin: '6px 0 0 16px', fontSize: 12, listStyle: 'disc' }}>
              {collectionMissingSemantic.map((m) => (
                <li key={m.instanceId} style={{ marginBottom: 2 }}>
                  <button
                    onClick={() => {
                      useSelectionStore.getState().select(m.nodeId)
                      notify(`Selected "${m.nodeName}" — set its Semantic Name in Inspector`)
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--color-danger)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                    data-testid={`missing-semantic-${m.nodeId}`}
                    title="Select this node to set Semantic Name"
                  >
                    {m.nodeName}
                  </button>
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: 6, fontSize: 11 }}>
                    clip:{' '}
                    {(() => {
                      try {
                        return engine.getClip(m.clipId).name
                      } catch {
                        return m.clipId
                      }
                    })()}
                  </span>
                </li>
              ))}
            </ul>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Set Semantic Name in Inspector → General → Semantic Name (e.g. left_hand)
            </span>
          </div>
        )}
        {collectionLocalError && !editingCollectionId && !collectionCreateOpen && (
          <div
            data-testid="collection-local-error"
            role="alert"
            style={{ color: 'var(--color-danger, red)', fontSize: 12 }}
          >
            {collectionLocalError}
          </div>
        )}

        {/* Editor sub-view */}
        {editing && editingClip ? (
          <ManagerClipEditor
            clip={editingClip}
            nodeId={editing.nodeId}
            pps={pps}
            onBack={restorePpsAndBack}
          />
        ) : activeTab === 'collections' ? (
          <div
            data-testid="manager-collections"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {collectionsForParent.length === 0 ? (
              <div
                data-testid="manager-collections-empty"
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-muted, #666)',
                  padding: 12,
                  border: '1px dashed var(--color-border, #ddd)',
                  borderRadius: 6,
                  textAlign: 'center',
                }}
              >
                No Clip Collections for "{parentNode?.name ?? 'parent'}". Select Clip Lanes in Clips
                tab → Create Collection.
              </div>
            ) : (
              <div
                style={{
                  border: '1px solid var(--color-border, #ddd)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {collectionsForParent.map((col) => (
                  <div
                    key={col.id}
                    data-testid={`manager-collection-${col.id}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      borderBottom: '1px solid var(--color-border, #eee)',
                      padding: '8px 12px',
                      gap: 6,
                      background: 'var(--color-bg-panel, #fff)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{ fontWeight: 600, fontSize: 13 }}
                        data-testid={`collection-name-${col.id}`}
                      >
                        {col.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                        {col.bindings.size} binding(s) · source:{' '}
                        {col.sourceNodeId
                          ? (() => {
                              try {
                                return engine.getNode(col.sourceNodeId!).name
                              } catch {
                                return col.sourceNodeId!.slice(0, 8)
                              }
                            })()
                          : '—'}
                      </span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button
                          data-testid={`collection-edit-${col.id}`}
                          onClick={() => openEditCollection(col.id)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: '1px solid var(--color-border, #ddd)',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          data-testid={`collection-delete-${col.id}`}
                          onClick={() => setDeleteConfirmCollectionId(col.id)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: '1px solid var(--color-danger, #c00)',
                            color: 'var(--color-danger, #c00)',
                            fontSize: 12,
                            cursor: 'pointer',
                            background: '#fff',
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                    <div
                      data-testid={`collection-bindings-${col.id}`}
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                    >
                      {[...col.bindings.entries()].map(([sem, clipId]) => {
                        let clipName: string
                        try {
                          clipName = engine.getClip(clipId).name
                        } catch {
                          clipName = clipId.slice(0, 8)
                        }
                        return (
                          <span
                            key={sem}
                            style={{
                              fontSize: 11,
                              fontFamily: 'monospace',
                              background: 'var(--color-bg, #fafafa)',
                              border: '1px solid var(--color-border, #ddd)',
                              borderRadius: 4,
                              padding: '2px 6px',
                            }}
                            data-testid={`collection-binding-${col.id}-${sem}`}
                          >
                            {sem} → {clipName}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : managerRows.length === 0 ? (
          <div
            data-testid="manager-empty"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted, #666)',
              padding: 12,
              border: '1px dashed var(--color-border, #ddd)',
              borderRadius: 6,
              textAlign: 'center',
            }}
          >
            No animated children under "{parentNode?.name ?? 'parent'}". Add keyframes or assign a
            clip to a descendant to see it here.
          </div>
        ) : (
          <div
            data-testid="manager-rows"
            ref={orphansContainerRef}
            onPointerDown={handleOrphansPointerDown}
            onContextMenu={
              activeTab === 'orphans'
                ? (e) => {
                    const target = e.target as HTMLElement
                    if (target.closest('[data-testid^="orphan-diamond"]')) return
                    e.preventDefault()
                    if (selectedOrphanIds.size > 0) {
                      setOrphanContextMenu({ x: e.clientX, y: e.clientY })
                    }
                  }
                : undefined
            }
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              overflow: 'hidden',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            {/* Column-like rows: group headers + animated params + clip lanes */}
            {managerRows.map((row) => {
              const isExpanded = expandedMap[row.node.id] ?? true
              const animatedParamCount = row.animatedParams.length
              // Compute clip lanes for this node (for clips tab)
              const getClip = (clipId: string) => {
                try {
                  return engine.getClip(clipId)
                } catch {
                  return null
                }
              }
              const previewOverrides =
                dragState && dragState.nodeId === row.node.id
                  ? new Map<string, { startTime: number; speed: number }>([
                      [
                        dragState.instanceId,
                        { startTime: dragState.previewStart, speed: dragState.previewSpeed },
                      ],
                    ])
                  : undefined
              const packedLanes = packClipLanesForNode(row.node, getClip, pps, previewOverrides)
              const trackCount =
                packedLanes.length > 0 ? Math.max(...packedLanes.map((l) => l.track)) + 1 : 0
              const lanesHeight = trackCount * CLIP_LANE_HEIGHT_PX
              // Container width: based on slide duration and max lane end
              const maxEnd = packedLanes.length > 0 ? Math.max(...packedLanes.map((l) => l.end)) : 0
              const slideDuration = activeSlide?.duration ?? 10
              const timelineWidth = Math.max(slideDuration, maxEnd + 1) * pps
              return (
                <div
                  key={row.node.id}
                  data-testid={`manager-row-${row.node.id}`}
                  style={{ borderBottom: '1px solid var(--color-border, #ddd)' }}
                >
                  <div
                    role="button"
                    aria-expanded={isExpanded}
                    data-testid={`manager-toggle-${row.node.id}`}
                    onClick={() =>
                      setExpandedMap((prev) => ({ ...prev, [row.node.id]: !isExpanded }))
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'var(--color-bg-elevated, #fafafa)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      paddingLeft: `${12 + row.depth * 16}px`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 16,
                        textAlign: 'center',
                        fontSize: 12,
                      }}
                    >
                      {isExpanded ? '−' : '+'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{row.node.name}</span>
                    {row.node.semanticName && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--color-text-muted, #666)',
                          marginLeft: 6,
                        }}
                        title={`Semantic: ${row.node.semanticName}`}
                      >
                        ({row.node.semanticName})
                      </span>
                    )}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 11,
                        color: 'var(--color-text-muted, #666)',
                      }}
                    >
                      {animatedParamCount} param{animatedParamCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ background: 'var(--color-bg-panel, #fff)' }}>
                      {/* Clip Lanes section – only when tab is clips */}
                      {activeTab === 'clips' && packedLanes.length > 0 && (
                        <div
                          data-testid={`manager-clip-lanes-${row.node.id}`}
                          style={{
                            position: 'relative',
                            height: lanesHeight > 0 ? lanesHeight : CLIP_LANE_HEIGHT_PX,
                            margin: '6px 12px 6px 32px',
                            border: '1px solid var(--color-border, #eee)',
                            borderRadius: 4,
                            background: 'var(--color-bg, #fafafa)',
                            overflowX: 'auto',
                            overflowY: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              position: 'relative',
                              width: `${timelineWidth}px`,
                              height: '100%',
                            }}
                          >
                            {packedLanes.map((lane) => {
                              const isSelectedSingle = selectedInstanceId === lane.instance.id
                              const isMultiSelected = selectedClipIds.has(lane.instance.id)
                              const isSelected = isMultiSelected || isSelectedSingle
                              const isDragging = dragState?.instanceId === lane.instance.id
                              const isEnabled = lane.instance.enabled
                              const isHighlighted = highlightedClipInstanceId === lane.instance.id
                              const barStyle: React.CSSProperties = {
                                position: 'absolute',
                                left: lane.left,
                                width: lane.width,
                                top: lane.track * CLIP_LANE_HEIGHT_PX + 2,
                                height: CLIP_LANE_BAR_HEIGHT_PX,
                                background: isHighlighted
                                  ? '#ffcc00'
                                  : isEnabled
                                    ? isSelected
                                      ? 'var(--color-accent, #7c5cff)'
                                      : '#b8a6ff'
                                    : '#e5e5e5',
                                border: isHighlighted
                                  ? '2px solid #b38f00'
                                  : isEnabled
                                    ? `1px solid ${isSelected ? '#4c1d95' : '#7c5cff'}`
                                    : '1px dashed #888',
                                borderRadius: 4,
                                opacity: isEnabled ? 1 : 0.5,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 8px',
                                boxSizing: 'border-box',
                                cursor: isEnabled ? (isDragging ? 'grabbing' : 'grab') : 'default',
                                zIndex: isHighlighted ? 999 : isMultiSelected ? 900 : lane.zIndex,
                                userSelect: 'none',
                                overflow: 'hidden',
                                boxShadow: isHighlighted
                                  ? '0 0 0 3px rgba(255,204,0,0.5)'
                                  : undefined,
                              }
                              const handleStyle = (
                                side: 'left' | 'right',
                              ): React.CSSProperties => ({
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                width: CLIP_HANDLE_WIDTH_PX,
                                ...(side === 'left' ? { left: 0 } : { right: 0 }),
                                cursor: 'ew-resize',
                                background: 'rgba(0,0,0,0.06)',
                                borderLeft:
                                  side === 'left' ? '1px solid rgba(0,0,0,0.15)' : undefined,
                                borderRight:
                                  side === 'right' ? '1px solid rgba(0,0,0,0.15)' : undefined,
                              })
                              const handlePointerDown = (
                                e: React.PointerEvent,
                                mode: 'resize-left' | 'resize-right',
                              ) => {
                                if (!isEnabled) return
                                if (e.button !== 0) return
                                e.preventDefault()
                                e.stopPropagation()
                                setSelectedInstanceId(lane.instance.id)
                                const rightEdge = lane.start + lane.visualDuration
                                setDragState({
                                  mode,
                                  nodeId: row.node.id,
                                  instanceId: lane.instance.id,
                                  clipId: lane.clip.id,
                                  clipDuration: lane.clip.duration,
                                  initialStart: lane.start,
                                  initialSpeed: lane.instance.speed,
                                  initialVisual: lane.visualDuration,
                                  rightEdge,
                                  startX: e.clientX,
                                  previewStart: lane.start,
                                  previewSpeed: lane.instance.speed,
                                  previewVisual: lane.visualDuration,
                                } as DragState)
                              }
                              const barPointerDown = (e: React.PointerEvent) => {
                                // If clicking on handle, ignore (handle already handled)
                                const target = e.target as HTMLElement
                                if (target.dataset.testid?.startsWith('clip-handle')) return
                                if (!isEnabled) {
                                  e.stopPropagation()
                                  setSelectedInstanceId(lane.instance.id)
                                  // still manage multi-select for disabled? keep single
                                  setSelectedClipIds(new Set([lane.instance.id]))
                                  setClipAnchorId(lane.instance.id)
                                  return
                                }
                                if (e.button !== 0) return
                                // Ctrl/Cmd/Shift indicates multi-select intent, not drag
                                if (e.ctrlKey || e.metaKey || e.shiftKey) return
                                e.preventDefault()
                                e.stopPropagation()
                                // Ensure clicked lane is in selection (single if not multi)
                                if (!selectedClipIds.has(lane.instance.id)) {
                                  setSelectedInstanceId(lane.instance.id)
                                  setSelectedClipIds(new Set([lane.instance.id]))
                                  setClipAnchorId(lane.instance.id)
                                } else {
                                  setSelectedInstanceId(lane.instance.id)
                                }
                                const rightEdge = lane.start + lane.visualDuration
                                setDragState({
                                  mode: 'move',
                                  nodeId: row.node.id,
                                  instanceId: lane.instance.id,
                                  clipId: lane.clip.id,
                                  clipDuration: lane.clip.duration,
                                  initialStart: lane.start,
                                  initialSpeed: lane.instance.speed,
                                  initialVisual: lane.visualDuration,
                                  rightEdge,
                                  startX: e.clientX,
                                  previewStart: lane.start,
                                  previewSpeed: lane.instance.speed,
                                  previewVisual: lane.visualDuration,
                                } as DragState)
                              }
                              const handleContextMenu = (e: React.MouseEvent) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setClipMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  clipId: lane.clip.id,
                                  nodeId: row.node.id,
                                  instanceId: lane.instance.id,
                                })
                              }
                              return (
                                <div
                                  key={lane.instance.id}
                                  data-testid={`clip-lane-${row.node.id}-${lane.instance.id}`}
                                  data-clip-instance-id={lane.instance.id}
                                  data-track={String(lane.track)}
                                  data-start={String(lane.start)}
                                  data-visual={String(lane.visualDuration)}
                                  data-enabled={String(isEnabled)}
                                  data-selected={String(isSelected)}
                                  data-multiselected={String(isMultiSelected)}
                                  data-highlighted={String(isHighlighted)}
                                  title={`${lane.clip.name} — start ${lane.start.toFixed(2)}s visual ${lane.visualDuration.toFixed(2)}s speed ${lane.instance.speed.toFixed(3)}${isEnabled ? '' : ' (disabled)'}${isHighlighted ? ' (new)' : ''}${isMultiSelected ? ' (multi)' : ''}`}
                                  style={barStyle}
                                  onPointerDown={barPointerDown}
                                  onContextMenu={handleContextMenu}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (isHighlighted) setHighlightedClipInstanceId(null)
                                    // Multi-select handling (Ctrl/Cmd toggle, Shift range)
                                    const target = e.target as HTMLElement
                                    if (target.dataset.testid?.startsWith('clip-handle')) return
                                    handleClipLaneSelect(
                                      e as unknown as React.MouseEvent,
                                      lane.instance.id,
                                    )
                                  }}
                                >
                                  <span
                                    data-testid={`clip-lane-label-${lane.instance.id}`}
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 500,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      flex: 1,
                                      pointerEvents: 'none',
                                      color: isEnabled ? (isSelected ? '#fff' : '#2e2e2e') : '#666',
                                    }}
                                  >
                                    {lane.clip.name}
                                  </span>
                                  {isEnabled && (
                                    <>
                                      <div
                                        data-testid={`clip-handle-left-${lane.instance.id}`}
                                        data-handle="left"
                                        style={handleStyle('left')}
                                        onPointerDown={(e) => handlePointerDown(e, 'resize-left')}
                                      />
                                      <div
                                        data-testid={`clip-handle-right-${lane.instance.id}`}
                                        data-handle="right"
                                        style={handleStyle('right')}
                                        onPointerDown={(e) => handlePointerDown(e, 'resize-right')}
                                      />
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {activeTab === 'clips' &&
                        packedLanes.length === 0 &&
                        row.node.clipInstances.length > 0 && (
                          <div
                            data-testid={`manager-clip-lanes-empty-${row.node.id}`}
                            style={{
                              padding: '6px 12px 6px 32px',
                              fontSize: 11,
                              color: 'var(--color-text-muted, #888)',
                            }}
                          >
                            No clip lanes (missing clip definition)
                          </div>
                        )}
                      {/* Animated params list – always rendered when expanded (for compatibility), scrollable */}
                      <div
                        data-testid={`manager-params-${row.node.id}`}
                        style={{ background: 'var(--color-bg-panel, #fff)' }}
                      >
                        {row.animatedParams.length === 0 ? (
                          <div
                            style={{
                              padding: '6px 12px 6px 32px',
                              fontSize: 12,
                              color: 'var(--color-text-muted, #666)',
                            }}
                          >
                            No animated params (clip without channels)
                          </div>
                        ) : (
                          row.animatedParams.map((param) => {
                            const orphanKeyframes = activeSlide
                              ? getOrphanKeyframes(row.node, activeSlide, param)
                              : []
                            const showDiamonds =
                              activeTab === 'orphans' && orphanKeyframes.length > 0
                            return (
                              <div
                                key={`${row.node.id}-${param.kind}-${param.key}`}
                                data-testid={`manager-param-${row.node.id}-${param.key}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 12,
                                  padding: '6px 12px 6px 32px',
                                  borderTop: '1px solid var(--color-border, #eee)',
                                  fontSize: 12,
                                }}
                              >
                                <span style={{ flex: 1 }}>{param.label}</span>
                                {activeTab !== 'orphans' && (
                                  <span
                                    style={{ fontSize: 10, color: 'var(--color-text-muted, #888)' }}
                                    data-testid={`manager-param-kind-${row.node.id}-${param.key}`}
                                  >
                                    {param.kind}
                                  </span>
                                )}
                                {showDiamonds && (
                                  <span
                                    style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                                    data-testid={`manager-orphan-diamonds-${row.node.id}-${param.key}`}
                                  >
                                    {orphanKeyframes.map((kf) => {
                                      const entry = flatOrphanEntries.find(
                                        (x) => x.keyframeId === kf.id,
                                      )
                                      const isSelected = selectedOrphanIds.has(kf.id)
                                      return (
                                        <span
                                          key={kf.id}
                                          data-testid={`orphan-diamond-${kf.id}`}
                                          data-keyframe-id={kf.id}
                                          data-node-id={row.node.id}
                                          title={`orphan keyframe at ${kf.time}s${isSelected ? ' (selected)' : ''}`}
                                          aria-label={`orphan keyframe at ${kf.time}s`}
                                          aria-selected={isSelected}
                                          onClick={(e) => {
                                            if (!entry) return
                                            handleOrphanDiamondClick(e, entry)
                                          }}
                                          onContextMenu={(e) => {
                                            if (!entry) return
                                            handleOrphanContextMenu(e, entry)
                                          }}
                                          style={{
                                            width: 10,
                                            height: 10,
                                            background: isSelected
                                              ? '#ffcc00'
                                              : 'var(--color-accent, #7c5cff)',
                                            border: isSelected
                                              ? '2px solid #000'
                                              : '1px solid #fff',
                                            transform: 'rotate(45deg)',
                                            display: 'inline-block',
                                            flexShrink: 0,
                                            cursor: 'pointer',
                                            boxShadow: isSelected
                                              ? '0 0 0 2px rgba(255,204,0,0.4)'
                                              : undefined,
                                            outline: isSelected ? '1px solid #000' : undefined,
                                          }}
                                        />
                                      )
                                    })}
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: 'var(--color-text-muted, #666)',
                                        marginLeft: 4,
                                      }}
                                    >
                                      {orphanKeyframes.length} orphan
                                    </span>
                                  </span>
                                )}
                                {activeTab === 'orphans' &&
                                  !showDiamonds &&
                                  orphanKeyframes.length === 0 && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: 'var(--color-text-muted, #999)',
                                      }}
                                      data-testid={`manager-no-orphan-${row.node.id}-${param.key}`}
                                    >
                                      no orphan
                                    </span>
                                  )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Clip lane context menu – Edit */}
        {clipMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
              onClick={() => setClipMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setClipMenu(null)
              }}
            />
            <div
              role="menu"
              data-testid="clip-lane-context-menu"
              style={{
                position: 'fixed',
                left: clipMenu.x,
                top: clipMenu.y,
                background: 'var(--color-bg, #fff)',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 6,
                padding: 4,
                zIndex: 1100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: 140,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                role="menuitem"
                data-testid="clip-lane-edit"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                onClick={() => handleEdit(clipMenu.clipId, clipMenu.nodeId)}
              >
                Edit
              </button>
            </div>
          </>
        )}

        {/* Orphan context menu – Add to clip... */}
        {orphanContextMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
              onClick={() => setOrphanContextMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setOrphanContextMenu(null)
              }}
            />
            <div
              role="menu"
              data-testid="orphan-context-menu"
              style={{
                position: 'fixed',
                left: orphanContextMenu.x,
                top: orphanContextMenu.y,
                background: 'var(--color-bg, #fff)',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 6,
                padding: 4,
                zIndex: 1100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: 160,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                role="menuitem"
                data-testid="orphan-add-to-clip"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                onClick={openOrphanExtraction}
              >
                Add to clip… {selectedOrphanIds.size > 0 ? `(${selectedOrphanIds.size})` : ''}
              </button>
            </div>
          </>
        )}

        {/* Orphan marquee overlay */}
        {orphanMarquee?.active && (
          <div
            data-testid="orphan-marquee"
            style={{
              position: 'fixed',
              left: Math.min(orphanMarquee.startX, orphanMarquee.curX),
              top: Math.min(orphanMarquee.startY, orphanMarquee.curY),
              width: Math.abs(orphanMarquee.curX - orphanMarquee.startX),
              height: Math.abs(orphanMarquee.curY - orphanMarquee.startY),
              border: '1px solid var(--color-accent, #7c5cff)',
              background: 'rgba(124,92,255,0.15)',
              pointerEvents: 'none',
              zIndex: 1100,
            }}
          />
        )}

        {/* Filtered ClipExtractionModal for orphans */}
        {orphanExtraction &&
          (() => {
            const nodeId = orphanExtraction.nodeId
            const node = (() => {
              try {
                return engine.getNode(nodeId)
              } catch {
                return null
              }
            })()
            const allowedClipIds = node
              ? [...new Set(node.clipInstances.map((inst) => inst.clipId))]
              : []
            const defaultName = nextClipNameForNode(orphanExtraction.nodeName, engine.clips)
            const defaultDuration = '7'
            const defaultCategory = orphanExtraction.semanticName?.trim()
              ? orphanExtraction.semanticName.trim()
              : 'extracted'
            return (
              <ClipExtractionModal
                keyframes={orphanExtraction.keyframes}
                allowedClipIds={allowedClipIds}
                initialName={defaultName}
                initialDuration={defaultDuration}
                initialCategory={defaultCategory}
                onClose={() => setOrphanExtraction(null)}
                onSuccess={({ mode, clipId, selStart }) => {
                  if (mode === 'new') {
                    // Create instance at selStart speed=1, auto-switch to Clips tab and highlight
                    const assignResult = dispatch(
                      new AssignClipCommand({ nodeId, clipId, startTime: selStart, speed: 1 }),
                    )
                    if (!assignResult.ok) {
                      notify(assignResult.error.message)
                      return
                    }
                    const instanceId = (assignResult.inverse as { instanceId: string }).instanceId
                    // Merge ExtractToClip + AssignClip into single undo entry (one gesture)
                    try {
                      undoStack.mergeLastAsTransaction(2)
                    } catch {
                      /* ignore */
                    }
                    setActiveTab('clips')
                    setHighlightedClipInstanceId(instanceId)
                    setSelectedInstanceId(instanceId)
                    setSelectedOrphanIds(new Set())
                    setOrphanAnchorId(null)
                  } else {
                    // Existing path: no new instance, clear selection but stay on orphans
                    setSelectedOrphanIds(new Set())
                    setOrphanAnchorId(null)
                  }
                }}
              />
            )
          })()}

        {/* Create ClipCollection modal (15-05) – subset-pointed */}
        {collectionCreateOpen && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Create Clip Collection"
            data-testid="create-collection-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setCollectionCreateOpen(false)}
          >
            <div
              className="modal"
              style={{
                background: 'var(--color-bg, #fff)',
                borderRadius: 8,
                padding: 16,
                minWidth: 460,
                maxWidth: 600,
                maxHeight: '80vh',
                overflowY: 'auto',
                border: '1px solid var(--color-border, #ddd)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 12px' }}>Create Clip Collection</h3>
              <div
                style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', marginBottom: 8 }}
              >
                Hierarchy: <strong>{parentNode?.name ?? parentNodeId}</strong> ·{' '}
                {selectedClipIds.size} lane(s) selected
              </div>
              <div
                style={{ fontSize: 11, color: '#666', marginBottom: 8 }}
                data-testid="create-collection-preview-info"
              >
                {collectionBindingsPreview.length} binding(s) preview · {selectedClipIds.size}{' '}
                selected
              </div>
              {/* Orphan blocking */}
              {hasOrphanInSubtree && (
                <div
                  className="panel-status panel-status--error"
                  role="alert"
                  data-testid="create-collection-orphan-error"
                  style={{ marginBottom: 8 }}
                >
                  <p style={{ fontSize: 12, margin: 0 }}>
                    Cannot create: {flatOrphanEntries.length} orphan keyframe(s) in hierarchy.
                  </p>
                  <ul style={{ margin: '6px 0 0 16px', fontSize: 12, listStyle: 'disc' }}>
                    {distinctOrphanNodes.map((n) => (
                      <li key={n.id}>
                        <button
                          onClick={() => {
                            useSelectionStore.getState().select(n.id)
                            setActiveTab('orphans')
                            setCollectionCreateOpen(false)
                            notify(`Selected "${n.name}" — resolve orphans before creating`)
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'var(--color-danger)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                          data-testid={`create-orphan-${n.id}`}
                        >
                          {n.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Missing semantic blocking */}
              {collectionMissingSemantic.length > 0 && (
                <div
                  className="panel-status panel-status--error"
                  role="alert"
                  data-testid="create-collection-missing-semantic"
                  style={{ marginBottom: 8, flexDirection: 'column', alignItems: 'stretch' }}
                >
                  <p style={{ fontSize: 12, margin: 0 }}>
                    {collectionMissingSemantic.length} selected node(s) with no Semantic Name:
                  </p>
                  <ul style={{ margin: '6px 0 0 16px', fontSize: 12, listStyle: 'disc' }}>
                    {collectionMissingSemantic.map((m) => (
                      <li key={m.instanceId}>
                        <button
                          onClick={() => {
                            useSelectionStore.getState().select(m.nodeId)
                            setCollectionCreateOpen(false)
                            notify(`Selected "${m.nodeName}" — set Semantic Name in Inspector`)
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'var(--color-danger)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                          data-testid={`create-missing-${m.nodeId}`}
                        >
                          {m.nodeName}
                        </button>
                        <span
                          style={{ color: 'var(--color-text-muted)', marginLeft: 6, fontSize: 11 }}
                        >
                          clip:{' '}
                          {(() => {
                            try {
                              return engine.getClip(m.clipId).name
                            } catch {
                              return m.clipId
                            }
                          })()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {collectionBindingsPreview.length > 0 &&
                collectionMissingSemantic.length === 0 &&
                !hasOrphanInSubtree && (
                  <div
                    style={{
                      maxHeight: 160,
                      overflowY: 'auto',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      marginBottom: 8,
                    }}
                    data-testid="create-collection-bindings-preview"
                  >
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg-elevated)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px' }}>Semantic Name</th>
                          <th style={{ padding: '6px 8px' }}>Clip</th>
                        </tr>
                      </thead>
                      <tbody>
                        {collectionBindingsPreview.map((b) => (
                          <tr
                            key={b.semanticName}
                            style={{ borderTop: '1px solid var(--color-border)' }}
                          >
                            <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                              {b.semanticName}
                            </td>
                            <td style={{ padding: '6px 8px' }}>{b.clipName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                Collection name
                <input
                  value={collectionNameDraft}
                  onChange={(e) => setCollectionNameDraft(e.target.value)}
                  placeholder="My Collection"
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="create-collection-name-input"
                  autoFocus
                />
              </label>
              {collectionLocalError && (
                <div
                  data-testid="create-collection-local-error"
                  role="alert"
                  style={{ color: 'var(--color-danger, red)', fontSize: 12, marginBottom: 8 }}
                >
                  {collectionLocalError}
                </div>
              )}
              {collectionBlockingError && !collectionLocalError && (
                <div
                  data-testid="create-collection-blocking-error"
                  role="alert"
                  style={{ color: 'var(--color-danger, red)', fontSize: 12, marginBottom: 8 }}
                >
                  {collectionBlockingError}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => {
                    setCollectionCreateOpen(false)
                    setCollectionLocalError(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                  data-testid="create-collection-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmCreateCollection}
                  disabled={!canCreateCollection}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: canCreateCollection ? '#7c5cff' : '#9a9a9a',
                    color: '#fff',
                    cursor: canCreateCollection ? 'pointer' : 'not-allowed',
                  }}
                  data-testid="create-collection-confirm"
                  title={
                    !canCreateCollection && collectionBlockingError
                      ? collectionBlockingError
                      : undefined
                  }
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit ClipCollection modal */}
        {editingCollectionId && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Edit Clip Collection"
            data-testid="edit-collection-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setEditingCollectionId(null)}
          >
            <div
              className="modal"
              style={{
                background: 'var(--color-bg, #fff)',
                borderRadius: 8,
                padding: 16,
                minWidth: 520,
                maxWidth: 640,
                maxHeight: '80vh',
                overflowY: 'auto',
                border: '1px solid var(--color-border, #ddd)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 12px' }}>Edit Clip Collection</h3>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                Collection name
                <input
                  value={editingNameDraft}
                  onChange={(e) => setEditingNameDraft(e.target.value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="edit-collection-name-input"
                />
              </label>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Bindings (semanticName → clipId)
                </div>
                <div
                  data-testid="edit-collection-bindings"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: 240,
                    overflowY: 'auto',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    padding: 8,
                  }}
                >
                  {Object.entries(editingBindingsDraft).length === 0 && (
                    <div style={{ fontSize: 12, color: '#888' }}>No bindings</div>
                  )}
                  {Object.entries(editingBindingsDraft).map(([sem, clipId]) => {
                    let clipName: string
                    try {
                      clipName = engine.getClip(clipId).name
                    } catch {
                      clipName = clipId.slice(0, 8)
                    }
                    return (
                      <div
                        key={sem}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        data-testid={`edit-binding-${sem}`}
                      >
                        <span style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }}>
                          {sem} → {clipName} ({clipId.slice(0, 6)})
                        </span>
                        <span style={{ fontSize: 11, color: '#666' }}>{clipId.slice(0, 8)}</span>
                        <button
                          onClick={() => {
                            const next = { ...editingBindingsDraft }
                            delete next[sem]
                            setEditingBindingsDraft(next)
                          }}
                          style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid #c00',
                            color: '#c00',
                            fontSize: 11,
                            cursor: 'pointer',
                            background: '#fff',
                          }}
                          data-testid={`edit-binding-remove-${sem}`}
                        >
                          Remove
                        </button>
                      </div>
                    )
                  })}
                </div>
                <AddBindingRow
                  clips={engine.clips}
                  onAdd={(sem, clipId) => {
                    if (!sem.trim() || !clipId) {
                      setCollectionLocalError('Semantic and clip required')
                      return
                    }
                    if (editingBindingsDraft[sem.trim()]) {
                      setCollectionLocalError(`Binding "${sem.trim()}" already exists`)
                      return
                    }
                    try {
                      engine.getClip(clipId)
                    } catch {
                      setCollectionLocalError('Clip not found')
                      return
                    }
                    setEditingBindingsDraft({ ...editingBindingsDraft, [sem.trim()]: clipId })
                    setCollectionLocalError(null)
                  }}
                />
              </div>
              {collectionLocalError && (
                <div
                  data-testid="edit-collection-local-error"
                  role="alert"
                  style={{ color: 'var(--color-danger, red)', fontSize: 12, marginBottom: 8 }}
                >
                  {collectionLocalError}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => {
                    setEditingCollectionId(null)
                    setCollectionLocalError(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                  data-testid="edit-collection-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmEditCollection}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: '#7c5cff',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                  data-testid="edit-collection-confirm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {deleteConfirmCollectionId && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete collection"
            data-testid="delete-collection-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setDeleteConfirmCollectionId(null)}
          >
            <div
              className="modal"
              style={{
                background: 'var(--color-bg, #fff)',
                borderRadius: 8,
                padding: 16,
                minWidth: 360,
                border: '1px solid var(--color-border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p style={{ fontSize: 13, margin: '0 0 12px' }}>
                Delete collection "
                {(() => {
                  try {
                    return engine.getClipCollection(deleteConfirmCollectionId).name
                  } catch {
                    return deleteConfirmCollectionId.slice(0, 8)
                  }
                })()}
                "?
                <br />
                <span style={{ fontSize: 11, color: '#666' }}>
                  Already-placed lanes remain as plain ClipInstances (no cascading delete).
                </span>
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setDeleteConfirmCollectionId(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="delete-collection-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteCollection(deleteConfirmCollectionId)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid #c00',
                    background: '#c00',
                    color: '#fff',
                  }}
                  data-testid="delete-collection-confirm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer hint */}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted, #888)' }}>
          Press Esc to close{editing ? ' (Esc drills back first)' : ''} • Click backdrop to close •
          Filtered to animated descendants only (pre-order)
        </div>
      </div>
    </div>
  )
}

function AddBindingRow({
  clips,
  onAdd,
}: {
  clips: readonly ClipDefinition[]
  onAdd: (semanticName: string, clipId: string) => void
}) {
  const [sem, setSem] = useState('')
  const [clipId, setClipId] = useState('')
  return (
    <div
      style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}
      data-testid="add-binding-row"
    >
      <input
        placeholder="semanticName (e.g. left_hand)"
        value={sem}
        onChange={(e) => setSem(e.target.value)}
        style={{
          flex: 1,
          padding: '4px 6px',
          borderRadius: 4,
          border: '1px solid var(--color-border)',
          fontSize: 12,
        }}
        data-testid="add-binding-semantic-input"
      />
      <select
        value={clipId}
        onChange={(e) => setClipId(e.target.value)}
        style={{
          flex: 1,
          padding: '4px 6px',
          borderRadius: 4,
          border: '1px solid var(--color-border)',
          fontSize: 12,
        }}
        data-testid="add-binding-clip-select"
      >
        <option value="">— select clip —</option>
        {clips.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.id.slice(0, 6)})
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          onAdd(sem, clipId)
          if (sem.trim() && clipId) {
            setSem('')
            setClipId('')
          }
        }}
        style={{
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid var(--color-border)',
          fontSize: 12,
          cursor: 'pointer',
        }}
        data-testid="add-binding-confirm"
      >
        Add
      </button>
    </div>
  )
}

function ManagerClipEditor({
  clip,
  nodeId,
  pps,
}: {
  clip: ClipDefinition
  nodeId: string
  pps: number
  onBack: () => void
}) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((s) => s.notify)
  const [tick, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

  // Force re-evaluation when clip mutates via engine events (tick)
  const rows = useMemo(() => {
    void tick
    return clipChannelRows(clip)
  }, [clip, tick])
  const clipDuration = clip.duration
  const [pickerOpen, setPickerOpen] = useState(false)
  const [diamondMenu, setDiamondMenu] = useState<{
    x: number
    y: number
    keyframeId: string
    row: ClipEditorRow
  } | null>(null)
  const [dragInfo, setDragInfo] = useState<{
    keyframeId: string
    row: ClipEditorRow
    startX: number
    originalNormalized: number
    originalLocal: number
  } | null>(null)
  const timeAreaRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const animatableParams = useMemo(() => {
    try {
      return engine.getAnimatableParameters(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId])

  const contentWidth = Math.max(760, clipDuration * pps + 80)
  const editorPps = pps // clip-local; spec says 0..duration domain

  // Duration rescale – only in editor
  const handleDurationChange = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return
    const result = dispatch(new SetClipDurationCommand({ clipId: clip.id, duration: value }))
    if (!result.ok) notify(result.error.message)
  }

  const handleAddChannel = (
    property: import('../../engine/animationProperties').AnimationProperty,
  ) => {
    setPickerOpen(false)
    const result = dispatch(new AddClipChannelCommand({ clipId: clip.id, channel: { property } }))
    if (!result.ok) notify(result.error.message)
  }

  const handleAddKeyframe = (row: ClipEditorRow) => {
    // add at normalized 0.5 (local 0.5*duration = mid) for uniform only
    if (row.kind !== 'clipChannel') {
      notify('Only uniform channels support adding keyframes in this editor slice')
      return
    }
    const time = 0.5 // normalized
    const result = dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId: clip.id, channel: row.channel },
        time,
        value: 0,
      }),
    )
    if (!result.ok) notify(result.error.message)
  }

  const handleDeleteKeyframe = () => {
    if (!diamondMenu) return
    const { keyframeId, row } = diamondMenu
    setDiamondMenu(null)
    if (row.kind !== 'clipChannel') {
      notify('Only uniform channels support delete in this slice')
      return
    }
    const result = dispatch(
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: row.channel },
        keyframeIds: [keyframeId],
      }),
    )
    if (!result.ok) notify(result.error.message)
  }

  // Diamond drag handling – move only for uniform channels
  useEffect(() => {
    if (!dragInfo) return
    const onMove = (e: PointerEvent) => {
      const cur = dragInfo
      if (!cur || cur.row.kind !== 'clipChannel') return
      const deltaPx = e.clientX - cur.startX
      const deltaLocal = deltaPx / editorPps
      const newLocal = cur.originalLocal + deltaLocal
      const clampedLocal = Math.max(0, Math.min(newLocal, clipDuration))
      const newNormalized = clipDuration > 0 ? clampedLocal / clipDuration : 0
      // preview via DOM direct mutation
      const el = document.querySelector(
        `[data-keyframe-id="${cur.keyframeId}"]`,
      ) as HTMLElement | null
      if (el) {
        el.style.left = `${clampedLocal * editorPps}px`
      }
      // store preview in state for commit (attach to ref)
      ;(cur as unknown as { previewNormalized: number }).previewNormalized = newNormalized
    }
    const onUp = () => {
      const cur = dragInfo
      setDragInfo(null)
      if (!cur || cur.row.kind !== 'clipChannel') return
      const preview = (cur as unknown as { previewNormalized?: number }).previewNormalized
      if (preview === undefined || Math.abs(preview - cur.originalNormalized) < 1e-6) return
      const result = dispatch(
        new MoveClipKeyframesCommand({
          target: {
            kind: 'clip',
            clipId: clip.id,
            channel: (cur.row as Extract<ClipEditorRow, { kind: 'clipChannel' }>).channel,
          },
          moves: [{ keyframeId: cur.keyframeId, newTime: preview }],
        }),
      )
      if (!result.ok) notify(result.error.message)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragInfo, editorPps, clipDuration, clip.id, dispatch, notify])

  // Helper to get keyframes for a row
  const getKeyframesForRow = (
    row: ClipEditorRow,
  ): readonly import('../../engine/keyframe').Keyframe[] => {
    try {
      const c = engine.getClip(clip.id)
      if (row.kind === 'clipChannel') return c.getChannelKeyframes(row.channel)
      if (row.kind === 'clipVisible') return c.getVisibleKeyframes()
      if (row.kind === 'clipMorph') return c.getMorphKeyframes()
      if (row.kind === 'clipCircle') return c.getCircleKeyframes(row.property)
      if (row.kind === 'clipShadow') return c.getShadowChannelKeyframes(row.property)
      if (row.kind === 'clipMaterial') return c.getMaterialChannelKeyframes(row.parameter)
      return []
    } catch {
      return []
    }
  }

  const handleDiamondPointerDown = (
    e: React.PointerEvent,
    row: ClipEditorRow,
    kf: import('../../engine/keyframe').Keyframe,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (row.kind !== 'clipChannel') return // only uniform draggable in this slice
    const normalized = kf.time
    const local = normalized * clipDuration
    setDragInfo({
      keyframeId: kf.id,
      row,
      startX: e.clientX,
      originalNormalized: normalized,
      originalLocal: local,
    })
  }

  const handleDiamondContextMenu = (e: React.MouseEvent, row: ClipEditorRow, kfId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDiamondMenu({ x: e.clientX, y: e.clientY, keyframeId: kfId, row })
  }

  const handleChannelContextMenu = (e: React.MouseEvent, row: ClipEditorRow) => {
    e.preventDefault()
    if (row.kind !== 'clipChannel') return
    // Could show remove channel menu – for now we expose remove via state?
    // Simple: right-click offers remove
    const shouldRemove = window.confirm(`Remove channel ${row.label}?`)
    if (shouldRemove) {
      const result = dispatch(
        new RemoveClipChannelCommand({ clipId: clip.id, channel: row.channel }),
      )
      if (!result.ok) notify(result.error.message)
    }
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="clip-editor-empty"
        style={{
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 6,
          padding: 24,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div
          style={{ fontSize: 13, color: 'var(--color-text-muted, #666)' }}
          data-testid="clip-editor-empty-text"
        >
          No channels — + Add Channel
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            data-testid="clip-editor-add-channel"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg-elevated, #f5f5f5)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            + Add Channel
          </button>
          {pickerOpen && (
            <ClipAddChannelPicker
              clip={clip}
              parameters={animatableParams}
              onSelect={handleAddChannel}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="clip-editor-subview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flex: 1,
      }}
    >
      {/* Duration control – only in editor */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 8px',
          background: 'var(--color-bg-elevated, #fafafa)',
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 6,
        }}
        data-testid="clip-editor-duration-row"
      >
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Duration
          <input
            type="number"
            min={0}
            step={0.1}
            value={clipDuration}
            onChange={(e) => handleDurationChange(Number(e.target.value))}
            data-testid="clip-duration-input"
            style={{
              width: 80,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              fontSize: 12,
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>seconds</span>
        </label>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #888)', marginLeft: 'auto' }}>
          Clip-local time 0..{clipDuration.toFixed(2)}s • diamonds = normalized × duration
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 6,
          overflow: 'hidden',
          minHeight: 360,
          flex: 1,
        }}
      >
        {/* Left headers */}
        <div
          style={{
            width: TRACK_HEADER_WIDTH,
            flexShrink: 0,
            background: 'var(--color-bg-elevated, #fafafa)',
            borderRight: '1px solid var(--color-border, #ddd)',
            overflowY: 'auto',
          }}
          data-testid="clip-editor-tracks"
        >
          <div
            style={{
              height: 28,
              borderBottom: '1px solid var(--color-border, #ddd)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              fontSize: 11,
              color: 'var(--color-text-muted, #666)',
              fontWeight: 600,
            }}
          >
            CHANNELS
          </div>
          {rows.map((row) => {
            const key =
              row.kind === 'clipChannel'
                ? row.channel
                : row.kind === 'clipCircle'
                  ? (row as Extract<ClipEditorRow, { kind: 'clipCircle' }>).property
                  : row.kind === 'clipShadow'
                    ? (row as Extract<ClipEditorRow, { kind: 'clipShadow' }>).property
                    : row.kind === 'clipMaterial'
                      ? (row as Extract<ClipEditorRow, { kind: 'clipMaterial' }>).parameter
                      : row.kind === 'clipVisible'
                        ? 'visible'
                        : 'clipMorph'
            const testId =
              row.kind === 'clipChannel'
                ? `clip-editor-row-${row.channel}`
                : `clip-editor-row-${row.kind}-${key}`
            return (
              <div
                key={`${row.kind}-${key}-${row.rowIndex}`}
                data-testid={testId}
                data-row-kind={row.kind}
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  borderBottom: '1px solid var(--color-border, #eee)',
                  fontSize: 12,
                  gap: 6,
                }}
                onContextMenu={(e) => handleChannelContextMenu(e, row)}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.label}
                </span>
                {row.kind === 'clipChannel' && (
                  <button
                    title="Add keyframe at 0.5 normalized"
                    onClick={() => handleAddKeyframe(row)}
                    data-testid={`clip-editor-add-kf-${(row as Extract<ClipEditorRow, { kind: 'clipChannel' }>).channel}`}
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      borderRadius: 4,
                      border: '1px solid var(--color-border, #ddd)',
                      background: 'var(--color-bg, #fff)',
                      cursor: 'pointer',
                    }}
                  >
                    + KF
                  </button>
                )}
              </div>
            )
          })}
          <div
            style={{
              height: ROW_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              position: 'relative',
            }}
            data-testid="clip-editor-add-row"
          >
            <button
              onClick={() => setPickerOpen((v) => !v)}
              data-testid="clip-editor-add-channel-2"
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted, #666)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              + Add Channel
            </button>
            {pickerOpen && (
              <ClipAddChannelPicker
                clip={clip}
                parameters={animatableParams}
                onSelect={handleAddChannel}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Right lanes */}
        <div
          ref={scrollerRef}
          style={{ flex: 1, overflow: 'auto', position: 'relative' }}
          data-testid="clip-editor-scroller"
        >
          <div style={{ width: contentWidth, position: 'relative' }}>
            <div
              ref={timeAreaRef}
              style={{
                position: 'relative',
                height: 28,
                borderBottom: '1px solid var(--color-border, #ddd)',
                background: 'var(--color-bg, #fff)',
                userSelect: 'none',
              }}
              data-testid="clip-editor-ruler"
            >
              {/* simple ticks 0..duration */}
              {Array.from({ length: Math.ceil(clipDuration) + 1 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: i * editorPps,
                    top: 0,
                    bottom: 0,
                    borderLeft: '1px solid var(--color-border, #ddd)',
                    fontSize: 10,
                    color: 'var(--color-text-muted, #666)',
                    paddingLeft: 4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {i}s
                </div>
              ))}
            </div>
            <div
              style={{
                position: 'relative',
                height: rows.length * ROW_HEIGHT,
                width: contentWidth,
                background: 'var(--color-bg-panel, #fff)',
              }}
              data-testid="clip-editor-lanes"
            >
              {rows.map((row, idx) => {
                const kfs = getKeyframesForRow(row)
                return (
                  <div
                    key={`${row.kind}-${idx}`}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: idx * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                      borderBottom: '1px solid var(--color-border, #eee)',
                    }}
                    data-testid={`clip-editor-lane-${row.kind}-${idx}`}
                  >
                    {kfs.map((kf) => {
                      const left = kf.time * clipDuration * editorPps
                      return (
                        <div
                          key={kf.id}
                          data-keyframe-id={kf.id}
                          data-testid={`clip-diamond-${kf.id}`}
                          title={`kf ${kf.time.toFixed(3)} (local ${(kf.time * clipDuration).toFixed(2)}s) → ${String(kf.value)}`}
                          onPointerDown={(e) => handleDiamondPointerDown(e, row, kf)}
                          onContextMenu={(e) => handleDiamondContextMenu(e, row, kf.id)}
                          style={{
                            position: 'absolute',
                            left: left - 5,
                            top: '50%',
                            width: 10,
                            height: 10,
                            marginTop: -5,
                            transform: 'rotate(45deg)',
                            background: 'var(--color-accent, #7c5cff)',
                            border: '1px solid #fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            cursor: row.kind === 'clipChannel' ? 'grab' : 'default',
                            zIndex: 2,
                          }}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {diamondMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1098 }}
            onClick={() => setDiamondMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setDiamondMenu(null)
            }}
          />
          <div
            role="menu"
            data-testid="clip-diamond-context-menu"
            style={{
              position: 'fixed',
              left: diamondMenu.x,
              top: diamondMenu.y,
              background: 'var(--color-bg, #fff)',
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              padding: 4,
              zIndex: 1100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              data-testid="clip-diamond-delete"
              onClick={handleDeleteKeyframe}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Delete Keyframe
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ClipAddChannelPicker({
  clip,
  parameters,
  onSelect,
  onClose,
}: {
  clip: ClipDefinition
  parameters: readonly import('../../engine/animatableParameters').AnimatableParameter[]
  onSelect: (p: import('../../engine/animationProperties').AnimationProperty) => void
  onClose: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const clickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-testid="clip-add-channel-picker"]')) {
        // not closing on outside automatically – picker closes via Esc or selection
      }
    }
    window.addEventListener('keydown', esc)
    window.addEventListener('mousedown', clickOutside)
    return () => {
      window.removeEventListener('keydown', esc)
      window.removeEventListener('mousedown', clickOutside)
    }
  }, [onClose])
  const standard = parameters.filter((p) => p.source === 'standard')
  return (
    <div
      data-testid="clip-add-channel-picker"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        minWidth: 200,
        background: 'var(--color-bg, #fff)',
        border: '1px solid var(--color-border, #ddd)',
        borderRadius: 6,
        padding: 4,
        zIndex: 30,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {standard.map((p) => {
        const already = clip.hasChannel(
          p.key as import('../../engine/animationProperties').AnimationProperty,
        )
        return (
          <button
            key={p.key}
            disabled={already}
            data-testid={`picker-item-${p.key}`}
            onClick={() =>
              !already &&
              onSelect(p.key as import('../../engine/animationProperties').AnimationProperty)
            }
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: already ? 'default' : 'pointer',
              opacity: already ? 0.4 : 1,
              fontSize: 12,
            }}
          >
            {p.label} {already ? '(added)' : ''}
          </button>
        )
      })}
      {standard.length === 0 && (
        <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
          No animatable parameters
        </div>
      )}
      <button
        onClick={onClose}
        style={{
          marginTop: 4,
          fontSize: 11,
          color: 'var(--color-text-muted, #666)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  )
}
