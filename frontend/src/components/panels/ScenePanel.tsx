import { useCallback, useEffect, useState } from 'react'
import { applyHierarchyMove } from '../../app/hierarchyMoveActions'
export const SCENE_NODE_IDS_MIME = 'application/x.scene-node-ids'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { applyZOrder, canApplyZOrder, Z_ORDER_ITEMS } from '../../app/zOrderActions'
import type { SceneNode } from '../../engine'
import type { ZOrderMode } from '../../engine/commands'
import type { ParentingMode } from '../../engine/commands/reparentNodeCommand'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateRigHandleCommand,
  SetKeyframeValueCommand,
  SetVisibilityCommand,
} from '../../engine/commands'
import { defaultChartComponent } from '../../engine/defaultChart'
import { defaultTableComponent } from '../../engine/defaultTable'
import { defaultTextComponent } from '../../engine/defaultText'
import { createCircleComponent } from '../../engine/circleComponent'
import { namesInTree, uniqueNodeName } from '../../engine/naming'
import { useMissingAssetsStore } from '../../stores/missingAssetsStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useUiStore } from '../../stores/uiStore'
import { iconOf } from './nodeIconKinds'
import { LockIcon, MissingAssetIcon, NodeIcon, VisibilityIcon } from './nodeIcons'
import { ParentingModeDialog } from './ParentingModeDialog'

interface ContextMenuState {
  x: number
  y: number
}

function visibleChildren(node: SceneNode): SceneNode[] {
  return node.children.filter((child) => !child.components.camera)
}

