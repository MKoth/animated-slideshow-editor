import { useEffect, useState } from 'react'
import { applyHierarchyMove } from '../../app/hierarchyMoveActions'
export const SCENE_NODE_IDS_MIME = 'application/x.scene-node-ids'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { applyZOrder, canApplyZOrder, Z_ORDER_ITEMS } from '../../app/zOrderActions'
import type { SceneNode } from '../../engine'
import type { ZOrderMode } from '../../engine/commands'
import { useSelectionStore } from '../../stores/selectionStore'

interface ContextMenuState {
  x: number
  y: number
}

type IconKind = 'folder' | 'image' | 'text'

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    </svg>
  )
}

function TextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 5h14v3h-6v11h-2V8H5z" />
    </svg>
  )
}

function VisibilityIcon({ visible }: { visible: boolean }) {
  if (!visible) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  )
}

function iconOf(node: SceneNode): IconKind {
  if (node.components.assetInstance) {
    return 'image'
  }
  if (node.components.text) {
    return 'text'
  }
  return 'folder'
}

function NodeIcon({ node }: { node: SceneNode }) {
  switch (iconOf(node)) {
    case 'image':
      return <ImageIcon />
    case 'text':
      return <TextIcon />
    default:
      return <FolderIcon />
  }
}

function visibleChildren(node: SceneNode): SceneNode[] {
  return node.children.filter((child) => !child.components.camera)
}

interface SceneTreeRowProps {
  node: SceneNode
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
        className={`scene-tree__row${selected ? ' scene-tree__row--selected' : ''}${affordanceClass}`}
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
        </span>
      </button>
      {children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <SceneTreeRow
              key={child.id}
              node={child}
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

  if (!project) {
    return (
      <div className="panel-empty-state">
        <p>No project. Create one to get started.</p>
      </div>
    )
  }

  if (project.slides.length === 0) {
    return (
      <div className="panel-empty-state">
        <p>No slides created.</p>
      </div>
    )
  }

  return (
    <div className="scene-panel">
      {project.slides.map((slide) => (
        <section className="scene-slide" key={slide.id}>
          <h3 className="scene-slide__title">{slide.name}</h3>
          <ul className="scene-tree" role="tree" aria-label={`Scene tree of ${slide.name}`}>
            <SceneTreeRow
              node={slide.scene.root}
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
      ))}
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
