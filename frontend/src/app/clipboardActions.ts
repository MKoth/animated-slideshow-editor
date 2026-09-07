import type { EnginePublic } from '../engine'
import type { SceneNode } from '../engine'
import type { Slide } from '../engine'
import type { DispatchCommand } from '../engine/commands'
import {
  CreateAssetInstanceCommand,
  DeleteNodeCommand,
  DuplicateNodeCommand,
  ImportReusableObjectCommand,
} from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import {
  useClipboardStore,
  writeSystemClipboard,
  readSystemClipboard,
  type ClipboardPayload,
} from '../stores/clipboardStore'
import type { ReusableObjectJSON } from '../engine/reusableObject'
import { useSelectionStore } from '../stores/selectionStore'

const DUPLICATE_OFFSET = { x: 20, y: 20 } as const

export function copySelection(engine: EnginePublic): void {
  const selectedIds = useSelectionStore.getState().selectedIds
  if (selectedIds.length === 0) {
    return
  }
  const selectedSet = new Set(selectedIds)
  const topLevelIds: string[] = []
  for (const nodeId of selectedIds) {
    if (isDescendantOfSelected(nodeId, selectedSet, engine)) {
      continue
    }
    try {
      const node = engine.getNode(nodeId)
      if (!node.parent) continue
      if (node.components.camera) continue
      topLevelIds.push(nodeId)
    } catch {
      continue
    }
  }
  if (topLevelIds.length === 0) {
    return
  }
  const entries: ReusableObjectJSON[] = []
  for (const nodeId of topLevelIds) {
    try {
      const node = engine.getNode(nodeId)
      const json = engine.exportReusableObject(nodeId, node.name)
      entries.push(json)
    } catch {
      continue
    }
  }
  if (entries.length === 0) {
    return
  }
  const payload: ClipboardPayload = {
    version: 1,
    createdAt: Date.now(),
    entries,
  }
  useClipboardStore.getState().copyPayload(payload)
  // Populate legacy items for backward compat (assetInstances only, in selection order)
  const legacyItems: import('../stores/clipboardStore').ClipboardItem[] = []
  for (const nodeId of selectedIds) {
    try {
      const node = engine.getNode(nodeId)
      const comp = node.components.assetInstance
      if (!comp) continue
      // Only include if node was actually copied (top-level entries contain it)
      // For legacy, keep original single-node shallow items
      const slide = findSlideOfNode(engine, nodeId)
      if (!slide) continue
      legacyItems.push({
        definitionId: comp.assetDefinitionId,
        sceneId: slide.scene.id,
        parentId: node.parent?.id ?? slide.scene.root.id,
        name: node.name,
        transform: { ...node.transform },
        ...(node.semanticName !== undefined ? { semanticName: node.semanticName } : {}),
      })
    } catch {
      continue
    }
  }
  if (legacyItems.length > 0) {
    useClipboardStore.getState().copy(legacyItems)
  }
  // Fire-and-forget system clipboard (requires user gesture, may fail silently)
  void writeSystemClipboard(payload)
}

function findSlideOfNode(engine: EnginePublic, nodeId: string): Slide | null {
  for (const slide of engine.project?.slides ?? []) {
    for (const n of walkPreOrder(slide.scene.root)) {
      if (n.id === nodeId) return slide
    }
  }
  return null
}

export function pasteClipboard(
  engineOrDispatch: EnginePublic | DispatchCommand,
  dispatchMaybe?: DispatchCommand,
): void {
  // Overload handling for legacy tests: pasteClipboard(dispatch)
  let engine: EnginePublic | null = null
  let dispatch: DispatchCommand
  if (typeof engineOrDispatch === 'function' && dispatchMaybe === undefined) {
    dispatch = engineOrDispatch as DispatchCommand
    const legacyItems = useClipboardStore.getState().items
    if (legacyItems.length > 0) {
      const created: string[] = []
      for (const item of legacyItems) {
        const result = dispatch(
          new CreateAssetInstanceCommand({
            sceneId: item.sceneId,
            parentId: item.parentId,
            definitionId: item.definitionId,
            name: item.name,
            position: {
              x: item.transform.x + DUPLICATE_OFFSET.x,
              y: item.transform.y + DUPLICATE_OFFSET.y,
            },
            rotation: item.transform.rotation,
            scaleX: item.transform.scaleX,
            scaleY: item.transform.scaleY,
            ...(item.semanticName !== undefined ? { semanticName: item.semanticName } : {}),
          }),
        )
        if (result.ok) {
          created.push(result.inverse.nodeId)
        }
      }
      if (created.length > 0) {
        useSelectionStore.getState().selectMany(created)
      }
      return
    }
    // If no legacy items but payload exists, we cannot paste without engine; no-op for legacy single-arg
    return
  } else {
    engine = engineOrDispatch as EnginePublic
    dispatch = dispatchMaybe as DispatchCommand
  }

  if (!engine || !dispatch) return

  // Fast synchronous path: if in-memory payload exists, use it immediately
  const payload = useClipboardStore.getState().payload
  if (payload && payload.entries.length > 0) {
    pasteWithPayload(payload, engine, dispatch)
    return
  }

  // No in-memory payload: try system clipboard asynchronously (fire-and-forget for now, cross-tab)
  // For cross-tab/project paste, caller should use pasteClipboardAsync
  const legacyItems = useClipboardStore.getState().items
  if (legacyItems.length > 0) {
    const created: string[] = []
    for (const item of legacyItems) {
      const result = dispatch(
        new CreateAssetInstanceCommand({
          sceneId: item.sceneId,
          parentId: item.parentId,
          definitionId: item.definitionId,
          name: item.name,
          position: {
            x: item.transform.x + DUPLICATE_OFFSET.x,
            y: item.transform.y + DUPLICATE_OFFSET.y,
          },
          rotation: item.transform.rotation,
          scaleX: item.transform.scaleX,
          scaleY: item.transform.scaleY,
          ...(item.semanticName !== undefined ? { semanticName: item.semanticName } : {}),
        }),
      )
      if (result.ok) {
        created.push(result.inverse.nodeId)
      }
    }
    if (created.length > 0) {
      useSelectionStore.getState().selectMany(created)
    }
  }
}