interface SceneTreeRowProps {
  node: SceneNode
  missingNodeIds: ReadonlySet<string>
  onContextMenu: (event: React.MouseEvent, node: SceneNode) => void
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => void
  onDragOver: (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => void
  onDragLeave: (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => void
  onDrop: (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => void
  onDragEnd: () => void
  dropOver: { targetId: string; zone: 'before' | 'into' | 'after' } | null
}

function SceneTreeRow({
  node,
  missingNodeIds,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  dropOver,
}: SceneTreeRowProps) {
  const { engine, dispatch } = useEngine()
  const selected = useSelectionStore((state) => state.selectedIds.includes(node.id))
  const animationMode = useUiStore((state) => state.animationMode)
  const children = visibleChildren(node)
  const missing = missingNodeIds.has(node.id)
  let affordanceClass = ''
  if (dropOver?.targetId === node.id) {
    affordanceClass = ` scene-tree__row--drop-${dropOver.zone}`
  }

  const handleEyeClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const activeSlide = engine.getActiveSlide()
    if (!activeSlide) {
      return
    }
    if (animationMode) {
      const time = usePlaybackController.getState().getTime(activeSlide.id)
      const evaluatedVisible = (() => {
        try {
          return engine.evaluateVisible(node.id, time)
        } catch {
          return node.visible
        }
      })()
      const visibleKeyframes = engine.getVisibleKeyframes(node.id)
      const existing = visibleKeyframes.find((kf) => kf.time === time)
      if (existing) {
        dispatch(
          new SetKeyframeValueCommand({
            target: { kind: 'visible', nodeId: node.id },
            keyframeId: existing.id,
            newValue: !evaluatedVisible,
          }),
        )
      } else {
        dispatch(
          new AddKeyframeCommand({
            target: { kind: 'visible', nodeId: node.id },
            time,
            value: !evaluatedVisible,
          }),
        )
      }
    } else {
      dispatch(new SetVisibilityCommand({ nodeId: node.id, visible: !node.visible }))
    }
  }
  return (
    <li>
      <button
        role="treeitem"
        aria-selected={selected}
        draggable={node.parent !== null || undefined}
        className={`scene-tree__row${selected ? ' scene-tree__row--selected' : ''}${missing ? ' scene-tree__row--missing' : ''}${affordanceClass}`}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey) {
            useSelectionStore.getState().toggle(node.id)
          } else if (event.shiftKey) {
            useSelectionStore.getState().extend(node.id)
          } else {
            useSelectionStore.getState().select(node.id)
          }
        }}
        onContextMenu={(event) => onContextMenu(event, node)}
        onDragStart={(event) => onDragStart(event, node.id)}
        onDragOver={(event) => onDragOver(event, node.id)}
        onDragLeave={(event) => onDragLeave(event, node.id)}
        onDrop={(event) => onDrop(event, node.id)}
        onDragEnd={onDragEnd}
      >
        <span className="scene-tree__icon" data-icon={iconOf(node)}>
          <NodeIcon node={node} />
        </span>
        <span className="scene-tree__name">{node.name}</span>
        {node.semanticName && (
          <span className="scene-tree__semantic" title={`Semantic: ${node.semanticName}`}>
            {node.semanticName}
          </span>
        )}
        <span className="scene-tree__indicators">
          <button
            className="scene-tree__indicator scene-tree__indicator--eye"
            title={node.visible ? 'Visible' : 'Hidden'}
            aria-label={node.visible ? 'Hide node' : 'Show node'}
            onClick={handleEyeClick}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <VisibilityIcon visible={node.visible} />
          </button>
          <span className="scene-tree__indicator" title="Locked">
            <LockIcon />
          </span>
          {missing && (
            <span
              className="scene-tree__indicator scene-tree__indicator--missing"
              title="Missing asset"
            >
              <MissingAssetIcon />
            </span>
          )}
        </span>
      </button>
      {children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <SceneTreeRow
              key={child.id}
              node={child}
              missingNodeIds={missingNodeIds}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              dropOver={dropOver}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ScenePanel() {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dragIds, setDragIds] = useState<string[] | null>(null)
  const [dropOver, setDropOver] = useState<{
    targetId: string
    zone: 'before' | 'into' | 'after'
  } | null>(null)
  const [pendingMove, setPendingMove] = useState<{
    targets: readonly string[]
    parentId: string
    index: number
  } | null>(null)
  const missingNodeIds = useMissingAssetsStore((state) => state.report?.affectedNodeIds)
  useEngineEvent(() => setTick((tick) => tick + 1))

  // Close context menu on click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  // Cancel drag on Escape
  useEffect(() => {
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDragIds(null)
        setDropOver(null)
      }
    }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  const handleDragStart = (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => {
    const selectedIds = useSelectionStore.getState().selectedIds
    let ids: string[]
    if (!selectedIds.includes(nodeId)) {
      useSelectionStore.getState().select(nodeId)
      ids = [nodeId]
    } else {
      ids = [...selectedIds]
    }
    setDragIds(ids)
    const dt = event.dataTransfer
    dt.setData(SCENE_NODE_IDS_MIME, JSON.stringify(ids))
    dt.effectAllowed = 'move'
  }

  const handleDragOver = (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => {
    event.preventDefault()
    if (!dragIds) return
    const draggedSet = new Set(dragIds)
    // ignore if target is dragged node or its descendant
    const isDescendant = (targetId: string) => {
      let cur = engine.getNode(targetId)
      while (cur.parent) {
        if (draggedSet.has(cur.parent.id)) return true
        cur = cur.parent
      }
      return false
    }
    if (draggedSet.has(nodeId) || isDescendant(nodeId)) {
      setDropOver(null)
      return
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    const h = rect.height
    let zone: 'before' | 'into' | 'after' = 'into'
    if (offsetY < h * 0.33) zone = 'before'
    else if (offsetY > h * 0.66) zone = 'after'
    setDropOver({ targetId: nodeId, zone })
  }

  const handleDragLeave = (_event: React.DragEvent<HTMLButtonElement>, nodeId: string) => {
    if (dropOver?.targetId === nodeId) {
      setDropOver(null)
    }
  }

  const handleDragEnd = () => {
    setDragIds(null)
    setDropOver(null)
  }

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>, nodeId: string) => {
    event.preventDefault()
    if (!dragIds) return
    const draggedSet = new Set(dragIds)
    const isDescendant = (targetId: string) => {
      let cur = engine.getNode(targetId)
      while (cur.parent) {
        if (draggedSet.has(cur.parent.id)) return true
        cur = cur.parent
      }
      return false
    }
    if (draggedSet.has(nodeId) || isDescendant(nodeId)) {
      handleDragEnd()
      return
    }
    const zone = dropOver?.zone ?? 'into'
    const targetNode = engine.getNode(nodeId)
    const targets = dragIds
    let parentId: string
    let index: number
    if (zone === 'into') {
      parentId = nodeId
      const nonDragged = targetNode.children.filter((child) => !draggedSet.has(child.id))
      index = nonDragged.length
    } else {
      const parent = targetNode.parent
      if (!parent) {
        handleDragEnd()
        return
      }
      parentId = parent.id
      const nonDragged = parent.children.filter((child) => !draggedSet.has(child.id))
      const targetPos = nonDragged.indexOf(targetNode)
      const liveIndex = parent.children.indexOf(targetNode)
      const predecessor = liveIndex > 0 ? parent.children[liveIndex - 1] : undefined
      const adjacentToDragged = predecessor !== undefined && draggedSet.has(predecessor.id)
      index = zone === 'after' || adjacentToDragged ? targetPos + 1 : targetPos
    }
    // Determine if this drop involves a true reparent (cross-parent) vs pure reorder
    const isReparent = targets.some((id) => {
      try {
        const node = engine.getNode(id)
        return node.parent?.id !== parentId
      } catch {
        return false
      }
    })
    if (isReparent) {
      setPendingMove({ targets, parentId, index })
      // keep drag state until dialog resolves; clear visual hover
      setDragIds(null)
      setDropOver(null)
      return
    }
    applyHierarchyMove(engine, dispatch, { targets, parentId, index })
    handleDragEnd()
  }

  const handleParentingConfirm = useCallback(
    (mode: ParentingMode) => {
      if (!pendingMove) return
      applyHierarchyMove(engine, dispatch, pendingMove, mode)
      setPendingMove(null)
    },
    [engine, dispatch, pendingMove],
  )

  const handleParentingCancel = useCallback(() => {
    setPendingMove(null)
  }, [])

  const handleRowContextMenu = (event: React.MouseEvent, node: SceneNode) => {
    event.preventDefault()
    const { selectedIds } = useSelectionStore.getState()
    if (!selectedIds.includes(node.id)) {
      useSelectionStore.getState().select(node.id)
    }
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  const handleContextMenuAction = (mode: ZOrderMode) => {
    applyZOrder(engine, dispatch, mode)
    setContextMenu(null)
  }

  const handleCreateTable = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Table')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { table: defaultTableComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
    setContextMenu(null)
  }

  const handleCreateChart = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Chart')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { chart: defaultChartComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
    setContextMenu(null)
  }

  const handleCreateText = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Text')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { text: defaultTextComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
    setContextMenu(null)
  }

  const handleCreateCircle = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    const name = uniqueNodeName(taken, 'Circle')
    const result = dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name,
        components: { circle: createCircleComponent() },
      }),
    )
    if (result.ok) {
      useSelectionStore.getState().select(result.inverse.nodeId)
    }
    setContextMenu(null)
  }

  const handleCreateGroup = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) return
    const taken = namesInTree(targetSlide.scene.root)
    // Rig Handle / Group Node is an empty Scene Node (only Transform)
    const name = uniqueNodeName(taken, 'Rig Handle')
    const selectedIds = useSelectionStore.getState().selectedIds
    // Filter out root, camera, and ids that don't exist in this scene
    const sceneNodeIds = new Set<string>()
    const walk = (node: SceneNode) => {
      sceneNodeIds.add(node.id)
      for (const child of node.children) walk(child)
    }
    walk(targetSlide.scene.root)
    const childIds = selectedIds.filter(
      (id) =>
        sceneNodeIds.has(id) &&
        id !== targetSlide.scene.root.id &&
        id !== targetSlide.scene.camera.id,
    )
    if (childIds.length > 0) {
      const result = dispatch(
        new CreateRigHandleCommand({
          sceneId: targetSlide.scene.id,
          name,
          childIds,
        }),
      )
      if (result.ok) {
        useSelectionStore.getState().select(result.inverse.handleId)
      }
    } else {
      const result = dispatch(
        new CreateRigHandleCommand({
          sceneId: targetSlide.scene.id,
          name,
        }),
      )
      if (result.ok) {
        useSelectionStore.getState().select(result.inverse.handleId)
      }
    }
    setContextMenu(null)
  }

  const project = engine.project
  const slide = engine.getActiveSlide()

  if (!project) {
    return (
      <div className="panel-empty-state">
        <p>No project. Create one to get started.</p>
      </div>
    )
  }

  if (!slide) {
    return (
      <div className="panel-empty-state">
        <p>No slides created.</p>
      </div>
    )
  }

  return (
    <div className="scene-panel">
      <div className="scene-panel__toolbar" style={{ display: 'flex', gap: '8px', padding: '8px' }}>
        <button
          className="scene-panel__create-group"
          onClick={handleCreateGroup}
          title="Create empty Group/Locator (Rig Handle) — groups selected nodes with Keep World"
          aria-label="Create Rig Handle Group"
        >
          Create Group
        </button>
        <button
          className="scene-panel__create-group"
          onClick={handleCreateCircle}
          title="Create procedural Circle (wedge with animatable slice)"
          aria-label="Create Circle"
        >
          Create Circle
        </button>
      </div>
      <section className="scene-slide" key={slide.id}>
        <h3 className="scene-slide__title">{slide.name}</h3>
        <ul className="scene-tree" role="tree" aria-label={`Scene tree of ${slide.name}`}>
          <SceneTreeRow
            node={slide.scene.root}
            missingNodeIds={new Set(missingNodeIds ?? [])}
            onContextMenu={handleRowContextMenu}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            dropOver={dropOver}
          />
        </ul>
      </section>
      {contextMenu && (
        <div
          className="context-menu"
          role="menu"
          aria-label="Context menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="menu__item" role="menuitem" onClick={handleCreateTable}>
            Create Table
          </button>
          <button className="menu__item" role="menuitem" onClick={handleCreateChart}>
            Create Chart
          </button>
          <button className="menu__item" role="menuitem" onClick={handleCreateText}>
            Create Text
          </button>
          <button className="menu__item" role="menuitem" onClick={handleCreateCircle}>
            Create Circle
          </button>
          <button className="menu__item" role="menuitem" onClick={handleCreateGroup}>
            Create Group (Rig Handle)
          </button>
          <hr className="menu__separator" />
          {Z_ORDER_ITEMS.map((item) => (
            <button
              key={item.label}
              className="menu__item"
              role="menuitem"
              disabled={!canApplyZOrder(engine, item.mode)}
              onClick={() => handleContextMenuAction(item.mode)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <ParentingModeDialog
        open={pendingMove !== null}
        initialMode="keepWorld"
        onConfirm={handleParentingConfirm}
        onCancel={handleParentingCancel}
      />
    </div>
  )
}
