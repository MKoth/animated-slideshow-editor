import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  getManagerRows,
  type ManagerTab,
  getOrphanKeyframes,
  packClipLanesForNode,
  packControlIntervalBlocks,
  MIN_VISUAL_DURATION,
  MIN_CLIP_SPEED,
  CLIP_HANDLE_WIDTH_PX,
  CLIP_LANE_HEIGHT_PX,
  CLIP_LANE_BAR_HEIGHT_PX,
  clampedSpeedForVisual,
  snapStartTime,
  packCollectionLanesForParent,
  visualDurationForClip,
  visualDurationForCollectionPlacement,
  collectUnifiedBarEdgesForSnap,
} from '../../engine/animationManagerModel'
import {
  useTimelineViewStore,
  pixelsPerSecond,
  rulerTickStep,
  rulerTickTimes,
  tickLabel,
} from '../../stores/timelineViewStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { walkPreOrder } from '../../engine/sceneNode'
import type { SceneNode } from '../../engine/sceneNode'
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
  AddKeyframeCommand,
  DeleteClipKeyframesCommand,
  DeleteKeyframesCommand,
  MoveClipKeyframesCommand,
  SetClipKeyframeValueCommand,
  AssignClipCommand,
  CreateClipCollectionCommand,
  SetClipCollectionBindingsCommand,
  SetClipCollectionCategoryCommand,
  RenameClipCollectionCommand,
  PlaceCollectionCommand,
  SetCollectionPlacementStartTimeCommand,
  ReorderCollectionPlacementCommand,
  MoveClipLayerCommand,
  ReverseClipCommand,
  ReverseCollectionCommand,
  MirrorClipCommand,
  MirrorCollectionCommand,
  ReverseMirrorCollectionCommand,
  CopyClipCommand,
  CopyCollectionCommand,
  RemoveClipCommand,
  DeleteCollectionPlacementCommand,
  SetControlSetCommand,
  UpdateControlIntervalCommand,
  ReorderControlBindingCommand,
  MoveBindingBetweenGroupsCommand,
} from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { computeExtractionBounds } from '../../engine/clipExtraction'
import {
  mirrorClipDefaultName,
  mirrorCollectionDefaultName,
  buildMirrorSwapPreview,
  mirrorSkippedLaneNames,
  collectMirrorSkippedLaneNames,
} from '../../engine/clipMirror'
import { copyClipDefaultName, copyCollectionDefaultName } from '../../engine/clipCopy'
import type { MirrorAxis } from '../../engine/clipMirror'
import { reverseMirrorCollectionDefaultName } from '../../engine/clipReverseMirror'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import { ClipExtractionModal } from './ClipExtractionModal'
import { DeleteOrphansConfirmModal } from './DeleteOrphansConfirmModal'
import { TimeSegmentToCollectionModal } from './TimeSegmentToCollectionModal'
import type { SegmentSourceEntry } from './TimeSegmentToCollectionModal'
import { executeSegmentToCollection, nextClipNameForNode } from '../../engine/timeSegmentExtraction'
import {
  ALL_COLLECTION_CATEGORIES,
  collectionCategoryLabel,
  distinctClipCategories,
  distinctCollectionCategories,
  matchesCollectionCategory,
} from './collectionCategories'
import { executeDeleteClipCollection } from '../../app/deleteClipCollectionAction'
import { executeReapplyClipCollections } from '../../app/reapplyClipCollectionsAction'
import { executeBulkClipOffset, previewBulkClipOffset } from '../../app/clipBulkOffsetAction'
import type { BulkOffsetMap, BulkOffsetPreview } from '../../app/clipBulkOffsetAction'
import { BulkOffsetModal } from './BulkOffsetModal'
import type { BulkOffsetBindingRow } from './BulkOffsetModal'
import {
  defaultSegmentRange,
  formatSec,
  parseSec,
  validateSegmentRange,
} from '../../engine/timeSegmentExtraction'
import {
  executeCollectionFlatten,
  longestClipDuration,
  previewCollectionFlatten,
} from '../../engine/collectionFlatten'
import type { SegmentCollectionPlan, SegmentSourceClip } from '../../engine/timeSegmentExtraction'
import type { AnimatedParam } from '../../engine/animationManagerModel'
import type { KeyframeTarget } from '../../engine/keyframeTarget'
import { assetsApi } from '../../api'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { ManagerRuler } from './ManagerRuler'
import { snapKeyframeTime } from '../../engine/timelineSnapping'
import {
  createControl,
  createControlSet,
  CONTROL_INTERVAL_MIN_SPAN,
  flattenControlBindings,
  addBindingToRecord,
  addGroupToControlSet,
  removeGroupFromControlSet,
  setBlendNameInControlSet,
  mergeGroupBindings,
  moveBindingBetweenGroups,
  groupCollectionBlocks,
  addCollectionBlockToGroup,
  removeCollectionBlockFromGroup,
  updateCollectionBlockInterval,
  reorderCollectionBlockWithinGroup,
  moveCollectionBlockBetweenGroups,
} from '../../engine/control'
import { SetControlBlendCommand } from '../../engine/commands/setControlBlendCommand'
import { useAnimationManagerNavStore } from '../../stores/animationManagerNavStore'

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
      /** Measured px-per-second of the rendered lane; bars are fit-to-width, not zoom-based */
      effectivePps?: number
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
      /** Measured px-per-second of the rendered lane; bars are fit-to-width, not zoom-based */
      effectivePps?: number
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
      /** Measured px-per-second of the rendered lane; bars are fit-to-width, not zoom-based */
      effectivePps?: number
    }
  | {
      mode: 'collection-move'
      placementId: string
      collectionId: string
      parentNodeId: string
      initialStart: number
      initialVisual: number
      startX: number
      previewStart: number
      startY: number
      initialIndex: number
      previewIndex: number
      /** Measured px-per-second of the rendered lane; bars are fit-to-width, not zoom-based */
      effectivePps?: number
    }
  | {
      mode: 'collection-resize-right'
      placementId: string
      collectionId: string
      parentNodeId: string
      initialStart: number
      initialVisual: number
      startX: number
      previewVisual: number
      previewStart: number
      /** Measured px-per-second of the rendered lane; bars are fit-to-width, not zoom-based */
      effectivePps?: number
    }
  | {
      mode: 'collection-resize-left'
      placementId: string
      collectionId: string
      parentNodeId: string
      initialStart: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewVisual: number
      previewStart: number
      /** Measured px-per-second of the rendered lane; bars are fit-to-width, not zoom-based */
      effectivePps?: number
    }
  | {
      mode: 'clip-reorder'
      nodeId: string
      instanceId: string
      initialIndex: number
      startY: number
      previewIndex: number
      startX: number
      initialStart: number
    }
  | {
      mode: 'collection-reorder'
      placementId: string
      parentNodeId: string
      initialIndex: number
      startY: number
      previewIndex: number
      startX: number
      initialStart: number
    }
  | {
      mode: 'interval-move'
      nodeId: string
      controlKey: string
      /** Owning timeline for per-group lanes; absent = legacy merged/drill-in drag */
      groupId?: string
      semanticName: string
      clipId?: string
      /** Set for live-linked collection blocks (semanticName is unused there) */
      kind?: 'clip' | 'collection'
      blockId?: string
      initialStart: number
      initialEnd: number
      span: number
      startX: number
      startY: number
      previewStart: number
      previewEnd: number
      effectivePps?: number
      laneWidth?: number
    }
  | {
      mode: 'interval-resize-left'
      nodeId: string
      controlKey: string
      /** Owning timeline for per-group lanes; absent = legacy merged/drill-in drag */
      groupId?: string
      semanticName: string
      clipId?: string
      /** Set for live-linked collection blocks (semanticName is unused there) */
      kind?: 'clip' | 'collection'
      blockId?: string
      initialStart: number
      initialEnd: number
      startX: number
      previewStart: number
      previewEnd: number
      effectivePps?: number
      laneWidth?: number
    }
  | {
      mode: 'interval-resize-right'
      nodeId: string
      controlKey: string
      /** Owning timeline for per-group lanes; absent = legacy merged/drill-in drag */
      groupId?: string
      semanticName: string
      clipId?: string
      /** Set for live-linked collection blocks (semanticName is unused there) */
      kind?: 'clip' | 'collection'
      blockId?: string
      initialStart: number
      initialEnd: number
      startX: number
      previewStart: number
      previewEnd: number
      effectivePps?: number
      laneWidth?: number
    }
  | {
      mode: 'interval-reorder'
      nodeId: string
      controlKey: string
      /** Owning timeline for per-group lanes; absent = legacy merged/drill-in drag */
      groupId?: string
      semanticName: string
      /** Set for live-linked collection blocks (indices address collectionBlocks) */
      kind?: 'clip' | 'collection'
      blockId?: string
      initialIndex: number
      previewIndex: number
      startY: number
      startX: number
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

function deletedPlacementMessage(removedLanes: number): string {
  return removedLanes > 0
    ? `Deleted collection placement (+${removedLanes} clip lane(s) removed)`
    : 'Deleted collection placement'
}

/**
 * Bar positions in the manager lanes are percentages of the slide duration, so the
 * on-screen px-per-second is laneWidth / duration – independent of the timeline zoom.
 * Drag math must convert pixels with that scale or the bar drifts from the pointer.
 * Returns undefined when the layout is unmeasurable (jsdom/tests), so callers fall
 * back to the zoom pps.
 */
function laneEffectivePps(laneEl: HTMLElement | null, durationSec: number): number | undefined {
  if (!laneEl || !(durationSec > 0)) return undefined
  const width = laneEl.getBoundingClientRect().width
  return width > 1 ? width / durationSec : undefined
}

function paramToTarget(param: AnimatedParam, nodeId: string): KeyframeTarget {
  if (param.kind === 'property') return { kind: 'node', nodeId, property: param.key as never }
  if (param.kind === 'visible') return { kind: 'visible', nodeId }
  if (param.kind === 'zIndex') return { kind: 'zIndex', nodeId }
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

export function AnimationManagerModal({ open, parentNodeId, onClose }: AnimationManagerModalProps) {
  const { engine, dispatch, undoStack } = useEngine()
  const [tick, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<ManagerTab>('collections')
  const [controlValues, setControlValues] = useState<Record<string, number>>({})
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{
    clipId: string
    nodeId: string
    instanceId?: string
  } | null>(null)
  const [editingControl, setEditingControl] = useState<{ key: string; clipId: string } | null>(null)
  const [editingControlMeta, setEditingControlMeta] = useState<{
    key: string
    draftLabel: string
  } | null>(null)
  const [editingBlendName, setEditingBlendName] = useState<{
    controlKey: string
    blendIndex: number
    draftName: string
  } | null>(null)
  const [deleteControlConfirmKey, setDeleteControlConfirmKey] = useState<string | null>(null)
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
  // Batch flow: create one clip per object + one collection from a time segment
  const [segmentModalOpen, setSegmentModalOpen] = useState(false)
  const [orphanScopeMessage, setOrphanScopeMessage] = useState<string | null>(null)
  const [highlightedClipInstanceId, setHighlightedClipInstanceId] = useState<string | null>(null)
  // Clip Lane multi-select for Collection grouping (15-05)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [clipAnchorId, setClipAnchorId] = useState<string | null>(null)
  const [collectionCreateOpen, setCollectionCreateOpen] = useState(false)
  const [collectionNameDraft, setCollectionNameDraft] = useState('')
  const [collectionCategoryDraft, setCollectionCategoryDraft] = useState('')
  const [collectionLocalError, setCollectionLocalError] = useState<string | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [editingBindingsDraft, setEditingBindingsDraft] = useState<Record<string, string>>({})
  const [editingNameDraft, setEditingNameDraft] = useState('')
  const [editingCategoryDraft, setEditingCategoryDraft] = useState('')
  const [deleteConfirmCollectionId, setDeleteConfirmCollectionId] = useState<string | null>(null)
  // Top-level collection category filter: '' = Uncategorized (default),
  // '__all' = All categories. Scopes the Collections tab, bulk edit, and
  // place-collection dropdown to the category being worked with.
  const [collectionCategoryFilter, setCollectionCategoryFilter] = useState<string>('')
  // Fine-grained collection editing (Spec 353): flatten + replace
  const [flattenOpen, setFlattenOpen] = useState(false)
  const [flattenFromStr, setFlattenFromStr] = useState('0')
  const [flattenToStr, setFlattenToStr] = useState('1')
  const [flattenError, setFlattenError] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  // Bulk additive offset of clip keyframe values across collection bindings (retarget flow)
  const [bulkOffsetOpen, setBulkOffsetOpen] = useState(false)
  const [bulkOffsetFilterSeed, setBulkOffsetFilterSeed] = useState('')
  // Collection Lane placements (15-06)
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [placeCollectionId, setPlaceCollectionId] = useState<string>('')
  const [collectionPlacementMenu, setCollectionPlacementMenu] = useState<{
    x: number
    y: number
    placementId: string
  } | null>(null)
  // Control timeline Clip Block context menu (Controls tab per-timeline lanes)
  const [controlBlockMenu, setControlBlockMenu] = useState<{
    x: number
    y: number
    controlKey: string
    groupId: string
    semanticName: string
    clipId: string
    start: number
    end: number
    /** Set for grouped collection blocks (semanticName/clipId unused there) */
    kind?: 'clip' | 'collection'
    blockId?: string
    collectionId?: string
  } | null>(null)
  const [reverseClipPrompt, setReverseClipPrompt] = useState<{
    clipId: string
    nodeId?: string
    instanceId?: string
    startTime?: number
    defaultName: string
  } | null>(null)
  const [reverseCollectionPrompt, setReverseCollectionPrompt] = useState<{
    collectionId: string
    parentNodeId?: string
    startTime?: number
    defaultName: string
  } | null>(null)
  const [reverseNameDraft, setReverseNameDraft] = useState('')
  const [mirrorClipPrompt, setMirrorClipPrompt] = useState<{
    clipId: string
    nodeId?: string
    instanceId?: string
    startTime?: number
    defaultName: string
  } | null>(null)
  const [mirrorNameDraft, setMirrorNameDraft] = useState('')
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>('X')
  const [mirrorCollectionPrompt, setMirrorCollectionPrompt] = useState<{
    collectionId: string
    parentNodeId?: string
    startTime?: number
    defaultName: string
  } | null>(null)
  const [mirrorCollectionNameDraft, setMirrorCollectionNameDraft] = useState('')
  const [reverseMirrorCollectionPrompt, setReverseMirrorCollectionPrompt] = useState<{
    collectionId: string
    parentNodeId?: string
    startTime?: number
    defaultName: string
  } | null>(null)
  const [reverseMirrorCollectionNameDraft, setReverseMirrorCollectionNameDraft] = useState('')
  const [reverseMirrorAxis, setReverseMirrorAxis] = useState<MirrorAxis>('X')
  const [deleteOrphansConfirm, setDeleteOrphansConfirm] = useState<{
    keyframes: readonly ExtractableKeyframe[]
    clipId: string
    selStart: number
    mode: 'new' | 'existing'
    nodeId: string
  } | null>(null)
  const orphansContainerRef = useRef<HTMLDivElement>(null)
  const collectionScrollRef = useRef<HTMLDivElement>(null)
  const controlsScrollRef = useRef<HTMLDivElement>(null)
  const [addBlockDialog, setAddBlockDialog] = useState<{
    controlKey: string
    draftGroupId: string
    mode: 'clip' | 'collection'
    draftSemantic: string
    draftClipId: string
    draftCollectionId: string
    error: string | null
  } | null>(null)
  const notify = useNotificationStore((s) => s.notify)
  const authoringMode = useTimelineViewStore((s) =>
    parentNodeId ? s.authoringModeByHost[parentNodeId] === true : false,
  )
  const toggleAuthoringMode = useTimelineViewStore((s) => s.toggleAuthoringMode)
  const navPending = useAnimationManagerNavStore((s) => s.pending)
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  useEffect(() => {
    if (open && navPending && parentNodeId === navPending.hostNodeId) {
      setActiveTab('controls')
      if (navPending.controlKey) setHighlightKey(navPending.controlKey)
      // clear after handling so next jump works
      useAnimationManagerNavStore.getState().clear()
    }
  }, [open, navPending, parentNodeId])
  useEffect(() => {
    if (!open) setHighlightKey(null)
  }, [open])

  const zoomLevel = useTimelineViewStore((s) => s.zoomLevel)
  const gridSnapEnabled = useTimelineViewStore((s) => s.gridSnapEnabled)
  const pps = pixelsPerSecond(zoomLevel)

  useEngineEvent(() => setTick((t) => t + 1))

  // Reset tab and expanded when opening parent changes
  useEffect(() => {
    if (open) {
      setActiveTab('collections')
      setControlValues({})
      setExpandedMap({})
      setEditing(null)
      setEditingControl(null)
      setEditingControlMeta(null)
      setDeleteControlConfirmKey(null)
      setSelectedInstanceId(null)
      setDragState(null)
      setClipMenu(null)
      setSavedZoom(null)
      setSelectedOrphanIds(new Set())
      setOrphanAnchorId(null)
      setOrphanContextMenu(null)
      setOrphanMarquee(null)
      setOrphanExtraction(null)
      setSegmentModalOpen(false)
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
      setFlattenOpen(false)
      setFlattenError(null)
      setReplaceOpen(false)
      setBulkOffsetOpen(false)
      setBulkOffsetFilterSeed('')
      setSelectedPlacementId(null)
      setPlaceCollectionId('')
      setCollectionPlacementMenu(null)
      setControlBlockMenu(null)
      setReverseClipPrompt(null)
      setReverseCollectionPrompt(null)
      setReverseNameDraft('')
      setMirrorClipPrompt(null)
      setMirrorCollectionPrompt(null)
      setDeleteOrphansConfirm(null)
      setAddBlockDialog(null)
    }
  }, [open, parentNodeId])

  const restorePpsAndBack = useCallback(() => {
    if (savedZoom !== null) {
      useTimelineViewStore.setState({ zoomLevel: savedZoom })
      setSavedZoom(null)
    }
    setEditing(null)
    setEditingControl(null)
    setEditingControlMeta(null)
  }, [savedZoom])

  // Esc handling: drills back from editor (restoring pps), second Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (reverseClipPrompt) {
          setReverseClipPrompt(null)
          e.stopPropagation()
        } else if (mirrorClipPrompt) {
          setMirrorClipPrompt(null)
          e.stopPropagation()
        } else if (reverseCollectionPrompt) {
          setReverseCollectionPrompt(null)
          e.stopPropagation()
        } else if (mirrorCollectionPrompt) {
          setMirrorCollectionPrompt(null)
          e.stopPropagation()
        } else if (collectionCreateOpen) {
          setCollectionCreateOpen(false)
          e.stopPropagation()
        } else if (editingCollectionId) {
          setEditingCollectionId(null)
          e.stopPropagation()
        } else if (deleteConfirmCollectionId) {
          setDeleteConfirmCollectionId(null)
          e.stopPropagation()
        } else if (deleteControlConfirmKey) {
          setDeleteControlConfirmKey(null)
          e.stopPropagation()
        } else if (editingControlMeta) {
          setEditingControlMeta(null)
          e.stopPropagation()
        } else if (deleteOrphansConfirm) {
          // let DeleteOrphansConfirmModal's own Esc handler call onKeep (with notify)
          // keep in stack to prevent closing parent, but delegate
          e.stopPropagation()
          // trigger Keep semantics via the modal's onKeep (we simulate by clearing with notify)
          // The modal's own listener will also fire, but this ensures parent doesn't close.
          // We directly call the Keep path here to avoid double-notify from modal:
          // Clear without notify here; modal's listener will notify. So just stop propagation.
          return
        } else if (orphanExtraction) {
          setOrphanExtraction(null)
          e.stopPropagation()
        } else if (segmentModalOpen) {
          setSegmentModalOpen(false)
          e.stopPropagation()
        } else if (bulkOffsetOpen) {
          setBulkOffsetOpen(false)
          e.stopPropagation()
        } else if (orphanContextMenu) {
          setOrphanContextMenu(null)
          e.stopPropagation()
        } else if (addBlockDialog) {
          setAddBlockDialog(null)
          e.stopPropagation()
        } else if (orphanScopeMessage) {
          setOrphanScopeMessage(null)
          e.stopPropagation()
        } else if (editing || editingControl) {
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
        } else if (collectionPlacementMenu) {
          setCollectionPlacementMenu(null)
          e.stopPropagation()
        } else if (controlBlockMenu) {
          setControlBlockMenu(null)
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
    editingControl,
    editingControlMeta,
    deleteControlConfirmKey,
    dragState,
    clipMenu,
    orphanContextMenu,
    orphanExtraction,
    segmentModalOpen,
    deleteOrphansConfirm,
    orphanScopeMessage,
    orphanMarquee,
    collectionCreateOpen,
    editingCollectionId,
    deleteConfirmCollectionId,
    collectionPlacementMenu,
    controlBlockMenu,
    bulkOffsetOpen,
    reverseClipPrompt,
    reverseCollectionPrompt,
    mirrorClipPrompt,
    addBlockDialog,
    onClose,
    restorePpsAndBack,
  ])

  const activeSlide = open ? engine.getActiveSlide() : null
  const currentPlayheadTime = usePlaybackController((s) =>
    activeSlide ? (s.currentTimes[activeSlide.id] ?? 0) : 0,
  )
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

  const controls = parentNode?.controlSet?.controls ?? []
  const availableClipsForBinding = useMemo(() => {
    void tick
    try {
      return [...engine.clips]
    } catch {
      return []
    }
  }, [engine, tick])
  const [hoveredBindingSemantic, setHoveredBindingSemantic] = useState<string | null>(null)
  const previousSelectionRef = useRef<string[] | null>(null)
  const descendantSemanticMap = useMemo(() => {
    void tick
    const map = new Map<string, SceneNode[]>()
    if (!parentNode) return map
    for (const node of walkPreOrder(parentNode)) {
      if (node.id === parentNode.id) continue
      const sem = node.semanticName?.trim()
      if (!sem) continue
      const arr = map.get(sem) ?? []
      arr.push(node)
      map.set(sem, arr)
    }
    return map
  }, [parentNode, tick])
  const handleBindingHoverEnter = useCallback(
    (semantic: string) => {
      setHoveredBindingSemantic(semantic)
      const nodes = descendantSemanticMap.get(semantic) ?? []
      if (nodes.length > 0) {
        previousSelectionRef.current = [...useSelectionStore.getState().selectedIds]
        useSelectionStore.getState().selectMany(nodes.map((n) => n.id))
      }
    },
    [descendantSemanticMap],
  )
  const handleBindingHoverLeave = useCallback(() => {
    setHoveredBindingSemantic(null)
    if (previousSelectionRef.current) {
      const prev = previousSelectionRef.current
      previousSelectionRef.current = null
      if (prev.length === 0) useSelectionStore.getState().clear()
      else useSelectionStore.getState().selectMany(prev)
    }
  }, [])
  const addControl = useCallback(() => {
    if (!parentNode) return
    const existing = new Set(parentNode.controlSet?.controls.map((control) => control.key) ?? [])
    let index = 1
    while (existing.has(`Control${index}`)) index += 1
    const control = createControl({
      key: `Control${index}`,
      label: `Control ${index}`,
      exposed: true,
    })
    dispatch(
      new SetControlSetCommand({
        nodeId: parentNode.id,
        controlSet: parentNode.controlSet
          ? { ...parentNode.controlSet, controls: [...parentNode.controlSet.controls, control] }
          : createControlSet(parentNode.id, [control]),
      }),
    )
    setTick((value) => value + 1)
  }, [dispatch, parentNode])

  const setControlBindings = useCallback(
    (
      controlKey: string,
      bindings: Record<string, import('../../engine/control').ControlBindingValue>,
    ) => {
      if (!parentNode?.controlSet) return
      dispatch(
        new SetControlSetCommand({
          nodeId: parentNode.id,
          controlSet: {
            ...parentNode.controlSet,
            controls: parentNode.controlSet.controls.map((control) =>
              control.key === controlKey ? { ...control, bindings } : control,
            ),
          },
        }),
      )
      setTick((value) => value + 1)
    },
    [dispatch, parentNode],
  )

  /**
   * Group-aware write: replace one timeline's bindings and recompute the merged
   * view. Groups are the source of truth for multi-timeline controls — writing
   * flat `bindings` alone is discarded by normalization, so all edits go here.
   */
  const writeControlGroupBindings = useCallback(
    (
      controlKey: string,
      groupId: string,
      nextGroupBindings: Record<string, import('../../engine/control').ControlBindingValue>,
    ) => {
      if (!parentNode?.controlSet) return
      const control = parentNode.controlSet.controls.find((c) => c.key === controlKey)
      if (!control) return
      const nextGroups = control.groups.map((g) =>
        g.id === groupId ? { ...g, bindings: nextGroupBindings } : g,
      )
      dispatch(
        new SetControlSetCommand({
          nodeId: parentNode.id,
          controlSet: {
            ...parentNode.controlSet,
            controls: parentNode.controlSet.controls.map((c) =>
              c.key === controlKey
                ? { ...c, groups: nextGroups, bindings: mergeGroupBindings(nextGroups) }
                : c,
            ),
          },
        }),
      )
      setTick((value) => value + 1)
    },
    [dispatch, parentNode],
  )

  /**
   * Remove one Clip Block from a specific timeline, matched by
   * (semantic, clip, interval). Groups are the source of truth.
   * Returns false when the block wasn't found.
   */
  const removeControlBlock = useCallback(
    (args: {
      controlKey: string
      groupId: string
      semanticName: string
      clipId: string
      start: number
      end: number
    }): boolean => {
      if (!parentNode?.controlSet) return false
      const control = parentNode.controlSet.controls.find((c) => c.key === args.controlKey)
      const group = control?.groups.find((g) => g.id === args.groupId)
      if (!control || !group) return false
      const EPS = 1e-9
      const cur = (
        group.bindings as Record<string, import('../../engine/control').ControlBindingValue>
      )[args.semanticName]
      if (cur === undefined) return false
      const matches = (b: import('../../engine/control').ControlBinding): boolean => {
        const cid = typeof b === 'string' ? b : b.clipId
        if (cid !== args.clipId) return false
        const s = typeof b === 'string' ? 0 : b.start
        const e = typeof b === 'string' ? 1 : b.end
        return Math.abs(s - args.start) < EPS && Math.abs(e - args.end) < EPS
      }
      const next: Record<string, import('../../engine/control').ControlBindingValue> = {
        ...group.bindings,
      }
      if (Array.isArray(cur)) {
        const arr = cur as import('../../engine/control').ControlBinding[]
        const filtered = arr.filter((b) => !matches(b))
        if (filtered.length === arr.length) return false
        if (filtered.length === 0) delete next[args.semanticName]
        else if (filtered.length === 1) next[args.semanticName] = filtered[0]!
        else next[args.semanticName] = filtered
      } else if (matches(cur as import('../../engine/control').ControlBinding)) {
        delete next[args.semanticName]
      } else return false
      writeControlGroupBindings(args.controlKey, args.groupId, next)
      return true
    },
    [parentNode, writeControlGroupBindings],
  )

  const removeControlBinding = useCallback(
    (controlKey: string, semanticName: string) => {
      const existing =
        parentNode?.controlSet?.controls.find((c) => c.key === controlKey)?.bindings ?? {}
      const next = { ...existing }
      delete next[semanticName]
      setControlBindings(controlKey, next)
    },
    [parentNode, setControlBindings],
  )
  void removeControlBinding

  /**
   * Commit a drag move/resize for one block inside a specific timeline.
   * Finds the block in that timeline's bindings by (semantic, clip, interval)
   * and rewrites the interval there; merged bindings are recomputed.
   * Returns false when the block wasn't found (caller falls back to legacy).
   */
  const commitGroupIntervalEdit = useCallback(
    (args: {
      controlKey: string
      groupId: string
      semanticName: string
      clipId: string | undefined
      initialStart: number
      initialEnd: number
      previewStart: number
      previewEnd: number
    }): boolean => {
      if (!parentNode?.controlSet) return false
      const control = parentNode.controlSet.controls.find((c) => c.key === args.controlKey)
      const group = control?.groups.find((g) => g.id === args.groupId)
      if (!control || !group) return false
      const flat = flattenControlBindings(
        group.bindings as unknown as Record<
          string,
          import('../../engine/control').ControlBindingValue
        >,
      )
      const EPS = 1e-9
      const idx = flat.findIndex((f) => {
        if (f.semantic !== args.semanticName) return false
        const cid =
          typeof f.binding === 'string'
            ? (f.binding as string)
            : (f.binding as { clipId: string }).clipId
        if (args.clipId !== undefined && cid !== args.clipId) return false
        const s = typeof f.binding === 'string' ? 0 : (f.binding as { start: number }).start
        const e = typeof f.binding === 'string' ? 1 : (f.binding as { end: number }).end
        return Math.abs(s - args.initialStart) < EPS && Math.abs(e - args.initialEnd) < EPS
      })
      if (idx === -1) return false
      const target = flat[idx]!
      const resolvedClipId =
        args.clipId ??
        (typeof target.binding === 'string'
          ? (target.binding as string)
          : (target.binding as { clipId: string }).clipId)
      flat[idx] = {
        semantic: target.semantic,
        binding: { clipId: resolvedClipId, start: args.previewStart, end: args.previewEnd },
        index: target.index,
      }
      const rebuilt: Record<string, import('../../engine/control').ControlBindingValue> = {}
      for (const { semantic: s, binding: b } of flat) {
        addBindingToRecord(rebuilt, s, b as import('../../engine/control').ControlBinding)
      }
      writeControlGroupBindings(args.controlKey, args.groupId, rebuilt)
      return true
    },
    [parentNode, writeControlGroupBindings],
  )

  /**
   * Reorder one entry inside a specific timeline's bindings (Priority stacking).
   * Returns false when out of range (caller falls back to legacy).
   */
  const reorderGroupBinding = useCallback(
    (args: {
      controlKey: string
      groupId: string
      fromIndex: number
      toIndex: number
    }): boolean => {
      if (!parentNode?.controlSet) return false
      const control = parentNode.controlSet.controls.find((c) => c.key === args.controlKey)
      const group = control?.groups.find((g) => g.id === args.groupId)
      if (!control || !group) return false
      const flat = flattenControlBindings(
        group.bindings as unknown as Record<
          string,
          import('../../engine/control').ControlBindingValue
        >,
      )
      if (args.fromIndex < 0 || args.fromIndex >= flat.length) return false
      const dest = Math.max(0, Math.min(args.toIndex, flat.length - 1))
      const [moved] = flat.splice(args.fromIndex, 1)
      flat.splice(dest, 0, moved!)
      const rebuilt: Record<string, import('../../engine/control').ControlBindingValue> = {}
      for (const { semantic: s, binding: b } of flat) {
        addBindingToRecord(rebuilt, s, b as import('../../engine/control').ControlBinding)
      }
      writeControlGroupBindings(args.controlKey, args.groupId, rebuilt)
      return true
    },
    [parentNode, writeControlGroupBindings],
  )

  /** Remove one grouped collection block from a timeline by block id. */
  const removeControlCollectionBlock = useCallback(
    (args: { controlKey: string; groupId: string; blockId: string }): boolean => {
      if (!parentNode?.controlSet) return false
      try {
        const nextSet = removeCollectionBlockFromGroup(
          parentNode.controlSet,
          args.controlKey,
          args.groupId,
          args.blockId,
        )
        const res = dispatch(
          new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }),
        )
        if (!res.ok) {
          notify(res.error.message)
          return false
        }
        setTick((v) => v + 1)
        return true
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [dispatch, notify, parentNode],
  )

  /**
   * Commit a drag move/resize for one grouped collection block.
   * Returns false when the block wasn't found.
   */
  const commitGroupCollectionIntervalEdit = useCallback(
    (args: {
      controlKey: string
      groupId: string
      blockId: string
      previewStart: number
      previewEnd: number
    }): boolean => {
      if (!parentNode?.controlSet) return false
      try {
        const nextSet = updateCollectionBlockInterval(
          parentNode.controlSet,
          args.controlKey,
          args.groupId,
          args.blockId,
          args.previewStart,
          args.previewEnd,
        )
        const res = dispatch(
          new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }),
        )
        if (!res.ok) {
          notify(res.error.message)
          return false
        }
        setTick((v) => v + 1)
        return true
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [dispatch, notify, parentNode],
  )

  /**
   * Reorder collection blocks inside one timeline (Priority stacking among
   * collections; indices address that timeline's collectionBlocks array).
   */
  const reorderGroupCollectionBlock = useCallback(
    (args: {
      controlKey: string
      groupId: string
      fromIndex: number
      toIndex: number
    }): boolean => {
      if (!parentNode?.controlSet) return false
      try {
        const nextSet = reorderCollectionBlockWithinGroup(
          parentNode.controlSet,
          args.controlKey,
          args.groupId,
          args.fromIndex,
          args.toIndex,
        )
        const res = dispatch(
          new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }),
        )
        if (!res.ok) {
          notify(res.error.message)
          return false
        }
        setTick((v) => v + 1)
        return true
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [dispatch, notify, parentNode],
  )

  /**
   * Hover a grouped collection block: highlight all member semantics at once
   * (hover key is namespaced so clip rows never clash with it).
   */
  const handleCollectionHoverEnter = useCallback(
    (blockId: string, memberSemantics: readonly string[]) => {
      setHoveredBindingSemantic(`collection::${blockId}`)
      const ids = new Set<string>()
      for (const sem of memberSemantics) {
        for (const n of descendantSemanticMap.get(sem) ?? []) ids.add(n.id)
      }
      if (ids.size > 0) {
        previousSelectionRef.current = [...useSelectionStore.getState().selectedIds]
        useSelectionStore.getState().selectMany([...ids])
      }
    },
    [descendantSemanticMap],
  )
  const handleUpdateControlInterval = useCallback(
    (controlKey: string, semanticName: string, start: number, end: number) => {
      if (!parentNodeId) return
      const cmd = new UpdateControlIntervalCommand({
        nodeId: parentNodeId,
        controlKey,
        semanticName,
        start,
        end,
      })
      const tx = new TransactionCommand([
        cmd as unknown as import('../../engine/commands').Command<unknown>,
      ])
      const res = dispatch(tx as never)
      if (!res.ok) notify(res.error.message)
      else setTick((v) => v + 1)
    },
    [parentNodeId, dispatch, notify],
  )
  void handleUpdateControlInterval
  const handleReorderControlBinding = useCallback(
    (controlKey: string, semanticName: string, newIndex: number) => {
      if (!parentNodeId) return
      const cmd = new ReorderControlBindingCommand({
        nodeId: parentNodeId,
        controlKey,
        semanticName,
        newIndex,
      })
      const tx = new TransactionCommand([
        cmd as unknown as import('../../engine/commands').Command<unknown>,
      ])
      const res = dispatch(tx as never)
      if (!res.ok) notify(res.error.message)
      else setTick((v) => v + 1)
    },
    [parentNodeId, dispatch, notify],
  )
  void handleReorderControlBinding

  const handleMoveBindingBetweenGroups = useCallback(
    (semanticName: string, fromControlKey: string, toControlKey: string, toIndex?: number) => {
      if (!parentNodeId) return
      const cmd = new MoveBindingBetweenGroupsCommand({
        nodeId: parentNodeId,
        semanticName,
        fromControlKey,
        toControlKey,
        toIndex,
      })
      const tx = new TransactionCommand([
        cmd as unknown as import('../../engine/commands').Command<unknown>,
      ])
      const res = dispatch(tx as never)
      if (!res.ok) notify(res.error.message)
      else setTick((v) => v + 1)
    },
    [parentNodeId, dispatch, notify],
  )
  // Cross-control HTML5 drop was removed with the merged bindings table; moves
  // between timelines use the per-block ⇄ select (moveBindingBetweenGroups).
  void handleMoveBindingBetweenGroups

  const handleAddBlock = useCallback(
    (controlKey: string) => {
      if (!addBlockDialog || addBlockDialog.controlKey !== controlKey) return
      if (!parentNode?.controlSet) return
      const control = parentNode.controlSet.controls.find((c) => c.key === controlKey)
      if (!control) return
      // Resolve target timeline (group); default to first group
      const targetGroup =
        control.groups.find((g) => g.id === addBlockDialog.draftGroupId) ?? control.groups[0]
      if (!targetGroup) return
      if (addBlockDialog.mode === 'collection') {
        const collectionId = addBlockDialog.draftCollectionId.trim()
        if (!collectionId) {
          setAddBlockDialog((prev) =>
            prev ? { ...prev, error: 'Collection selection required' } : prev,
          )
          return
        }
        let collectionName = collectionId
        let memberCount = 0
        try {
          const collection = engine.getClipCollection(collectionId)
          collectionName = collection.name
          memberCount = collection.bindings.size
        } catch {
          setAddBlockDialog((prev) => (prev ? { ...prev, error: 'Collection not found' } : prev))
          return
        }
        if (memberCount === 0) {
          setAddBlockDialog((prev) =>
            prev ? { ...prev, error: 'Collection has no bindings' } : prev,
          )
          return
        }
        if (groupCollectionBlocks(targetGroup).some((b) => b.collectionId === collectionId)) {
          setAddBlockDialog((prev) =>
            prev ? { ...prev, error: 'Collection already attached to this timeline' } : prev,
          )
          return
        }
        try {
          const nextSet = addCollectionBlockToGroup(
            parentNode.controlSet,
            controlKey,
            targetGroup.id,
            { collectionId, start: 0, end: 1 },
          )
          const res = dispatch(
            new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }),
          )
          if (!res.ok) {
            setAddBlockDialog((prev) => (prev ? { ...prev, error: res.error.message } : prev))
            return
          }
        } catch (err) {
          setAddBlockDialog((prev) =>
            prev ? { ...prev, error: err instanceof Error ? err.message : String(err) } : prev,
          )
          return
        }
        setAddBlockDialog(null)
        setTick((v) => v + 1)
        notify(`Attached collection "${collectionName}" to ${controlKey}`)
        return
      }
      const semantic = addBlockDialog.draftSemantic.trim()
      const clipId = addBlockDialog.draftClipId.trim()
      if (!semantic) {
        setAddBlockDialog((prev) => (prev ? { ...prev, error: 'Semantic name required' } : prev))
        return
      }
      if (!clipId) {
        setAddBlockDialog((prev) => (prev ? { ...prev, error: 'Clip selection required' } : prev))
        return
      }
      // Allow multiple clips per same semantic – no duplicate check (array per semantic)
      // Check clip exists
      try {
        engine.getClip(clipId)
      } catch {
        setAddBlockDialog((prev) => (prev ? { ...prev, error: 'Clip not found' } : prev))
        return
      }
      const count = descendantSemanticMap.get(semantic)?.length ?? 0
      if (count === 0) {
        setAddBlockDialog((prev) =>
          prev ? { ...prev, error: `No descendant with semanticName "${semantic}"` } : prev,
        )
        return
      }
      // Default interval [0,1] then user can resize – append to the TARGET GROUP's
      // bindings (groups are the source of truth; merged bindings are derived).
      const nextGroupBindings: Record<string, import('../../engine/control').ControlBindingValue> =
        { ...targetGroup.bindings }
      addBindingToRecord(nextGroupBindings, semantic, { clipId, start: 0, end: 1 })
      const nextGroups = control.groups.map((g) =>
        g.id === targetGroup.id ? { ...g, bindings: nextGroupBindings } : g,
      )
      const nextSet: import('../../engine/control').ControlSet = {
        ...parentNode.controlSet,
        controls: parentNode.controlSet.controls.map((c) =>
          c.key === controlKey
            ? { ...c, groups: nextGroups, bindings: mergeGroupBindings(nextGroups) }
            : c,
        ),
      }
      const cmd = new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet })
      const tx = new TransactionCommand([
        cmd as unknown as import('../../engine/commands').Command<unknown>,
      ])
      const res = dispatch(tx as never)
      if (!res.ok) {
        setAddBlockDialog((prev) => (prev ? { ...prev, error: res.error.message } : prev))
        return
      }
      setAddBlockDialog(null)
      setTick((v) => v + 1)
      notify(`Added Clip Block ${semantic} → ${clipId} [0,1] on ${targetGroup.name}`)
    },
    [addBlockDialog, parentNode, engine, descendantSemanticMap, dispatch, notify],
  )

  const handleEditControlMeta = useCallback(
    (key: string) => {
      const control = parentNode?.controlSet?.controls.find((c) => c.key === key)
      if (!control) return
      setEditingControlMeta({ key, draftLabel: control.label })
    },
    [parentNode],
  )

  const handleSaveControlMeta = useCallback(() => {
    if (!editingControlMeta || !parentNode?.controlSet) return
    const label = editingControlMeta.draftLabel.trim()
    if (!label) {
      notify('Control label must be non-empty')
      return
    }
    const updated = {
      ...parentNode.controlSet,
      controls: parentNode.controlSet.controls.map((control) =>
        control.key === editingControlMeta.key ? { ...control, label } : control,
      ),
    }
    dispatch(new SetControlSetCommand({ nodeId: parentNode.id, controlSet: updated }))
    setEditingControlMeta(null)
    setTick((value) => value + 1)
    notify(`Renamed ${editingControlMeta.key} → "${label}"`)
  }, [editingControlMeta, parentNode, dispatch, notify])

  const handleEditBlendName = useCallback(
    (controlKey: string, blendIndex: number) => {
      const control = parentNode?.controlSet?.controls.find((c) => c.key === controlKey)
      if (!control) return
      setEditingBlendName({
        controlKey,
        blendIndex,
        draftName: (control.blendNames?.[blendIndex] ?? '').trim(),
      })
    },
    [parentNode],
  )

  const handleSaveBlendName = useCallback(() => {
    if (!editingBlendName || !parentNode?.controlSet) return
    try {
      const nextSet = setBlendNameInControlSet(
        parentNode.controlSet,
        editingBlendName.controlKey,
        editingBlendName.blendIndex,
        editingBlendName.draftName,
      )
      const res = dispatch(new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }))
      if (!res.ok) {
        notify(res.error.message)
        return
      }
      const name = editingBlendName.draftName.trim()
      const gap = `T${editingBlendName.blendIndex + 1}→T${editingBlendName.blendIndex + 2}`
      setEditingBlendName(null)
      setTick((value) => value + 1)
      notify(name ? `Renamed blend ${gap} → "${name}"` : `Cleared custom name of blend ${gap}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    }
  }, [editingBlendName, parentNode, dispatch, notify])

  const handleDeleteControl = useCallback(
    (key: string) => {
      if (!parentNode?.controlSet) return
      const control = parentNode.controlSet.controls.find((c) => c.key === key)
      if (!control) return
      const nextControls = parentNode.controlSet.controls.filter((c) => c.key !== key)
      const nextSet =
        nextControls.length === 0 ? undefined : { ...parentNode.controlSet, controls: nextControls }
      const commands: import('../../engine/commands').Command<unknown>[] = []
      // Delete control keyframes on all slides where host has track
      if (engine.project) {
        for (const slide of engine.project.slides) {
          const kfs = slide.animation.node(parentNode.id)?.controlKeyframes(key) ?? []
          if (kfs.length > 0) {
            commands.push(
              new DeleteKeyframesCommand({
                target: { kind: 'control', nodeId: parentNode.id, controlKey: key },
                keyframeIds: kfs.map((kf) => kf.id),
              }) as unknown as import('../../engine/commands').Command<unknown>,
            )
          }
        }
      }
      commands.push(
        new SetControlSetCommand({
          nodeId: parentNode.id,
          controlSet: nextSet,
        }) as unknown as import('../../engine/commands').Command<unknown>,
      )
      if (commands.length === 1) {
        dispatch(commands[0] as never)
      } else {
        const tx = new TransactionCommand(commands as never)
        const result = dispatch(tx as never)
        if (!result.ok) {
          notify(result.error.message)
          return
        }
      }
      setDeleteControlConfirmKey(null)
      setTick((value) => value + 1)
      notify(`Deleted Control ${key}`)
    },
    [parentNode, engine, dispatch, notify],
  )

  const toggleControlExposure = useCallback(
    (controlKey: string) => {
      if (!parentNode?.controlSet) return
      dispatch(
        new SetControlSetCommand({
          nodeId: parentNode.id,
          controlSet: {
            ...parentNode.controlSet,
            controls: parentNode.controlSet.controls.map((control) =>
              control.key === controlKey ? { ...control, exposed: !control.exposed } : control,
            ),
          },
        }),
      )
      setTick((value) => value + 1)
    },
    [dispatch, parentNode],
  )
  const addControlKeyframe = useCallback(
    (controlKey: string, value: number) => {
      if (!parentNodeId || !activeSlide) return
      const time = usePlaybackController.getState().getTime(activeSlide.id)
      const result = dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: parentNodeId, controlKey },
          time,
          value: controlValues[controlKey] ?? value,
        }),
      )
      if (!result.ok) notify(result.error.message)
    },
    [parentNodeId, activeSlide, controlValues, dispatch, notify],
  )

  const handleAddTimeline = useCallback(
    (controlKey: string) => {
      if (!parentNode?.controlSet) return
      try {
        const nextSet = addGroupToControlSet(parentNode.controlSet, controlKey)
        const res = dispatch(
          new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }),
        )
        if (!res.ok) notify(res.error.message)
        else {
          // Pad existing host kfs with 0 for the new timeline gap
          const slide = engine.getActiveSlide()
          const anim = slide?.animation.node(parentNode.id)
          const kfs = anim?.controlKeyframes(controlKey) ?? []
          const expected = Math.max(
            0,
            nextSet.controls.find((c) => c.key === controlKey)!.groups.length - 1,
          )
          for (const kf of kfs) {
            while (kf.blend.length < expected) {
              ;(kf as { blend: readonly number[] }).blend = [...kf.blend, 0]
            }
          }
          setTick((v) => v + 1)
          notify(`Added Timeline to ${controlKey}`)
        }
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e))
      }
    },
    [parentNode, dispatch, notify, engine],
  )

  const handleRemoveTimeline = useCallback(
    (controlKey: string, groupId: string) => {
      if (!parentNode?.controlSet) return
      try {
        const control = parentNode.controlSet.controls.find((c) => c.key === controlKey)
        if (!control) return
        const groupIdx = control.groups.findIndex((g) => g.id === groupId)
        const nextSet = removeGroupFromControlSet(parentNode.controlSet, controlKey, groupId)
        const res = dispatch(
          new SetControlSetCommand({ nodeId: parentNode.id, controlSet: nextSet }),
        )
        if (!res.ok) notify(res.error.message)
        else {
          // Splice blend index from host kfs (removed gap = groupIdx>0 ? groupIdx-1 : 0)
          const slide = engine.getActiveSlide()
          const anim = slide?.animation.node(parentNode.id)
          const kfs = anim?.controlKeyframes(controlKey) ?? []
          const spliceIdx = groupIdx <= 0 ? 0 : groupIdx - 1
          for (const kf of kfs) {
            if (kf.blend.length > spliceIdx) {
              const next = [...kf.blend]
              next.splice(spliceIdx, 1)
              ;(kf as { blend: readonly number[] }).blend = next
            }
          }
          setTick((v) => v + 1)
          notify(`Removed Timeline from ${controlKey}`)
        }
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e))
      }
    },
    [parentNode, dispatch, notify, engine],
  )

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

  // Global orphan timeline bounds – unified across all tabs to slide duration (same as main timeline slider)
  const orphanTimelineBounds = useMemo(() => {
    if (activeTab !== 'orphans') return null
    if (flatOrphanEntries.length === 0) return null
    const slideDuration = activeSlide?.duration ?? 10
    const span = slideDuration
    const width = span * pps
    return { min: 0, max: slideDuration, span, width }
  }, [activeTab, flatOrphanEntries, pps, activeSlide?.duration])

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

  const addControlFromSelection = useCallback(() => {
    if (!parentNode) return
    if (selectedClipIds.size === 0) {
      notify('Select clip lanes in Clips tab first (Ctrl+click)')
      return
    }
    const bindings: Record<string, import('../../engine/control').ControlBindingValue> = {}
    const seen = new Set<string>()
    const rejected: string[] = []
    for (const id of selectedClipIds) {
      const info = instanceToNode.get(id)
      if (!info?.semanticName?.trim()) continue
      const sem = info.semanticName.trim()
      const dedupKey = `${sem}::${info.clipId}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      const count = descendantSemanticMap.get(sem)?.length ?? 0
      if (count === 0) {
        rejected.push(sem)
        continue
      }
      addBindingToRecord(
        bindings as Record<string, import('../../engine/control').ControlBindingValue>,
        sem,
        info.clipId,
      )
    }
    if (rejected.length > 0)
      notify(
        `Skipped ${rejected.join(', ')} — no descendant with that semanticName under ${parentNode.name}`,
      )
    if (Object.keys(bindings).length === 0) {
      notify(
        'No bindable clips — selected nodes need Semantic Name and at least one matching descendant',
      )
      return
    }
    const existing = new Set(parentNode.controlSet?.controls.map((control) => control.key) ?? [])
    let index = 1
    while (existing.has(`Control${index}`)) index += 1
    const control = createControl({
      key: `Control${index}`,
      label: `Control ${index}`,
      exposed: true,
      bindings,
    })
    dispatch(
      new SetControlSetCommand({
        nodeId: parentNode.id,
        controlSet: parentNode.controlSet
          ? { ...parentNode.controlSet, controls: [...parentNode.controlSet.controls, control] }
          : createControlSet(parentNode.id, [control]),
      }),
    )
    notify(`Control ${control.key} bound to ${Object.keys(bindings).length} semantic(s)`)
    setTick((value) => value + 1)
  }, [dispatch, parentNode, selectedClipIds, instanceToNode, descendantSemanticMap, notify])

  const attachSelectedToControl = useCallback(
    (controlKey: string) => {
      if (selectedClipIds.size === 0) {
        notify('Select clip lanes in Clips tab first (Ctrl+click)')
        return
      }
      const preview: Record<string, import('../../engine/control').ControlBindingValue> = {}
      const seen = new Set<string>()
      const rejected: string[] = []
      for (const id of selectedClipIds) {
        const info = instanceToNode.get(id)
        if (!info?.semanticName?.trim()) continue
        const sem = info.semanticName.trim()
        const dedupKey = `${sem}::${info.clipId}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        const count = descendantSemanticMap.get(sem)?.length ?? 0
        if (count === 0) {
          rejected.push(sem)
          continue
        }
        addBindingToRecord(
          preview as Record<string, import('../../engine/control').ControlBindingValue>,
          sem,
          info.clipId,
        )
      }
      if (rejected.length > 0)
        notify(
          `Skipped ${rejected.join(', ')} — no descendant with that semanticName under ${parentNode?.name ?? 'host'}`,
        )
      if (Object.keys(preview).length === 0) {
        notify('No bindable clips — selected nodes need Semantic Name and matching descendant')
        return
      }
      // Attach into Timeline 1 (groups are the source of truth; flat merges are
      // recomputed, so writing flat bindings alone would be discarded).
      const control = parentNode?.controlSet?.controls.find((c) => c.key === controlKey)
      const targetGroup = control?.groups[0]
      if (!control || !targetGroup || !parentNode?.controlSet) return
      const merged: Record<string, import('../../engine/control').ControlBindingValue> = {
        ...targetGroup.bindings,
      }
      for (const [sem, val] of Object.entries(preview)) {
        if (Array.isArray(val)) {
          for (const b of val as import('../../engine/control').ControlBinding[]) {
            addBindingToRecord(merged, sem, b)
          }
        } else {
          addBindingToRecord(merged, sem, val as import('../../engine/control').ControlBinding)
        }
      }
      writeControlGroupBindings(controlKey, targetGroup.id, merged)
      notify(
        `Attached ${Object.keys(preview).length} binding(s) to ${controlKey} → ${targetGroup.name}`,
      )
    },
    [
      selectedClipIds,
      instanceToNode,
      parentNode,
      writeControlGroupBindings,
      descendantSemanticMap,
      notify,
    ],
  )

  const collectionsForParent = useMemo(() => {
    void tick
    return engine.clipCollections.filter((c) =>
      matchesCollectionCategory(c, collectionCategoryFilter),
    )
  }, [engine, tick, collectionCategoryFilter])

  // Bulk offset targets: every binding in the category-filtered collection set.
  const bulkOffsetRows = useMemo((): BulkOffsetBindingRow[] => {
    void tick
    if (!parentNodeId) return []
    const rows: BulkOffsetBindingRow[] = []
    for (const col of collectionsForParent) {
      for (const [semanticName, clipId] of Object.entries(col.getBindingsObject())) {
        let clipName = clipId
        try {
          clipName = engine.getClip(clipId).name
        } catch {
          // keep the id when the bound clip is gone; the action reports it as missing
        }
        rows.push({
          collectionId: col.id,
          collectionName: col.name,
          semanticName,
          clipId,
          clipName,
          uses: countClipUses(engine, clipId),
        })
      }
    }
    return rows
  }, [collectionsForParent, engine, parentNodeId, tick])

  const handleBulkOffsetConfirm = useCallback(
    (selection: { clipIds: string[]; offsets: BulkOffsetMap }): string | null => {
      const result = executeBulkClipOffset(engine, dispatch, selection)
      if (!result.ok) return result.error
      setBulkOffsetOpen(false)
      setTick((value) => value + 1)
      notify(result.message)
      return null
    },
    [engine, dispatch, notify],
  )

  const bulkOffsetPreview = useCallback(
    (clipIds: string[], offsets: BulkOffsetMap): BulkOffsetPreview =>
      previewBulkClipOffset(engine, { clipIds, offsets }),
    [engine],
  )

  // Global distinct collection categories for the filter dropdowns.
  const allCollectionCategories = useMemo(() => {
    void tick
    return distinctCollectionCategories(engine.clipCollections)
  }, [engine, tick])

  // Collection placements packing (Spec 15-06) – derived from parentNode.collectionPlacements
  const packedCollectionLanes = useMemo(() => {
    void tick
    if (!parentNode) return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    const getCollection = (collectionId: string) => {
      try {
        return engine.getClipCollection(collectionId)
      } catch {
        return null
      }
    }
    // Preview overrides for collection drag (move/stretch)
    let preview: Map<string, { startTime: number; visualDuration?: number }> | undefined
    if (dragState && dragState.mode.startsWith('collection')) {
      preview = new Map()
      if (dragState.mode === 'collection-move') {
        // preview visual unchanged, only start
        const vd = visualDurationForCollectionPlacement(
          {
            id: dragState.placementId,
            collectionId: dragState.collectionId,
            parentNodeId: dragState.parentNodeId,
            startTime: dragState.initialStart,
          } as import('../../engine/collectionPlacement').CollectionPlacement,
          parentNode,
          getClip,
        )
        preview.set(dragState.placementId, {
          startTime: dragState.previewStart,
          visualDuration: vd,
        })
      } else if (
        dragState.mode === 'collection-resize-right' ||
        dragState.mode === 'collection-resize-left'
      ) {
        preview.set(dragState.placementId, {
          startTime: dragState.previewStart,
          visualDuration: dragState.previewVisual,
        })
      } else if (dragState.mode === 'collection-reorder') {
        // For reorder preview, we need to simulate swapped order in packing – handled via virtual placements array order preview
        // For now, just use current placements but previewIndex will be used to reorder entries before packing
        // We'll handle in separate logic below
      }
    }
    // If reorder, we need to reorder parentNode.collectionPlacements virtually for packing preview
    if (dragState && dragState.mode === 'collection-reorder') {
      const placements = [...parentNode.collectionPlacements]
      const fromIdx = dragState.initialIndex
      const toIdx = dragState.previewIndex
      if (fromIdx !== toIdx) {
        const [moved] = placements.splice(fromIdx, 1)
        placements.splice(toIdx, 0, moved)
      }
      // Create a temporary parent node clone with reordered placements for packing
      const tmpParent = { ...parentNode, collectionPlacements: placements } as typeof parentNode
      return packCollectionLanesForParent(tmpParent, getClip, getCollection, pps, preview)
    }
    return packCollectionLanesForParent(parentNode, getClip, getCollection, pps, preview)
  }, [parentNode, engine, tick, pps, dragState])

  // Candidate times for snap – computed from committed state, excluding dragging instance/placement
  const snapCandidateTimes = useMemo(() => {
    if (!dragState) return []
    const isClipMove = dragState.mode === 'move'
    const isCollectionMove = dragState.mode === 'collection-move'
    if (!isClipMove && !isCollectionMove) return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    const getCollection = (collectionId: string) => {
      try {
        return engine.getClipCollection(collectionId)
      } catch {
        return null
      }
    }
    const nodes = managerRows.map((r) => r.node)
    if (isClipMove && parentNode) {
      const edges = collectUnifiedBarEdgesForSnap(
        parentNode,
        nodes,
        getClip,
        getCollection,
        { nodeId: dragState.nodeId, instanceId: dragState.instanceId },
        undefined,
      )
      if (activeSlide) {
        const playhead = usePlaybackController.getState().getTime(activeSlide.id)
        return [...edges, playhead]
      }
      return [...edges]
    }
    if (isCollectionMove && parentNode) {
      const edges = collectUnifiedBarEdgesForSnap(
        parentNode,
        nodes,
        getClip,
        getCollection,
        undefined,
        { placementId: dragState.placementId },
      )
      if (activeSlide) {
        const playhead = usePlaybackController.getState().getTime(activeSlide.id)
        return [...edges, playhead]
      }
      return [...edges]
    }
    return []
  }, [managerRows, parentNode, engine, dragState, activeSlide])

  // Delete/Backspace scoped handling – deletes only selected manager items, not whole object (capture to preempt global)
  useEffect(() => {
    if (!open) return
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      )
    }
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const isDelete = e.key === 'Delete' || e.key === 'Backspace'
      if (!isDelete) return
      if (
        reverseClipPrompt ||
        reverseCollectionPrompt ||
        mirrorClipPrompt ||
        collectionCreateOpen ||
        editingCollectionId ||
        deleteConfirmCollectionId ||
        deleteOrphansConfirm ||
        orphanExtraction ||
        bulkOffsetOpen
      ) {
        return
      }
      if (editing) return
      if (selectedPlacementId) {
        e.preventDefault()
        e.stopPropagation()
        try {
          ;(e as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
        } catch {
          void 0
        }
        const pid = selectedPlacementId
        const result = dispatch(new DeleteCollectionPlacementCommand({ placementId: pid }))
        if (!result.ok) notify(result.error.message)
        else notify(deletedPlacementMessage(result.inverse.memberInstances.length))
        setSelectedPlacementId(null)
        return
      }
      if (activeTab === 'orphans' && selectedOrphanIds.size > 0) {
        e.preventDefault()
        e.stopPropagation()
        try {
          ;(e as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
        } catch {
          void 0
        }
        const entries = flatOrphanEntries.filter((en) => selectedOrphanIds.has(en.keyframeId))
        if (entries.length === 0) return
        const groups = new Map<string, { target: KeyframeTarget; ids: string[] }>()
        for (const en of entries) {
          const t = en.target as KeyframeTarget
          let key: string
          if (t.kind === 'node' && 'property' in t)
            key = `node:${(t as { nodeId: string }).nodeId}:${(t as { property: string }).property}`
          else if (t.kind === 'node' && 'parameter' in t)
            key = `node-param:${(t as { nodeId: string }).nodeId}:${(t as { parameter: string }).parameter}`
          else if (t.kind === 'visible') key = `visible:${(t as { nodeId: string }).nodeId}`
          else if (t.kind === 'morph') key = `morph:${(t as { nodeId: string }).nodeId}`
          else if (t.kind === 'circle')
            key = `circle:${(t as { nodeId: string }).nodeId}:${(t as { property: string }).property}`
          else if (t.kind === 'shadow')
            key = `shadow:${(t as { nodeId: string }).nodeId}:${(t as { property: string }).property}`
          else if (t.kind === 'dataLabel')
            key = `dataLabel:${(t as { nodeId: string }).nodeId}:${(t as { label: string }).label}`
          else if (t.kind === 'table')
            key = `table:${(t as { nodeId: string }).nodeId}:${(t as { property: string }).property}`
          else if (t.kind === 'symmetry') key = `symmetry:${(t as { nodeId: string }).nodeId}`
          else if (t.kind === 'zIndex') key = `zIndex:${(t as { nodeId: string }).nodeId}`
          else key = `${t as { kind: string }}:${(t as { nodeId?: string }).nodeId ?? ''}`
          const entry = groups.get(key)
          if (entry) entry.ids.push(en.keyframeId)
          else groups.set(key, { target: t, ids: [en.keyframeId] })
        }
        const cmds = [...groups.values()].map(
          (g) => new DeleteKeyframesCommand({ target: g.target, keyframeIds: g.ids }),
        )
        if (cmds.length > 0) {
          const tx =
            cmds.length === 1 ? cmds[0] : new TransactionCommand(cmds as unknown as never[])
          const result = dispatch(tx as never)
          if (!result.ok) notify(result.error.message)
          else notify(`Deleted ${entries.length} orphan keyframe(s)`)
        }
        setSelectedOrphanIds(new Set())
        setOrphanAnchorId(null)
        return
      }
      if (activeTab === 'clips' && selectedClipIds.size > 0) {
        e.preventDefault()
        e.stopPropagation()
        try {
          ;(e as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
        } catch {
          void 0
        }
        const cmds: import('../../engine/commands').Command<unknown>[] = []
        for (const instId of selectedClipIds) {
          const info = instanceToNode.get(instId)
          if (!info) continue
          cmds.push(
            new RemoveClipCommand({
              nodeId: info.nodeId,
              instanceId: instId,
            }) as unknown as import('../../engine/commands').Command<unknown>,
          )
        }
        if (cmds.length > 0) {
          const tx =
            cmds.length === 1 ? cmds[0] : new TransactionCommand(cmds as unknown as never[])
          const result = dispatch(tx as never)
          if (!result.ok) notify(result.error.message)
          else notify(`Removed ${cmds.length} clip lane(s)`)
        }
        setSelectedClipIds(new Set())
        setClipAnchorId(null)
        setSelectedInstanceId(null)
        return
      }
      if (selectedClipIds.size > 0 || selectedOrphanIds.size > 0 || selectedPlacementId) {
        e.preventDefault()
        e.stopPropagation()
        try {
          ;(e as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
        } catch {
          void 0
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [
    open,
    editing,
    activeTab,
    selectedPlacementId,
    selectedOrphanIds,
    selectedClipIds,
    flatOrphanEntries,
    instanceToNode,
    dispatch,
    notify,
    reverseClipPrompt,
    reverseCollectionPrompt,
    mirrorClipPrompt,
    collectionCreateOpen,
    editingCollectionId,
    deleteConfirmCollectionId,
    deleteOrphansConfirm,
    orphanExtraction,
    bulkOffsetOpen,
  ])

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

  // --- Time-segment → collection batch flow (Orphans tab) ---
  // Flat source entries for the segment modal: every orphan keyframe with its
  // owner node's display name + semantic name for grouping and gating.
  const segmentEntries = useMemo((): SegmentSourceEntry[] => {
    void tick
    const meta = new Map(managerRows.map((r) => [r.node.id, r.node]))
    return flatOrphanEntries.map((e) => {
      let nodeName = e.nodeId.slice(0, 8)
      let semanticName: string | undefined
      const rowNode = meta.get(e.nodeId)
      if (rowNode) {
        nodeName = rowNode.name
        semanticName = rowNode.semanticName
      } else {
        try {
          const n = engine.getNode(e.nodeId)
          nodeName = n.name
          semanticName = n.semanticName
        } catch {
          // keep fallbacks
        }
      }
      return {
        nodeId: e.nodeId,
        nodeName,
        semanticName,
        paramKey: `${e.param.kind}:${e.param.key}`,
        paramLabel: e.param.label,
        target: e.target,
        time: e.keyframe.time,
        value: e.keyframe.value as unknown as ExtractableKeyframe['value'],
        interpolation: e.keyframe.interpolation,
        tangentIn: { time: e.keyframe.tangentIn.time, value: e.keyframe.tangentIn.value },
        tangentOut: { time: e.keyframe.tangentOut.time, value: e.keyframe.tangentOut.value },
        keyframeId: e.keyframe.id,
      }
    })
  }, [flatOrphanEntries, managerRows, engine, tick])

  // All clip placements on descendant nodes with precomputed timeline spans.
  // The segment wizard filters these by full containment in [from, to].
  const segmentClips = useMemo((): SegmentSourceClip[] => {
    void tick
    const out: SegmentSourceClip[] = []
    for (const row of managerRows) {
      for (const inst of row.node.clipInstances) {
        try {
          const clip = engine.getClip(inst.clipId)
          const start = inst.startTime
          out.push({
            nodeId: row.node.id,
            nodeName: row.node.name,
            semanticName: row.node.semanticName,
            instanceId: inst.id,
            clipId: inst.clipId,
            clipName: clip.name,
            start,
            end: start + visualDurationForClip(clip, inst),
          })
        } catch {
          // missing clip definition — skip
        }
      }
    }
    return out
  }, [managerRows, engine, tick])

  // Engine-backed evaluator for the segment wizard's bake previews.
  // (Methods read live engine state, so no tick dependency is needed.)
  const segmentBakingEvaluator = useMemo(
    () => ({
      getNode: (id: string) => engine.getNode(id),
      evaluateNode: (id: string, time: number) => engine.evaluateNode(id, time),
      evaluateCircle: (id: string, time: number) => engine.evaluateCircle(id, time),
      evaluateTable: (id: string, time: number) => engine.evaluateTable(id, time),
      evaluateShadow: (id: string, time: number) => engine.evaluateShadow(id, time),
      evaluateSymmetry: (id: string, time: number) => engine.evaluateSymmetry(id, time),
    }),
    [engine],
  )

  // Every descendant of the rigging-group parent with its depth (1 = direct
  // child). The segment wizard offers keyframe-less descendants within the
  // bake-depth slider as bake-only clips so static objects hold their pose.
  const segmentStaticNodes = useMemo((): {
    nodeId: string
    nodeName: string
    semanticName?: string
    depth: number
  }[] => {
    void tick
    if (!parentNode) return []
    const out: { nodeId: string; nodeName: string; semanticName?: string; depth: number }[] = []
    const walk = (node: SceneNode, depth: number): void => {
      for (const child of node.children) {
        out.push({
          nodeId: child.id,
          nodeName: child.name,
          semanticName: child.semanticName,
          depth,
        })
        walk(child, depth + 1)
      }
    }
    walk(parentNode, 1)
    return out
  }, [parentNode, tick])

  const handleSegmentConfirm = useCallback(
    (plan: SegmentCollectionPlan): string | null => {
      if (!parentNodeId) return 'No parent selected.'
      const result = executeSegmentToCollection(engine, dispatch, undoStack, {
        ...plan,
        parentNodeId,
      })
      if (!result.ok) return result.error
      setSegmentModalOpen(false)
      setSelectedOrphanIds(new Set())
      setOrphanAnchorId(null)
      setActiveTab('collections')
      const bits = [
        `Collection "${result.collectionName}" created — ${result.clips.length + result.reused.length} binding(s) (${result.extractedCount} keyframe(s)${result.reused.length > 0 ? `, ${result.reused.length} reused clip(s)` : ''})`,
      ]
      if (result.skippedCount > 0)
        bits.push(`${result.skippedCount} skipped (${result.skippedKinds.join(', ')})`)
      if (plan.deleteOrphans) bits.push(`deleted ${result.deletedCount} orphan(s)`)
      if (result.removedInstanceCount > 0)
        bits.push(`removed ${result.removedInstanceCount} clip placement(s)`)
      for (const w of result.warnings) bits.push(w)
      notify(bits.join(' · '))
      return null
    },
    [engine, dispatch, undoStack, parentNodeId, notify],
  )

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
    // default category from the active filter (All → blank = Uncategorized)
    if (collectionCategoryFilter !== ALL_COLLECTION_CATEGORIES) {
      setCollectionCategoryDraft(collectionCategoryFilter)
    }
    setCollectionLocalError(null)
    setCollectionCreateOpen(true)
  }, [
    selectedClipIds,
    hasOrphanInSubtree,
    flatOrphanEntries,
    collectionMissingSemantic,
    collectionNameDraft,
    collectionCategoryFilter,
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
      new CreateClipCollectionCommand({
        name,
        bindings,
        sourceNodeId: parentNodeId,
        ...(collectionCategoryDraft.trim() !== ''
          ? { category: collectionCategoryDraft.trim() }
          : {}),
      }),
    )
    if (!result.ok) {
      setCollectionLocalError(result.error.message)
      return
    }
    notify(`Created ClipCollection "${name}" (${Object.keys(bindings).length} bindings)`)
    setCollectionCreateOpen(false)
    setCollectionNameDraft('')
    setCollectionCategoryDraft('')
    setCollectionLocalError(null)
    // keep selection but maybe clear? Keep for edit
    // Do not clear selection to allow shared clip test
  }, [
    parentNodeId,
    hasOrphanInSubtree,
    flatOrphanEntries,
    collectionMissingSemantic,
    collectionNameDraft,
    collectionCategoryDraft,
    collectionBindingsPreview,
    dispatch,
    notify,
  ])

  const handleDeleteCollection = useCallback(
    (collectionId: string) => {
      const result = executeDeleteClipCollection(engine, dispatch, undoStack, collectionId)
      if (!result.ok) {
        notify(result.error)
        return
      }
      notify(result.message)
      setDeleteConfirmCollectionId(null)
    },
    [dispatch, notify, engine, undoStack],
  )

  const openEditCollection = useCallback(
    (collectionId: string) => {
      try {
        const col = engine.getClipCollection(collectionId)
        setEditingCollectionId(collectionId)
        setEditingBindingsDraft({ ...col.getBindingsObject() })
        setEditingNameDraft(col.name)
        setEditingCategoryDraft(col.category)
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
      if (editingCategoryDraft.trim() !== col.category) {
        const catResult = dispatch(
          new SetClipCollectionCategoryCommand({
            collectionId: editingCollectionId,
            category: editingCategoryDraft.trim(),
          }),
        )
        if (!catResult.ok) {
          setCollectionLocalError(catResult.error.message)
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
  }, [
    editingCollectionId,
    editingBindingsDraft,
    editingNameDraft,
    editingCategoryDraft,
    engine,
    dispatch,
    notify,
  ])

  // --- Fine-grained collection editing: flatten + replace (Spec 353) ---
  const openFlattenDialog = useCallback(() => {
    if (!editingCollectionId || !activeSlide) return
    try {
      const longest = longestClipDuration(engine, editingCollectionId)
      const playhead = usePlaybackController.getState().getTime(activeSlide.id) ?? 0
      const from = Math.max(0, playhead)
      const to = Math.min(activeSlide.duration, from + (longest > 0 ? longest : 1))
      setFlattenFromStr(formatSec(from))
      setFlattenToStr(formatSec(to > from ? to : Math.min(activeSlide.duration, from + 1)))
      setFlattenError(null)
      setFlattenOpen(true)
    } catch (e) {
      setCollectionLocalError(e instanceof Error ? e.message : String(e))
    }
  }, [editingCollectionId, activeSlide, engine])

  const handleFlattenConfirm = useCallback(() => {
    if (!editingCollectionId) return
    const from = parseSec(flattenFromStr)
    const to = parseSec(flattenToStr)
    if (from === null || to === null) {
      setFlattenError('Enter numeric From and To times.')
      return
    }
    const slideDuration = activeSlide?.duration ?? to
    const rangeErr = validateSegmentRange(from, to, slideDuration)
    if (rangeErr) {
      setFlattenError(rangeErr)
      return
    }
    const result = executeCollectionFlatten(engine, dispatch, undoStack, {
      collectionId: editingCollectionId,
      from,
      to,
    })
    if (!result.ok) {
      setFlattenError(result.error)
      return
    }
    setFlattenOpen(false)
    setFlattenError(null)
    const bits = [
      `Flattened ${result.writtenCount} keyframe(s) to [${formatSec(from)}s, ${formatSec(to)}s]`,
    ]
    for (const w of result.warnings) bits.push(w)
    notify(bits.join(' · '))
  }, [
    editingCollectionId,
    flattenFromStr,
    flattenToStr,
    activeSlide,
    engine,
    dispatch,
    undoStack,
    notify,
  ])

  const handleReplaceConfirm = useCallback(
    (plan: SegmentCollectionPlan): string | null => {
      if (!editingCollectionId) return 'No collection selected.'
      const result = executeSegmentToCollection(engine, dispatch, undoStack, {
        ...plan,
        parentNodeId: parentNodeId ?? plan.parentNodeId,
        collectionName: plan.collectionName,
        replaceCollectionId: editingCollectionId,
      })
      if (!result.ok) return result.error
      setReplaceOpen(false)
      try {
        const col = engine.getClipCollection(editingCollectionId)
        setEditingBindingsDraft({ ...col.getBindingsObject() })
        setEditingNameDraft(col.name)
        setEditingCategoryDraft(col.category)
      } catch {
        // collection still exists (replace never deletes it)
      }
      const bits = [
        `Collection "${result.collectionName}" replaced — ${result.clips.length + result.reused.length} binding(s) updated`,
      ]
      if (result.skippedCount > 0)
        bits.push(`${result.skippedCount} skipped (${result.skippedKinds.join(', ')})`)
      if (plan.deleteOrphans) bits.push(`deleted ${result.deletedCount} orphan(s)`)
      if (result.deletedOldClipIds && result.deletedOldClipIds.length > 0)
        bits.push(`deleted ${result.deletedOldClipIds.length} old clip(s)`)
      for (const w of result.warnings) bits.push(w)
      notify(bits.join(' · '))
      return null
    },
    [editingCollectionId, engine, dispatch, undoStack, parentNodeId, notify],
  )

  const replaceSeed = useMemo(() => {
    if (!editingCollectionId)
      return { clipNamesByNode: {}, collectionName: '', collectionCategory: '' }
    let collectionName = ''
    let collectionCategory = ''
    const clipNamesBySemantic = new Map<string, string>()
    try {
      const col = engine.getClipCollection(editingCollectionId)
      collectionName = col.name
      collectionCategory = col.category
      for (const [sem, clipId] of col.bindings) {
        try {
          clipNamesBySemantic.set(sem.trim(), engine.getClip(clipId).name)
        } catch {
          continue
        }
      }
    } catch {
      return { clipNamesByNode: {}, collectionName: '', collectionCategory: '' }
    }
    const clipNamesByNode: Record<string, string> = {}
    for (const row of managerRows) {
      const sem = row.node.semanticName?.trim()
      if (!sem) continue
      const bound = clipNamesBySemantic.get(sem)
      if (bound) clipNamesByNode[row.node.id] = bound
    }
    return { clipNamesByNode, collectionName, collectionCategory }
  }, [editingCollectionId, engine, managerRows, tick])

  // Marquee drag for orphans – threshold 5px, handle-excluded
  const handleOrphansPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (activeTab !== 'orphans') return
      const target = e.target as HTMLElement
      // handle-excluded: if click is on diamond or its handle area, don't start marquee
      if (target.closest('[data-testid^="orphan-diamond"]')) return
      if (target.closest('[data-testid="orphan-context-menu"]')) return
      if (target.closest('[data-testid="clip-extraction-modal"]')) return
      if (target.closest('[data-testid^="manager-toggle-"]')) return
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
        const movePps = dragState.effectivePps ?? pps
        const raw = dragState.initialStart + deltaPx / movePps
        const clampedRaw = Math.max(0, raw)
        const snapped = gridSnapEnabled
          ? snapStartTime(clampedRaw, movePps, true, snapCandidateTimes)
          : clampedRaw
        setDragState((prev) => (prev ? ({ ...prev, previewStart: snapped } as DragState) : prev))
      } else if (dragState.mode === 'resize-right') {
        const resizePps = dragState.effectivePps ?? pps
        const newWidthPx = dragState.initialVisual * resizePps + deltaPx
        let newVisual = newWidthPx / resizePps
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
        const resizePps = dragState.effectivePps ?? pps
        const deltaSec = deltaPx / resizePps
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
      } else if (dragState.mode === 'collection-move') {
        const deltaY = e.clientY - dragState.startY
        // Check for vertical dominance -> switch to reorder
        if (Math.abs(deltaY) > Math.abs(deltaPx) && Math.abs(deltaY) > 8) {
          const newIndex = Math.max(
            0,
            Math.min(
              (parentNode?.collectionPlacements.length ?? 1) - 1,
              Math.round(dragState.initialIndex + deltaY / CLIP_LANE_HEIGHT_PX),
            ),
          )
          setDragState((prev) =>
            prev && prev.mode === 'collection-move'
              ? ({
                  mode: 'collection-reorder',
                  placementId: prev.placementId,
                  parentNodeId: prev.parentNodeId,
                  initialIndex: prev.initialIndex,
                  startY: prev.startY,
                  previewIndex: newIndex,
                  startX: prev.startX,
                  initialStart: prev.initialStart,
                } as DragState)
              : prev,
          )
          return
        }
        const movePps = dragState.effectivePps ?? pps
        const raw = dragState.initialStart + deltaPx / movePps
        const clampedRaw = Math.max(0, raw)
        const snapped = gridSnapEnabled
          ? snapStartTime(clampedRaw, movePps, true, snapCandidateTimes)
          : clampedRaw
        setDragState((prev) => (prev ? ({ ...prev, previewStart: snapped } as DragState) : prev))
      } else if (dragState.mode === 'collection-resize-right') {
        const resizePps = dragState.effectivePps ?? pps
        const newWidthPx = dragState.initialVisual * resizePps + deltaPx
        let newVisual = newWidthPx / resizePps
        if (newVisual < MIN_VISUAL_DURATION) newVisual = MIN_VISUAL_DURATION
        // Clamp to slide duration
        if (activeSlide)
          newVisual = Math.min(newVisual, activeSlide.duration - dragState.initialStart)
        if (newVisual < MIN_VISUAL_DURATION) newVisual = MIN_VISUAL_DURATION
        setDragState((prev) =>
          prev
            ? ({
                ...prev,
                previewVisual: newVisual,
                previewStart: dragState.initialStart,
              } as DragState)
            : prev,
        )
      } else if (dragState.mode === 'collection-resize-left') {
        const resizePps = dragState.effectivePps ?? pps
        const deltaSec = deltaPx / resizePps
        const rawStart = dragState.initialStart + deltaSec
        const rightEdge = dragState.rightEdge
        let newVisualRaw = rightEdge - rawStart
        if (newVisualRaw < MIN_VISUAL_DURATION) newVisualRaw = MIN_VISUAL_DURATION
        let previewStart = rightEdge - newVisualRaw
        if (previewStart < 0) {
          previewStart = 0
          newVisualRaw = Math.max(rightEdge - previewStart, MIN_VISUAL_DURATION)
        }
        // Clamp to slide start
        if (previewStart < 0) previewStart = 0
        setDragState((prev) =>
          prev ? ({ ...prev, previewStart, previewVisual: newVisualRaw } as DragState) : prev,
        )
      } else if (dragState.mode === 'clip-reorder') {
        const deltaY = e.clientY - dragState.startY
        const newIndex = Math.max(
          0,
          Math.min(
            (managerRows.find((r) => r.node.id === dragState.nodeId)?.node.clipInstances.length ??
              1) - 1,
            Math.round(dragState.initialIndex + deltaY / CLIP_LANE_HEIGHT_PX),
          ),
        )
        setDragState((prev) => (prev ? ({ ...prev, previewIndex: newIndex } as DragState) : prev))
      } else if (dragState.mode === 'collection-reorder') {
        const deltaY = e.clientY - dragState.startY
        const newIndex = Math.max(
          0,
          Math.min(
            (parentNode?.collectionPlacements.length ?? 1) - 1,
            Math.round(dragState.initialIndex + deltaY / CLIP_LANE_HEIGHT_PX),
          ),
        )
        setDragState((prev) => (prev ? ({ ...prev, previewIndex: newIndex } as DragState) : prev))
      } else if (dragState.mode === 'interval-move') {
        const deltaY = e.clientY - dragState.startY
        if (Math.abs(deltaY) > Math.abs(deltaPx) && Math.abs(deltaY) > 8) {
          // Switch to reorder if vertical dominant — use flat index for array-per-semantic.
          // Per-timeline lane drags reorder within their own timeline.
          // Collection blocks reorder within their own sub-list (indices address
          // collectionBlocks, not the clip flat list).
          const control = parentNode?.controlSet?.controls.find(
            (c) => c.key === dragState.controlKey,
          )
          const reorderGroupId = (dragState as unknown as { groupId?: string }).groupId
          const reorderKind = (dragState as unknown as { kind?: string }).kind
          const reorderBlockId = (dragState as unknown as { blockId?: string }).blockId
          const reorderScope =
            reorderGroupId !== undefined
              ? control?.groups.find((g) => g.id === reorderGroupId)?.bindings
              : control?.bindings
          let initialIdx = 0
          let count = 1
          if (reorderKind === 'collection' && reorderGroupId !== undefined && control) {
            const blocks = groupCollectionBlocks(
              control.groups.find((g) => g.id === reorderGroupId),
            )
            const found = blocks.findIndex((b) => b.id === reorderBlockId)
            initialIdx = found !== -1 ? found : 0
            count = Math.max(blocks.length, 1)
          } else if (control && reorderScope) {
            const flat = flattenControlBindings(
              reorderScope as unknown as Record<
                string,
                import('../../engine/control').ControlBindingValue
              >,
            )
            const dragWithClip = dragState as unknown as {
              clipId?: string
              initialStart?: number
              initialEnd?: number
            }
            const EPS = 1e-9
            const found = flat.findIndex((f) => {
              if (f.semantic !== dragState.semanticName) return false
              const bClip =
                typeof f.binding === 'string'
                  ? (f.binding as string)
                  : (f.binding as { clipId: string }).clipId
              if (dragWithClip.clipId !== undefined && bClip !== dragWithClip.clipId) return false
              const bStart =
                typeof f.binding === 'string' ? 0 : (f.binding as { start: number }).start
              const bEnd = typeof f.binding === 'string' ? 1 : (f.binding as { end: number }).end
              if (
                dragWithClip.initialStart !== undefined &&
                Math.abs(bStart - dragWithClip.initialStart) > EPS
              )
                return false
              if (
                dragWithClip.initialEnd !== undefined &&
                Math.abs(bEnd - dragWithClip.initialEnd) > EPS
              )
                return false
              return true
            })
            if (found !== -1) initialIdx = found
            else initialIdx = flat.findIndex((f) => f.semantic === dragState.semanticName)
            if (initialIdx === -1) initialIdx = 0
            count = flat.length
          } else {
            initialIdx = 0
          }
          setDragState({
            mode: 'interval-reorder',
            nodeId: dragState.nodeId,
            controlKey: dragState.controlKey,
            ...(reorderGroupId !== undefined ? { groupId: reorderGroupId } : {}),
            ...(reorderKind === 'collection' && reorderBlockId !== undefined
              ? { kind: 'collection' as const, blockId: reorderBlockId }
              : {}),
            semanticName: dragState.semanticName,
            initialIndex: initialIdx >= 0 ? initialIdx : 0,
            previewIndex: Math.max(
              0,
              Math.min(
                count - 1,
                Math.round((initialIdx >= 0 ? initialIdx : 0) + deltaY / CLIP_LANE_HEIGHT_PX),
              ),
            ),
            startY: dragState.startY,
            startX: dragState.startX,
          } as DragState)
          return
        }
        const dragWithLaneMove = dragState as unknown as {
          effectivePps?: number
          laneWidth?: number
        }
        const rawLaneWidth = dragWithLaneMove.laneWidth
        const ppsForMove =
          rawLaneWidth !== undefined && rawLaneWidth > 1
            ? rawLaneWidth
            : (dragWithLaneMove.effectivePps ?? pps)
        const deltaU = deltaPx / (ppsForMove > 1e-9 ? ppsForMove : pps)
        const span = dragState.span
        let newStart = dragState.initialStart + deltaU
        let newEnd = newStart + span
        // Clamp to [0,1]
        if (newStart < 0) {
          newStart = 0
          newEnd = span
        }
        if (newEnd > 1) {
          newEnd = 1
          newStart = 1 - span
        }
        if (newEnd - newStart < CONTROL_INTERVAL_MIN_SPAN) {
          // Preserve span guard
          if (deltaU > 0) newEnd = newStart + CONTROL_INTERVAL_MIN_SPAN
          else newStart = newEnd - CONTROL_INTERVAL_MIN_SPAN
        }
        setDragState((prev) =>
          prev ? ({ ...prev, previewStart: newStart, previewEnd: newEnd } as DragState) : prev,
        )
      } else if (dragState.mode === 'interval-resize-left') {
        const dragWithLaneLeft = dragState as unknown as {
          effectivePps?: number
          laneWidth?: number
        }
        const rawLaneLeft = dragWithLaneLeft.laneWidth
        const ppsForLeft =
          rawLaneLeft !== undefined && rawLaneLeft > 1
            ? rawLaneLeft
            : (dragWithLaneLeft.effectivePps ?? pps)
        const deltaU = deltaPx / (ppsForLeft > 1e-9 ? ppsForLeft : pps)
        let newStart = dragState.initialStart + deltaU
        newStart = Math.max(0, Math.min(newStart, dragState.initialEnd - CONTROL_INTERVAL_MIN_SPAN))
        if (dragState.initialEnd - newStart < CONTROL_INTERVAL_MIN_SPAN)
          newStart = dragState.initialEnd - CONTROL_INTERVAL_MIN_SPAN
        setDragState((prev) =>
          prev
            ? ({ ...prev, previewStart: newStart, previewEnd: dragState.initialEnd } as DragState)
            : prev,
        )
      } else if (dragState.mode === 'interval-resize-right') {
        const dragWithLaneRight = dragState as unknown as {
          effectivePps?: number
          laneWidth?: number
        }
        const rawLaneRight = dragWithLaneRight.laneWidth
        const ppsForRight =
          rawLaneRight !== undefined && rawLaneRight > 1
            ? rawLaneRight
            : (dragWithLaneRight.effectivePps ?? pps)
        const deltaU = deltaPx / (ppsForRight > 1e-9 ? ppsForRight : pps)
        let newEnd = dragState.initialEnd + deltaU
        newEnd = Math.min(1, Math.max(newEnd, dragState.initialStart + CONTROL_INTERVAL_MIN_SPAN))
        if (newEnd - dragState.initialStart < CONTROL_INTERVAL_MIN_SPAN)
          newEnd = dragState.initialStart + CONTROL_INTERVAL_MIN_SPAN
        setDragState((prev) =>
          prev
            ? ({ ...prev, previewStart: dragState.initialStart, previewEnd: newEnd } as DragState)
            : prev,
        )
      } else if (dragState.mode === 'interval-reorder') {
        const deltaY = e.clientY - dragState.startY
        const control = parentNode?.controlSet?.controls.find((c) => c.key === dragState.controlKey)
        const reorderDrag = dragState as unknown as {
          kind?: string
          groupId?: string
        }
        // Collection blocks reorder within their own sub-list; clip blocks use
        // the (legacy merged) flat count. Group-scoped clip counts are resolved
        // at commit time by reorderGroupBinding.
        const count =
          reorderDrag.kind === 'collection' && reorderDrag.groupId && control
            ? Math.max(
                groupCollectionBlocks(control.groups.find((g) => g.id === reorderDrag.groupId))
                  .length,
                1,
              )
            : control
              ? flattenControlBindings(
                  control.bindings as unknown as Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  >,
                ).length
              : 1
        const newIndex = Math.max(
          0,
          Math.min(count - 1, Math.round(dragState.initialIndex + deltaY / CLIP_LANE_HEIGHT_PX)),
        )
        setDragState((prev) => (prev ? ({ ...prev, previewIndex: newIndex } as DragState) : prev))
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
      } else if (current.mode === 'collection-move') {
        const delta = current.previewStart - current.initialStart
        if (Math.abs(delta) > 1e-6) {
          try {
            const members = (
              engine as unknown as {
                getPlacementMembers: (id: string) => {
                  nodeId: string
                  instance: import('../../engine/clipInstance').ClipInstance
                }[]
              }
            ).getPlacementMembers(current.placementId)
            const cmds: import('../../engine/commands').Command<unknown>[] = []
            // Update placement start
            cmds.push(
              new SetCollectionPlacementStartTimeCommand({
                placementId: current.placementId,
                startTime: current.previewStart,
              }),
            )
            // Move all members by same delta (v1 zero-offset)
            for (const m of members) {
              const newStart = m.instance.startTime + delta
              cmds.push(
                new SetClipInstanceStartTimeCommand({
                  nodeId: m.nodeId,
                  instanceId: m.instance.id,
                  startTime: Math.max(0, newStart),
                }),
              )
            }
            const tx = new TransactionCommand(cmds as never)
            dispatch(tx)
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
          }
        }
      } else if (
        current.mode === 'collection-resize-right' ||
        current.mode === 'collection-resize-left'
      ) {
        const oldVisual = current.initialVisual
        const newVisual = current.previewVisual
        const factor = oldVisual / newVisual
        if (Math.abs(factor - 1) > 1e-9 && Number.isFinite(factor) && factor > 0) {
          try {
            const members = (
              engine as unknown as {
                getPlacementMembers: (id: string) => {
                  nodeId: string
                  instance: import('../../engine/clipInstance').ClipInstance
                }[]
              }
            ).getPlacementMembers(current.placementId)
            const cmds: import('../../engine/commands').Command<unknown>[] = []
            // If left handle, placement start changed
            if (
              current.mode === 'collection-resize-left' &&
              Math.abs(current.previewStart - current.initialStart) > 1e-6
            ) {
              cmds.push(
                new SetCollectionPlacementStartTimeCommand({
                  placementId: current.placementId,
                  startTime: Math.max(0, current.previewStart),
                }),
              )
              for (const m of members) {
                const deltaStart = current.previewStart - current.initialStart
                const newStart = m.instance.startTime + deltaStart
                cmds.push(
                  new SetClipInstanceStartTimeCommand({
                    nodeId: m.nodeId,
                    instanceId: m.instance.id,
                    startTime: Math.max(0, newStart),
                  }),
                )
              }
            }
            // Uniform stretch: newSpeed = oldSpeed * oldVisual / newVisual (clamped per member)
            for (const m of members) {
              const clip = engine.getClip(m.instance.clipId)
              const oldSpeed = m.instance.speed
              let newSpeed = oldSpeed * factor
              // Clamp per member MIN_VISUAL
              const maxAllowedSpeed = clip.duration / MIN_VISUAL_DURATION
              if (newSpeed > maxAllowedSpeed) newSpeed = maxAllowedSpeed
              if (newSpeed < MIN_CLIP_SPEED) newSpeed = MIN_CLIP_SPEED
              // Recompute visual to ensure MIN_VISUAL
              const resultingVisual = clip.duration / newSpeed
              if (resultingVisual < MIN_VISUAL_DURATION - 1e-9)
                newSpeed = clip.duration / MIN_VISUAL_DURATION
              if (Math.abs(newSpeed - oldSpeed) > 1e-9) {
                cmds.push(
                  new SetClipInstanceSpeedCommand({
                    nodeId: m.nodeId,
                    instanceId: m.instance.id,
                    speed: newSpeed,
                  }),
                )
              }
            }
            if (cmds.length > 0) {
              const tx = new TransactionCommand(cmds as never)
              dispatch(tx)
            }
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
          }
        }
      } else if (current.mode === 'clip-reorder') {
        if (current.previewIndex !== current.initialIndex) {
          try {
            const cmd = new MoveClipLayerCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              newIndex: current.previewIndex,
            })
            dispatch(cmd)
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
          }
        }
      } else if (current.mode === 'collection-reorder') {
        if (current.previewIndex !== current.initialIndex) {
          try {
            const cmd = new ReorderCollectionPlacementCommand({
              parentNodeId: current.parentNodeId,
              placementId: current.placementId,
              newIndex: current.previewIndex,
            })
            dispatch(cmd)
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
          }
        }
      } else if (current.mode === 'interval-move') {
        const moved =
          Math.abs(current.previewStart - current.initialStart) > 1e-9 ||
          Math.abs(current.previewEnd - current.initialEnd) > 1e-9
        if (moved) {
          try {
            // Per-timeline lane drags commit into their own timeline.
            const groupDrag = current as unknown as { groupId?: string; clipId?: string }
            const collDrag = current as unknown as {
              kind?: string
              blockId?: string
              groupId?: string
            }
            if (collDrag.kind === 'collection' && collDrag.groupId && collDrag.blockId) {
              const ok = commitGroupCollectionIntervalEdit({
                controlKey: current.controlKey,
                groupId: collDrag.groupId,
                blockId: collDrag.blockId,
                previewStart: current.previewStart,
                previewEnd: current.previewEnd,
              })
              if (!ok) notify('Block not found in its timeline — no change applied')
            } else if (groupDrag.groupId) {
              const ok = commitGroupIntervalEdit({
                controlKey: current.controlKey,
                groupId: groupDrag.groupId,
                semanticName: current.semanticName,
                clipId: groupDrag.clipId,
                initialStart: current.initialStart,
                initialEnd: current.initialEnd,
                previewStart: current.previewStart,
                previewEnd: current.previewEnd,
              })
              if (!ok) notify('Block not found in its timeline — no change applied')
            } else {
              const ctrl = parentNode?.controlSet?.controls.find(
                (c) => c.key === current.controlKey,
              )
              const flatLen = ctrl
                ? flattenControlBindings(
                    ctrl.bindings as unknown as Record<
                      string,
                      import('../../engine/control').ControlBindingValue
                    >,
                  ).length
                : 0
              const keyLen = ctrl ? Object.keys(ctrl.bindings).length : 0
              const dragWithClip = current as unknown as {
                clipId?: string
                initialStart: number
                initialEnd: number
              }
              if (ctrl && flatLen !== keyLen && dragWithClip.clipId) {
                // flat-aware update for duplicate semantics — epsilon tolerant
                const flat = flattenControlBindings(
                  ctrl.bindings as unknown as Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  >,
                )
                const EPS = 1e-9
                const idx = flat.findIndex((f) => {
                  if (f.semantic !== current.semanticName) return false
                  const cid =
                    typeof f.binding === 'string'
                      ? (f.binding as string)
                      : (f.binding as { clipId: string }).clipId
                  if (cid !== dragWithClip.clipId) return false
                  const s =
                    typeof f.binding === 'string' ? 0 : (f.binding as { start: number }).start
                  const e = typeof f.binding === 'string' ? 1 : (f.binding as { end: number }).end
                  return (
                    Math.abs(s - dragWithClip.initialStart) < EPS &&
                    Math.abs(e - dragWithClip.initialEnd) < EPS
                  )
                })
                if (idx !== -1) {
                  const target = flat[idx]!
                  const updated = {
                    clipId: dragWithClip.clipId!,
                    start: current.previewStart,
                    end: current.previewEnd,
                  }
                  flat[idx] = { semantic: target.semantic, binding: updated, index: target.index }
                  const rebuilt: Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  > = {}
                  for (const { semantic: s, binding: b } of flat) {
                    addBindingToRecord(
                      rebuilt,
                      s,
                      b as import('../../engine/control').ControlBinding,
                    )
                  }
                  const nextSet: import('../../engine/control').ControlSet = {
                    ...parentNode!.controlSet!,
                    controls: parentNode!.controlSet!.controls.map((c) =>
                      c.key === current.controlKey ? { ...c, bindings: rebuilt } : c,
                    ),
                  }
                  const res = dispatch(
                    new SetControlSetCommand({
                      nodeId: current.nodeId,
                      controlSet: nextSet,
                    }) as never,
                  )
                  if (!res.ok) notify(res.error.message)
                  else setTick((v) => v + 1)
                } else {
                  const cmd = new UpdateControlIntervalCommand({
                    nodeId: current.nodeId,
                    controlKey: current.controlKey,
                    semanticName: current.semanticName,
                    start: current.previewStart,
                    end: current.previewEnd,
                  })
                  const tx = new TransactionCommand([
                    cmd as unknown as import('../../engine/commands').Command<unknown>,
                  ])
                  const res = dispatch(tx as never)
                  if (!res.ok) notify(res.error.message)
                  else setTick((v) => v + 1)
                }
              } else {
                const cmd = new UpdateControlIntervalCommand({
                  nodeId: current.nodeId,
                  controlKey: current.controlKey,
                  semanticName: current.semanticName,
                  start: current.previewStart,
                  end: current.previewEnd,
                })
                const tx = new TransactionCommand([
                  cmd as unknown as import('../../engine/commands').Command<unknown>,
                ])
                const res = dispatch(tx as never)
                if (!res.ok) notify(res.error.message)
                else setTick((v) => v + 1)
              }
            } // end legacy (non-group) interval-move path
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
          }
        }
      } else if (
        current.mode === 'interval-resize-left' ||
        current.mode === 'interval-resize-right'
      ) {
        const moved =
          Math.abs(current.previewStart - current.initialStart) > 1e-9 ||
          Math.abs(current.previewEnd - current.initialEnd) > 1e-9
        if (moved) {
          try {
            // Per-timeline lane drags commit into their own timeline.
            const groupResize = current as unknown as { groupId?: string; clipId?: string }
            const collResize = current as unknown as {
              kind?: string
              blockId?: string
              groupId?: string
            }
            if (collResize.kind === 'collection' && collResize.groupId && collResize.blockId) {
              const ok = commitGroupCollectionIntervalEdit({
                controlKey: current.controlKey,
                groupId: collResize.groupId,
                blockId: collResize.blockId,
                previewStart: current.previewStart,
                previewEnd: current.previewEnd,
              })
              if (!ok) notify('Block not found in its timeline — no change applied')
            } else if (groupResize.groupId) {
              const ok = commitGroupIntervalEdit({
                controlKey: current.controlKey,
                groupId: groupResize.groupId,
                semanticName: current.semanticName,
                clipId: groupResize.clipId,
                initialStart: current.initialStart,
                initialEnd: current.initialEnd,
                previewStart: current.previewStart,
                previewEnd: current.previewEnd,
              })
              if (!ok) notify('Block not found in its timeline — no change applied')
            } else {
              const ctrl = parentNode?.controlSet?.controls.find(
                (c) => c.key === current.controlKey,
              )
              const flatLen = ctrl
                ? flattenControlBindings(
                    ctrl.bindings as unknown as Record<
                      string,
                      import('../../engine/control').ControlBindingValue
                    >,
                  ).length
                : 0
              const keyLen = ctrl ? Object.keys(ctrl.bindings).length : 0
              const dragWithClip = current as unknown as {
                clipId?: string
                initialStart: number
                initialEnd: number
              }
              if (ctrl && flatLen !== keyLen && dragWithClip.clipId) {
                const flat = flattenControlBindings(
                  ctrl.bindings as unknown as Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  >,
                )
                const EPS = 1e-9
                const idx = flat.findIndex((f) => {
                  if (f.semantic !== current.semanticName) return false
                  const cid =
                    typeof f.binding === 'string'
                      ? (f.binding as string)
                      : (f.binding as { clipId: string }).clipId
                  if (cid !== dragWithClip.clipId) return false
                  const s =
                    typeof f.binding === 'string' ? 0 : (f.binding as { start: number }).start
                  const e = typeof f.binding === 'string' ? 1 : (f.binding as { end: number }).end
                  return (
                    Math.abs(s - dragWithClip.initialStart) < EPS &&
                    Math.abs(e - dragWithClip.initialEnd) < EPS
                  )
                })
                if (idx !== -1) {
                  const target = flat[idx]!
                  const updated = {
                    clipId: dragWithClip.clipId!,
                    start: current.previewStart,
                    end: current.previewEnd,
                  }
                  flat[idx] = { semantic: target.semantic, binding: updated, index: target.index }
                  const rebuilt: Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  > = {}
                  for (const { semantic: s, binding: b } of flat) {
                    addBindingToRecord(
                      rebuilt,
                      s,
                      b as import('../../engine/control').ControlBinding,
                    )
                  }
                  const nextSet: import('../../engine/control').ControlSet = {
                    ...parentNode!.controlSet!,
                    controls: parentNode!.controlSet!.controls.map((c) =>
                      c.key === current.controlKey ? { ...c, bindings: rebuilt } : c,
                    ),
                  }
                  const res = dispatch(
                    new SetControlSetCommand({
                      nodeId: current.nodeId,
                      controlSet: nextSet,
                    }) as never,
                  )
                  if (!res.ok) notify(res.error.message)
                  else setTick((v) => v + 1)
                } else {
                  const cmd = new UpdateControlIntervalCommand({
                    nodeId: current.nodeId,
                    controlKey: current.controlKey,
                    semanticName: current.semanticName,
                    start: current.previewStart,
                    end: current.previewEnd,
                  })
                  const tx = new TransactionCommand([
                    cmd as unknown as import('../../engine/commands').Command<unknown>,
                  ])
                  const res = dispatch(tx as never)
                  if (!res.ok) notify(res.error.message)
                  else setTick((v) => v + 1)
                }
              } else {
                const cmd = new UpdateControlIntervalCommand({
                  nodeId: current.nodeId,
                  controlKey: current.controlKey,
                  semanticName: current.semanticName,
                  start: current.previewStart,
                  end: current.previewEnd,
                })
                const tx = new TransactionCommand([
                  cmd as unknown as import('../../engine/commands').Command<unknown>,
                ])
                const res = dispatch(tx as never)
                if (!res.ok) notify(res.error.message)
                else setTick((v) => v + 1)
              }
            } // end legacy (non-group) interval-resize path
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
          }
        }
      } else if (current.mode === 'interval-reorder') {
        if (current.previewIndex !== current.initialIndex) {
          try {
            // Per-timeline lane reorder commits into its own timeline.
            const groupReorder = current as unknown as { groupId?: string }
            const collReorder = current as unknown as {
              kind?: string
              blockId?: string
              groupId?: string
            }
            if (collReorder.kind === 'collection' && collReorder.groupId) {
              const ok = reorderGroupCollectionBlock({
                controlKey: current.controlKey,
                groupId: collReorder.groupId,
                fromIndex: current.initialIndex,
                toIndex: current.previewIndex,
              })
              if (!ok) notify('Block not found in its timeline — no change applied')
            } else if (groupReorder.groupId) {
              const ok = reorderGroupBinding({
                controlKey: current.controlKey,
                groupId: groupReorder.groupId,
                fromIndex: current.initialIndex,
                toIndex: current.previewIndex,
              })
              if (!ok) notify('Block not found in its timeline — no change applied')
            } else {
              const ctrl = parentNode?.controlSet?.controls.find(
                (c) => c.key === current.controlKey,
              )
              const flatLen = ctrl
                ? flattenControlBindings(
                    ctrl.bindings as unknown as Record<
                      string,
                      import('../../engine/control').ControlBindingValue
                    >,
                  ).length
                : 0
              const keyLen = ctrl ? Object.keys(ctrl.bindings).length : 0
              if (ctrl && flatLen !== keyLen) {
                // flat-aware reorder for duplicate semantics (array per semantic)
                const flat = flattenControlBindings(
                  ctrl.bindings as unknown as Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  >,
                )
                const [moved] = flat.splice(current.initialIndex, 1)
                flat.splice(current.previewIndex, 0, moved!)
                const rebuilt: Record<string, import('../../engine/control').ControlBindingValue> =
                  {}
                for (const { semantic: s, binding: b } of flat) {
                  addBindingToRecord(rebuilt, s, b as import('../../engine/control').ControlBinding)
                }
                const nextSet: import('../../engine/control').ControlSet = {
                  ...parentNode!.controlSet!,
                  controls: parentNode!.controlSet!.controls.map((c) =>
                    c.key === current.controlKey ? { ...c, bindings: rebuilt } : c,
                  ),
                }
                const res = dispatch(
                  new SetControlSetCommand({
                    nodeId: current.nodeId,
                    controlSet: nextSet,
                  }) as never,
                )
                if (!res.ok) notify(res.error.message)
                else setTick((v) => v + 1)
              } else {
                const cmd = new ReorderControlBindingCommand({
                  nodeId: current.nodeId,
                  controlKey: current.controlKey,
                  semanticName: current.semanticName,
                  newIndex: current.previewIndex,
                })
                const tx = new TransactionCommand([
                  cmd as unknown as import('../../engine/commands').Command<unknown>,
                ])
                const res = dispatch(tx as never)
                if (!res.ok) notify(res.error.message)
                else setTick((v) => v + 1)
              }
            } // end legacy (non-group) interval-reorder path
          } catch (e) {
            notify(e instanceof Error ? e.message : String(e))
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
  }, [
    dragState,
    pps,
    gridSnapEnabled,
    snapCandidateTimes,
    dispatch,
    managerRows,
    parentNode,
    activeSlide,
    engine,
    notify,
    commitGroupIntervalEdit,
    reorderGroupBinding,
    commitGroupCollectionIntervalEdit,
    reorderGroupCollectionBlock,
  ])

  if (!open) return null

  const handleBackdropClick = () => {
    if (reverseClipPrompt) {
      setReverseClipPrompt(null)
      return
    }
    if (mirrorClipPrompt) {
      setMirrorClipPrompt(null)
      return
    }
    if (reverseCollectionPrompt) {
      setReverseCollectionPrompt(null)
      return
    }
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
    if (deleteOrphansConfirm) {
      setDeleteOrphansConfirm(null)
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
    if (collectionPlacementMenu) {
      setCollectionPlacementMenu(null)
      return
    }
    if (controlBlockMenu) {
      setControlBlockMenu(null)
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

  const editingControlClip: ClipDefinition | null = (() => {
    if (!editingControl) return null
    const control = controls.find((entry) => entry.key === editingControl.key)
    const raw = editingControl.clipId || Object.values(control?.bindings ?? {})[0]
    const clipId = typeof raw === 'string' ? raw : (raw as { clipId?: string } | undefined)?.clipId
    if (!clipId) return null
    try {
      return engine.getClip(clipId)
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

  const handleEdit = (clipId: string, nodeId: string, instanceId?: string) => {
    // save pps before drill-in
    const currentZoom = useTimelineViewStore.getState().zoomLevel
    setSavedZoom(currentZoom)
    setEditing({ clipId, nodeId, instanceId })
    setClipMenu(null)
  }

  const handleEditControl = (controlKey: string) => {
    const control = controls.find((entry) => entry.key === controlKey)
    const raw = Object.values(control?.bindings ?? {})[0]
    const clipId = typeof raw === 'string' ? raw : (raw as { clipId?: string } | undefined)?.clipId
    if (!clipId) {
      notify('This Control has no clip binding — attach a clip in Controls tab first.')
      return
    }
    setSavedZoom(useTimelineViewStore.getState().zoomLevel)
    setEditingControl({ key: controlKey, clipId })
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
            ) : editingControl ? (
              <>
                <button
                  onClick={restorePpsAndBack}
                  data-testid="manager-control-back-button"
                  style={{ marginRight: 8, padding: '2px 8px', borderRadius: 4 }}
                >
                  ← Back
                </button>
                <span data-testid="manager-control-editing-header">
                  Editing Control: {editingControl.key} (0…1)
                </span>
              </>
            ) : parentNode ? (
              `Animation Manager — ${parentNode.name}`
            ) : (
              'Animation Manager'
            )}
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!editing && parentNode && (
              <button
                onClick={async () => {
                  if (!parentNodeId || !parentNode) return
                  try {
                    const json = engine.exportReusableObject(parentNodeId, parentNode.name)
                    const blob = new Blob([JSON.stringify(json, null, 2)], {
                      type: 'application/json',
                    })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    const safe =
                      parentNode.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_') ||
                      'object'
                    a.href = url
                    a.download = `${safe}.lesson_object`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    URL.revokeObjectURL(url)
                    try {
                      const file = new File([blob], `${safe}.lesson_object`, {
                        type: 'application/json',
                      })
                      const result = await assetsApi.uploadAssets([file], ['object'])
                      if (result.errors.length > 0) {
                        notify(result.errors.map((e) => `${e.filename}: ${e.error}`).join('; '))
                      }
                      if (result.created.length > 0) {
                        await useAssetLibraryStore.getState().loadLibrary()
                      }
                    } catch {
                      // backend down – still allow download
                    }
                    notify(`Exported hierarchy "${parentNode.name}"`)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                  }
                }}
                data-testid="manager-export-object"
                title="Export this hierarchy as .lesson_object (self-contained with clips/collections, downloadable + Library entry)"
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background: 'var(--color-bg, #fff)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Export .lesson_object
              </button>
            )}
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
                  color:
                    activeTab === 'collections'
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
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
                  color:
                    activeTab === 'clips'
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                }}
              >
                Clips
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'controls'}
                data-testid="manager-tab-controls"
                onClick={() => setActiveTab('controls')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: 'none',
                  background:
                    activeTab === 'controls' ? 'var(--color-accent, #7c5cff)' : 'transparent',
                  color:
                    activeTab === 'controls'
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                }}
              >
                Controls
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
                  color:
                    activeTab === 'orphans'
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                }}
              >
                Orphans
              </button>
            </div>
            {activeTab === 'controls' && parentNodeId && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  data-testid="manager-add-control"
                  onClick={() => addControl()}
                  style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >
                  Add Control
                </button>
                <button
                  data-testid="manager-add-control-from-selection"
                  onClick={() => addControlFromSelection()}
                  disabled={selectedClipIds.size === 0}
                  title={
                    selectedClipIds.size === 0
                      ? 'Select clip lanes in Clips tab first'
                      : `Create Control bound to ${selectedClipIds.size} selected lane(s)`
                  }
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    cursor: selectedClipIds.size > 0 ? 'pointer' : 'default',
                    fontSize: 12,
                    opacity: selectedClipIds.size > 0 ? 1 : 0.6,
                    border: '1px solid var(--color-border, #ddd)',
                    background:
                      selectedClipIds.size > 0
                        ? 'var(--color-accent, #7c5cff)'
                        : 'var(--color-bg-elevated, #eceef1)',
                    color:
                      selectedClipIds.size > 0
                        ? 'var(--color-accent-text, #fff)'
                        : 'var(--color-text-muted, #666)',
                  }}
                >
                  Add Control from selection
                  {selectedClipIds.size > 0 ? ` (${selectedClipIds.size})` : ''}
                </button>
                <button
                  data-testid="manager-toggle-authoring"
                  onClick={() => toggleAuthoringMode(parentNodeId)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: authoringMode
                      ? 'var(--color-accent, #7c5cff)'
                      : 'var(--color-bg-panel, #fff)',
                    color: authoringMode
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {authoringMode ? 'Hide internal lanes' : 'Show internal lanes'}
                </button>
              </div>
            )}
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
                  background:
                    selectedOrphanIds.size > 0
                      ? 'var(--color-accent, #7c5cff)'
                      : 'var(--color-bg-elevated, #eceef1)',
                  color:
                    selectedOrphanIds.size > 0
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                  cursor: selectedOrphanIds.size > 0 ? 'pointer' : 'default',
                  fontSize: 12,
                  opacity: selectedOrphanIds.size > 0 ? 1 : 0.6,
                }}
              >
                Add to clip… {selectedOrphanIds.size > 0 ? `(${selectedOrphanIds.size})` : ''}
              </button>
            )}
            {activeTab === 'orphans' && (
              <button
                data-testid="orphan-create-from-segment-button"
                onClick={() => setSegmentModalOpen(true)}
                disabled={flatOrphanEntries.length === 0 && segmentClips.length === 0}
                title={
                  flatOrphanEntries.length === 0 && segmentClips.length === 0
                    ? 'No orphan keyframes or clips in hierarchy'
                    : 'Pick a time segment → one clip per object + one collection (orphans and fully-contained clips)'
                }
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background:
                    flatOrphanEntries.length > 0 || segmentClips.length > 0
                      ? 'var(--color-accent, #7c5cff)'
                      : 'var(--color-bg-elevated, #eceef1)',
                  color:
                    flatOrphanEntries.length > 0 || segmentClips.length > 0
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                  cursor:
                    flatOrphanEntries.length > 0 || segmentClips.length > 0 ? 'pointer' : 'default',
                  fontSize: 12,
                  opacity: flatOrphanEntries.length > 0 || segmentClips.length > 0 ? 1 : 0.6,
                }}
              >
                From time segment…
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
                        : 'var(--color-bg-elevated, #eceef1)',
                    color:
                      selectedClipIds.size > 0 && !collectionBlockingError
                        ? 'var(--color-accent-text, #fff)'
                        : 'var(--color-text-muted, #666)',
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
              color: 'var(--color-danger, #c00)',
              background: 'color-mix(in srgb, var(--color-danger) 10%, var(--color-bg-panel))',
              border: '1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border))',
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

        {/* Collection Lanes top section (Spec 15-06) – single bar per placed collection, hidden internals.
            Collections tab only – no need to show it on clips/controls/orphans tabs. */}
        {!editing && parentNode && activeTab === 'collections' && (
          <div
            data-testid="collection-lanes-section"
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              padding: 8,
              background: 'var(--color-bg-panel, #fff)',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Collection Lanes</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                {parentNode.collectionPlacements.length} placed · parent: {parentNode.name}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={collectionCategoryFilter}
                  onChange={(e) => {
                    setCollectionCategoryFilter(e.target.value)
                    setPlaceCollectionId('')
                  }}
                  data-testid="place-collection-category-select"
                  title="Filter collections by category"
                  style={{
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                    fontSize: 12,
                    maxWidth: 160,
                  }}
                >
                  <option value={ALL_COLLECTION_CATEGORIES}>All categories</option>
                  <option value="">Uncategorized</option>
                  {allCollectionCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <select
                  value={placeCollectionId}
                  onChange={(e) => setPlaceCollectionId(e.target.value)}
                  data-testid="place-collection-select"
                  style={{
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                    fontSize: 12,
                  }}
                >
                  <option value="">Select collection…</option>
                  {collectionsForParent.map((col) => {
                    let rigSuffix = ''
                    try {
                      if (col.sourceNodeId)
                        rigSuffix = ` · ${engine.getNode(col.sourceNodeId).name}`
                    } catch {
                      rigSuffix = ''
                    }
                    const catLabel = col.category !== '' ? ` [${col.category}]` : ''
                    return (
                      <option key={col.id} value={col.id}>
                        {col.name} ({col.bindings.size}){catLabel}
                        {rigSuffix}
                      </option>
                    )
                  })}
                </select>
                <button
                  data-testid="place-collection-button"
                  disabled={!placeCollectionId}
                  onClick={() => {
                    if (!placeCollectionId || !parentNodeId || !activeSlide) return
                    const playhead = usePlaybackController.getState().getTime(activeSlide.id)
                    const result = dispatch(
                      new PlaceCollectionCommand({
                        collectionId: placeCollectionId,
                        parentNodeId,
                        startTime: playhead,
                      }),
                    )
                    if (!result.ok) {
                      notify(result.error.message)
                    } else {
                      notify(`Placed collection at ${playhead.toFixed(2)}s`)
                      setPlaceCollectionId('')
                    }
                  }}
                  title={
                    placeCollectionId
                      ? 'Place collection at playhead (speed=1, broadcast by semanticName)'
                      : 'Select a collection'
                  }
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: placeCollectionId
                      ? 'var(--color-accent, #7c5cff)'
                      : 'var(--color-bg-elevated, #eceef1)',
                    color: placeCollectionId
                      ? 'var(--color-accent-text, #fff)'
                      : 'var(--color-text-muted, #666)',
                    cursor: placeCollectionId ? 'pointer' : 'default',
                    fontSize: 12,
                  }}
                >
                  Place at playhead
                </button>
                <button
                  data-testid="reapply-collections-button"
                  disabled={parentNode.collectionPlacements.length === 0}
                  onClick={() => {
                    if (!parentNodeId) return
                    const result = executeReapplyClipCollections(
                      engine,
                      dispatch,
                      undoStack,
                      parentNodeId,
                    )
                    if (!result.ok) {
                      notify(result.error)
                    } else {
                      notify(result.message)
                      setSelectedPlacementId(null)
                    }
                  }}
                  title="Delete and re-place all collections under this parent at the same startTimes, re-binding current descendants by semanticName. Surviving lanes keep retime/respeed edits; placements with no matches are kept."
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background:
                      parentNode.collectionPlacements.length > 0
                        ? 'var(--color-bg-elevated, #eceef1)'
                        : 'var(--color-bg, #f5f5f5)',
                    color: 'var(--color-text, #1c1e21)',
                    cursor: parentNode.collectionPlacements.length > 0 ? 'pointer' : 'default',
                    fontSize: 12,
                  }}
                >
                  Refresh collections
                </button>
                <button
                  data-testid="collection-bulk-offset"
                  disabled={bulkOffsetRows.length === 0}
                  onClick={() => {
                    const seeds = new Set<string>()
                    for (const instId of selectedClipIds) {
                      const sem = instanceToNode.get(instId)?.semanticName?.trim()
                      if (sem) seeds.add(sem)
                    }
                    setBulkOffsetFilterSeed(seeds.size === 1 ? [...seeds][0]! : '')
                    setBulkOffsetOpen(true)
                  }}
                  title="Additively offset keyframe values across collection bindings filtered by semantic name (e.g. retarget a replaced head by +100 Y). Shared clips are edited in place."
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background:
                      bulkOffsetRows.length > 0
                        ? 'var(--color-bg-elevated, #eceef1)'
                        : 'var(--color-bg, #f5f5f5)',
                    color: 'var(--color-text, #1c1e21)',
                    cursor: bulkOffsetRows.length > 0 ? 'pointer' : 'default',
                    fontSize: 12,
                  }}
                >
                  Bulk offset…
                </button>
              </span>
            </div>
            {parentNode.collectionPlacements.length === 0 ? (
              <div
                data-testid="collection-lanes-empty"
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted, #666)',
                  padding: 8,
                  border: '1px dashed var(--color-border, #ddd)',
                  borderRadius: 4,
                  textAlign: 'center',
                }}
              >
                No placed collections. Select a collection above → Place at playhead.
              </div>
            ) : (
              (() => {
                const collectionSlideDuration = activeSlide?.duration ?? 10
                void collectionSlideDuration
                void pps
                return (
                  <div
                    ref={collectionScrollRef}
                    data-testid="collection-lanes"
                    style={{
                      position: 'relative',
                      border: '1px solid var(--color-border, #eee)',
                      borderRadius: 4,
                      background: 'var(--color-bg, #fafafa)',
                      overflowX: 'auto',
                      overflowY: 'hidden',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                    onScroll={(e) => {
                      const target = e.currentTarget as HTMLDivElement
                      const p = pixelsPerSecond(useTimelineViewStore.getState().zoomLevel)
                      const viewport = target.clientWidth > 0 ? target.clientWidth : 800
                      const duration = activeSlide?.duration ?? 10
                      useTimelineViewStore
                        .getState()
                        .setScrollTime(target.scrollLeft / p, viewport, duration)
                    }}
                  >
                    <div style={{ width: '100%' }}>
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: 22,
                          borderBottom: '1px solid var(--color-border, #ddd)',
                          background: 'var(--color-bg, #fff)',
                          overflow: 'hidden',
                        }}
                        data-testid="collection-ruler"
                      >
                        {(() => {
                          const span = collectionSlideDuration
                          const step = rulerTickStep(pps)
                          const ticks = rulerTickTimes(0, span, step)
                          return ticks.map((time) => (
                            <div
                              key={time}
                              data-testid={`collection-ruler-tick-${time}`}
                              style={{
                                position: 'absolute',
                                left: `${(time / span) * 100}%`,
                                top: 0,
                                bottom: 0,
                                borderLeft: '1px solid var(--color-border, #ddd)',
                                fontSize: 9,
                                color: 'var(--color-text-muted, #666)',
                                paddingLeft: 3,
                                display: 'flex',
                                alignItems: 'center',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {tickLabel(time, step)}s
                            </div>
                          ))
                        })()}
                        <div
                          data-testid="manager-collection-ruler-playhead"
                          style={{
                            position: 'absolute',
                            left: `${(currentPlayheadTime / collectionSlideDuration) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: 1,
                            background: 'var(--color-accent, #ff3b30)',
                            pointerEvents: 'none',
                            zIndex: 20,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: (() => {
                            const maxTrack =
                              packedCollectionLanes.length > 0
                                ? Math.max(...packedCollectionLanes.map((l) => l.track))
                                : 0
                            return (maxTrack + 1) * CLIP_LANE_HEIGHT_PX
                          })(),
                          minHeight: CLIP_LANE_HEIGHT_PX,
                        }}
                      >
                        <div
                          data-testid="manager-collection-playhead"
                          style={{
                            position: 'absolute',
                            left: `${(currentPlayheadTime / collectionSlideDuration) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: 1,
                            background: 'var(--color-accent, #ff3b30)',
                            pointerEvents: 'none',
                            zIndex: 500,
                          }}
                        />
                        {packedCollectionLanes.map((lane) => {
                          const isSelected = selectedPlacementId === lane.placement.id
                          const isDragging =
                            dragState &&
                            'placementId' in dragState &&
                            dragState.placementId === lane.placement.id
                          // Tooltip with collection name and bindings
                          let tooltip = lane.collection.name
                          try {
                            const bindings = [...lane.collection.bindings.entries()].map(
                              ([sem, clipId]) => {
                                try {
                                  return `${sem} → ${engine.getClip(clipId).name}`
                                } catch {
                                  return `${sem} → ${clipId.slice(0, 6)}`
                                }
                              },
                            )
                            if (bindings.length > 0) tooltip += `\n${bindings.join('\n')}`
                            tooltip += `\nstart ${lane.start.toFixed(2)}s visual ${lane.visualDuration.toFixed(2)}s`
                          } catch {
                            tooltip = lane.collection.name
                          }
                          const barStyle: React.CSSProperties = {
                            position: 'absolute',
                            left: `${(lane.start / collectionSlideDuration) * 100}%`,
                            width: `${(lane.visualDuration / collectionSlideDuration) * 100}%`,
                            top: lane.track * CLIP_LANE_HEIGHT_PX + 2,
                            height: CLIP_LANE_BAR_HEIGHT_PX,
                            background: isSelected ? 'var(--color-accent, #7c5cff)' : '#d4c5ff',
                            border: `1px solid ${isSelected ? '#4c1d95' : '#7c5cff'}`,
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 8px',
                            boxSizing: 'border-box',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex: lane.zIndex,
                            userSelect: 'none',
                            overflow: 'hidden',
                          }
                          const handleStyle = (side: 'left' | 'right'): React.CSSProperties => ({
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            width: CLIP_HANDLE_WIDTH_PX,
                            ...(side === 'left' ? { left: 0 } : { right: 0 }),
                            cursor: 'ew-resize',
                            background: 'rgba(0,0,0,0.06)',
                            borderLeft: side === 'left' ? '1px solid rgba(0,0,0,0.15)' : undefined,
                            borderRight:
                              side === 'right' ? '1px solid rgba(0,0,0,0.15)' : undefined,
                          })
                          const handlePointerDown = (
                            e: React.PointerEvent,
                            mode: 'collection-resize-left' | 'collection-resize-right',
                          ) => {
                            if (e.button !== 0) return
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedPlacementId(lane.placement.id)
                            const effectivePps = laneEffectivePps(
                              (e.currentTarget as HTMLElement).parentElement?.parentElement ?? null,
                              activeSlide?.duration ?? 10,
                            )
                            if (mode === 'collection-resize-right') {
                              setDragState({
                                mode: 'collection-resize-right',
                                placementId: lane.placement.id,
                                collectionId: lane.collection.id,
                                parentNodeId: parentNode.id,
                                initialStart: lane.start,
                                initialVisual: lane.visualDuration,
                                startX: e.clientX,
                                previewVisual: lane.visualDuration,
                                previewStart: lane.start,
                                effectivePps,
                              } as DragState)
                            } else {
                              const rightEdge = lane.start + lane.visualDuration
                              setDragState({
                                mode: 'collection-resize-left',
                                placementId: lane.placement.id,
                                collectionId: lane.collection.id,
                                parentNodeId: parentNode.id,
                                initialStart: lane.start,
                                initialVisual: lane.visualDuration,
                                rightEdge,
                                startX: e.clientX,
                                previewVisual: lane.visualDuration,
                                previewStart: lane.start,
                                effectivePps,
                              } as DragState)
                            }
                          }
                          const barPointerDown = (e: React.PointerEvent) => {
                            const target = e.target as HTMLElement
                            if (target.dataset.testid?.startsWith('collection-handle')) return
                            if (e.button !== 0) return
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedPlacementId(lane.placement.id)
                            // Check for multi-axis: record startY for reorder detection
                            const startY = e.clientY
                            const parent = parentNode
                            const initialIndex = parent.collectionPlacements.findIndex(
                              (p) => p.id === lane.placement.id,
                            )
                            setDragState({
                              mode: 'collection-move',
                              placementId: lane.placement.id,
                              collectionId: lane.collection.id,
                              parentNodeId: parent.id,
                              initialStart: lane.start,
                              initialVisual: lane.visualDuration,
                              startX: e.clientX,
                              previewStart: lane.start,
                              startY,
                              initialIndex: initialIndex === -1 ? lane.track : initialIndex,
                              previewIndex: initialIndex === -1 ? lane.track : initialIndex,
                              effectivePps: laneEffectivePps(
                                (e.currentTarget as HTMLElement).parentElement,
                                activeSlide?.duration ?? 10,
                              ),
                            } as DragState)
                          }
                          const handleContextMenu = (e: React.MouseEvent) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCollectionPlacementMenu({
                              x: e.clientX,
                              y: e.clientY,
                              placementId: lane.placement.id,
                            })
                          }
                          return (
                            <div
                              key={lane.placement.id}
                              data-testid={`collection-lane-${lane.placement.id}`}
                              data-placement-id={lane.placement.id}
                              data-track={String(lane.track)}
                              data-start={String(lane.start)}
                              data-visual={String(lane.visualDuration)}
                              data-selected={String(isSelected)}
                              title={tooltip}
                              style={barStyle}
                              onPointerDown={barPointerDown}
                              onContextMenu={handleContextMenu}
                              onClick={(e) => {
                                e.stopPropagation()
                                const target = e.target as HTMLElement
                                if (target.dataset.testid?.startsWith('collection-handle')) return
                                setSelectedPlacementId(lane.placement.id)
                              }}
                            >
                              <span
                                data-testid={`collection-lane-label-${lane.placement.id}`}
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  flex: 1,
                                  pointerEvents: 'none',
                                  color: isSelected ? 'var(--color-accent-text, #fff)' : '#2e2e2e',
                                }}
                              >
                                {lane.collection.name}
                              </span>
                              <div
                                data-testid={`collection-handle-left-${lane.placement.id}`}
                                data-handle="left"
                                style={handleStyle('left')}
                                onPointerDown={(e) =>
                                  handlePointerDown(e, 'collection-resize-left')
                                }
                              />
                              <div
                                data-testid={`collection-handle-right-${lane.placement.id}`}
                                data-handle="right"
                                style={handleStyle('right')}
                                onPointerDown={(e) =>
                                  handlePointerDown(e, 'collection-resize-right')
                                }
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })()
            )}
            <div style={{ fontSize: 10, color: 'var(--color-text-muted, #888)', marginTop: 4 }}>
              Drag body to move (horizontal) or reorder (vertical), drag edges to stretch uniformly
              (speed factor per member). Lower lane wins Priority.
            </div>
          </div>
        )}

        {/* Editor sub-view */}
        {editing && editingClip ? (
          <ManagerClipEditor
            clip={editingClip}
            nodeId={editing.nodeId}
            instanceId={editing.instanceId}
            pps={pps}
            onBack={restorePpsAndBack}
          />
        ) : editingControl && editingControlClip ? (
          (() => {
            const ctrl = controls.find((c) => c.key === editingControl.key)
            if (!ctrl) {
              return (
                <div data-testid="manager-control-editor" style={{ flex: 1, minHeight: 260 }}>
                  <div>Control not found</div>
                  <button onClick={restorePpsAndBack}>Back</button>
                </div>
              )
            }
            // Build preview overrides for drill-in Clip Blocks — use uniqueId for duplicate semantics
            const previewOverrides = new Map<string, { start: number; end: number }>()
            if (
              dragState &&
              (dragState.mode === 'interval-move' ||
                dragState.mode === 'interval-resize-left' ||
                dragState.mode === 'interval-resize-right') &&
              dragState.controlKey === ctrl.key
            ) {
              const ds = dragState as unknown as {
                semanticName: string
                clipId?: string
                kind?: string
                blockId?: string
                initialStart?: number
                initialEnd?: number
              }
              if (ds.kind === 'collection' && ds.blockId) {
                previewOverrides.set(`collection::${ds.blockId}`, {
                  start: dragState.previewStart,
                  end: dragState.previewEnd,
                })
              } else if (ds.clipId !== undefined) {
                // Find flat index for uniqueId: need to locate binding index for this clip+interval — epsilon tolerant
                const flat = flattenControlBindings(
                  ctrl.bindings as unknown as Record<
                    string,
                    import('../../engine/control').ControlBindingValue
                  >,
                )
                const EPS = 1e-9
                const found = flat.findIndex((f) => {
                  if (f.semantic !== ds.semanticName) return false
                  const cid =
                    typeof f.binding === 'string'
                      ? (f.binding as string)
                      : (f.binding as { clipId: string }).clipId
                  if (cid !== ds.clipId) return false
                  const bStart =
                    typeof f.binding === 'string' ? 0 : (f.binding as { start: number }).start
                  const bEnd =
                    typeof f.binding === 'string' ? 1 : (f.binding as { end: number }).end
                  if (ds.initialStart !== undefined && Math.abs(bStart - ds.initialStart) > EPS)
                    return false
                  if (ds.initialEnd !== undefined && Math.abs(bEnd - ds.initialEnd) > EPS)
                    return false
                  return true
                })
                const target = found !== -1 ? flat[found] : undefined
                if (target) {
                  previewOverrides.set(`${ds.semanticName}::${ds.clipId}::${target.index}`, {
                    start: dragState.previewStart,
                    end: dragState.previewEnd,
                  })
                } else {
                  // fallback to semantic alone (legacy single)
                  previewOverrides.set(dragState.semanticName, {
                    start: dragState.previewStart,
                    end: dragState.previewEnd,
                  })
                }
              } else {
                previewOverrides.set(dragState.semanticName, {
                  start: dragState.previewStart,
                  end: dragState.previewEnd,
                })
              }
            }
            // Also include reorder preview? Reorder doesn't affect geometry, just order
            const packed = packControlIntervalBlocks(
              ctrl,
              (id: string) => {
                try {
                  return engine.getClip(id)
                } catch {
                  return null
                }
              },
              pps,
              previewOverrides,
              (id: string) => {
                try {
                  return engine.getClipCollection(id)
                } catch {
                  return null
                }
              },
            )
            const maxTrack = packed.length > 0 ? Math.max(...packed.map((b) => b.track)) : 0
            const laneHeight = (maxTrack + 1) * CLIP_LANE_HEIGHT_PX
            const normalizedWidth = 1 * pps
            const step = rulerTickStep(pps)
            const ticks = rulerTickTimes(0, 1, step)
            // Determine header text for group-aware future: Editing Control: Name 0…1 / Editing Group: Face — Group 1 0…1
            // For now, handle control header; if ctrl has groups, show group variant when editingControl specifies group (future)
            const isGroupDrill =
              (editingControl as unknown as { groupId?: string }).groupId !== undefined
            const headerLabel = isGroupDrill
              ? `Editing Group: ${parentNode?.name ?? 'Host'} — ${ctrl.label} 0…1`
              : `Editing Control: ${ctrl.label} 0…1`
            return (
              <div
                data-testid="manager-control-editor"
                style={{
                  flex: 1,
                  minHeight: 260,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{ fontSize: 12, fontWeight: 600 }}
                  data-testid="manager-control-editing-header"
                >
                  {headerLabel}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                    fontSize: 11,
                    color: 'var(--color-text-muted, #666)',
                    borderBottom: '1px solid var(--color-border, #ddd)',
                  }}
                >
                  <span>0 CLOSED — 1 OPEN</span>
                  <span>
                    Control Interval → Clip Block · t ∈ [0, 1] · normalized (any duration)
                  </span>
                </div>
                {/* Normalized ruler 0…1 */}
                <div
                  data-testid="control-interval-ruler"
                  style={{
                    position: 'relative',
                    height: 22,
                    border: '1px solid var(--color-border, #ddd)',
                    borderRadius: 4,
                    background: 'var(--color-bg, #fafafa)',
                    overflow: 'hidden',
                    width: '100%',
                  }}
                >
                  {ticks.map((t) => (
                    <div
                      key={t}
                      data-testid={`control-interval-ruler-tick-${t}`}
                      style={{
                        position: 'absolute',
                        left: `${(t / 1) * 100}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: '1px solid var(--color-border, #ddd)',
                        fontSize: 9,
                        color: 'var(--color-text-muted, #666)',
                        paddingLeft: 3,
                        display: 'flex',
                        alignItems: 'center',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tickLabel(t, step)}
                    </div>
                  ))}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      bottom: 0,
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '0 6px',
                      alignItems: 'center',
                      fontSize: 9,
                      color: 'var(--color-text-muted, #999)',
                      pointerEvents: 'none',
                    }}
                  >
                    <span>0</span>
                    <span>1</span>
                  </div>
                </div>
                {/* Clip Blocks lane */}
                <div
                  data-testid="control-interval-lane"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: Math.max(laneHeight, CLIP_LANE_HEIGHT_PX),
                    minHeight: CLIP_LANE_HEIGHT_PX,
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
                      width: normalizedWidth,
                      height: '100%',
                      minWidth: '100%',
                    }}
                  >
                    {packed.map((block) => {
                      if (block.kind === 'collection') {
                        const resolved = (() => {
                          try {
                            return block.collectionId
                              ? engine.getClipCollection(block.collectionId)
                              : null
                          } catch {
                            return null
                          }
                        })()
                        const missing = resolved === null
                        const memberSemantics = resolved ? [...resolved.bindings.keys()] : []
                        const memberCount = resolved ? resolved.bindings.size : 0
                        const collectionName =
                          block.collectionName ??
                          resolved?.name ??
                          (block.collectionId ?? '').slice(0, 8)
                        const hoverKey = `collection::${block.blockId}`
                        const dragMatch =
                          !!dragState &&
                          (dragState.mode === 'interval-move' ||
                            dragState.mode === 'interval-resize-left' ||
                            dragState.mode === 'interval-resize-right') &&
                          (dragState as unknown as { controlKey: string }).controlKey ===
                            ctrl.key &&
                          (dragState as unknown as { kind?: string }).kind === 'collection' &&
                          (dragState as unknown as { blockId?: string }).blockId === block.blockId
                        const startForBlock = dragMatch
                          ? (dragState as unknown as { previewStart: number }).previewStart
                          : block.start
                        const endForBlock = dragMatch
                          ? (dragState as unknown as { previewEnd: number }).previewEnd
                          : block.end
                        const beginDrag = (
                          mode: 'interval-move' | 'interval-resize-left' | 'interval-resize-right',
                          e: React.PointerEvent,
                        ) => {
                          if (e.button !== 0 || !block.groupId || !block.blockId) return
                          e.preventDefault()
                          e.stopPropagation()
                          setDragState({
                            mode,
                            nodeId: parentNode!.id,
                            controlKey: ctrl.key,
                            groupId: block.groupId,
                            semanticName: '',
                            kind: 'collection',
                            blockId: block.blockId,
                            initialStart: block.start,
                            initialEnd: block.end,
                            span: block.end - block.start,
                            startX: e.clientX,
                            startY: e.clientY,
                            previewStart: startForBlock,
                            previewEnd: endForBlock,
                          } as unknown as DragState)
                        }
                        return (
                          <div
                            key={`collection::${block.blockId}::${block.priority}`}
                            data-testid={`collection-block-${ctrl.key}-${block.blockId}`}
                            data-collection={block.collectionId}
                            data-start={String(startForBlock)}
                            data-end={String(endForBlock)}
                            data-track={String(block.track)}
                            title={
                              missing
                                ? `▦ collection "${block.collectionId}" is missing (does nothing) — right-click to detach`
                                : `▦ ${collectionName} [${startForBlock.toFixed(3)}, ${endForBlock.toFixed(3)}] — ${memberCount} clip${memberCount === 1 ? '' : 's'}: ${memberSemantics.join(', ')} — drag body=move, edges=resize`
                            }
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (!block.groupId || !block.blockId) return
                              setControlBlockMenu({
                                x: e.clientX,
                                y: e.clientY,
                                controlKey: ctrl.key,
                                groupId: block.groupId,
                                semanticName: '',
                                clipId: '',
                                start: block.start,
                                end: block.end,
                                kind: 'collection',
                                blockId: block.blockId,
                                collectionId: block.collectionId,
                              })
                            }}
                            onMouseEnter={() =>
                              handleCollectionHoverEnter(block.blockId ?? '', memberSemantics)
                            }
                            onMouseLeave={handleBindingHoverLeave}
                            style={{
                              position: 'absolute',
                              left: block.left,
                              width: Math.max(block.width, 8),
                              top: block.track * CLIP_LANE_HEIGHT_PX + 2,
                              height: CLIP_LANE_BAR_HEIGHT_PX,
                              background:
                                dragMatch || hoveredBindingSemantic === hoverKey
                                  ? '#0e9f6e'
                                  : '#a7e3c7',
                              border: `1px solid ${dragMatch ? '#064e3b' : missing ? '#c00' : '#0e9f6e'}`,
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 8px',
                              boxSizing: 'border-box',
                              cursor: dragMatch ? 'grabbing' : 'grab',
                              zIndex: block.zIndex,
                              userSelect: 'none',
                              overflow: 'hidden',
                              opacity: dragMatch ? 0.95 : 1,
                            }}
                            onPointerDown={(e) => {
                              const target = e.target as HTMLElement
                              if (
                                target.dataset.handle === 'left' ||
                                target.dataset.handle === 'right'
                              )
                                return
                              beginDrag('interval-move', e)
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                flex: 1,
                                pointerEvents: 'none',
                                color: '#064e3b',
                              }}
                            >
                              {missing ? '⚠ ' : '▦ '}
                              {collectionName} ({memberCount})
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                fontFamily: 'monospace',
                                marginLeft: 6,
                                pointerEvents: 'none',
                                color: '#064e3b',
                              }}
                            >
                              [{startForBlock.toFixed(2)},{endForBlock.toFixed(2)}]
                            </span>
                            <div
                              data-handle="left"
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: CLIP_HANDLE_WIDTH_PX,
                                cursor: 'ew-resize',
                                background: 'rgba(0,0,0,0.08)',
                                borderRight: '1px solid rgba(0,0,0,0.15)',
                              }}
                              onPointerDown={(e) => beginDrag('interval-resize-left', e)}
                            />
                            <div
                              data-handle="right"
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: CLIP_HANDLE_WIDTH_PX,
                                cursor: 'ew-resize',
                                background: 'rgba(0,0,0,0.08)',
                                borderLeft: '1px solid rgba(0,0,0,0.15)',
                              }}
                              onPointerDown={(e) => beginDrag('interval-resize-right', e)}
                            />
                          </div>
                        )
                      }
                      const isDraggingMoveResize =
                        !!dragState &&
                        (dragState.mode === 'interval-move' ||
                          dragState.mode === 'interval-resize-left' ||
                          dragState.mode === 'interval-resize-right') &&
                        (dragState as unknown as { controlKey: string }).controlKey === ctrl.key &&
                        (dragState as unknown as { semanticName: string }).semanticName ===
                          block.semanticName &&
                        (() => {
                          const ds = dragState as unknown as { clipId?: string }
                          return ds.clipId === undefined || ds.clipId === block.clipId
                        })()
                      const isDraggingReorder =
                        !!dragState &&
                        dragState.mode === 'interval-reorder' &&
                        (dragState as unknown as { controlKey: string }).controlKey === ctrl.key &&
                        (dragState as unknown as { semanticName: string }).semanticName ===
                          block.semanticName
                      const isDragging = isDraggingMoveResize || isDraggingReorder
                      const left = block.left
                      const width = block.width
                      const clipName = block.clip?.name ?? block.clipId.slice(0, 8)
                      const duration = block.clip?.duration ?? 1
                      const uniqueKey = `${block.semanticName}::${block.clipId}::${block.priority}`
                      return (
                        <div
                          key={uniqueKey}
                          data-testid={`clip-block-${ctrl.key}-${block.semanticName}-${block.priority}`}
                          data-semantic={block.semanticName}
                          data-start={String(block.start)}
                          data-end={String(block.end)}
                          data-track={String(block.track)}
                          title={`${block.semanticName}: ${clipName} [${block.start.toFixed(3)}, ${block.end.toFixed(3)}] Priority ${block.priority} — drag body=move preserving width, edges=resize (span≥${CONTROL_INTERVAL_MIN_SPAN})`}
                          style={{
                            position: 'absolute',
                            left,
                            width: Math.max(width, 8),
                            top: block.track * CLIP_LANE_HEIGHT_PX + 2,
                            height: CLIP_LANE_BAR_HEIGHT_PX,
                            background: isDragging ? '#7c5cff' : '#b8a6ff',
                            border: `1px solid ${isDragging ? '#4c1d95' : '#7c5cff'}`,
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 8px',
                            boxSizing: 'border-box',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex: block.zIndex,
                            userSelect: 'none',
                            overflow: 'hidden',
                            opacity: isDragging ? 0.95 : 1,
                          }}
                          onPointerDown={(e) => {
                            const target = e.target as HTMLElement
                            if (
                              target.dataset.handle === 'left' ||
                              target.dataset.handle === 'right'
                            )
                              return
                            if (e.button !== 0) return
                            // Check for vertical reorder intent via shift? Use vertical dominance already in move handler
                            e.preventDefault()
                            e.stopPropagation()
                            const span = block.end - block.start
                            setDragState({
                              mode: 'interval-move',
                              nodeId: parentNode!.id,
                              controlKey: ctrl.key,
                              semanticName: block.semanticName,
                              clipId: block.clipId,
                              initialStart: block.start,
                              initialEnd: block.end,
                              span,
                              startX: e.clientX,
                              startY: e.clientY,
                              previewStart: block.start,
                              previewEnd: block.end,
                            } as DragState)
                          }}
                        >
                          <span
                            data-testid={`clip-block-label-${ctrl.key}-${block.semanticName}-${block.priority}`}
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              flex: 1,
                              pointerEvents: 'none',
                              color: '#2e1a6d',
                            }}
                          >
                            {block.semanticName} · {clipName} ({duration}s)
                          </span>
                          <span
                            data-testid={`clip-block-interval-${ctrl.key}-${block.semanticName}-${block.priority}`}
                            style={{
                              fontSize: 9,
                              fontFamily: 'monospace',
                              marginLeft: 6,
                              pointerEvents: 'none',
                              color: '#4c1d95',
                            }}
                          >
                            [{block.start.toFixed(2)},{block.end.toFixed(2)}]
                          </span>
                          {/* Resize handles */}
                          <div
                            data-testid={`clip-block-handle-left-${ctrl.key}-${block.semanticName}-${block.priority}`}
                            data-handle="left"
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: CLIP_HANDLE_WIDTH_PX,
                              cursor: 'ew-resize',
                              background: 'rgba(0,0,0,0.08)',
                              borderRight: '1px solid rgba(0,0,0,0.15)',
                            }}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return
                              e.preventDefault()
                              e.stopPropagation()
                              setDragState({
                                mode: 'interval-resize-left',
                                nodeId: parentNode!.id,
                                controlKey: ctrl.key,
                                semanticName: block.semanticName,
                                clipId: block.clipId,
                                initialStart: block.start,
                                initialEnd: block.end,
                                startX: e.clientX,
                                previewStart: block.start,
                                previewEnd: block.end,
                              } as DragState)
                            }}
                          />
                          <div
                            data-testid={`clip-block-handle-right-${ctrl.key}-${block.semanticName}-${block.priority}`}
                            data-handle="right"
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: CLIP_HANDLE_WIDTH_PX,
                              cursor: 'ew-resize',
                              background: 'rgba(0,0,0,0.08)',
                              borderLeft: '1px solid rgba(0,0,0,0.15)',
                            }}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return
                              e.preventDefault()
                              e.stopPropagation()
                              setDragState({
                                mode: 'interval-resize-right',
                                nodeId: parentNode!.id,
                                controlKey: ctrl.key,
                                semanticName: block.semanticName,
                                clipId: block.clipId,
                                initialStart: block.start,
                                initialEnd: block.end,
                                startX: e.clientX,
                                previewStart: block.start,
                                previewEnd: block.end,
                              } as DragState)
                            }}
                          />
                        </div>
                      )
                    })}
                    {/* Priority stacking hint */}
                    {packed.length === 0 && (
                      <div
                        style={{
                          padding: 12,
                          fontSize: 11,
                          color: 'var(--color-text-muted, #888)',
                          fontStyle: 'italic',
                        }}
                      >
                        No Clip Blocks — Add Block [0,1] then resize
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted, #888)' }}>
                  Drag body to move (preserve width), drag edges to resize (span ≥{' '}
                  {CONTROL_INTERVAL_MIN_SPAN}, overlap allowed). Vertical drag or ↑↓ reorders
                  Priority (insertion order, later wins, matches evaluator). Overlap via Priority
                  stacking as in clip lanes.
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    data-testid="control-interval-done"
                    onClick={restorePpsAndBack}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border, #ddd)',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Done
                  </button>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-muted, #666)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    Edits dispatch definition commands (Control Interval) grouped as Transactions
                    with undo/redo — no new KeyframeTarget kinds
                  </span>
                </div>
              </div>
            )
          })()
        ) : activeTab === 'controls' ? (
          <div
            data-testid="manager-controls"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
              {controls.length === 0
                ? `No Controls are defined on "${parentNode?.name ?? 'this rig'}".`
                : `${controls.length} Control${controls.length === 1 ? '' : 's'} · ${
                    controls.filter((control) => control.exposed).length
                  } exposed`}
            </div>
            <div
              style={{ fontSize: 11, color: 'var(--color-text-muted, #666)', fontStyle: 'italic' }}
            >
              Control Interval (model) / Clip Block (view) — intervals are definition data (on
              Control), not keyframed
            </div>
            <div
              ref={controlsScrollRef}
              data-testid="manager-controls-ruler"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 30,
                border: '1px solid var(--color-border, #eee)',
                borderRadius: 4,
                background: 'var(--color-bg, #fafafa)',
                overflowX: 'auto',
                overflowY: 'hidden',
                width: '100%',
                boxSizing: 'border-box',
              }}
              onScroll={(e) => {
                const target = e.currentTarget as HTMLDivElement
                const p = pixelsPerSecond(useTimelineViewStore.getState().zoomLevel)
                const viewport = target.clientWidth > 0 ? target.clientWidth : 800
                const duration = activeSlide?.duration ?? 10
                const next = target.scrollLeft / p
                if (Math.abs(useTimelineViewStore.getState().scrollTime - next) > 0.01) {
                  useTimelineViewStore.getState().setScrollTime(next, viewport, duration)
                }
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 22,
                  borderBottom: '1px solid var(--color-border, #ddd)',
                  background: 'var(--color-bg, #fff)',
                  overflow: 'hidden',
                }}
                data-testid="controls-ruler"
              >
                {(() => {
                  const span = activeSlide?.duration ?? 10
                  const step = rulerTickStep(pps)
                  const ticks = rulerTickTimes(0, span, step)
                  return ticks.map((time) => (
                    <div
                      key={time}
                      data-testid={`controls-ruler-tick-${time}`}
                      style={{
                        position: 'absolute',
                        left: `${(time / span) * 100}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: '1px solid var(--color-border, #ddd)',
                        fontSize: 9,
                        color: 'var(--color-text-muted, #666)',
                        paddingLeft: 3,
                        display: 'flex',
                        alignItems: 'center',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tickLabel(time, step)}s
                    </div>
                  ))
                })()}
                <div
                  data-testid="manager-controls-ruler-playhead"
                  style={{
                    position: 'absolute',
                    left: `${(currentPlayheadTime / (activeSlide?.duration ?? 10)) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: 'var(--color-accent, #ff3b30)',
                    pointerEvents: 'none',
                    zIndex: 20,
                  }}
                />
              </div>
            </div>
            {controls.map((control) => {
              const keyframes = activeSlide
                ? (activeSlide.animation.node(parentNodeId!)?.controlKeyframes(control.key) ?? [])
                : []
              const bindings = control.bindings ?? {}
              const flatBindings = flattenControlBindings(
                bindings as unknown as Record<
                  string,
                  import('../../engine/control').ControlBindingValue
                >,
              )
              return (
                <div
                  key={control.key}
                  data-testid={`manager-control-${control.key}`}
                  style={{
                    border:
                      highlightKey === control.key
                        ? '2px solid var(--color-accent, #7c5cff)'
                        : '1px solid var(--color-border, #ddd)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: highlightKey === control.key ? 'rgba(124,92,255,0.06)' : undefined,
                  }}
                >
                  {editingControlMeta?.key === control.key ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        data-testid={`manager-control-rename-input-${control.key}`}
                        value={editingControlMeta.draftLabel}
                        onChange={(e) =>
                          setEditingControlMeta({ key: control.key, draftLabel: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveControlMeta()
                          if (e.key === 'Escape') setEditingControlMeta(null)
                        }}
                        placeholder="Control label"
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          background: 'var(--color-bg, #fff)',
                          color: 'var(--color-text, #1c1e21)',
                          fontSize: 13,
                        }}
                        autoFocus
                      />
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                        {control.key}
                      </span>
                      <button
                        data-testid={`manager-control-rename-save-${control.key}`}
                        onClick={handleSaveControlMeta}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 4,
                          background: 'var(--color-accent, #7c5cff)',
                          color: 'var(--color-accent-text, #fff)',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Save
                      </button>
                      <button
                        data-testid={`manager-control-rename-cancel-${control.key}`}
                        onClick={() => setEditingControlMeta(null)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                    >
                      <div style={{ minWidth: 160, flex: '0 0 auto' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{control.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                          {control.key} · {control.exposed ? 'Exposed' : 'Internal'} ·{' '}
                          {keyframes.length} keyframe{keyframes.length === 1 ? '' : 's'} ·{' '}
                          {flatBindings.length} binding{flatBindings.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <input
                        aria-label={`${control.label} value`}
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={0.01}
                        value={controlValues[control.key] ?? control.default}
                        onChange={(event) =>
                          setControlValues((previous) => ({
                            ...previous,
                            [control.key]: Number(event.target.value),
                          }))
                        }
                        style={{ flex: 1, minWidth: 80 }}
                      />
                      <button
                        data-testid={`manager-control-rename-${control.key}`}
                        onClick={() => handleEditControlMeta(control.key)}
                        title="Rename control label"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Rename
                      </button>
                      <button
                        data-testid={`manager-control-delete-${control.key}`}
                        onClick={() => setDeleteControlConfirmKey(control.key)}
                        title="Delete control and its keyframes"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-danger, #c00)',
                          color: 'var(--color-danger, #c00)',
                          cursor: 'pointer',
                          fontSize: 12,
                          background: 'var(--color-bg-panel, #fff)',
                        }}
                      >
                        Delete
                      </button>
                      <button
                        data-testid={`manager-control-expose-${control.key}`}
                        onClick={() => toggleControlExposure(control.key)}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {control.exposed ? 'Hide' : 'Expose'}
                      </button>
                      <button
                        data-testid={`manager-control-edit-${control.key}`}
                        onClick={() => handleEditControl(control.key)}
                        disabled={flatBindings.length === 0}
                        title={
                          flatBindings.length === 0
                            ? 'No bindings — attach a clip first'
                            : 'Edit clip animation'
                        }
                        style={{
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: flatBindings.length === 0 ? 'default' : 'pointer',
                          fontSize: 12,
                          opacity: flatBindings.length === 0 ? 0.6 : 1,
                        }}
                      >
                        Edit Animation
                      </button>
                      <button
                        data-testid={`manager-control-keyframe-${control.key}`}
                        onClick={() =>
                          addControlKeyframe(
                            control.key,
                            controlValues[control.key] ?? control.default,
                          )
                        }
                        style={{
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Add keyframe
                      </button>
                    </div>
                  )}
                  {deleteControlConfirmKey === control.key && (
                    <div
                      data-testid={`manager-control-delete-confirm-${control.key}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        background:
                          'color-mix(in srgb, var(--color-danger) 10%, var(--color-bg-panel))',
                        border:
                          '1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border))',
                        borderRadius: 4,
                        fontSize: 12,
                        color: 'var(--color-text, #1c1e21)',
                      }}
                    >
                      <span>
                        Delete Control "{control.label}" ({control.key}) and its {keyframes.length}{' '}
                        keyframe(s)?
                      </span>
                      <button
                        data-testid={`manager-control-delete-confirm-yes-${control.key}`}
                        onClick={() => handleDeleteControl(control.key)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          background: 'var(--color-danger, #c00)',
                          color: 'var(--color-accent-text, #fff)',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Delete
                      </button>
                      <button
                        data-testid={`manager-control-delete-confirm-no-${control.key}`}
                        onClick={() => setDeleteControlConfirmKey(null)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {/* N timelines + blend-inside-host-kf: per-group lanes + Add/Remove Timeline + blend sliders */}
                  <div
                    data-testid={`manager-control-timelines-${control.key}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>
                        {control.groups.length} Timeline{control.groups.length === 1 ? '' : 's'}
                      </span>
                      <button
                        data-testid={`manager-control-add-timeline-${control.key}`}
                        onClick={() => handleAddTimeline(control.key)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        Add Timeline
                      </button>
                    </div>
                    {control.groups.map((group, gi) => (
                      <div
                        key={group.id}
                        data-testid={`manager-control-timeline-${control.key}-${gi}`}
                        style={{
                          border: '1px solid var(--color-border, #eee)',
                          borderRadius: 4,
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, minWidth: 90 }}>
                            T{gi + 1}: {group.name}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--color-text-muted, #666)' }}>
                            {Object.keys(group.bindings).length +
                              groupCollectionBlocks(group).length}{' '}
                            block
                            {Object.keys(group.bindings).length +
                              groupCollectionBlocks(group).length ===
                            1
                              ? ''
                              : 's'}
                          </span>
                          <button
                            data-testid={`manager-control-add-block-here-${control.key}-${gi}`}
                            onClick={() =>
                              setAddBlockDialog({
                                controlKey: control.key,
                                draftGroupId: group.id,
                                mode: 'clip',
                                draftSemantic: '',
                                draftClipId: availableClipsForBinding[0]?.id ?? '',
                                draftCollectionId: engine.clipCollections[0]?.id ?? '',
                                error: null,
                              })
                            }
                            title={`Add a Clip Block to T${gi + 1} (${group.name})`}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 4,
                              border: '1px solid var(--color-accent, #7c5cff)',
                              background: 'var(--color-accent, #7c5cff)',
                              color: 'var(--color-accent-text, #fff)',
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            Add Block here
                          </button>
                        </div>
                        {/* Per-control visual lane: Clip Blocks as blocks on 0…1 timeline, like Clips tab */}
                        {(() => {
                          const groupFlat = flattenControlBindings(
                            group.bindings as unknown as Record<
                              string,
                              import('../../engine/control').ControlBindingValue
                            >,
                          )
                          const previewOverrides = new Map<string, { start: number; end: number }>()
                          if (
                            dragState &&
                            (dragState.mode === 'interval-move' ||
                              dragState.mode === 'interval-resize-left' ||
                              dragState.mode === 'interval-resize-right') &&
                            dragState.controlKey === control.key &&
                            (dragState as unknown as { groupId?: string }).groupId === group.id
                          ) {
                            const dragKind = (dragState as unknown as { kind?: string }).kind
                            const dragBlockId = (dragState as unknown as { blockId?: string })
                              .blockId
                            if (dragKind === 'collection' && dragBlockId) {
                              previewOverrides.set(`collection::${dragBlockId}`, {
                                start: dragState.previewStart,
                                end: dragState.previewEnd,
                              })
                            } else {
                              const dragWithClip = dragState as unknown as {
                                clipId?: string
                                initialStart?: number
                                initialEnd?: number
                              }
                              const EPS = 1e-9
                              const targetBlk = groupFlat.find((f) => {
                                if (f.semantic !== dragState.semanticName) return false
                                const raw = f.binding as unknown as {
                                  clipId?: string
                                  start?: number
                                  end?: number
                                }
                                const cid =
                                  typeof f.binding === 'string'
                                    ? (f.binding as string)
                                    : (raw.clipId ?? '')
                                if (dragWithClip.clipId && cid !== dragWithClip.clipId) return false
                                const bStart =
                                  typeof (f.binding as { start?: number }).start === 'number'
                                    ? (f.binding as { start?: number }).start!
                                    : 0
                                const bEnd =
                                  typeof (f.binding as { end?: number }).end === 'number'
                                    ? (f.binding as { end?: number }).end!
                                    : 1
                                if (
                                  dragWithClip.initialStart !== undefined &&
                                  Math.abs(bStart - dragWithClip.initialStart) > EPS
                                )
                                  return false
                                if (
                                  dragWithClip.initialEnd !== undefined &&
                                  Math.abs(bEnd - dragWithClip.initialEnd) > EPS
                                )
                                  return false
                                return true
                              })
                              const blk =
                                targetBlk ??
                                groupFlat.find((f) => f.semantic === dragState.semanticName)
                              if (blk) {
                                const raw = blk.binding as unknown as { clipId?: string }
                                const cid =
                                  typeof blk.binding === 'string'
                                    ? (blk.binding as string)
                                    : (raw.clipId ?? '')
                                previewOverrides.set(
                                  `${dragState.semanticName}::${cid}::${blk.index}`,
                                  {
                                    start: dragState.previewStart,
                                    end: dragState.previewEnd,
                                  },
                                )
                              }
                            }
                          }
                          const lanePps = Math.max(pps, 600)
                          // Per-timeline lane: group-local order drives vertical stacking (later wins = lower lane).
                          // Clip blocks come first; grouped collection blocks stack below them
                          // (collections win ties within a timeline, matching evaluation).
                          const collectionBlocks = groupCollectionBlocks(group)
                          const laneHeight =
                            (groupFlat.length + collectionBlocks.length) * CLIP_LANE_HEIGHT_PX
                          const step = rulerTickStep(lanePps)
                          const ticks = rulerTickTimes(0, 1, step)
                          return (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                marginTop: 8,
                              }}
                            >
                              <div
                                data-testid={`control-interval-ruler-inline-${control.key}-g${gi}`}
                                style={{
                                  position: 'relative',
                                  height: 18,
                                  border: '1px solid var(--color-border, #ddd)',
                                  borderRadius: 4,
                                  background: 'var(--color-bg, #fafafa)',
                                  overflow: 'hidden',
                                  width: '100%',
                                }}
                              >
                                {ticks.map((t) => (
                                  <div
                                    key={t}
                                    style={{
                                      position: 'absolute',
                                      left: `${(t / 1) * 100}%`,
                                      top: 0,
                                      bottom: 0,
                                      borderLeft: '1px solid var(--color-border, #ddd)',
                                      fontSize: 9,
                                      color: 'var(--color-text-muted, #666)',
                                      paddingLeft: 3,
                                      display: 'flex',
                                      alignItems: 'center',
                                      pointerEvents: 'none',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {tickLabel(t, step)}
                                  </div>
                                ))}
                                <div
                                  style={{
                                    position: 'absolute',
                                    right: 6,
                                    top: 0,
                                    bottom: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontSize: 9,
                                    color: 'var(--color-text-muted, #999)',
                                    pointerEvents: 'none',
                                  }}
                                >
                                  0…1
                                </div>
                              </div>
                              <div
                                data-testid={`control-interval-lane-inline-${control.key}-g${gi}`}
                                style={{
                                  position: 'relative',
                                  width: '100%',
                                  height: Math.max(laneHeight, CLIP_LANE_HEIGHT_PX),
                                  minHeight: CLIP_LANE_HEIGHT_PX,
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
                                    width: '100%',
                                    height: '100%',
                                  }}
                                >
                                  {groupFlat.map(({ semantic, binding: rawFlat }, idx) => {
                                    const intervalFlat =
                                      typeof rawFlat === 'string'
                                        ? { clipId: rawFlat as string, start: 0, end: 1 }
                                        : (rawFlat as {
                                            clipId: string
                                            start: number
                                            end: number
                                          })
                                    const clipForLane = (() => {
                                      try {
                                        return engine.getClip(intervalFlat.clipId)
                                      } catch {
                                        return null
                                      }
                                    })()
                                    const isDraggingMoveResize =
                                      !!dragState &&
                                      (dragState.mode === 'interval-move' ||
                                        dragState.mode === 'interval-resize-left' ||
                                        dragState.mode === 'interval-resize-right') &&
                                      (dragState as unknown as { controlKey: string })
                                        .controlKey === control.key &&
                                      (dragState as unknown as { groupId?: string }).groupId ===
                                        group.id &&
                                      (dragState as unknown as { semanticName: string })
                                        .semanticName === semantic &&
                                      (() => {
                                        const ds = dragState as unknown as {
                                          clipId?: string
                                          initialStart?: number
                                          initialEnd?: number
                                        }
                                        const EPS = 1e-9
                                        return (
                                          ds.clipId === intervalFlat.clipId &&
                                          ds.initialStart !== undefined &&
                                          ds.initialEnd !== undefined &&
                                          Math.abs(ds.initialStart - intervalFlat.start) < EPS &&
                                          Math.abs(ds.initialEnd - intervalFlat.end) < EPS
                                        )
                                      })()
                                    const isDraggingReorder =
                                      !!dragState &&
                                      dragState.mode === 'interval-reorder' &&
                                      (dragState as unknown as { controlKey: string })
                                        .controlKey === control.key &&
                                      (dragState as unknown as { groupId?: string }).groupId ===
                                        group.id &&
                                      (dragState as unknown as { initialIndex: number })
                                        .initialIndex === idx
                                    const isDragging = isDraggingMoveResize || isDraggingReorder
                                    const startForBlock = isDraggingMoveResize
                                      ? (dragState as unknown as { previewStart: number })
                                          .previewStart
                                      : intervalFlat.start
                                    const endForBlock = isDraggingMoveResize
                                      ? (dragState as unknown as { previewEnd: number }).previewEnd
                                      : intervalFlat.end
                                    const spanForBlock = endForBlock - startForBlock
                                    const left = `${startForBlock * 100}%`
                                    const width = `${spanForBlock * 100}%`
                                    const clipName =
                                      clipForLane?.name ?? intervalFlat.clipId.slice(0, 8)
                                    const duration = clipForLane?.duration ?? 1
                                    const matchNodes = descendantSemanticMap.get(semantic) ?? []
                                    const matchCount = matchNodes.length
                                    const block = {
                                      semanticName: semantic,
                                      clipId: intervalFlat.clipId,
                                      start: startForBlock,
                                      end: endForBlock,
                                      span: spanForBlock,
                                      priority: idx,
                                      track: idx,
                                      zIndex: idx,
                                      clip: clipForLane,
                                    }
                                    return (
                                      <div
                                        key={`${block.semanticName}::${block.clipId}::${block.priority}`}
                                        data-testid={`clip-block-inline-${control.key}-g${gi}-${block.semanticName}-${idx}`}
                                        data-semantic={block.semanticName}
                                        data-start={String(block.start)}
                                        data-end={String(block.end)}
                                        data-track={String(block.track)}
                                        title={`T${gi + 1} · ${block.semanticName}: ${clipName} [${block.start.toFixed(3)}, ${block.end.toFixed(3)}]${matchCount === 0 ? ' — NO descendant match (does nothing)' : ` — ${matchCount} node${matchCount === 1 ? '' : 's'}: ${matchNodes.map((n) => n.name).join(', ')}`} — drag body=move, edges=resize, drag vertically=reorder`}
                                        onContextMenu={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          setControlBlockMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            controlKey: control.key,
                                            groupId: group.id,
                                            semanticName: block.semanticName,
                                            clipId: block.clipId,
                                            start: intervalFlat.start,
                                            end: intervalFlat.end,
                                          })
                                        }}
                                        onMouseEnter={() =>
                                          handleBindingHoverEnter(block.semanticName)
                                        }
                                        onMouseLeave={handleBindingHoverLeave}
                                        style={{
                                          position: 'absolute',
                                          left,
                                          width,
                                          minWidth: 8,
                                          top: block.track * CLIP_LANE_HEIGHT_PX + 2,
                                          height: CLIP_LANE_BAR_HEIGHT_PX,
                                          background:
                                            isDragging || hoveredBindingSemantic === semantic
                                              ? '#7c5cff'
                                              : '#b8a6ff',
                                          border: `1px solid ${isDragging ? '#4c1d95' : matchCount === 0 ? '#c00' : '#7c5cff'}`,
                                          borderRadius: 4,
                                          display: 'flex',
                                          alignItems: 'center',
                                          padding: '0 8px',
                                          boxSizing: 'border-box',
                                          cursor: isDragging ? 'grabbing' : 'grab',
                                          zIndex: block.zIndex,
                                          userSelect: 'none',
                                          overflow: 'hidden',
                                          opacity: isDragging ? 0.95 : 1,
                                        }}
                                        onPointerDown={(e) => {
                                          const target = e.target as HTMLElement
                                          if (
                                            target.dataset.handle === 'left' ||
                                            target.dataset.handle === 'right'
                                          )
                                            return
                                          if (e.button !== 0) return
                                          e.preventDefault()
                                          e.stopPropagation()
                                          const span = block.end - block.start
                                          const laneEl = (e.currentTarget as HTMLElement).closest(
                                            '[data-testid^="control-interval-lane-inline"]',
                                          ) as HTMLElement | null
                                          const laneWidth =
                                            laneEl?.getBoundingClientRect().width ?? lanePps
                                          setDragState({
                                            mode: 'interval-move',
                                            nodeId: parentNode!.id,
                                            controlKey: control.key,
                                            groupId: group.id,
                                            semanticName: block.semanticName,
                                            clipId: block.clipId,
                                            initialStart: block.start,
                                            initialEnd: block.end,
                                            span,
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            previewStart: block.start,
                                            previewEnd: block.end,
                                            effectivePps: lanePps,
                                            laneWidth,
                                          } as unknown as DragState)
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            flex: 1,
                                            pointerEvents: 'none',
                                            color: '#2e1a6d',
                                          }}
                                        >
                                          {matchCount === 0 ? '⚠ ' : ''}
                                          {block.semanticName} · {clipName} ({duration}s)
                                        </span>
                                        <span
                                          style={{
                                            fontSize: 9,
                                            fontFamily: 'monospace',
                                            marginLeft: 6,
                                            pointerEvents: 'none',
                                            color: '#4c1d95',
                                          }}
                                        >
                                          [{block.start.toFixed(2)},{block.end.toFixed(2)}]
                                        </span>
                                        <button
                                          data-testid={`clip-block-unbind-inline-${control.key}-g${gi}-${block.semanticName}-${idx}`}
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={() => {
                                            removeControlBlock({
                                              controlKey: control.key,
                                              groupId: group.id,
                                              semanticName: block.semanticName,
                                              clipId: block.clipId,
                                              start: intervalFlat.start,
                                              end: intervalFlat.end,
                                            })
                                          }}
                                          title={`Remove ${block.semanticName} from T${gi + 1}`}
                                          style={{
                                            border: 'none',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            padding: '0 2px',
                                            fontSize: 11,
                                            lineHeight: 1,
                                            color: '#4c1d95',
                                            pointerEvents: 'auto',
                                            flexShrink: 0,
                                          }}
                                        >
                                          ×
                                        </button>
                                        {control.groups.length > 1 && (
                                          <select
                                            data-testid={`clip-block-move-inline-${control.key}-g${gi}-${block.semanticName}-${idx}`}
                                            value=""
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const toGroupId = e.target.value
                                              e.target.value = ''
                                              if (!toGroupId || !parentNode?.controlSet) return
                                              try {
                                                const nextSet = moveBindingBetweenGroups(
                                                  parentNode.controlSet,
                                                  control.key,
                                                  block.semanticName,
                                                  group.id,
                                                  toGroupId,
                                                  undefined,
                                                  {
                                                    clipId: block.clipId,
                                                    start: intervalFlat.start,
                                                    end: intervalFlat.end,
                                                  },
                                                )
                                                const res = dispatch(
                                                  new SetControlSetCommand({
                                                    nodeId: parentNode.id,
                                                    controlSet: nextSet,
                                                  }),
                                                )
                                                if (!res.ok) notify(res.error.message)
                                                else {
                                                  setTick((v) => v + 1)
                                                  notify(
                                                    `Moved ${block.semanticName} to another timeline`,
                                                  )
                                                }
                                              } catch (err) {
                                                notify(
                                                  err instanceof Error ? err.message : String(err),
                                                )
                                              }
                                            }}
                                            title={`Move ${block.semanticName} to another timeline`}
                                            style={{
                                              fontSize: 9,
                                              padding: 0,
                                              maxWidth: 40,
                                              flexShrink: 0,
                                            }}
                                          >
                                            <option value="">⇄</option>
                                            {control.groups
                                              .filter((g) => g.id !== group.id)
                                              .map((g) => (
                                                <option key={g.id} value={g.id}>
                                                  T
                                                  {control.groups.findIndex(
                                                    (gg) => gg.id === g.id,
                                                  ) + 1}
                                                </option>
                                              ))}
                                          </select>
                                        )}
                                        <div
                                          data-handle="left"
                                          style={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            bottom: 0,
                                            width: CLIP_HANDLE_WIDTH_PX,
                                            cursor: 'ew-resize',
                                            background: 'rgba(0,0,0,0.08)',
                                            borderRight: '1px solid rgba(0,0,0,0.15)',
                                          }}
                                          onPointerDown={(e) => {
                                            if (e.button !== 0) return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const laneEl = (e.currentTarget as HTMLElement).closest(
                                              '[data-testid^="control-interval-lane-inline"]',
                                            ) as HTMLElement | null
                                            const laneWidth =
                                              laneEl?.getBoundingClientRect().width ?? lanePps
                                            setDragState({
                                              mode: 'interval-resize-left',
                                              nodeId: parentNode!.id,
                                              controlKey: control.key,
                                              groupId: group.id,
                                              semanticName: block.semanticName,
                                              clipId: block.clipId,
                                              initialStart: block.start,
                                              initialEnd: block.end,
                                              startX: e.clientX,
                                              previewStart: block.start,
                                              previewEnd: block.end,
                                              effectivePps: lanePps,
                                              laneWidth,
                                            } as unknown as DragState)
                                          }}
                                        />
                                        <div
                                          data-handle="right"
                                          style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: 0,
                                            bottom: 0,
                                            width: CLIP_HANDLE_WIDTH_PX,
                                            cursor: 'ew-resize',
                                            background: 'rgba(0,0,0,0.08)',
                                            borderLeft: '1px solid rgba(0,0,0,0.15)',
                                          }}
                                          onPointerDown={(e) => {
                                            if (e.button !== 0) return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const laneEl = (e.currentTarget as HTMLElement).closest(
                                              '[data-testid^="control-interval-lane-inline"]',
                                            ) as HTMLElement | null
                                            const laneWidth =
                                              laneEl?.getBoundingClientRect().width ?? lanePps
                                            setDragState({
                                              mode: 'interval-resize-right',
                                              nodeId: parentNode!.id,
                                              controlKey: control.key,
                                              groupId: group.id,
                                              semanticName: block.semanticName,
                                              clipId: block.clipId,
                                              initialStart: block.start,
                                              initialEnd: block.end,
                                              startX: e.clientX,
                                              previewStart: block.start,
                                              previewEnd: block.end,
                                              effectivePps: lanePps,
                                              laneWidth,
                                            } as unknown as DragState)
                                          }}
                                        />
                                      </div>
                                    )
                                  })}
                                  {collectionBlocks.map((block, ci) => {
                                    const rowIdx = groupFlat.length + ci
                                    const resolved = (() => {
                                      try {
                                        return engine.getClipCollection(block.collectionId)
                                      } catch {
                                        return null
                                      }
                                    })()
                                    const missing = resolved === null
                                    const memberSemantics = resolved
                                      ? [...resolved.bindings.keys()]
                                      : []
                                    const memberCount = resolved ? resolved.bindings.size : 0
                                    const collectionName =
                                      resolved?.name ?? block.collectionId.slice(0, 8)
                                    const matchedNames = memberSemantics.flatMap(
                                      (sem) =>
                                        descendantSemanticMap.get(sem)?.map((n) => n.name) ?? [],
                                    )
                                    const hoverKey = `collection::${block.id}`
                                    const isDraggingMoveResize =
                                      !!dragState &&
                                      (dragState.mode === 'interval-move' ||
                                        dragState.mode === 'interval-resize-left' ||
                                        dragState.mode === 'interval-resize-right') &&
                                      (dragState as unknown as { controlKey: string })
                                        .controlKey === control.key &&
                                      (dragState as unknown as { groupId?: string }).groupId ===
                                        group.id &&
                                      (dragState as unknown as { kind?: string }).kind ===
                                        'collection' &&
                                      (dragState as unknown as { blockId?: string }).blockId ===
                                        block.id
                                    const isDraggingReorder =
                                      !!dragState &&
                                      dragState.mode === 'interval-reorder' &&
                                      (dragState as unknown as { controlKey: string })
                                        .controlKey === control.key &&
                                      (dragState as unknown as { groupId?: string }).groupId ===
                                        group.id &&
                                      (dragState as unknown as { kind?: string }).kind ===
                                        'collection' &&
                                      (dragState as unknown as { initialIndex: number })
                                        .initialIndex === ci
                                    const isDragging = isDraggingMoveResize || isDraggingReorder
                                    const startForBlock = isDraggingMoveResize
                                      ? (dragState as unknown as { previewStart: number })
                                          .previewStart
                                      : block.start
                                    const endForBlock = isDraggingMoveResize
                                      ? (dragState as unknown as { previewEnd: number }).previewEnd
                                      : block.end
                                    const spanForBlock = endForBlock - startForBlock
                                    const left = `${startForBlock * 100}%`
                                    const width = `${spanForBlock * 100}%`
                                    return (
                                      <div
                                        key={`collection::${block.id}`}
                                        data-testid={`collection-block-inline-${control.key}-g${gi}-${ci}`}
                                        data-collection={block.collectionId}
                                        data-start={String(startForBlock)}
                                        data-end={String(endForBlock)}
                                        data-track={String(rowIdx)}
                                        title={
                                          missing
                                            ? `T${gi + 1} · collection "${block.collectionId}" is missing (does nothing) — right-click to remove`
                                            : `T${gi + 1} · ▦ ${collectionName} [${startForBlock.toFixed(3)}, ${endForBlock.toFixed(3)}] — ${memberCount} clip${memberCount === 1 ? '' : 's'}: ${memberSemantics.join(', ')}${matchedNames.length > 0 ? ` — drives: ${matchedNames.join(', ')}` : ' — NO descendant match (does nothing)'} — drag body=move, edges=resize, drag vertically=reorder`
                                        }
                                        onContextMenu={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          setControlBlockMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            controlKey: control.key,
                                            groupId: group.id,
                                            semanticName: '',
                                            clipId: '',
                                            start: block.start,
                                            end: block.end,
                                            kind: 'collection',
                                            blockId: block.id,
                                            collectionId: block.collectionId,
                                          })
                                        }}
                                        onMouseEnter={() =>
                                          handleCollectionHoverEnter(block.id, memberSemantics)
                                        }
                                        onMouseLeave={handleBindingHoverLeave}
                                        style={{
                                          position: 'absolute',
                                          left,
                                          width,
                                          minWidth: 8,
                                          top: rowIdx * CLIP_LANE_HEIGHT_PX + 2,
                                          height: CLIP_LANE_BAR_HEIGHT_PX,
                                          background:
                                            isDragging || hoveredBindingSemantic === hoverKey
                                              ? '#0e9f6e'
                                              : '#a7e3c7',
                                          border: `1px solid ${isDragging ? '#064e3b' : missing ? '#c00' : '#0e9f6e'}`,
                                          borderRadius: 4,
                                          display: 'flex',
                                          alignItems: 'center',
                                          padding: '0 8px',
                                          boxSizing: 'border-box',
                                          cursor: isDragging ? 'grabbing' : 'grab',
                                          zIndex: rowIdx,
                                          userSelect: 'none',
                                          overflow: 'hidden',
                                          opacity: isDragging ? 0.95 : 1,
                                        }}
                                        onPointerDown={(e) => {
                                          const target = e.target as HTMLElement
                                          if (
                                            target.dataset.handle === 'left' ||
                                            target.dataset.handle === 'right'
                                          )
                                            return
                                          if (e.button !== 0) return
                                          e.preventDefault()
                                          e.stopPropagation()
                                          const span = endForBlock - startForBlock
                                          const laneEl = (e.currentTarget as HTMLElement).closest(
                                            '[data-testid^="control-interval-lane-inline"]',
                                          ) as HTMLElement | null
                                          const laneWidth =
                                            laneEl?.getBoundingClientRect().width ?? lanePps
                                          setDragState({
                                            mode: 'interval-move',
                                            nodeId: parentNode!.id,
                                            controlKey: control.key,
                                            groupId: group.id,
                                            semanticName: '',
                                            kind: 'collection',
                                            blockId: block.id,
                                            initialStart: block.start,
                                            initialEnd: block.end,
                                            span,
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            previewStart: startForBlock,
                                            previewEnd: endForBlock,
                                            effectivePps: lanePps,
                                            laneWidth,
                                          } as unknown as DragState)
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            flex: 1,
                                            pointerEvents: 'none',
                                            color: '#064e3b',
                                          }}
                                        >
                                          {missing ? '⚠ ' : '▦ '}
                                          {collectionName} ({memberCount} clip
                                          {memberCount === 1 ? '' : 's'})
                                        </span>
                                        <span
                                          style={{
                                            fontSize: 9,
                                            fontFamily: 'monospace',
                                            marginLeft: 6,
                                            pointerEvents: 'none',
                                            color: '#064e3b',
                                          }}
                                        >
                                          [{startForBlock.toFixed(2)},{endForBlock.toFixed(2)}]
                                        </span>
                                        <button
                                          data-testid={`collection-block-unbind-inline-${control.key}-g${gi}-${ci}`}
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={() => {
                                            removeControlCollectionBlock({
                                              controlKey: control.key,
                                              groupId: group.id,
                                              blockId: block.id,
                                            })
                                          }}
                                          title={`Detach ${collectionName} from T${gi + 1}`}
                                          style={{
                                            border: 'none',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            padding: '0 2px',
                                            fontSize: 11,
                                            lineHeight: 1,
                                            color: '#064e3b',
                                            pointerEvents: 'auto',
                                            flexShrink: 0,
                                          }}
                                        >
                                          ×
                                        </button>
                                        {control.groups.length > 1 && (
                                          <select
                                            data-testid={`collection-block-move-inline-${control.key}-g${gi}-${ci}`}
                                            value=""
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const toGroupId = e.target.value
                                              e.target.value = ''
                                              if (!toGroupId || !parentNode?.controlSet) return
                                              try {
                                                const nextSet = moveCollectionBlockBetweenGroups(
                                                  parentNode.controlSet,
                                                  control.key,
                                                  group.id,
                                                  toGroupId,
                                                  block.id,
                                                )
                                                const res = dispatch(
                                                  new SetControlSetCommand({
                                                    nodeId: parentNode.id,
                                                    controlSet: nextSet,
                                                  }),
                                                )
                                                if (!res.ok) notify(res.error.message)
                                                else {
                                                  setTick((v) => v + 1)
                                                  notify(
                                                    `Moved collection "${collectionName}" to another timeline`,
                                                  )
                                                }
                                              } catch (err) {
                                                notify(
                                                  err instanceof Error ? err.message : String(err),
                                                )
                                              }
                                            }}
                                            title={`Move collection "${collectionName}" to another timeline`}
                                            style={{
                                              fontSize: 9,
                                              padding: 0,
                                              maxWidth: 40,
                                              flexShrink: 0,
                                            }}
                                          >
                                            <option value="">⇄</option>
                                            {control.groups
                                              .filter((g) => g.id !== group.id)
                                              .map((g) => (
                                                <option key={g.id} value={g.id}>
                                                  T
                                                  {control.groups.findIndex(
                                                    (gg) => gg.id === g.id,
                                                  ) + 1}
                                                </option>
                                              ))}
                                          </select>
                                        )}
                                        <div
                                          data-handle="left"
                                          style={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            bottom: 0,
                                            width: CLIP_HANDLE_WIDTH_PX,
                                            cursor: 'ew-resize',
                                            background: 'rgba(0,0,0,0.08)',
                                            borderRight: '1px solid rgba(0,0,0,0.15)',
                                          }}
                                          onPointerDown={(e) => {
                                            if (e.button !== 0) return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const laneEl = (e.currentTarget as HTMLElement).closest(
                                              '[data-testid^="control-interval-lane-inline"]',
                                            ) as HTMLElement | null
                                            const laneWidth =
                                              laneEl?.getBoundingClientRect().width ?? lanePps
                                            setDragState({
                                              mode: 'interval-resize-left',
                                              nodeId: parentNode!.id,
                                              controlKey: control.key,
                                              groupId: group.id,
                                              semanticName: '',
                                              kind: 'collection',
                                              blockId: block.id,
                                              initialStart: block.start,
                                              initialEnd: block.end,
                                              startX: e.clientX,
                                              previewStart: startForBlock,
                                              previewEnd: endForBlock,
                                              effectivePps: lanePps,
                                              laneWidth,
                                            } as unknown as DragState)
                                          }}
                                        />
                                        <div
                                          data-handle="right"
                                          style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: 0,
                                            bottom: 0,
                                            width: CLIP_HANDLE_WIDTH_PX,
                                            cursor: 'ew-resize',
                                            background: 'rgba(0,0,0,0.08)',
                                            borderLeft: '1px solid rgba(0,0,0,0.15)',
                                          }}
                                          onPointerDown={(e) => {
                                            if (e.button !== 0) return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const laneEl = (e.currentTarget as HTMLElement).closest(
                                              '[data-testid^="control-interval-lane-inline"]',
                                            ) as HTMLElement | null
                                            const laneWidth =
                                              laneEl?.getBoundingClientRect().width ?? lanePps
                                            setDragState({
                                              mode: 'interval-resize-right',
                                              nodeId: parentNode!.id,
                                              controlKey: control.key,
                                              groupId: group.id,
                                              semanticName: '',
                                              kind: 'collection',
                                              blockId: block.id,
                                              initialStart: block.start,
                                              initialEnd: block.end,
                                              startX: e.clientX,
                                              previewStart: startForBlock,
                                              previewEnd: endForBlock,
                                              effectivePps: lanePps,
                                              laneWidth,
                                            } as unknown as DragState)
                                          }}
                                        />
                                      </div>
                                    )
                                  })}
                                  {groupFlat.length === 0 && collectionBlocks.length === 0 && (
                                    <div
                                      style={{
                                        padding: 12,
                                        fontSize: 11,
                                        color: 'var(--color-text-muted, #888)',
                                        fontStyle: 'italic',
                                      }}
                                    >
                                      No Clip Blocks in T${gi + 1} — use Add Block here, default
                                      [0,1]
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--color-text-muted, #888)' }}>
                                Drag body to move (preserve width), edges to resize (span ≥{' '}
                                {CONTROL_INTERVAL_MIN_SPAN}), overlap via Priority stacking (lower
                                lane wins). Drag vertically to reorder Priority.
                              </div>
                            </div>
                          )
                        })()}

                        {control.groups.length > 1 && (
                          <button
                            data-testid={`manager-control-remove-timeline-${control.key}-${gi}`}
                            onClick={() => handleRemoveTimeline(control.key, group.id)}
                            title={
                              gi === 0
                                ? 'Remove Timeline 1 (blends re-index)'
                                : 'Remove this Timeline'
                            }
                            style={{
                              padding: '3px 8px',
                              borderRadius: 4,
                              border: '1px solid var(--color-border, #ddd)',
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            Remove Timeline
                          </button>
                        )}
                        {gi > 0 &&
                          (() => {
                            const kfAtPlayhead = (() => {
                              const all = activeSlide
                                ? (activeSlide.animation
                                    .node(parentNodeId!)
                                    ?.controlKeyframes(control.key) ?? [])
                                : []
                              if (all.length === 0) return undefined
                              let best = all[0]!
                              for (const kf of all) {
                                if (
                                  Math.abs(kf.time - currentPlayheadTime) <
                                  Math.abs(best.time - currentPlayheadTime)
                                )
                                  best = kf
                              }
                              return Math.abs(best.time - currentPlayheadTime) < 1e-6
                                ? best
                                : undefined
                            })()
                            const blendVal = kfAtPlayhead ? (kfAtPlayhead.blend[gi - 1] ?? 0) : 0
                            const defaultBlendLabel = `Blend T${gi}→T${gi + 1}`
                            const customBlendName = (control.blendNames?.[gi - 1] ?? '').trim()
                            const blendDisplayLabel = customBlendName || defaultBlendLabel
                            const isEditingBlend =
                              editingBlendName?.controlKey === control.key &&
                              editingBlendName?.blendIndex === gi - 1
                            return isEditingBlend ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                  data-testid={`manager-control-blend-rename-input-${control.key}-${gi - 1}`}
                                  value={editingBlendName?.draftName ?? ''}
                                  onChange={(e) =>
                                    setEditingBlendName({
                                      controlKey: control.key,
                                      blendIndex: gi - 1,
                                      draftName: e.target.value,
                                    })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveBlendName()
                                    if (e.key === 'Escape') setEditingBlendName(null)
                                  }}
                                  placeholder={defaultBlendLabel}
                                  title="Empty clears the custom name"
                                  style={{
                                    flex: 1,
                                    padding: '5px 8px',
                                    borderRadius: 4,
                                    border: '1px solid var(--color-border, #ddd)',
                                    background: 'var(--color-bg, #fff)',
                                    color: 'var(--color-text, #1c1e21)',
                                    fontSize: 11,
                                  }}
                                  autoFocus
                                />
                                <button
                                  data-testid={`manager-control-blend-rename-save-${control.key}-${gi - 1}`}
                                  onClick={handleSaveBlendName}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    background: 'var(--color-accent, #7c5cff)',
                                    color: 'var(--color-accent-text, #fff)',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: 11,
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  data-testid={`manager-control-blend-rename-cancel-${control.key}-${gi - 1}`}
                                  onClick={() => setEditingBlendName(null)}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    border: '1px solid var(--color-border, #ddd)',
                                    cursor: 'pointer',
                                    fontSize: 11,
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 11,
                                  flex: 1,
                                }}
                              >
                                <span
                                  style={{
                                    minWidth: 70,
                                    maxWidth: 180,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={customBlendName ? defaultBlendLabel : undefined}
                                >
                                  {blendDisplayLabel}
                                </span>
                                <button
                                  data-testid={`manager-control-blend-rename-${control.key}-${gi - 1}`}
                                  onClick={() => handleEditBlendName(control.key, gi - 1)}
                                  title={
                                    customBlendName
                                      ? `Rename blend parameter (currently "${customBlendName}")`
                                      : 'Rename blend parameter'
                                  }
                                  style={{
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    border: '1px solid var(--color-border, #ddd)',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    fontSize: 10,
                                  }}
                                >
                                  Rename
                                </button>
                                <input
                                  data-testid={`manager-control-blend-${control.key}-${gi - 1}`}
                                  aria-label={
                                    customBlendName
                                      ? `${customBlendName} (Blend T${gi} to T${gi + 1})`
                                      : `Blend T${gi} to T${gi + 1}`
                                  }
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={blendVal}
                                  disabled={!kfAtPlayhead}
                                  title={
                                    kfAtPlayhead
                                      ? `Blend at kf ${kfAtPlayhead.id}`
                                      : 'Add a host keyframe at playhead to edit blend'
                                  }
                                  onChange={(e) => {
                                    if (!kfAtPlayhead) return
                                    const v = Number(e.target.value)
                                    const res = dispatch(
                                      new SetControlBlendCommand({
                                        hostNodeId: parentNodeId!,
                                        controlKey: control.key,
                                        keyframeId: kfAtPlayhead.id,
                                        blendIndex: gi - 1,
                                        value: v,
                                      }),
                                    )
                                    if (!res.ok) notify(res.error.message)
                                    else setTick((t) => t + 1)
                                  }}
                                  style={{ flex: 1 }}
                                />
                                <span style={{ minWidth: 32, textAlign: 'right' }}>
                                  {blendVal.toFixed(2)}
                                </span>
                              </div>
                            )
                          })()}
                      </div>
                    ))}
                  </div>
                  {addBlockDialog && addBlockDialog.controlKey === control.key && (
                    <div
                      data-testid={`control-add-block-dialog-${control.key}`}
                      style={{
                        marginTop: 6,
                        padding: 8,
                        border: '1px solid var(--color-accent, #7c5cff)',
                        borderRadius: 6,
                        background: 'var(--color-bg-elevated, #f8f7ff)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600 }}>
                        {addBlockDialog.mode === 'collection'
                          ? 'Add Collection Block — Control Interval [0,1]'
                          : 'Add Clip Block — Control Interval [0,1]'}
                      </div>
                      <div
                        style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <label style={{ fontSize: 11, minWidth: 80 }}>Kind</label>
                        <select
                          data-testid={`control-add-block-kind-${control.key}`}
                          value={addBlockDialog.mode}
                          onChange={(e) =>
                            setAddBlockDialog((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    mode: e.target.value as 'clip' | 'collection',
                                    error: null,
                                  }
                                : prev,
                            )
                          }
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            fontSize: 11,
                            borderRadius: 4,
                            border: '1px solid var(--color-border, #ddd)',
                            background: 'var(--color-bg, #fff)',
                            color: 'var(--color-text, #1c1e21)',
                          }}
                        >
                          <option value="clip">Clip block</option>
                          <option value="collection">Collection block (live-linked)</option>
                        </select>
                      </div>
                      <div
                        style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <label style={{ fontSize: 11, minWidth: 80 }}>Timeline</label>
                        <select
                          data-testid={`control-add-block-timeline-${control.key}`}
                          value={
                            control.groups.some((g) => g.id === addBlockDialog.draftGroupId)
                              ? addBlockDialog.draftGroupId
                              : (control.groups[0]?.id ?? '')
                          }
                          onChange={(e) =>
                            setAddBlockDialog((prev) =>
                              prev ? { ...prev, draftGroupId: e.target.value } : prev,
                            )
                          }
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            fontSize: 11,
                            borderRadius: 4,
                            border: '1px solid var(--color-border, #ddd)',
                            background: 'var(--color-bg, #fff)',
                            color: 'var(--color-text, #1c1e21)',
                          }}
                        >
                          {control.groups.map((g, gi) => (
                            <option key={g.id} value={g.id}>
                              T{gi + 1}: {g.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {addBlockDialog.mode === 'collection' ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <label style={{ fontSize: 11, minWidth: 80 }}>Collection</label>
                          <select
                            data-testid={`control-add-block-collection-${control.key}`}
                            value={addBlockDialog.draftCollectionId}
                            onChange={(e) =>
                              setAddBlockDialog((prev) =>
                                prev ? { ...prev, draftCollectionId: e.target.value } : prev,
                              )
                            }
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: 11,
                              borderRadius: 4,
                              border: '1px solid var(--color-border, #ddd)',
                              background: 'var(--color-bg, #fff)',
                              color: 'var(--color-text, #1c1e21)',
                            }}
                          >
                            <option value="">Select collection…</option>
                            {engine.clipCollections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.bindings.size} clip
                                {c.bindings.size === 1 ? '' : 's'})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <label style={{ fontSize: 11, minWidth: 80 }}>Semantic</label>
                          <input
                            data-testid={`control-add-block-semantic-${control.key}`}
                            value={addBlockDialog.draftSemantic}
                            onChange={(e) =>
                              setAddBlockDialog((prev) =>
                                prev ? { ...prev, draftSemantic: e.target.value } : prev,
                              )
                            }
                            placeholder="e.g. smile"
                            list={`semantic-list-${control.key}`}
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: 11,
                              borderRadius: 4,
                              border: '1px solid var(--color-border, #ddd)',
                              background: 'var(--color-bg, #fff)',
                              color: 'var(--color-text, #1c1e21)',
                            }}
                          />
                          <datalist id={`semantic-list-${control.key}`}>
                            {[...descendantSemanticMap.keys()].map((sem) => (
                              <option key={sem} value={sem} />
                            ))}
                          </datalist>
                          <label style={{ fontSize: 11, minWidth: 40 }}>Clip</label>
                          <select
                            data-testid={`control-add-block-clip-${control.key}`}
                            value={addBlockDialog.draftClipId}
                            onChange={(e) =>
                              setAddBlockDialog((prev) =>
                                prev ? { ...prev, draftClipId: e.target.value } : prev,
                              )
                            }
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: 11,
                              borderRadius: 4,
                              border: '1px solid var(--color-border, #ddd)',
                              background: 'var(--color-bg, #fff)',
                              color: 'var(--color-text, #1c1e21)',
                            }}
                          >
                            <option value="">Select clip…</option>
                            {availableClipsForBinding.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.duration}s)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {addBlockDialog.error && (
                        <div
                          data-testid={`control-add-block-error-${control.key}`}
                          style={{ fontSize: 11, color: 'var(--color-danger, #c00)' }}
                        >
                          {addBlockDialog.error}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          data-testid={`control-add-block-cancel-${control.key}`}
                          onClick={() => setAddBlockDialog(null)}
                          style={{
                            padding: '4px 8px',
                            fontSize: 11,
                            borderRadius: 4,
                            border: '1px solid var(--color-border, #ddd)',
                            background: 'var(--color-bg-panel, #fff)',
                            color: 'var(--color-text, #1c1e21)',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          data-testid={`control-add-block-confirm-${control.key}`}
                          onClick={() => handleAddBlock(control.key)}
                          style={{
                            padding: '4px 10px',
                            fontSize: 11,
                            borderRadius: 4,
                            background: 'var(--color-accent, #7c5cff)',
                            color: 'var(--color-accent-text, #fff)',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          Add [0,1]
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      data-testid={`manager-control-attach-${control.key}`}
                      onClick={() => attachSelectedToControl(control.key)}
                      disabled={selectedClipIds.size === 0}
                      title={
                        selectedClipIds.size === 0
                          ? 'Select clip lanes in Clips tab (Ctrl+click)'
                          : `Attach ${selectedClipIds.size} selected lane(s) as bindings`
                      }
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid var(--color-border, #ddd)',
                        cursor: selectedClipIds.size > 0 ? 'pointer' : 'default',
                        fontSize: 11,
                        background:
                          selectedClipIds.size > 0
                            ? 'var(--color-accent, #7c5cff)'
                            : 'var(--color-bg-elevated, #eceef1)',
                        color:
                          selectedClipIds.size > 0
                            ? 'var(--color-accent-text, #fff)'
                            : 'var(--color-text-muted, #666)',
                        opacity: selectedClipIds.size > 0 ? 1 : 0.6,
                      }}
                    >
                      Attach selected clips
                      {selectedClipIds.size > 0 ? ` (${selectedClipIds.size})` : ''}
                    </button>
                    {flatBindings.length > 0 && (
                      <button
                        data-testid={`manager-control-clear-${control.key}`}
                        onClick={() => {
                          if (!parentNode?.controlSet) return
                          const ctrl = parentNode.controlSet.controls.find(
                            (c) => c.key === control.key,
                          )
                          if (!ctrl) return
                          const nextGroups = ctrl.groups.map((g) => ({ ...g, bindings: {} }))
                          dispatch(
                            new SetControlSetCommand({
                              nodeId: parentNode.id,
                              controlSet: {
                                ...parentNode.controlSet,
                                controls: parentNode.controlSet.controls.map((c) =>
                                  c.key === control.key
                                    ? {
                                        ...c,
                                        groups: nextGroups,
                                        bindings: mergeGroupBindings(nextGroups),
                                      }
                                    : c,
                                ),
                              },
                            }),
                          )
                          setTick((v) => v + 1)
                        }}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        Clear bindings
                      </button>
                    )}
                    <select
                      data-testid={`manager-control-clip-select-${control.key}`}
                      value=""
                      onChange={(e) => {
                        const clipId = e.target.value
                        e.target.value = ''
                        if (!clipId) return
                        // New flow: select clip then ask to select semantic via Add Block dialog
                        // Do not auto-guess from clip name; require explicit semantic selection
                        setAddBlockDialog({
                          controlKey: control.key,
                          draftGroupId: control.groups[0]?.id ?? '',
                          mode: 'clip',
                          draftSemantic: '',
                          draftClipId: clipId,
                          draftCollectionId: engine.clipCollections[0]?.id ?? '',
                          error: null,
                        })
                        notify(
                          'Select semantic name for the clip — if you cancel, it will not be attached',
                        )
                      }}
                      style={{
                        padding: '4px 6px',
                        borderRadius: 4,
                        fontSize: 11,
                        minWidth: 160,
                        border: '1px solid var(--color-border, #ddd)',
                        background: 'var(--color-bg, #fff)',
                        color: 'var(--color-text, #1c1e21)',
                      }}
                    >
                      <option value="">Bind clip…</option>
                      {availableClipsForBinding.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.duration}s) — {c.id.slice(0, 6)}
                        </option>
                      ))}
                    </select>
                    {flatBindings.length === 0 && (
                      <span style={{ fontSize: 11, color: 'var(--color-warning, #b45309)' }}>
                        Control does nothing until bound to a clip
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted, #888)',
                padding: 8,
                border: '1px dashed var(--color-border, #ddd)',
                borderRadius: 6,
              }}
            >
              Control values are keyframeable on the host node. Authoring mode reveals the rig's
              internal animation lanes without deleting them.
            </div>
          </div>
        ) : activeTab === 'collections' ? (
          <div
            data-testid="manager-collections"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              data-testid="manager-collections-filter-row"
            >
              <label style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
                Category
              </label>
              <select
                value={collectionCategoryFilter}
                onChange={(e) => {
                  setCollectionCategoryFilter(e.target.value)
                  setPlaceCollectionId('')
                }}
                data-testid="manager-collections-category-select"
                style={{
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background: 'var(--color-bg, #fff)',
                  color: 'var(--color-text, #1c1e21)',
                  fontSize: 12,
                }}
              >
                <option value={ALL_COLLECTION_CATEGORIES}>All categories</option>
                <option value="">Uncategorized</option>
                {allCollectionCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                {collectionsForParent.length} collection(s) ·{' '}
                {collectionCategoryLabel(collectionCategoryFilter)}
              </span>
            </div>
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
                No Clip Collections in {collectionCategoryLabel(collectionCategoryFilter)}. Select
                Clip Lanes in Clips tab → Create Collection.
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
                        {col.bindings.size} binding(s) ·{' '}
                        {col.category !== '' ? (
                          <span data-testid={`collection-category-${col.id}`}>
                            [{col.category}]
                          </span>
                        ) : (
                          <span data-testid={`collection-category-${col.id}`}>Uncategorized</span>
                        )}{' '}
                        · source:{' '}
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
                            background: 'var(--color-bg-panel, #fff)',
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
            onScroll={(e) => {
              const target = e.currentTarget as HTMLDivElement
              const p = pixelsPerSecond(useTimelineViewStore.getState().zoomLevel)
              const viewport = target.clientWidth > 0 ? target.clientWidth : 800
              const duration = activeSlide?.duration ?? 10
              const current = useTimelineViewStore.getState().scrollTime
              const next = target.scrollLeft / p
              if (Math.abs(current - next) > 0.01) {
                useTimelineViewStore.getState().setScrollTime(next, viewport, duration)
              }
            }}
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              overflow: 'auto',
              overflowX: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* Time ruler – orphan proportional – aligned to diamond area (left offset matches param label column) */}
            {activeTab === 'orphans' && orphanTimelineBounds && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  overflowX: 'hidden',
                  flexShrink: 0,
                  borderBottom: '1px solid var(--color-border, #ddd)',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 12,
                  padding: '0 12px 0 32px',
                  boxSizing: 'border-box',
                  background: 'var(--color-bg, #fff)',
                }}
              >
                <div aria-hidden="true" style={{ flex: '0 0 140px' }} />
                <div
                  style={{
                    position: 'relative',
                    flex: '1 1 0',
                    minWidth: 0,
                    height: 22,
                    borderBottom: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg, #fff)',
                    overflow: 'hidden',
                  }}
                  data-testid="orphan-ruler"
                >
                  {(() => {
                    const span = orphanTimelineBounds
                      ? orphanTimelineBounds.span
                      : (activeSlide?.duration ?? 10)
                    const step = rulerTickStep(pps)
                    const ticks = rulerTickTimes(0, span, step)
                    return ticks.map((time) => (
                      <div
                        key={time}
                        data-testid={`orphan-ruler-tick-${time}`}
                        style={{
                          position: 'absolute',
                          left: `${(time / span) * 100}%`,
                          top: 0,
                          bottom: 0,
                          borderLeft: '1px solid var(--color-border, #ddd)',
                          fontSize: 9,
                          color: 'var(--color-text-muted, #666)',
                          paddingLeft: 3,
                          display: 'flex',
                          alignItems: 'center',
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {tickLabel(time, step)}s
                      </div>
                    ))
                  })()}
                  <div
                    data-testid="manager-orphan-ruler-playhead"
                    style={{
                      position: 'absolute',
                      left: `${orphanTimelineBounds ? (currentPlayheadTime / orphanTimelineBounds.span) * 100 : 0}%`,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: 'var(--color-accent, #ff3b30)',
                      pointerEvents: 'none',
                      zIndex: 20,
                    }}
                  />
                </div>
                <div aria-hidden="true" style={{ flex: '0 0 48px' }} />
              </div>
            )}
            {/* Time ruler – clips tab global slide ruler (above rows, sticky) */}
            {activeTab === 'clips' && activeSlide && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 30,
                  overflowX: 'hidden',
                  flexShrink: 0,
                  borderBottom: '1px solid var(--color-border, #ddd)',
                  width: '100%',
                  background: 'var(--color-bg, #fff)',
                }}
              >
                <div style={{ width: '100%', marginLeft: 0, boxSizing: 'border-box' }}>
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: 22,
                      borderBottom: '1px solid var(--color-border, #ddd)',
                      background: 'var(--color-bg, #fff)',
                      overflow: 'hidden',
                    }}
                    data-testid="clips-global-ruler"
                  >
                    {(() => {
                      const span = activeSlide.duration
                      const step = rulerTickStep(pps)
                      const ticks = rulerTickTimes(0, span, step)
                      return ticks.map((time) => (
                        <div
                          key={time}
                          data-testid={`clips-global-ruler-tick-${time}`}
                          style={{
                            position: 'absolute',
                            left: `${(time / span) * 100}%`,
                            top: 0,
                            bottom: 0,
                            borderLeft: '1px solid var(--color-border, #ddd)',
                            fontSize: 9,
                            color: 'var(--color-text-muted, #666)',
                            paddingLeft: 3,
                            display: 'flex',
                            alignItems: 'center',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {tickLabel(time, step)}s
                        </div>
                      ))
                    })()}
                    <div
                      data-testid="manager-clips-ruler-playhead"
                      style={{
                        position: 'absolute',
                        left: `${(currentPlayheadTime / (activeSlide.duration ?? 10)) * 100}%`,
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: 'var(--color-accent, #ff3b30)',
                        pointerEvents: 'none',
                        zIndex: 20,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
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
                dragState &&
                (dragState.mode === 'move' ||
                  dragState.mode === 'resize-right' ||
                  dragState.mode === 'resize-left') &&
                dragState.nodeId === row.node.id
                  ? new Map<string, { startTime: number; speed: number }>([
                      [
                        (
                          dragState as Extract<
                            DragState,
                            { mode: 'move' | 'resize-right' | 'resize-left' }
                          >
                        ).instanceId,
                        {
                          startTime: (
                            dragState as Extract<
                              DragState,
                              { mode: 'move' | 'resize-right' | 'resize-left' }
                            >
                          ).previewStart,
                          speed: (
                            dragState as Extract<
                              DragState,
                              { mode: 'move' | 'resize-right' | 'resize-left' }
                            >
                          ).previewSpeed,
                        },
                      ],
                    ])
                  : undefined
              const packedLanes = packClipLanesForNode(row.node, getClip, pps, previewOverrides)
              const trackCount =
                packedLanes.length > 0 ? Math.max(...packedLanes.map((l) => l.track)) + 1 : 0
              const lanesHeight = trackCount * CLIP_LANE_HEIGHT_PX
              // Container width: based on slide duration and max lane end
              const slideDuration = activeSlide?.duration ?? 10
              void slideDuration
              void pps
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
                      {/* Clip Lanes section – only when tab is clips, with slide-duration ruler */}
                      {activeTab === 'clips' && packedLanes.length > 0 && (
                        <div
                          data-testid={`manager-clip-lanes-${row.node.id}`}
                          style={{
                            position: 'relative',
                            margin: '6px 0',
                            border: '1px solid var(--color-border, #eee)',
                            borderRadius: 4,
                            background: 'var(--color-bg, #fafafa)',
                            overflowX: 'hidden',
                            overflowY: 'hidden',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div style={{ width: '100%' }}>
                            <div
                              style={{
                                position: 'relative',
                                width: '100%',
                                height: 22,
                                borderBottom: '1px solid var(--color-border, #ddd)',
                                background: 'var(--color-bg, #fff)',
                                overflow: 'hidden',
                              }}
                              data-testid={`clip-ruler-${row.node.id}`}
                            >
                              {(() => {
                                const span = slideDuration
                                const step = rulerTickStep(pps)
                                const ticks = rulerTickTimes(0, span, step)
                                return ticks.map((time) => (
                                  <div
                                    key={time}
                                    data-testid={`clip-ruler-${row.node.id}-tick-${time}`}
                                    style={{
                                      position: 'absolute',
                                      left: `${(time / span) * 100}%`,
                                      top: 0,
                                      bottom: 0,
                                      borderLeft: '1px solid var(--color-border, #ddd)',
                                      fontSize: 9,
                                      color: 'var(--color-text-muted, #666)',
                                      paddingLeft: 3,
                                      display: 'flex',
                                      alignItems: 'center',
                                      pointerEvents: 'none',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {tickLabel(time, step)}s
                                  </div>
                                ))
                              })()}
                              <div
                                data-testid={`manager-perrow-ruler-playhead-${row.node.id}`}
                                style={{
                                  position: 'absolute',
                                  left: `${(currentPlayheadTime / slideDuration) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  width: 1,
                                  background: 'var(--color-accent, #ff3b30)',
                                  pointerEvents: 'none',
                                  zIndex: 20,
                                }}
                              />
                            </div>
                            <div
                              style={{
                                position: 'relative',
                                width: '100%',
                                height: lanesHeight > 0 ? lanesHeight : CLIP_LANE_HEIGHT_PX,
                              }}
                            >
                              <div
                                data-testid={`manager-clip-playhead-${row.node.id}`}
                                style={{
                                  position: 'absolute',
                                  left: `${(currentPlayheadTime / slideDuration) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  width: 1,
                                  background: 'var(--color-accent, #ff3b30)',
                                  pointerEvents: 'none',
                                  zIndex: 500,
                                }}
                              />
                              {packedLanes.map((lane) => {
                                const isSelectedSingle = selectedInstanceId === lane.instance.id
                                const isMultiSelected = selectedClipIds.has(lane.instance.id)
                                const isSelected = isMultiSelected || isSelectedSingle
                                const isDragging =
                                  !!dragState &&
                                  'instanceId' in dragState &&
                                  (dragState as { instanceId: string }).instanceId ===
                                    lane.instance.id
                                const isEnabled = lane.instance.enabled
                                const isHighlighted = highlightedClipInstanceId === lane.instance.id
                                const barStyle: React.CSSProperties = {
                                  position: 'absolute',
                                  left: `${(lane.start / slideDuration) * 100}%`,
                                  width: `${(lane.visualDuration / slideDuration) * 100}%`,
                                  top: lane.track * CLIP_LANE_HEIGHT_PX + 2,
                                  height: CLIP_LANE_BAR_HEIGHT_PX,
                                  background: isHighlighted
                                    ? '#ffcc00'
                                    : isEnabled
                                      ? isSelected
                                        ? 'var(--color-accent, #7c5cff)'
                                        : '#b8a6ff'
                                      : 'var(--color-bg-elevated, #e5e5e5)',
                                  border: isHighlighted
                                    ? '2px solid #b38f00'
                                    : isEnabled
                                      ? `1px solid ${isSelected ? '#4c1d95' : '#7c5cff'}`
                                      : '1px dashed var(--color-border, #888)',
                                  borderRadius: 4,
                                  opacity: isEnabled ? 1 : 0.5,
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '0 8px',
                                  boxSizing: 'border-box',
                                  cursor: isEnabled
                                    ? isDragging
                                      ? 'grabbing'
                                      : 'grab'
                                    : 'default',
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
                                    effectivePps: laneEffectivePps(
                                      (e.currentTarget as HTMLElement).parentElement
                                        ?.parentElement ?? null,
                                      activeSlide?.duration ?? 10,
                                    ),
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
                                    effectivePps: laneEffectivePps(
                                      (e.currentTarget as HTMLElement).parentElement,
                                      activeSlide?.duration ?? 10,
                                    ),
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
                                        color: isEnabled
                                          ? isSelected
                                            ? 'var(--color-accent-text, #fff)'
                                            : '#2e2e2e'
                                          : 'var(--color-text-muted, #666)',
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
                                          onPointerDown={(e) =>
                                            handlePointerDown(e, 'resize-right')
                                          }
                                        />
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
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
                      {/* Animated params list – hidden on clips tab when clip lanes present (reduces clutter; details visible in clip editor). Keep for orphan/keyframe-only rows. */}
                      {(activeTab !== 'clips' || packedLanes.length === 0) && (
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
                              const hasOrphanTimeline = !!orphanTimelineBounds
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
                                  <span
                                    style={{
                                      flex: hasOrphanTimeline && showDiamonds ? '0 0 140px' : 1,
                                      minWidth: 0,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      ...(hasOrphanTimeline && showDiamonds
                                        ? {
                                            position: 'sticky',
                                            left: 0,
                                            background: 'var(--color-bg-panel, #fff)',
                                            zIndex: 1,
                                            paddingRight: 8,
                                          }
                                        : {}),
                                    }}
                                  >
                                    {param.label}
                                  </span>
                                  {activeTab !== 'orphans' && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: 'var(--color-text-muted, #888)',
                                      }}
                                      data-testid={`manager-param-kind-${row.node.id}-${param.key}`}
                                    >
                                      {param.kind}
                                    </span>
                                  )}
                                  {showDiamonds && orphanTimelineBounds && (
                                    <>
                                      <div
                                        data-testid={`manager-orphan-diamonds-${row.node.id}-${param.key}`}
                                        style={{
                                          position: 'relative',
                                          flex: '1 1 0',
                                          minWidth: 0,
                                          height: 16,
                                          background: 'rgba(124,92,255,0.04)',
                                          border: '1px solid rgba(124,92,255,0.12)',
                                          borderRadius: 4,
                                        }}
                                      >
                                        {orphanKeyframes.map((kf) => {
                                          const entry = flatOrphanEntries.find(
                                            (x) => x.keyframeId === kf.id,
                                          )
                                          const isSelected = selectedOrphanIds.has(kf.id)
                                          const left = `${(kf.time / (orphanTimelineBounds?.span ?? activeSlide?.duration ?? 10)) * 100}%`
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
                                                position: 'absolute',
                                                left,
                                                top: '50%',
                                                width: 10,
                                                height: 10,
                                                background: isSelected
                                                  ? '#ffcc00'
                                                  : 'var(--color-accent, #7c5cff)',
                                                border: isSelected
                                                  ? '2px solid #000'
                                                  : '1px solid #fff',
                                                transform: 'translate(-50%, -50%) rotate(45deg)',
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
                                      </div>
                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: 'var(--color-text-muted, #666)',
                                          flexShrink: 0,
                                        }}
                                      >
                                        {orphanKeyframes.length} orphan
                                      </span>
                                    </>
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
                      )}
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
                onClick={() => handleEdit(clipMenu.clipId, clipMenu.nodeId, clipMenu.instanceId)}
              >
                Edit
              </button>
              <button
                role="menuitem"
                data-testid="clip-lane-reverse"
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
                onClick={() => {
                  try {
                    const clip = engine.getClip(clipMenu.clipId)
                    const node = engine.getNode(clipMenu.nodeId)
                    const inst = node.clipInstances.find((i) => i.id === clipMenu.instanceId)
                    const start = inst ? inst.startTime : 0
                    const defaultName = `${clip.name} Reversed`
                    setReverseNameDraft(defaultName)
                    setReverseClipPrompt({
                      clipId: clipMenu.clipId,
                      nodeId: clipMenu.nodeId,
                      instanceId: clipMenu.instanceId,
                      startTime: start,
                      defaultName,
                    })
                    setClipMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setClipMenu(null)
                  }
                }}
              >
                Reverse and Save As…
              </button>
              <button
                role="menuitem"
                data-testid="clip-lane-mirror"
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
                onClick={() => {
                  try {
                    const clip = engine.getClip(clipMenu.clipId)
                    const node = engine.getNode(clipMenu.nodeId)
                    const inst = node.clipInstances.find((i) => i.id === clipMenu.instanceId)
                    const start = inst ? inst.startTime : 0
                    const axis: MirrorAxis = 'X'
                    const defaultName = mirrorClipDefaultName(clip.name, axis)
                    setMirrorAxis(axis)
                    setMirrorNameDraft(defaultName)
                    setMirrorClipPrompt({
                      clipId: clipMenu.clipId,
                      nodeId: clipMenu.nodeId,
                      instanceId: clipMenu.instanceId,
                      startTime: start,
                      defaultName,
                    })
                    setClipMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setClipMenu(null)
                  }
                }}
              >
                Mirror and Save As…
              </button>
              <button
                role="menuitem"
                data-testid="clip-lane-copy"
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
                onClick={() => {
                  try {
                    const clip = engine.getClip(clipMenu.clipId)
                    const node = engine.getNode(clipMenu.nodeId)
                    const inst = node.clipInstances.find((i) => i.id === clipMenu.instanceId)
                    const start = inst ? inst.startTime : 0
                    const name = copyClipDefaultName(clip.name)
                    const res = dispatch(
                      new CopyClipCommand({
                        sourceClipId: clipMenu.clipId,
                        newName: name,
                        targetNodeId: clipMenu.nodeId,
                        startTime: start,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else notify(`Copied clip "${name}" created`)
                    setClipMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setClipMenu(null)
                  }
                }}
              >
                Copy and Save As…
              </button>
            </div>
          </>
        )}

        {/* Collection lane context menu */}
        {collectionPlacementMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
              onClick={() => setCollectionPlacementMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCollectionPlacementMenu(null)
              }}
            />
            <div
              role="menu"
              data-testid="collection-lane-context-menu"
              style={{
                position: 'fixed',
                left: collectionPlacementMenu.x,
                top: collectionPlacementMenu.y,
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
                data-testid="collection-lane-reverse"
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
                onClick={() => {
                  try {
                    const placement = engine.getCollectionPlacement(
                      collectionPlacementMenu.placementId,
                    )
                    const collection = engine.getClipCollection(placement.collectionId)
                    const defaultName = `${collection.name} Reversed`
                    setReverseNameDraft(defaultName)
                    setReverseCollectionPrompt({
                      collectionId: placement.collectionId,
                      parentNodeId: placement.parentNodeId,
                      startTime: placement.startTime,
                      defaultName,
                    })
                    setCollectionPlacementMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setCollectionPlacementMenu(null)
                  }
                }}
              >
                Reverse and Save As…
              </button>
              <button
                role="menuitem"
                data-testid="collection-lane-mirror"
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
                onClick={() => {
                  try {
                    const placement = engine.getCollectionPlacement(
                      collectionPlacementMenu.placementId,
                    )
                    const collection = engine.getClipCollection(placement.collectionId)
                    const axis: MirrorAxis = 'X'
                    const defaultName = mirrorCollectionDefaultName(collection.name, axis)
                    setMirrorAxis(axis)
                    setMirrorCollectionNameDraft(defaultName)
                    setMirrorCollectionPrompt({
                      collectionId: placement.collectionId,
                      parentNodeId: placement.parentNodeId,
                      startTime: placement.startTime,
                      defaultName,
                    })
                    setCollectionPlacementMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setCollectionPlacementMenu(null)
                  }
                }}
              >
                Mirror and Save As…
              </button>
              <button
                role="menuitem"
                data-testid="collection-lane-reverse-mirror"
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
                onClick={() => {
                  try {
                    const placement = engine.getCollectionPlacement(
                      collectionPlacementMenu.placementId,
                    )
                    const collection = engine.getClipCollection(placement.collectionId)
                    const axis: MirrorAxis = 'X'
                    const defaultName = reverseMirrorCollectionDefaultName(collection.name, axis)
                    setReverseMirrorAxis(axis)
                    setReverseMirrorCollectionNameDraft(defaultName)
                    setReverseMirrorCollectionPrompt({
                      collectionId: placement.collectionId,
                      parentNodeId: placement.parentNodeId,
                      startTime: placement.startTime,
                      defaultName,
                    })
                    setCollectionPlacementMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setCollectionPlacementMenu(null)
                  }
                }}
              >
                Reverse + Mirror and Save As…
              </button>
              <button
                role="menuitem"
                data-testid="collection-lane-copy"
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
                onClick={() => {
                  try {
                    const placement = engine.getCollectionPlacement(
                      collectionPlacementMenu.placementId,
                    )
                    const collection = engine.getClipCollection(placement.collectionId)
                    const name = copyCollectionDefaultName(collection.name)
                    const res = dispatch(
                      new CopyCollectionCommand({
                        sourceCollectionId: placement.collectionId,
                        newName: name,
                        targetParentNodeId: placement.parentNodeId,
                        startTime: placement.startTime,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else notify(`Copied collection "${name}" created`)
                    setCollectionPlacementMenu(null)
                  } catch (e) {
                    notify(e instanceof Error ? e.message : String(e))
                    setCollectionPlacementMenu(null)
                  }
                }}
              >
                Copy and Save As…
              </button>
              <button
                role="menuitem"
                data-testid="collection-lane-delete"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--color-danger, #c00)',
                }}
                onClick={() => {
                  const pid = collectionPlacementMenu.placementId
                  const result = dispatch(
                    new DeleteCollectionPlacementCommand({ placementId: pid }),
                  )
                  if (!result.ok) notify(result.error.message)
                  else {
                    notify(deletedPlacementMessage(result.inverse.memberInstances.length))
                    if (selectedPlacementId === pid) setSelectedPlacementId(null)
                  }
                  setCollectionPlacementMenu(null)
                }}
              >
                Delete placement
              </button>
            </div>
          </>
        )}

        {/* Control timeline Clip Block context menu – Delete */}
        {controlBlockMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
              onClick={() => setControlBlockMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setControlBlockMenu(null)
              }}
            />
            <div
              role="menu"
              data-testid="control-block-context-menu"
              style={{
                position: 'fixed',
                left: controlBlockMenu.x,
                top: controlBlockMenu.y,
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
                data-testid="control-block-delete"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--color-danger, #c00)',
                }}
                onClick={() => {
                  const m = controlBlockMenu
                  if (!m) {
                    setControlBlockMenu(null)
                    return
                  }
                  if (m.kind === 'collection' && m.blockId) {
                    const ok = removeControlCollectionBlock({
                      controlKey: m.controlKey,
                      groupId: m.groupId,
                      blockId: m.blockId,
                    })
                    if (ok) notify('Detached collection block from timeline')
                    else notify('Block not found — no change applied')
                    setControlBlockMenu(null)
                    return
                  }
                  const ok =
                    m &&
                    removeControlBlock({
                      controlKey: m.controlKey,
                      groupId: m.groupId,
                      semanticName: m.semanticName,
                      clipId: m.clipId,
                      start: m.start,
                      end: m.end,
                    })
                  if (ok) notify(`Deleted Clip Block ${m!.semanticName} from timeline`)
                  else notify('Block not found — no change applied')
                  setControlBlockMenu(null)
                }}
              >
                {controlBlockMenu.kind === 'collection' ? 'Detach collection' : 'Delete block'}
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

        {/* Time-segment → collection batch modal (Orphans tab) */}
        {segmentModalOpen && parentNodeId && parentNode && activeSlide && (
          <TimeSegmentToCollectionModal
            parentNodeId={parentNodeId}
            parentName={parentNode.name}
            slideDuration={activeSlide.duration}
            existingClipNames={engine.clips.map((c) => c.name)}
            entries={segmentEntries}
            clips={segmentClips}
            staticNodes={segmentStaticNodes}
            bakingEvaluator={segmentBakingEvaluator}
            onClose={() => setSegmentModalOpen(false)}
            onConfirm={handleSegmentConfirm}
            existingCollectionCategories={allCollectionCategories}
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
            let defaultDuration: string
            try {
              defaultDuration = String(
                computeExtractionBounds(orphanExtraction.keyframes).clipDuration,
              )
            } catch {
              defaultDuration = '1'
            }
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
                onSuccess={({ mode, clipId, selStart, keyframes: filteredKeyframes }) => {
                  let didAssign = false
                  let assignedInstanceId: string | null = null
                  if (mode === 'new') {
                    // Create instance at selStart speed=1, auto-switch to Clips tab and highlight
                    const assignResult = dispatch(
                      new AssignClipCommand({ nodeId, clipId, startTime: selStart, speed: 1 }),
                    )
                    if (!assignResult.ok) {
                      notify(assignResult.error.message)
                      return
                    }
                    assignedInstanceId = (assignResult.inverse as { instanceId: string }).instanceId
                    didAssign = true
                    // Merge ExtractToClip + AssignClip into single undo entry (one gesture)
                    try {
                      undoStack.mergeLastAsTransaction(2)
                    } catch {
                      /* ignore */
                    }
                    setActiveTab('clips')
                    setHighlightedClipInstanceId(assignedInstanceId)
                    setSelectedInstanceId(assignedInstanceId)
                  }
                  const kfs = filteredKeyframes ?? orphanExtraction.keyframes
                  if (kfs.length > 0) {
                    setDeleteOrphansConfirm({
                      keyframes: kfs,
                      clipId,
                      selStart,
                      mode,
                      nodeId,
                    })
                    // Keep selection until confirm/keep decides; the modal will handle clearing
                    // Store assign info for potential later? already highlighted
                    void didAssign
                    void assignedInstanceId
                  } else {
                    setSelectedOrphanIds(new Set())
                    setOrphanAnchorId(null)
                    if (mode === 'existing') {
                      // stay on orphans
                    }
                  }
                }}
              />
            )
          })()}

        {deleteOrphansConfirm && (
          <DeleteOrphansConfirmModal
            open={!!deleteOrphansConfirm}
            keyframes={deleteOrphansConfirm.keyframes}
            clipName={(() => {
              try {
                return engine.getClip(deleteOrphansConfirm.clipId).name
              } catch {
                return deleteOrphansConfirm.clipId.slice(0, 8)
              }
            })()}
            onKeep={() => {
              setSelectedOrphanIds(new Set())
              setOrphanAnchorId(null)
              setDeleteOrphansConfirm(null)
              notify(
                `Kept ${deleteOrphansConfirm.keyframes.length} orphan keyframe(s) — still blocked for collections until deleted in Orphans tab`,
              )
            }}
            onConfirmDelete={() => {
              const kfs = deleteOrphansConfirm.keyframes
              const groups = new Map<string, { target: KeyframeTarget; ids: string[] }>()
              for (const kf of kfs) {
                const t = kf.target
                let key: string
                if (t.kind === 'node' && 'property' in t) key = `node:${t.nodeId}:${t.property}`
                else if (t.kind === 'node' && 'parameter' in t)
                  key = `node-param:${t.nodeId}:${t.parameter}`
                else if (t.kind === 'visible') key = `visible:${t.nodeId}`
                else if (t.kind === 'morph') key = `morph:${t.nodeId}`
                else if (t.kind === 'circle') key = `circle:${t.nodeId}:${t.property}`
                else if (t.kind === 'shadow') key = `shadow:${t.nodeId}:${t.property}`
                else if (t.kind === 'dataLabel') key = `dataLabel:${t.nodeId}:${t.label}`
                else if (t.kind === 'table') key = `table:${t.nodeId}:${t.property}`
                else if (t.kind === 'symmetry') key = `symmetry:${t.nodeId}`
                else if (t.kind === 'zIndex') key = `zIndex:${t.nodeId}`
                else key = `${t.kind}:${(t as { nodeId?: string }).nodeId ?? ''}`
                const entry = groups.get(key)
                if (entry) entry.ids.push(kf.keyframeId)
                else groups.set(key, { target: t as KeyframeTarget, ids: [kf.keyframeId] })
              }
              const cmds = [...groups.values()].map(
                (g) => new DeleteKeyframesCommand({ target: g.target, keyframeIds: g.ids }),
              )
              if (cmds.length === 0) {
                setDeleteOrphansConfirm(null)
                return
              }
              const tx =
                cmds.length === 1 ? cmds[0] : new TransactionCommand(cmds as unknown as never[])
              const result = dispatch(tx as never)
              if (!result.ok) {
                notify(result.error.message)
                return
              }
              // Merge Extract (+ Assign if new) + Delete into one undo step
              try {
                undoStack.mergeLastAsTransaction(2)
              } catch {
                /* ignore */
              }
              const deletedCount = kfs.length
              setSelectedOrphanIds(new Set())
              setOrphanAnchorId(null)
              setDeleteOrphansConfirm(null)
              notify(
                `Deleted ${deletedCount} orphan keyframe(s) — collection creation unblocked where resolved`,
              )
            }}
          />
        )}

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
                style={{ fontSize: 11, color: 'var(--color-text-muted, #666)', marginBottom: 8 }}
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
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="create-collection-name-input"
                  autoFocus
                />
              </label>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                Category (blank = Uncategorized)
                <input
                  value={collectionCategoryDraft}
                  onChange={(e) => setCollectionCategoryDraft(e.target.value)}
                  placeholder="Uncategorized"
                  list="create-collection-category-list"
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="create-collection-category-input"
                />
                <datalist id="create-collection-category-list">
                  {allCollectionCategories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
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
                    background: canCreateCollection
                      ? '#7c5cff'
                      : 'var(--color-bg-elevated, #9a9a9a)',
                    color: 'var(--color-accent-text, #fff)',
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
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="edit-collection-name-input"
                />
              </label>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                Category (blank = Uncategorized)
                <input
                  value={editingCategoryDraft}
                  onChange={(e) => setEditingCategoryDraft(e.target.value)}
                  placeholder="Uncategorized"
                  list="edit-collection-category-list"
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="edit-collection-category-input"
                />
                <datalist id="edit-collection-category-list">
                  {allCollectionCategories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
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
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted, #888)' }}>
                      No bindings
                    </div>
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
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                          {clipId.slice(0, 8)}
                        </span>
                        <button
                          onClick={() => {
                            const next = { ...editingBindingsDraft }
                            delete next[sem]
                            setEditingBindingsDraft(next)
                          }}
                          style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid var(--color-danger, #c00)',
                            color: 'var(--color-danger, #c00)',
                            fontSize: 11,
                            cursor: 'pointer',
                            background: 'var(--color-bg-panel, #fff)',
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
                  key={editingCollectionId}
                  clips={engine.clips}
                  collections={engine.clipCollections}
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
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button
                  onClick={openFlattenDialog}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  data-testid="edit-collection-flatten"
                >
                  Flatten to timeline
                </button>
                <button
                  onClick={() => {
                    setReplaceOpen(true)
                    setCollectionLocalError(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  data-testid="edit-collection-replace"
                >
                  Replace from timeline
                </button>
              </div>
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
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
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

        {/* Bulk additive offset of clip values across collection bindings */}
        {bulkOffsetOpen && parentNode && (
          <BulkOffsetModal
            parentName={parentNode.name}
            rows={bulkOffsetRows}
            initialFilter={bulkOffsetFilterSeed}
            getPreview={bulkOffsetPreview}
            onClose={() => setBulkOffsetOpen(false)}
            onConfirm={handleBulkOffsetConfirm}
          />
        )}

        {/* Flatten to timeline dialog */}
        {flattenOpen && editingCollectionId && activeSlide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Flatten collection to timeline"
            data-testid="flatten-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1200,
            }}
            onClick={() => setFlattenOpen(false)}
          >
            <div
              style={{
                background: 'var(--color-bg, #fff)',
                borderRadius: 8,
                padding: 16,
                minWidth: 420,
                maxWidth: 560,
                border: '1px solid var(--color-border, #ddd)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: 0, fontSize: 14 }}>Flatten to timeline</h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: 0 }}>
                Explode every bound clip into orphan keyframes at natural duration (timeline = from
                + u · duration). Placements are left in place — overlapping ranges will double-drive
                until one side is removed.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ flex: 1, fontSize: 12 }}>
                  From (s)
                  <input
                    data-testid="flatten-from-input"
                    value={flattenFromStr}
                    onChange={(e) => setFlattenFromStr(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border, #ddd)',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                </label>
                <label style={{ flex: 1, fontSize: 12 }}>
                  To (s)
                  <input
                    data-testid="flatten-to-input"
                    value={flattenToStr}
                    onChange={(e) => setFlattenToStr(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border, #ddd)',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                </label>
              </div>
              {(() => {
                const from = parseSec(flattenFromStr)
                const to = parseSec(flattenToStr)
                if (from === null || to === null) return null
                if (validateSegmentRange(from, to, activeSlide.duration) !== null) return null
                const preview = previewCollectionFlatten(engine, {
                  collectionId: editingCollectionId,
                  from,
                  to,
                })
                return (
                  <div data-testid="flatten-preview" style={{ fontSize: 12 }}>
                    <div>
                      {preview.totalWrites} keyframe(s) across {preview.entries.length} node(s)
                      {preview.truncatedCount > 0 && ` · ${preview.truncatedCount} past To skipped`}
                    </div>
                    {preview.entries.map((e) => (
                      <div key={e.nodeId} data-testid={`flatten-preview-${e.nodeId}`}>
                        {e.nodeName} ({e.semanticName}): {e.writeCount} from {e.clipName}
                      </div>
                    ))}
                    {preview.conflicts.length > 0 && (
                      <div
                        data-testid="flatten-conflicts"
                        role="alert"
                        style={{ color: 'var(--color-danger, #c00)', marginTop: 4 }}
                      >
                        {preview.conflicts.map((c) => (
                          <div key={`${c.target}-${c.nodeName}`}>
                            “{c.nodeName}” {c.label} already has {c.existingCount} keyframe(s) in
                            the range
                          </div>
                        ))}
                      </div>
                    )}
                    {preview.warnings.length > 0 && preview.totalWrites === 0 && (
                      <div style={{ color: 'var(--color-text-muted, #666)', marginTop: 4 }}>
                        {preview.warnings.join(' ')}
                      </div>
                    )}
                  </div>
                )
              })()}
              {flattenError && (
                <div
                  data-testid="flatten-error"
                  role="alert"
                  style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
                >
                  {flattenError}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setFlattenOpen(false)}
                  style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  data-testid="flatten-confirm"
                  onClick={handleFlattenConfirm}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
                    cursor: 'pointer',
                  }}
                >
                  Flatten
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Replace from timeline wizard (reuses the segment wizard in replace mode) */}
        {replaceOpen && editingCollectionId && parentNodeId && parentNode && activeSlide && (
          <TimeSegmentToCollectionModal
            parentNodeId={parentNodeId}
            parentName={parentNode.name}
            slideDuration={activeSlide.duration}
            existingClipNames={engine.clips.map((c) => c.name)}
            entries={segmentEntries}
            clips={segmentClips}
            staticNodes={segmentStaticNodes}
            bakingEvaluator={segmentBakingEvaluator}
            onClose={() => setReplaceOpen(false)}
            onConfirm={handleReplaceConfirm}
            mode="replace"
            replaceCollectionId={editingCollectionId}
            replaceCollectionName={replaceSeed.collectionName}
            replaceCollectionCategory={replaceSeed.collectionCategory}
            existingCollectionCategories={allCollectionCategories}
            initialClipNamesByNode={replaceSeed.clipNamesByNode}
            initialRange={defaultSegmentRange(
              segmentEntries.map((e) => e.time),
              activeSlide.duration,
            )}
          />
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
                {(() => {
                  try {
                    const col = engine.getClipCollection(deleteConfirmCollectionId)
                    const all = engine.clipCollections
                    const ids = [...col.bindings.values()]
                    const exclusive = ids.filter(
                      (cid) =>
                        !all.some((c) => c.id !== col.id && [...c.bindings.values()].includes(cid)),
                    )
                    const shared = ids.length - exclusive.length
                    if (ids.length === 0)
                      return (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                          No clips bound.
                        </span>
                      )
                    return (
                      <span style={{ fontSize: 11, color: 'var(--color-warning, #b45309)' }}>
                        This will also delete {exclusive.length} clip(s) bound to this collection
                        {shared > 0 ? ` (${shared} shared clip(s) will be kept)` : ''}.
                        <br />
                        All lanes using those clips will be removed.
                      </span>
                    )
                  } catch {
                    return (
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                        Collection clips will be deleted.
                      </span>
                    )
                  }
                })()}
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
                    border: '1px solid var(--color-danger, #c00)',
                    background: 'var(--color-danger, #c00)',
                    color: 'var(--color-accent-text, #fff)',
                  }}
                  data-testid="delete-collection-confirm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reverse and Save As… modals */}
        {reverseClipPrompt && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Reverse and Save As"
            data-testid="reverse-clip-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setReverseClipPrompt(null)}
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
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
                ↺ Reverse and Save As… — time mirror
              </h3>
              <p
                style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}
              >
                Create a time-mirrored copy (last seconds become first). Original is untouched. New
                instance at same startTime with speed=1.
              </p>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                New clip name
                <input
                  value={reverseNameDraft}
                  onChange={(e) => setReverseNameDraft(e.target.value)}
                  placeholder={reverseClipPrompt.defaultName}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="reverse-clip-name-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = reverseNameDraft.trim() || reverseClipPrompt.defaultName
                      const res = dispatch(
                        new ReverseClipCommand({
                          sourceClipId: reverseClipPrompt.clipId,
                          newName: name,
                          targetNodeId: reverseClipPrompt.nodeId,
                          startTime: reverseClipPrompt.startTime,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else {
                        notify(`Reversed clip "${name}" created`)
                        // highlight new lane if placement
                        const newId = (res as { ok: true; inverse: { newClipId: string } }).inverse
                          .newClipId
                        // Find new instance if any
                        if (reverseClipPrompt.nodeId) {
                          try {
                            const node = engine.getNode(reverseClipPrompt.nodeId)
                            const inst = node.clipInstances.find((i) => i.clipId === newId)
                            if (inst) {
                              setHighlightedClipInstanceId(inst.id)
                              setSelectedInstanceId(inst.id)
                            }
                          } catch (_e) {
                            void _e
                          }
                        }
                      }
                      setReverseClipPrompt(null)
                    } else if (e.key === 'Escape') {
                      setReverseClipPrompt(null)
                    }
                  }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setReverseClipPrompt(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="reverse-clip-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const name = reverseNameDraft.trim() || reverseClipPrompt.defaultName
                    if (!name.trim()) {
                      notify('Name is required')
                      return
                    }
                    const res = dispatch(
                      new ReverseClipCommand({
                        sourceClipId: reverseClipPrompt.clipId,
                        newName: name,
                        targetNodeId: reverseClipPrompt.nodeId,
                        startTime: reverseClipPrompt.startTime,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else {
                      notify(`Reversed clip "${name}" created`)
                      const newId = (res as { ok: true; inverse: { newClipId: string } }).inverse
                        .newClipId
                      if (reverseClipPrompt.nodeId) {
                        try {
                          const node = engine.getNode(reverseClipPrompt.nodeId)
                          const inst = node.clipInstances.find((i) => i.clipId === newId)
                          if (inst) {
                            setHighlightedClipInstanceId(inst.id)
                            setSelectedInstanceId(inst.id)
                          }
                        } catch (_e) {
                          void _e
                        }
                      }
                    }
                    setReverseClipPrompt(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
                  }}
                  data-testid="reverse-clip-confirm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        {mirrorClipPrompt && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Mirror and Save As"
            data-testid="mirror-clip-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setMirrorClipPrompt(null)}
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
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
                ⇋ Mirror and Save As… — space mirror
              </h3>
              <p
                style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}
              >
                Create a spatially mirrored copy (X = left-right, Y = top-bottom). Timing is
                unchanged and the original is untouched. New instance at same startTime with
                speed=1.
              </p>
              <fieldset style={{ margin: '0 0 12px', padding: '8px 10px', fontSize: 13 }}>
                <legend style={{ fontSize: 12 }}>Mirror axis</legend>
                <label style={{ display: 'block', marginBottom: 4 }}>
                  <input
                    type="radio"
                    name="manager-mirror-axis"
                    checked={mirrorAxis === 'X'}
                    data-testid="mirror-clip-axis-x"
                    onChange={() => {
                      const next: MirrorAxis = 'X'
                      setMirrorAxis(next)
                      try {
                        const src = engine.getClip(mirrorClipPrompt.clipId)
                        const prevDefault = mirrorClipDefaultName(src.name, mirrorAxis)
                        const nextDefault = mirrorClipDefaultName(src.name, next)
                        setMirrorClipPrompt({ ...mirrorClipPrompt, defaultName: nextDefault })
                        if (mirrorNameDraft === prevDefault || mirrorNameDraft.trim() === '') {
                          setMirrorNameDraft(nextDefault)
                        }
                      } catch {
                        void 0
                      }
                    }}
                  />{' '}
                  X — left-right
                </label>
                <label style={{ display: 'block' }}>
                  <input
                    type="radio"
                    name="manager-mirror-axis"
                    checked={mirrorAxis === 'Y'}
                    data-testid="mirror-clip-axis-y"
                    onChange={() => {
                      const next: MirrorAxis = 'Y'
                      setMirrorAxis(next)
                      try {
                        const src = engine.getClip(mirrorClipPrompt.clipId)
                        const prevDefault = mirrorClipDefaultName(src.name, mirrorAxis)
                        const nextDefault = mirrorClipDefaultName(src.name, next)
                        setMirrorClipPrompt({ ...mirrorClipPrompt, defaultName: nextDefault })
                        if (mirrorNameDraft === prevDefault || mirrorNameDraft.trim() === '') {
                          setMirrorNameDraft(nextDefault)
                        }
                      } catch {
                        void 0
                      }
                    }}
                  />{' '}
                  Y — top-bottom
                </label>
              </fieldset>
              {(() => {
                try {
                  const src = engine.getClip(mirrorClipPrompt.clipId)
                  // Compact lane summary; full per-lane notices surface after Save.
                  const laneNames = mirrorSkippedLaneNames(src)
                  if (laneNames.length === 0) return null
                  return (
                    <p
                      data-testid="mirror-clip-skips"
                      style={{
                        fontSize: 12,
                        color: 'var(--color-warning, #a60)',
                        margin: '0 0 8px',
                      }}
                    >
                      Not mirrored (out of scope for v1): {laneNames.join(', ')}. These lanes stay
                      unchanged on the original.
                    </p>
                  )
                } catch {
                  return null
                }
              })()}
              <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                New clip name
                <input
                  value={mirrorNameDraft}
                  onChange={(e) => setMirrorNameDraft(e.target.value)}
                  placeholder={mirrorClipPrompt.defaultName}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="mirror-clip-name-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = mirrorNameDraft.trim() || mirrorClipPrompt.defaultName
                      const res = dispatch(
                        new MirrorClipCommand({
                          sourceClipId: mirrorClipPrompt.clipId,
                          newName: name,
                          axis: mirrorAxis,
                          targetNodeId: mirrorClipPrompt.nodeId,
                          startTime: mirrorClipPrompt.startTime,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else {
                        notify(`Mirrored clip "${name}" created`)
                        for (const s of res.inverse.skipped) notify(s)
                        const newId = res.inverse.newClipId
                        if (mirrorClipPrompt.nodeId) {
                          try {
                            const node = engine.getNode(mirrorClipPrompt.nodeId)
                            const inst = node.clipInstances.find((i) => i.clipId === newId)
                            if (inst) {
                              setHighlightedClipInstanceId(inst.id)
                              setSelectedInstanceId(inst.id)
                            }
                          } catch (_e) {
                            void _e
                          }
                        }
                      }
                      setMirrorClipPrompt(null)
                    } else if (e.key === 'Escape') {
                      setMirrorClipPrompt(null)
                    }
                  }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setMirrorClipPrompt(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="mirror-clip-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const name = mirrorNameDraft.trim() || mirrorClipPrompt.defaultName
                    if (!name.trim()) {
                      notify('Name is required')
                      return
                    }
                    const res = dispatch(
                      new MirrorClipCommand({
                        sourceClipId: mirrorClipPrompt.clipId,
                        newName: name,
                        axis: mirrorAxis,
                        targetNodeId: mirrorClipPrompt.nodeId,
                        startTime: mirrorClipPrompt.startTime,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else {
                      notify(`Mirrored clip "${name}" created`)
                      for (const s of res.inverse.skipped) notify(s)
                      const newId = res.inverse.newClipId
                      if (mirrorClipPrompt.nodeId) {
                        try {
                          const node = engine.getNode(mirrorClipPrompt.nodeId)
                          const inst = node.clipInstances.find((i) => i.clipId === newId)
                          if (inst) {
                            setHighlightedClipInstanceId(inst.id)
                            setSelectedInstanceId(inst.id)
                          }
                        } catch (_e) {
                          void _e
                        }
                      }
                    }
                    setMirrorClipPrompt(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
                  }}
                  data-testid="mirror-clip-confirm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        {reverseCollectionPrompt && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Reverse Collection and Save As"
            data-testid="reverse-collection-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setReverseCollectionPrompt(null)}
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
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
                ↺ Reverse Collection and Save As… — time mirror
              </h3>
              <p
                style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}
              >
                Create a time-mirrored copy (last seconds become first). Creates reversed copies of
                each member clip and a new collection with same semanticName map. Offsets preserved
                (v1).
              </p>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                New collection name
                <input
                  value={reverseNameDraft}
                  onChange={(e) => setReverseNameDraft(e.target.value)}
                  placeholder={reverseCollectionPrompt.defaultName}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="reverse-collection-name-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = reverseNameDraft.trim() || reverseCollectionPrompt.defaultName
                      const res = dispatch(
                        new ReverseCollectionCommand({
                          sourceCollectionId: reverseCollectionPrompt.collectionId,
                          newName: name,
                          targetParentNodeId: reverseCollectionPrompt.parentNodeId,
                          startTime: reverseCollectionPrompt.startTime,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else notify(`Reversed collection "${name}" created`)
                      setReverseCollectionPrompt(null)
                    } else if (e.key === 'Escape') {
                      setReverseCollectionPrompt(null)
                    }
                  }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setReverseCollectionPrompt(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="reverse-collection-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const name = reverseNameDraft.trim() || reverseCollectionPrompt.defaultName
                    if (!name.trim()) {
                      notify('Name is required')
                      return
                    }
                    const res = dispatch(
                      new ReverseCollectionCommand({
                        sourceCollectionId: reverseCollectionPrompt.collectionId,
                        newName: name,
                        targetParentNodeId: reverseCollectionPrompt.parentNodeId,
                        startTime: reverseCollectionPrompt.startTime,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else notify(`Reversed collection "${name}" created`)
                    setReverseCollectionPrompt(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
                  }}
                  data-testid="reverse-collection-confirm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        {mirrorCollectionPrompt && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Mirror Collection and Save As"
            data-testid="mirror-collection-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setMirrorCollectionPrompt(null)}
          >
            <div
              className="modal"
              style={{
                background: 'var(--color-bg, #fff)',
                borderRadius: 8,
                padding: 16,
                minWidth: 380,
                border: '1px solid var(--color-border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
                ⇋ Mirror Collection and Save As… — space mirror
              </h3>
              <p
                style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}
              >
                Create a spatially mirrored copy (X = left-right, Y = top-bottom). Each member is
                mirrored per the single-clip rules and lateral bindings swap sides. Timing is
                unchanged and originals are untouched.
              </p>
              <fieldset style={{ margin: '0 0 12px', padding: '8px 10px', fontSize: 13 }}>
                <legend style={{ fontSize: 12 }}>Mirror axis</legend>
                <label style={{ display: 'block', marginBottom: 4 }}>
                  <input
                    type="radio"
                    name="manager-mirror-collection-axis"
                    checked={mirrorAxis === 'X'}
                    data-testid="mirror-collection-axis-x"
                    onChange={() => {
                      const next: MirrorAxis = 'X'
                      setMirrorAxis(next)
                      try {
                        const src = engine.getClipCollection(mirrorCollectionPrompt.collectionId)
                        const nextDefault = mirrorCollectionDefaultName(src.name, next)
                        setMirrorCollectionPrompt({
                          ...mirrorCollectionPrompt,
                          defaultName: nextDefault,
                        })
                        if (
                          mirrorCollectionNameDraft.trim() === '' ||
                          mirrorCollectionNameDraft === mirrorCollectionPrompt.defaultName
                        ) {
                          setMirrorCollectionNameDraft(nextDefault)
                        }
                      } catch {
                        void 0
                      }
                    }}
                  />{' '}
                  X — left-right
                </label>
                <label style={{ display: 'block' }}>
                  <input
                    type="radio"
                    name="manager-mirror-collection-axis"
                    checked={mirrorAxis === 'Y'}
                    data-testid="mirror-collection-axis-y"
                    onChange={() => {
                      const next: MirrorAxis = 'Y'
                      setMirrorAxis(next)
                      try {
                        const src = engine.getClipCollection(mirrorCollectionPrompt.collectionId)
                        const nextDefault = mirrorCollectionDefaultName(src.name, next)
                        setMirrorCollectionPrompt({
                          ...mirrorCollectionPrompt,
                          defaultName: nextDefault,
                        })
                        if (
                          mirrorCollectionNameDraft.trim() === '' ||
                          mirrorCollectionNameDraft === mirrorCollectionPrompt.defaultName
                        ) {
                          setMirrorCollectionNameDraft(nextDefault)
                        }
                      } catch {
                        void 0
                      }
                    }}
                  />{' '}
                  Y — top-bottom
                </label>
              </fieldset>
              {(() => {
                try {
                  const src = engine.getClipCollection(mirrorCollectionPrompt.collectionId)
                  const preview = buildMirrorSwapPreview(src.getBindingsObject())
                  const swapped = preview.filter((p) => p.swapped)
                  return (
                    <div
                      data-testid="mirror-collection-swap-preview"
                      style={{ fontSize: 12, margin: '0 0 8px' }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Lateral binding swap</div>
                      {swapped.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted, #666)' }}>
                          No lateral names — bindings pass through unchanged.
                        </div>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {preview.map((p) => (
                            <li key={p.source} style={{ fontFamily: 'monospace' }}>
                              {p.source} → {p.mirrored}
                              {!p.swapped && ' (unchanged)'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                } catch {
                  return null
                }
              })()}
              {(() => {
                try {
                  const src = engine.getClipCollection(mirrorCollectionPrompt.collectionId)
                  const lanes = collectMirrorSkippedLaneNames(
                    (function* () {
                      for (const clipId of Object.values(src.getBindingsObject())) {
                        try {
                          yield engine.getClip(clipId)
                        } catch {
                          void 0
                        }
                      }
                    })(),
                  )
                  if (lanes.length === 0) return null
                  return (
                    <p
                      data-testid="mirror-collection-skips"
                      style={{
                        fontSize: 12,
                        color: 'var(--color-warning, #a60)',
                        margin: '0 0 8px',
                      }}
                    >
                      Not mirrored (out of scope for v1): {lanes.join(', ')}. These lanes stay
                      unchanged on the originals.
                    </p>
                  )
                } catch {
                  return null
                }
              })()}
              <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                New collection name
                <input
                  value={mirrorCollectionNameDraft}
                  onChange={(e) => setMirrorCollectionNameDraft(e.target.value)}
                  placeholder={mirrorCollectionPrompt.defaultName}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="mirror-collection-name-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name =
                        mirrorCollectionNameDraft.trim() || mirrorCollectionPrompt.defaultName
                      const res = dispatch(
                        new MirrorCollectionCommand({
                          sourceCollectionId: mirrorCollectionPrompt.collectionId,
                          newName: name,
                          axis: mirrorAxis,
                          targetParentNodeId: mirrorCollectionPrompt.parentNodeId,
                          startTime: mirrorCollectionPrompt.startTime,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else {
                        notify(`Mirrored collection "${name}" created`)
                        for (const s of res.inverse.skipped) notify(s)
                        for (const w of res.inverse.morphWarnings ?? []) notify(w)
                      }
                      setMirrorCollectionPrompt(null)
                    } else if (e.key === 'Escape') {
                      setMirrorCollectionPrompt(null)
                    }
                  }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setMirrorCollectionPrompt(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="mirror-collection-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const name =
                      mirrorCollectionNameDraft.trim() || mirrorCollectionPrompt.defaultName
                    if (!name.trim()) {
                      notify('Name is required')
                      return
                    }
                    const res = dispatch(
                      new MirrorCollectionCommand({
                        sourceCollectionId: mirrorCollectionPrompt.collectionId,
                        newName: name,
                        axis: mirrorAxis,
                        targetParentNodeId: mirrorCollectionPrompt.parentNodeId,
                        startTime: mirrorCollectionPrompt.startTime,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else {
                      notify(`Mirrored collection "${name}" created`)
                      for (const s of res.inverse.skipped) notify(s)
                      for (const w of res.inverse.morphWarnings ?? []) notify(w)
                    }
                    setMirrorCollectionPrompt(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
                  }}
                  data-testid="mirror-collection-confirm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        {reverseMirrorCollectionPrompt && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Reverse and Mirror Collection and Save As"
            data-testid="reverse-mirror-collection-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
            }}
            onClick={() => setReverseMirrorCollectionPrompt(null)}
          >
            <div
              className="modal"
              style={{
                background: 'var(--color-bg, #fff)',
                borderRadius: 8,
                padding: 16,
                minWidth: 380,
                border: '1px solid var(--color-border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
                ↺⇋ Reverse + Mirror Collection and Save As…
              </h3>
              <p
                style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}
              >
                Time-reverse each member clip (last seconds become first) and spatially mirror it (X
                = left-right, Y = top-bottom). Bindings and morph shape names stay on their original
                sides — every member plays fully mirrored (symmetry bracket 1 → 0), and originals
                are untouched.
              </p>
              <fieldset style={{ margin: '0 0 12px', padding: '8px 10px', fontSize: 13 }}>
                <legend style={{ fontSize: 12 }}>Mirror axis</legend>
                <label style={{ display: 'block', marginBottom: 4 }}>
                  <input
                    type="radio"
                    name="manager-reverse-mirror-collection-axis"
                    checked={reverseMirrorAxis === 'X'}
                    data-testid="reverse-mirror-collection-axis-x"
                    onChange={() => {
                      const next: MirrorAxis = 'X'
                      setReverseMirrorAxis(next)
                      try {
                        const src = engine.getClipCollection(
                          reverseMirrorCollectionPrompt.collectionId,
                        )
                        const nextDefault = reverseMirrorCollectionDefaultName(src.name, next)
                        setReverseMirrorCollectionPrompt({
                          ...reverseMirrorCollectionPrompt,
                          defaultName: nextDefault,
                        })
                        if (
                          reverseMirrorCollectionNameDraft.trim() === '' ||
                          reverseMirrorCollectionNameDraft ===
                            reverseMirrorCollectionPrompt.defaultName
                        ) {
                          setReverseMirrorCollectionNameDraft(nextDefault)
                        }
                      } catch {
                        void 0
                      }
                    }}
                  />{' '}
                  X — left-right
                </label>
                <label style={{ display: 'block' }}>
                  <input
                    type="radio"
                    name="manager-reverse-mirror-collection-axis"
                    checked={reverseMirrorAxis === 'Y'}
                    data-testid="reverse-mirror-collection-axis-y"
                    onChange={() => {
                      const next: MirrorAxis = 'Y'
                      setReverseMirrorAxis(next)
                      try {
                        const src = engine.getClipCollection(
                          reverseMirrorCollectionPrompt.collectionId,
                        )
                        const nextDefault = reverseMirrorCollectionDefaultName(src.name, next)
                        setReverseMirrorCollectionPrompt({
                          ...reverseMirrorCollectionPrompt,
                          defaultName: nextDefault,
                        })
                        if (
                          reverseMirrorCollectionNameDraft.trim() === '' ||
                          reverseMirrorCollectionNameDraft ===
                            reverseMirrorCollectionPrompt.defaultName
                        ) {
                          setReverseMirrorCollectionNameDraft(nextDefault)
                        }
                      } catch {
                        void 0
                      }
                    }}
                  />{' '}
                  Y — top-bottom
                </label>
              </fieldset>
              <div
                data-testid="reverse-mirror-collection-swap-preview"
                style={{ fontSize: 12, margin: '0 0 8px', color: 'var(--color-text-muted, #666)' }}
              >
                Bindings &amp; morphs stay on their original sides — no left↔right swap.
              </div>
              {(() => {
                try {
                  const src = engine.getClipCollection(reverseMirrorCollectionPrompt.collectionId)
                  const lanes = collectMirrorSkippedLaneNames(
                    (function* () {
                      for (const clipId of Object.values(src.getBindingsObject())) {
                        try {
                          yield engine.getClip(clipId)
                        } catch {
                          void 0
                        }
                      }
                    })(),
                  )
                  if (lanes.length === 0) return null
                  return (
                    <p
                      data-testid="reverse-mirror-collection-skips"
                      style={{
                        fontSize: 12,
                        color: 'var(--color-warning, #a60)',
                        margin: '0 0 8px',
                      }}
                    >
                      Not mirrored (out of scope for v1): {lanes.join(', ')}. These lanes stay
                      unchanged on the originals.
                    </p>
                  )
                } catch {
                  return null
                }
              })()}
              <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                New collection name
                <input
                  value={reverseMirrorCollectionNameDraft}
                  onChange={(e) => setReverseMirrorCollectionNameDraft(e.target.value)}
                  placeholder={reverseMirrorCollectionPrompt.defaultName}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg, #fff)',
                    color: 'var(--color-text, #1c1e21)',
                  }}
                  data-testid="reverse-mirror-collection-name-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name =
                        reverseMirrorCollectionNameDraft.trim() ||
                        reverseMirrorCollectionPrompt.defaultName
                      const res = dispatch(
                        new ReverseMirrorCollectionCommand({
                          sourceCollectionId: reverseMirrorCollectionPrompt.collectionId,
                          newName: name,
                          axis: reverseMirrorAxis,
                          targetParentNodeId: reverseMirrorCollectionPrompt.parentNodeId,
                          startTime: reverseMirrorCollectionPrompt.startTime,
                        }),
                      )
                      if (!res.ok) notify(res.error.message)
                      else {
                        notify(`Reverse-mirrored collection "${name}" created`)
                        for (const s of res.inverse.skipped) notify(s)
                      }
                      setReverseMirrorCollectionPrompt(null)
                    } else if (e.key === 'Escape') {
                      setReverseMirrorCollectionPrompt(null)
                    }
                  }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setReverseMirrorCollectionPrompt(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="reverse-mirror-collection-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const name =
                      reverseMirrorCollectionNameDraft.trim() ||
                      reverseMirrorCollectionPrompt.defaultName
                    if (!name.trim()) {
                      notify('Name is required')
                      return
                    }
                    const res = dispatch(
                      new ReverseMirrorCollectionCommand({
                        sourceCollectionId: reverseMirrorCollectionPrompt.collectionId,
                        newName: name,
                        axis: reverseMirrorAxis,
                        targetParentNodeId: reverseMirrorCollectionPrompt.parentNodeId,
                        startTime: reverseMirrorCollectionPrompt.startTime,
                      }),
                    )
                    if (!res.ok) notify(res.error.message)
                    else {
                      notify(`Reverse-mirrored collection "${name}" created`)
                      for (const s of res.inverse.skipped) notify(s)
                    }
                    setReverseMirrorCollectionPrompt(null)
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'var(--color-accent, #7c5cff)',
                    color: 'var(--color-accent-text, #fff)',
                  }}
                  data-testid="reverse-mirror-collection-confirm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drag time feedback for lane moves */}
        {dragState && (dragState.mode === 'move' || dragState.mode === 'collection-move') && (
          <div
            data-testid="lane-drag-tooltip"
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              background: 'rgba(0,0,0,0.85)',
              color: 'var(--color-accent-text, #fff)',
              padding: '4px 8px',
              borderRadius: 4,
              alignSelf: 'flex-start',
            }}
          >
            Drag: {dragState.previewStart.toFixed(2)}s
            {dragState.mode === 'move' ? ` speed ${dragState.previewSpeed.toFixed(3)}` : ''}{' '}
            {gridSnapEnabled ? '· snap' : ''}
          </div>
        )}
        {/* Footer hint */}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted, #888)' }}>
          Press Esc to close{editing ? ' (Esc drills back first)' : ''} • Click backdrop to close •
          Filtered to animated descendants only (pre-order) • Del: remove selected
          lane/keyframe/placement (not object)
        </div>
      </div>
    </div>
  )
}

function AddBindingRow({
  clips,
  collections,
  onAdd,
}: {
  clips: readonly ClipDefinition[]
  collections: readonly import('../../engine/clipCollection').ClipCollection[]
  onAdd: (semanticName: string, clipId: string) => void
}) {
  const [sem, setSem] = useState('')
  // Top level narrows candidates to clips already bound by collections in that
  // category (discovery aid). Defaults to All so every clip stays pickable —
  // binding a brand-new clip must never be blocked by the filter.
  const [topCat, setTopCat] = useState<string>(ALL_COLLECTION_CATEGORIES)
  const [clipCat, setClipCat] = useState<string>(ALL_COLLECTION_CATEGORIES)
  const [clipId, setClipId] = useState('')
  const topCats = useMemo(() => distinctCollectionCategories(collections), [collections])
  // Top level: collection category narrows candidates to clips bound by
  // collections in that category. Lower level: clip category (usually the
  // semantic name). '__all' at either level disables that level.
  const candidateClips = useMemo(() => {
    if (topCat === ALL_COLLECTION_CATEGORIES) return clips
    const ids = new Set<string>()
    for (const col of collections) {
      if (!matchesCollectionCategory(col, topCat)) continue
      for (const id of col.bindings.values()) ids.add(id)
    }
    return clips.filter((c) => ids.has(c.id))
  }, [clips, collections, topCat])
  const clipCats = useMemo(() => distinctClipCategories(candidateClips), [candidateClips])
  const visibleClips =
    clipCat === ALL_COLLECTION_CATEGORIES
      ? candidateClips
      : candidateClips.filter((c) => (c.category ?? '').trim() === clipCat)
  return (
    <div
      style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}
      data-testid="add-binding-row"
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={topCat}
          onChange={(e) => {
            setTopCat(e.target.value)
            setClipCat(ALL_COLLECTION_CATEGORIES)
            setClipId('')
          }}
          title="Filter clips by collection category (top level)"
          style={{
            flex: 1,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg, #fff)',
            color: 'var(--color-text, #1c1e21)',
            fontSize: 12,
          }}
          data-testid="add-binding-collection-category-select"
        >
          <option value={ALL_COLLECTION_CATEGORIES}>All collection categories</option>
          <option value="">Uncategorized collections</option>
          {topCats.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <select
          value={clipCat}
          onChange={(e) => {
            setClipCat(e.target.value)
            setClipId('')
          }}
          title="Filter clips by clip category (usually the semantic name)"
          style={{
            flex: 1,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg, #fff)',
            color: 'var(--color-text, #1c1e21)',
            fontSize: 12,
          }}
          data-testid="add-binding-clip-category-select"
        >
          <option value={ALL_COLLECTION_CATEGORIES}>All clip categories</option>
          <option value="">Uncategorized clips</option>
          {clipCats.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          placeholder="semanticName (e.g. left_hand)"
          value={sem}
          onChange={(e) => setSem(e.target.value)}
          style={{
            flex: 1,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg, #fff)',
            color: 'var(--color-text, #1c1e21)',
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
            background: 'var(--color-bg, #fff)',
            color: 'var(--color-text, #1c1e21)',
            fontSize: 12,
          }}
          data-testid="add-binding-clip-select"
        >
          <option value="">— select clip —</option>
          {visibleClips.map((c) => (
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
    </div>
  )
}

function ManagerClipEditor({
  clip,
  nodeId,
  instanceId,
  pps,
}: {
  clip: ClipDefinition
  nodeId: string
  instanceId?: string
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
  // Instance-aware denormalization: if editing a specific instance, show timeline
  // scaled to that instance's visual duration (actual placed length) so keyframes
  // appear at the global-time positions the user originally authored.
  // Denormalized local = normalized * clipDuration (clip-local) ; for instance
  // visualLocal = normalized * visualDuration. We expose visual space when
  // instance exists, normalizing back via visualDuration on save.
  const instance = useMemo(() => {
    void tick
    try {
      const node = engine.getNode(nodeId)
      if (instanceId) {
        const found = node.clipInstances.find((inst) => inst.id === instanceId)
        if (found) return found
      }
      // Fallback: first instance of this clip on the node
      return node.clipInstances.find((inst) => inst.clipId === clip.id) ?? null
    } catch {
      return null
    }
  }, [engine, nodeId, instanceId, clip.id, tick])
  const visualDuration = useMemo(() => {
    if (!instance) return null
    const speed = instance.speed < 1e-4 ? 1e-4 : instance.speed
    if (clipDuration <= 0) return null
    return clipDuration / speed
  }, [instance, clipDuration])
  // Effective timeline duration for display: visualDuration when editing a placed
  // instance (denormalized to "actual" 4-sec scale), otherwise clip local duration.
  // This implements the requested denormalize-on-edit / normalize-on-save cycle.
  const editingDuration = visualDuration ?? clipDuration
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
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [dragPreviewSec, setDragPreviewSec] = useState<number | null>(null)
  const [dragPreviewPos, setDragPreviewPos] = useState<{ x: number; y: number } | null>(null)
  const [selectedKf, setSelectedKf] = useState<{
    id: string
    row: ClipEditorRow
    value: unknown
    time: number
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

  // Morph debug display: clip morph keyframes store name-based values
  // { fromShapeName, toShapeName, coefficient, from/toCategoryPath? }.
  // Resolve names to category paths (cat1->cat2->name) via the edited
  // node's shapes so [object Object] never shows and stale names are visible.
  // New clips carry category paths; legacy clips (no path) fall back to
  // first name match with an ambiguity flag — mirroring the evaluator.
  const morphShapes = useMemo(() => {
    void tick
    try {
      return engine.getShapes(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId, tick])
  const morphCategories = useMemo(() => {
    void tick
    try {
      return engine.getShapeCategories(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId, tick])
  const morphPathOfShapeId = useCallback(
    (categoryId: string | null | undefined): readonly string[] | null => {
      if (categoryId === null || categoryId === undefined) return null
      const byId = new Map(morphCategories.map((c) => [c.id, c] as const))
      const chain: string[] = []
      const seen = new Set<string>()
      let cur: string | null = categoryId
      while (cur !== null) {
        if (seen.has(cur)) break
        seen.add(cur)
        const cat = byId.get(cur)
        if (!cat) return null
        chain.unshift(cat.name)
        cur = cat.parentId ?? null
      }
      return chain.length > 0 ? chain : null
    },
    [morphCategories],
  )
  const morphResolveDisplay = useCallback(
    (shapeName: string | null, storedPath?: readonly string[] | null): string => {
      if (shapeName === null || shapeName === undefined) return '— None —'
      const matches = morphShapes.filter((s) => s.name === shapeName)
      if (matches.length === 0) return `"${shapeName}" (missing on node)`
      let picked = matches[0]
      let legacyAmbiguous = false
      if (matches.length > 1) {
        if (storedPath !== undefined) {
          const exact = matches.filter((s) => {
            const p = morphPathOfShapeId(s.categoryId ?? null)
            const a = p ?? null
            const b = storedPath ?? null
            if (a === null && b === null) return true
            if (a === null || b === null) return false
            if (a.length !== b.length) return false
            return a.every((seg, i) => seg === b[i])
          })
          if (exact.length > 0) picked = exact[0]
          // else: stored path is stale — fall through to first match (evaluator does the same)
        } else {
          legacyAmbiguous = true
        }
      }
      const path = morphPathOfShapeId(picked!.categoryId ?? null)
      const prefix = path && path.length > 0 ? `${path.join('->')}->` : 'Uncategorized->'
      const storedText =
        storedPath === undefined
          ? 'legacy (no path)'
          : storedPath === null
            ? 'Uncategorized'
            : storedPath.join('->')
      const suffix =
        matches.length > 1
          ? storedPath !== undefined
            ? ` (resolved ${matches.length}, stored: ${storedText})`
            : ` (×${matches.length} same name! legacy — first match shown)`
          : ''
      void legacyAmbiguous
      return `${prefix}${picked!.name}${suffix}`
    },
    [morphShapes, morphPathOfShapeId],
  )
  const parseMorphClipValue = useCallback(
    (
      value: unknown,
    ): {
      fromName: string | null
      toName: string | null
      coefficient: number | null
      fromPath?: readonly string[] | null
      toPath?: readonly string[] | null
    } => {
      if (typeof value === 'number') {
        return { fromName: null, toName: null, coefficient: value }
      }
      if (typeof value === 'object' && value !== null) {
        const r = value as Record<string, unknown>
        if ('fromShapeName' in r || 'toShapeName' in r || 'coefficient' in r) {
          const parsePath = (raw: unknown): readonly string[] | null | undefined => {
            if (raw === undefined) return undefined
            if (raw === null) return null
            if (Array.isArray(raw) && raw.every((s) => typeof s === 'string')) return [...raw]
            return undefined
          }
          return {
            fromName: (r.fromShapeName as string | null) ?? null,
            toName: (r.toShapeName as string | null) ?? null,
            coefficient: typeof r.coefficient === 'number' ? (r.coefficient as number) : null,
            fromPath: parsePath(r.fromCategoryPath),
            toPath: parsePath(r.toCategoryPath),
          }
        }
        // legacy id-based object stored in old clips
        if ('fromShapeId' in r || 'toShapeId' in r) {
          return {
            fromName: (r.fromShapeId as string | null) ?? null,
            toName: (r.toShapeId as string | null) ?? null,
            coefficient: typeof r.coefficient === 'number' ? (r.coefficient as number) : null,
          }
        }
      }
      return { fromName: null, toName: null, coefficient: null }
    },
    [],
  )
  const formatClipMorphTitle = useCallback(
    (value: unknown): string => {
      const parsed = parseMorphClipValue(value)
      const from =
        parsed.fromName === null ? '—' : morphResolveDisplay(parsed.fromName, parsed.fromPath)
      const to = parsed.toName === null ? '—' : morphResolveDisplay(parsed.toName, parsed.toPath)
      const coeff = parsed.coefficient === null ? '?' : String(parsed.coefficient)
      return `from ${from} → to ${to} @ ${coeff}`
    },
    [parseMorphClipValue, morphResolveDisplay],
  )
  const formatClipKeyframeTitle = useCallback(
    (row: ClipEditorRow, value: unknown): string => {
      if (row.kind === 'clipMorph') return formatClipMorphTitle(value)
      if (typeof value === 'object' && value !== null) {
        try {
          return JSON.stringify(value)
        } catch {
          return String(value)
        }
      }
      return String(value)
    },
    [formatClipMorphTitle],
  )

  // Timeline width: fill available modal width for short clips (user request:
  // "duration to take whole width, now 4s shrank to 20%") while preserving
  // scroll for long clips. baseWidth is pps-accurate; contentWidth ensures
  // minimum 760px UI. laneWidth fills contentWidth, so 4s always spans the
  // modal. effectivePps = laneWidth / duration is used for diamond
  // positioning and drag delta → seconds, keeping ruler and diamonds in sync
  // (previous bug: ruler stretched to contentWidth while diamonds used pps).
  const baseWidth = Math.max(1, editingDuration) * pps
  const contentWidth = Math.max(760, baseWidth + 80)
  const laneWidth = contentWidth // fill whole width; scroll when baseWidth > 760
  const effectivePps = laneWidth / Math.max(1e-9, editingDuration)
  const editorPps = effectivePps // clip-local effective pixels per second

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
    else if (selectedKf?.id === keyframeId) setSelectedKf(null)
  }

  // Helper to get keyframes for a row
  const getKeyframesForRow = (
    row: ClipEditorRow,
  ): readonly import('../../engine/keyframe').Keyframe[] => {
    try {
      const c = engine.getClip(clip.id)
      if (row.kind === 'clipChannel') return c.getChannelKeyframes(row.channel)
      if (row.kind === 'clipVisible') return c.getVisibleKeyframes()
      if (row.kind === 'clipZIndex') return c.getZIndexKeyframes()
      if (row.kind === 'clipMorph') return c.getMorphKeyframes()
      if (row.kind === 'clipSymmetry') return c.getSymmetryKeyframes()
      if (row.kind === 'clipCircle') return c.getCircleKeyframes(row.property)
      if (row.kind === 'clipShadow') return c.getShadowChannelKeyframes(row.property)
      if (row.kind === 'clipMaterial') return c.getMaterialChannelKeyframes(row.parameter)
      return []
    } catch {
      return []
    }
  }

  // Diamond drag handling – move only for uniform channels, with opt-in snap + live feedback
  // Denormalized workflow: display local = normalized * editingDuration
  // (visualDuration when editing a placed instance, otherwise clipDuration).
  // Drag delta stays in seconds, snappedLocal clamped to editingDuration,
  // then renormalized via editingDuration on save.
  useEffect(() => {
    if (!dragInfo) return
    const onMove = (e: PointerEvent) => {
      const cur = dragInfo
      if (!cur || cur.row.kind !== 'clipChannel') return
      const deltaPx = e.clientX - cur.startX
      const deltaLocal = deltaPx / editorPps
      const rawLocal = cur.originalLocal + deltaLocal
      // candidate times for keyframe snap (other keyframes in seconds)
      let snappedLocal = rawLocal
      if (snapEnabled) {
        const candidateTimesSec: number[] = []
        for (const r of rows) {
          for (const kf of getKeyframesForRow(r)) {
            if (kf.id === cur.keyframeId) continue
            candidateTimesSec.push(kf.time * editingDuration)
          }
        }
        snappedLocal = snapKeyframeTime(rawLocal, {
          gridEnabled: true,
          keyframesEnabled: candidateTimesSec.length > 0,
          candidateTimes: candidateTimesSec,
          pps: editorPps,
        })
      }
      const clampedLocal = Math.max(0, Math.min(snappedLocal, editingDuration))
      const newNormalized = editingDuration > 0 ? clampedLocal / editingDuration : 0
      // preview via DOM direct mutation
      const el = document.querySelector(
        `[data-keyframe-id="${cur.keyframeId}"]`,
      ) as HTMLElement | null
      if (el) {
        // left is centered at kf, original uses left-5 offset; keep consistent with rendering left-5
        el.style.left = `${clampedLocal * editorPps}px`
      }
      // live feedback
      setDragPreviewSec(clampedLocal)
      setDragPreviewPos({ x: e.clientX, y: e.clientY })
      // store preview in state for commit (attach to ref)
      ;(cur as unknown as { previewNormalized: number }).previewNormalized = newNormalized
    }
    const onUp = () => {
      const cur = dragInfo
      setDragInfo(null)
      setDragPreviewSec(null)
      setDragPreviewPos(null)
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
      else if (selectedKf && selectedKf.id === cur.keyframeId) {
        setSelectedKf({ ...selectedKf, time: preview })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [
    dragInfo,
    editorPps,
    editingDuration,
    clip.id,
    dispatch,
    notify,
    snapEnabled,
    rows,
    getKeyframesForRow,
    selectedKf,
  ])

  const handleDiamondPointerDown = (
    e: React.PointerEvent,
    row: ClipEditorRow,
    kf: import('../../engine/keyframe').Keyframe,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    // Select for value editing (all row kinds)
    setSelectedKf({ id: kf.id, row, value: kf.value, time: kf.time })
    if (row.kind !== 'clipChannel') return // only uniform draggable for time
    const normalized = kf.time
    const local = normalized * editingDuration
    setDragInfo({
      keyframeId: kf.id,
      row,
      startX: e.clientX,
      originalNormalized: normalized,
      originalLocal: local,
    })
  }

  const handleSelectedValueChange = (newValue: number) => {
    if (!selectedKf || selectedKf.row.kind !== 'clipChannel') return
    const row = selectedKf.row as Extract<ClipEditorRow, { kind: 'clipChannel' }>
    const result = dispatch(
      new SetClipKeyframeValueCommand({
        target: { kind: 'clip', clipId: clip.id, channel: row.channel },
        keyframeId: selectedKf.id,
        newValue,
      }),
    )
    if (!result.ok) notify(result.error.message)
    else {
      // update local selected value optimistically
      setSelectedKf({ ...selectedKf, value: newValue })
    }
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
              background: 'var(--color-bg, #fff)',
              color: 'var(--color-text, #1c1e21)',
              fontSize: 12,
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>seconds</span>
        </label>
        <label
          style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}
          title="When enabled, dragging snaps to 0.5s grid and nearby keyframes (5px threshold)"
        >
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
            data-testid="clip-editor-snap-toggle"
          />
          Snap (0.5s + keyframes)
        </label>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #888)', marginLeft: 'auto' }}>
          {dragPreviewSec !== null
            ? `Dragging: ${dragPreviewSec.toFixed(2)}s (${editingDuration > 0 ? (dragPreviewSec / editingDuration).toFixed(3) : '0.000'} norm)`
            : visualDuration !== null && Math.abs(editingDuration - clipDuration) > 1e-6
              ? `Visual 0..${editingDuration.toFixed(2)}s (clip ${clipDuration.toFixed(2)}s) • diamonds = normalized × duration`
              : `Clip-local time 0..${clipDuration.toFixed(2)}s • diamonds = normalized × duration`}
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
                        : row.kind === 'clipZIndex'
                          ? 'zIndex'
                          : row.kind === 'clipSymmetry'
                            ? 'symmetry'
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
          <div style={{ width: laneWidth, position: 'relative' }}>
            <div ref={timeAreaRef} data-testid="clip-editor-ruler">
              <ManagerRuler
                durationSec={editingDuration}
                pps={editorPps}
                widthPx={laneWidth}
                testId="clip-editor-ruler"
              />
            </div>
            <div
              style={{
                position: 'relative',
                height: rows.length * ROW_HEIGHT,
                width: laneWidth,
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
                      const left = kf.time * editingDuration * editorPps
                      const isSelected = selectedKf?.id === kf.id
                      return (
                        <div
                          key={kf.id}
                          data-keyframe-id={kf.id}
                          data-testid={`clip-diamond-${kf.id}`}
                          data-selected={String(isSelected)}
                          title={`kf ${kf.time.toFixed(3)} (local ${(kf.time * editingDuration).toFixed(2)}s) → ${formatClipKeyframeTitle(row, kf.value)}${isSelected ? ' • selected' : ''}`}
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
                            background: isSelected ? '#ff3b30' : 'var(--color-accent, #7c5cff)',
                            border: isSelected ? '2px solid #fff' : '1px solid #fff',
                            boxShadow: isSelected
                              ? '0 0 0 2px rgba(255,59,48,0.4), 0 1px 2px rgba(0,0,0,0.2)'
                              : '0 1px 2px rgba(0,0,0,0.2)',
                            cursor: row.kind === 'clipChannel' ? 'grab' : 'pointer',
                            zIndex: isSelected ? 3 : 2,
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

      {/* Selected keyframe inspector – position/value editing */}
      {selectedKf && (
        <div
          data-testid="clip-selected-inspector"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 10px',
            background: 'var(--color-bg-elevated, #f5f5f5)',
            border: '1px solid var(--color-border, #ddd)',
            borderRadius: 6,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {selectedKf.row.label} • {selectedKf.id.slice(0, 6)}
          </span>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Time
            <input
              type="number"
              step={0.01}
              value={Number((selectedKf.time * editingDuration).toFixed(3))}
              onChange={(e) => {
                const local = Number(e.target.value)
                if (!Number.isFinite(local)) return
                const newNorm = Math.max(
                  0,
                  Math.min(1, editingDuration > 0 ? local / editingDuration : 0),
                )
                if (Math.abs(newNorm - selectedKf.time) < 1e-6) return
                const row = selectedKf.row
                if (row.kind !== 'clipChannel') {
                  notify('Only uniform channels support time editing in this slice')
                  return
                }
                const result = dispatch(
                  new MoveClipKeyframesCommand({
                    target: {
                      kind: 'clip',
                      clipId: clip.id,
                      channel: (row as Extract<ClipEditorRow, { kind: 'clipChannel' }>).channel,
                    },
                    moves: [{ keyframeId: selectedKf.id, newTime: newNorm }],
                  }),
                )
                if (!result.ok) notify(result.error.message)
                else setSelectedKf({ ...selectedKf, time: newNorm })
              }}
              data-testid="clip-selected-time-input"
              style={{
                width: 80,
                padding: '4px 6px',
                borderRadius: 4,
                border: '1px solid var(--color-border, #ddd)',
                fontSize: 12,
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>s</span>
          </label>
          {selectedKf.row.kind === 'clipChannel' && typeof selectedKf.value === 'number' && (
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              Value
              <input
                type="number"
                step={0.1}
                value={Number(selectedKf.value)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  handleSelectedValueChange(v)
                }}
                data-testid="clip-selected-value-input"
                style={{
                  width: 90,
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background: 'var(--color-bg, #fff)',
                  color: 'var(--color-text, #1c1e21)',
                  fontSize: 12,
                }}
              />
            </label>
          )}
          {selectedKf.row.kind === 'clipMorph' &&
            (() => {
              const live = getKeyframesForRow(selectedKf.row).find((k) => k.id === selectedKf.id)
              const parsed = parseMorphClipValue(live?.value ?? selectedKf.value)
              const fromPath = morphResolveDisplay(parsed.fromName, parsed.fromPath)
              const toPath = morphResolveDisplay(parsed.toName, parsed.toPath)
              const coeffText = parsed.coefficient === null ? '?' : String(parsed.coefficient)
              const isMissing =
                (parsed.fromName !== null &&
                  morphShapes.filter((s) => s.name === parsed.fromName).length === 0) ||
                (parsed.toName !== null &&
                  morphShapes.filter((s) => s.name === parsed.toName).length === 0)
              const isLegacyAmbiguous =
                (parsed.fromName !== null &&
                  morphShapes.filter((s) => s.name === parsed.fromName).length > 1 &&
                  parsed.fromPath === undefined) ||
                (parsed.toName !== null &&
                  morphShapes.filter((s) => s.name === parsed.toName).length > 1 &&
                  parsed.toPath === undefined)
              return (
                <>
                  <span
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                    title={`raw fromShapeName: ${parsed.fromName ?? 'null'}${parsed.fromPath !== undefined ? ` [${parsed.fromPath === null ? 'Uncategorized' : parsed.fromPath.join('->')}]` : ' (legacy: no stored path)'}`}
                  >
                    From
                    <code
                      data-testid="clip-selected-morph-from"
                      style={{
                        padding: '4px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--color-border, #ddd)',
                        background: 'var(--color-bg, #fff)',
                        fontSize: 11,
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'inline-block',
                      }}
                    >
                      {fromPath}
                    </code>
                  </span>
                  <span
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                    title={`raw toShapeName: ${parsed.toName ?? 'null'}${parsed.toPath !== undefined ? ` [${parsed.toPath === null ? 'Uncategorized' : parsed.toPath.join('->')}]` : ' (legacy: no stored path)'}`}
                  >
                    To
                    <code
                      data-testid="clip-selected-morph-to"
                      style={{
                        padding: '4px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--color-border, #ddd)',
                        background: 'var(--color-bg, #fff)',
                        fontSize: 11,
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'inline-block',
                      }}
                    >
                      {toPath}
                    </code>
                  </span>
                  <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Coefficient
                    <code
                      data-testid="clip-selected-morph-coefficient"
                      style={{
                        padding: '4px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--color-border, #ddd)',
                        background: 'var(--color-bg, #fff)',
                        fontSize: 11,
                      }}
                    >
                      {coeffText}
                    </code>
                  </span>
                  {isMissing && (
                    <span
                      data-testid="clip-selected-morph-warning"
                      style={{ fontSize: 11, color: '#b45309' }}
                    >
                      shape name not found on node — clip falls back to base geometry
                    </span>
                  )}
                  {!isMissing && isLegacyAmbiguous && (
                    <span
                      data-testid="clip-selected-morph-legacy-warning"
                      style={{ fontSize: 11, color: '#b45309' }}
                    >
                      legacy clip without category — first name match shown; re-extract from orphans
                      to store the category
                    </span>
                  )}
                </>
              )
            })()}
          <span
            style={{ fontSize: 11, color: 'var(--color-text-muted, #888)', marginLeft: 'auto' }}
          >
            {selectedKf.row.kind === 'clipChannel'
              ? `drag diamond to move • edit time/value above`
              : selectedKf.row.kind === 'clipMorph'
                ? `time ${(selectedKf.time * editingDuration).toFixed(2)}s • ${formatClipMorphTitle(getKeyframesForRow(selectedKf.row).find((k) => k.id === selectedKf.id)?.value ?? selectedKf.value)}`
                : `time ${(selectedKf.time * editingDuration).toFixed(2)}s • value ${formatClipKeyframeTitle(selectedKf.row, getKeyframesForRow(selectedKf.row).find((k) => k.id === selectedKf.id)?.value ?? selectedKf.value)}`}
          </span>
          <button
            onClick={() => setSelectedKf(null)}
            data-testid="clip-selected-close"
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg, #fff)',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Deselect
          </button>
        </div>
      )}

      {/* Live drag feedback tooltip */}
      {dragPreviewSec !== null && dragPreviewPos && (
        <div
          data-testid="clip-drag-tooltip"
          style={{
            position: 'fixed',
            left: dragPreviewPos.x + 12,
            top: dragPreviewPos.y - 28,
            background: 'rgba(0,0,0,0.85)',
            color: 'var(--color-accent-text, #fff)',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 1100,
            whiteSpace: 'nowrap',
          }}
        >
          {dragPreviewSec.toFixed(2)}s
          {editingDuration > 0 ? ` (${(dragPreviewSec / editingDuration).toFixed(3)})` : ''}{' '}
          {snapEnabled ? '· snap' : ''}
        </div>
      )}

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