export async function pasteClipboardAsync(
  engine: EnginePublic,
  dispatch: DispatchCommand,
): Promise<void> {
  let payload = useClipboardStore.getState().payload
  if (payload && payload.entries.length > 0) {
    // Prefer system clipboard if newer
    const systemPayload = await readSystemClipboard()
    if (systemPayload && systemPayload.entries.length > 0) {
      if (systemPayload.createdAt >= payload.createdAt) {
        payload = systemPayload
        useClipboardStore.getState().copyPayload(systemPayload)
      }
    }
    pasteWithPayload(payload, engine, dispatch)
    return
  }
  const systemPayload = await readSystemClipboard()
  if (systemPayload && systemPayload.entries.length > 0) {
    useClipboardStore.getState().copyPayload(systemPayload)
    pasteWithPayload(systemPayload, engine, dispatch)
    return
  }
  // fallback to sync version
  pasteClipboard(engine, dispatch)
}

function pasteWithPayload(
  payload: ClipboardPayload,
  engine: EnginePublic,
  dispatch: DispatchCommand,
): void {
  const targetSlide = engine.getActiveSlide() ?? engine.project?.slides[0]
  if (!targetSlide) return
  const targetParentId = targetSlide.scene.root.id
  const created: string[] = []
  for (const entry of payload.entries) {
    const cloned: ReusableObjectJSON = JSON.parse(JSON.stringify(entry)) as ReusableObjectJSON
    const rootNode = (
      cloned.nodes as unknown as { id: string; transform: { x: number; y: number } }[]
    ).find((n) => n.id === cloned.rootId)
    if (rootNode) {
      rootNode.transform.x += DUPLICATE_OFFSET.x
      rootNode.transform.y += DUPLICATE_OFFSET.y
    }
    const result = dispatch(
      new ImportReusableObjectCommand({
        objectJson: cloned as unknown as ReusableObjectJSON,
        targetParentId,
      }),
    )
    if (result.ok) {
      created.push(result.inverse.createdNodeIds[0] as string)
    }
  }
  if (created.length > 0) {
    useSelectionStore.getState().selectMany(created)
  }
}

// Synchronous wrapper for callers that expect void and not await (MenuBar legacy)
// Not exported, pasteClipboard is async but callers can void it

export function duplicateSelection(engine: EnginePublic, dispatch: DispatchCommand): void {
  const selectedIds = useSelectionStore.getState().selectedIds
  if (selectedIds.length === 0) {
    return
  }
  const selectedSet = new Set(selectedIds)
  const topLevelIds: string[] = []
  for (const nodeId of selectedIds) {
    if (isDescendantOfSelected(nodeId, selectedSet, engine)) {
      continue
    }
    try {
      const node = engine.getNode(nodeId)
      if (!node.parent) continue
      if (node.components.camera) continue
      topLevelIds.push(nodeId)
    } catch {
      continue
    }
  }
  if (topLevelIds.length === 0) return
  const created: string[] = []
  for (const nodeId of topLevelIds) {
    const result = dispatch(new DuplicateNodeCommand({ nodeId }))
    if (result.ok) {
      created.push(result.inverse.nodeId)
    }
  }
  if (created.length > 0) {
    useSelectionStore.getState().selectMany(created)
  }
}

export function deleteSelection(engine: EnginePublic, dispatch: DispatchCommand): void {
  const selectedIds = useSelectionStore.getState().selectedIds
  if (selectedIds.length === 0) {
    return
  }
  const live = liveNodeIds(engine)
  for (const nodeId of selectedIds) {
    if (!live.has(nodeId)) {
      continue
    }
    dispatch(new DeleteNodeCommand({ nodeId }))
  }
  useSelectionStore.getState().prune(liveNodeIds(engine))
}

interface LiveNodeEntry {
  readonly slide: Slide
  readonly node: SceneNode
}

function liveNodes(engine: EnginePublic): LiveNodeEntry[] {
  const entries: LiveNodeEntry[] = []
  for (const slide of engine.project?.slides ?? []) {
    for (const node of walkPreOrder(slide.scene.root)) {
      entries.push({ slide, node })
    }
  }
  return entries
}

function liveNodeIds(engine: EnginePublic): Set<string> {
  const ids = new Set<string>()
  for (const { node } of liveNodes(engine)) {
    ids.add(node.id)
  }
  for (const slide of engine.project?.slides ?? []) {
    ids.add(slide.scene.camera.id)
  }
  return ids
}

function isDescendantOfSelected(
  nodeId: string,
  selectedSet: Set<string>,
  engine: EnginePublic,
): boolean {
  try {
    let cursor: SceneNode | null = engine.getNode(nodeId).parent
    while (cursor) {
      if (selectedSet.has(cursor.id)) return true
      cursor = cursor.parent
    }
  } catch {
    return false
  }
  return false
}
