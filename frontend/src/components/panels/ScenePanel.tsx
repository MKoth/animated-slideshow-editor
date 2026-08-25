import { useEffect, useState } from 'react'
import { applyHierarchyMove } from '../../app/hierarchyMoveActions'
export const SCENE_NODE_IDS_MIME = 'application/x.scene-node-ids'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { applyZOrder, canApplyZOrder, Z_ORDER_ITEMS } from '../../app/zOrderActions'
import type { SceneNode } from '../../engine'
import type { ZOrderMode } from '../../engine/commands'
import { useMissingAssetsStore } from '../../stores/missingAssetsStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { iconOf } from './nodeIconKinds'
import { LockIcon, MissingAssetIcon, NodeIcon, VisibilityIcon } from './nodeIcons'

interface ContextMenuState {
  x: number
  y: number
}

function visibleChildren(node: SceneNode): SceneNode[] {
  return node.children.filter((child) => !child.components.camera && !child.components.ghost)
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
  const selected = useSelectionStore((state) => state.selectedIds.includes(node.id))
  const children = visibleChildren(node)
  const missing = missingNodeIds.has(node.id)
  let affordanceClass = ''
  if (dropOver?.targetId === node.id) {
    affordanceClass = ` scene-tree__row--drop-${dropOver.zone}`
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
        <span className="scene-tree__indicators">
          <span className="scene-tree__indicator" title={node.visible ? 'Visible' : 'Hidden'}>
            <VisibilityIcon visible={node.visible} />
          </span>
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
    applyHierarchyMove(engine, dispatch, { targets, parentId, index })
    handleDragEnd()
  }

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
          aria-label="Z-order"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
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
    </div>
  )
}
