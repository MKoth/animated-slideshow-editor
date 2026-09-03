import type { EnginePublic } from '../engine'
import type { SceneNode } from '../engine'
import type { Slide } from '../engine'
import type { DispatchCommand } from '../engine/commands'
import {
  CreateAssetInstanceCommand,
  DeleteNodeCommand,
  DUPLICATE_OFFSET,
  DuplicateNodeCommand,
} from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import { useClipboardStore } from '../stores/clipboardStore'
import type { ClipboardItem } from '../stores/clipboardStore'
import { useSelectionStore } from '../stores/selectionStore'

export function copySelection(engine: EnginePublic): void {
  const selectedIds = useSelectionStore.getState().selectedIds
  if (selectedIds.length === 0) {
    return
  }
  const byId = new Map<string, ClipboardItem>()
  for (const { slide, node } of liveNodes(engine)) {
    const component = node.components.assetInstance
    if (!component) {
      continue
    }
    byId.set(node.id, {
      definitionId: component.assetDefinitionId,
      sceneId: slide.scene.id,
      parentId: node.parent?.id ?? slide.scene.root.id,
      name: node.name,
      transform: { ...node.transform },
      ...(node.semanticName !== undefined ? { semanticName: node.semanticName } : {}),
    })
  }
  const items: ClipboardItem[] = []
  for (const nodeId of selectedIds) {
    const item = byId.get(nodeId)
    if (item) {
      items.push(item)
    }
  }
  if (items.length === 0) {
    return
  }
  useClipboardStore.getState().copy(items)
}

export function pasteClipboard(dispatch: DispatchCommand): void {
  const items = useClipboardStore.getState().items
  if (items.length === 0) {
    return
  }
  const created: string[] = []
  for (const item of items) {
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

export function duplicateSelection(engine: EnginePublic, dispatch: DispatchCommand): void {
  const selectedIds = useSelectionStore.getState().selectedIds
  if (selectedIds.length === 0) {
    return
  }
  const instances = new Set<string>()
  for (const { node } of liveNodes(engine)) {
    if (node.components.assetInstance) {
      instances.add(node.id)
    }
  }
  const created: string[] = []
  for (const nodeId of selectedIds) {
    if (!instances.has(nodeId)) {
      continue
    }
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
