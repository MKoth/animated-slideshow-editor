import { useEffect, useMemo, useState } from 'react'
import type { EnginePublic, SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  CopyShapeToMeshCommand,
  CreateBakedShapeCommand,
  CreateShapeCommand,
  CreateShapeCategoryCommand,
  DeleteShapeCommand,
  DeleteShapeCategoryCommand,
  DuplicateShapeCommand,
  MoveShapeToCategoryCommand,
  RenameShapeCommand,
  RenameShapeCategoryCommand,
  ReorderShapeCommand,
  ReorderShapeCategoryCommand,
} from '../../engine/commands'
import { useEngineEvent } from '../../app/useEngine'
import { playheadTimeOf } from '../../app/keyframeActions'
import { useShapePreviewStore } from '../../stores/shapePreviewStore'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useShapeCategoryViewStore } from '../../stores/shapeCategoryViewStore'
import { NameField } from './inspectorFields'

interface MeshInspectorSectionProps {
  target: SceneNode
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}

type DragOverState = { id: string; zone: 'before' | 'into' | 'after'; kind: 'cat' | 'shape' } | null

export function MeshInspectorSection({
  target,
  engine,
  dispatch,
  notify,
  playing,
}: MeshInspectorSectionProps) {
  const [tick, setTick] = useState(0)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameCatId, setRenameCatId] = useState<string | null>(null)
  const [renameCatError, setRenameCatError] = useState<string | null>(null)
  const [copyShapeId, setCopyShapeId] = useState<string | null>(null)
  const [copyTargetId, setCopyTargetId] = useState<string>('')
  const [copyMirrored, setCopyMirrored] = useState(false)
  const [copyAxis, setCopyAxis] = useState<'x' | 'y'>('x')
  const [moveShapeId, setMoveShapeId] = useState<string | null>(null)
  const [dragCatId, setDragCatId] = useState<string | null>(null)
  const [dragShapeId, setDragShapeId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<DragOverState>(null)
  const previewShapeId = useShapePreviewStore((s) => s.previewShapeId)
  const previewNodeId = useShapePreviewStore((s) => s.previewNodeId)
  const collapsedMap = useShapeCategoryViewStore((s) => s.collapsedIds)
  const toggleCat = useShapeCategoryViewStore((s) => s.toggleCollapsed)

  useEngineEvent(() => setTick((t) => t + 1))

  const shapes = useMemo(
    () => (target.components.mesh?.shapes ?? []) as readonly import('../../engine/shape').Shape[],
    [target.components.mesh?.shapes],
  )
  const categories = useMemo(
    () =>
      (target.components.mesh?.shapeCategories ??
        []) as readonly import('../../engine/shapeCategory').ShapeCategory[],
    [target.components.mesh?.shapeCategories],
  )
  const shapeIdsKey = shapes.map((s) => s.id).join(',')
  const catIdsKey = categories.map((c) => c.id).join(',')

  useEffect(() => {
    return () => {
      const state = useShapePreviewStore.getState()
      if (state.previewNodeId === target.id) state.clearPreview()
    }
  }, [target.id])

  useEffect(() => {
    if (previewNodeId === target.id && previewShapeId) {
      const exists = shapes.some((s) => s.id === previewShapeId)
      if (!exists) useShapePreviewStore.getState().clearPreview()
    }
  }, [shapeIdsKey, previewNodeId, previewShapeId, target.id, shapes])

  useEffect(() => {
    const valid = new Set(categories.map((c) => `${target.id}:${c.id}`))
    useShapeCategoryViewStore.getState().prune(valid)
  }, [catIdsKey, target.id, categories])

  const copyCandidates = useMemo(() => {
    void tick
    const vertexCount = target.components.mesh?.mesh.vertices.length
    if (!vertexCount || !engine.project) return []
    const out: { id: string; name: string }[] = []
    for (const slide of engine.project.slides) {
      const stack: SceneNode[] = [slide.scene.root]
      while (stack.length > 0) {
        const node = stack.pop()!
        if (node.id !== target.id && node.components.mesh) {
          if (node.components.mesh.mesh.vertices.length === vertexCount) {
            out.push({ id: node.id, name: node.name })
          }
        }
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
      }
    }
    return out
  }, [engine.project, target.id, target.components.mesh?.mesh.vertices.length, tick])

  const isFrozen = shapes.length > 0
  const isPreviewSelected = (shapeId: string) =>
    previewNodeId === target.id && previewShapeId === shapeId

  const handleCreateCategory = (parentId: string | null) => {
    const base = 'Category'
    const result = dispatch(
      new CreateShapeCategoryCommand({ nodeId: target.id, name: base, parentId }),
    )
    if (!result.ok) {
      const existing = categories.filter((c) => c.parentId === parentId).map((c) => c.name)
      let name = base
      let i = 2
      const set = new Set(existing)
      while (set.has(name)) {
        name = `${base} ${i}`
        i++
      }
      const r2 = dispatch(new CreateShapeCategoryCommand({ nodeId: target.id, name, parentId }))
      if (!r2.ok) notify(r2.error.message)
    }
  }

  const handleCreateShape = (categoryId: string | null) => {
    const existingInCat = shapes.filter((s) => (s.categoryId ?? null) === categoryId)
    const base = 'Shape'
    let name = base
    let i = 2
    const set = new Set(existingInCat.map((s) => s.name))
    while (set.has(name)) {
      name = `${base} ${i}`
      i++
    }
    const result = dispatch(new CreateShapeCommand({ nodeId: target.id, name, categoryId }))
    if (!result.ok) notify(result.error.message)
    else {
      const shapeId = (result.inverse as { shapeId?: string })?.shapeId
      if (shapeId) useMeshEditStore.getState().setActiveShapeId(shapeId)
    }
  }

  const handleBakePose = () => {
    const existingInCat = shapes.filter((s) => (s.categoryId ?? null) === null)
    const base = 'Baked Pose'
    let name = base
    let i = 2
    const set = new Set(existingInCat.map((s) => s.name))
    while (set.has(name)) {
      name = `${base} ${i}`
      i++
    }
    const time = playheadTimeOf(engine, target.id) ?? 0
    const result = dispatch(
      new CreateBakedShapeCommand({ nodeId: target.id, name, categoryId: null, time }),
    )
    if (!result.ok) notify(result.error.message)
    else {
      const shapeId = (result.inverse as { shapeId?: string })?.shapeId
      if (shapeId) useMeshEditStore.getState().setActiveShapeId(shapeId)
      // feedback includes baked time for morph/bone evaluation context
      notify(`Baked pose as "${name}" at ${time.toFixed(2)}s`)
    }
  }

  const handleDuplicate = (shapeId: string) => {
    const result = dispatch(new DuplicateShapeCommand({ nodeId: target.id, shapeId }))
    if (!result.ok) notify(result.error.message)
    else {
      const newId = (result.inverse as { shapeId?: string })?.shapeId
      if (newId) useMeshEditStore.getState().setActiveShapeId(newId)
    }
  }
  const handleDelete = (shapeId: string) => {
    const result = dispatch(new DeleteShapeCommand({ nodeId: target.id, shapeId }))
    if (!result.ok) notify(result.error.message)
    else {
      if (previewShapeId === shapeId && previewNodeId === target.id)
        useShapePreviewStore.getState().clearPreview()
      if (useMeshEditStore.getState().activeShapeId === shapeId)
        useMeshEditStore.getState().setActiveShapeId(null)
    }
  }
  const handleRenameCommit = (shapeId: string, raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setRenameError('Shape name must be a non-empty string')
      return
    }
    const shape = shapes.find((s) => s.id === shapeId)!
    if (
      shapes.some(
        (s) =>
          s.id !== shapeId &&
          (s.categoryId ?? null) === (shape.categoryId ?? null) &&
          s.name === trimmed,
      )
    ) {
      setRenameError(`A shape with name "${trimmed}" already exists in this category`)
      return
    }
    const result = dispatch(
      new RenameShapeCommand({ nodeId: target.id, shapeId, newName: trimmed }),
    )
    if (!result.ok) {
      const msg = result.error.message
      if (msg.toLowerCase().includes('already exists')) setRenameError(msg)
      else {
        notify(msg)
        setRenameError(null)
      }
      return
    }
    setRenameError(null)
    setRenameId(null)
  }
  const handlePreviewToggle = (shapeId: string) => {
    const store = useShapePreviewStore.getState()
    if (store.previewNodeId === target.id && store.previewShapeId === shapeId) store.clearPreview()
    else {
      store.setPreview(target.id, shapeId)
      useMeshEditStore.getState().setActiveShapeId(shapeId)
    }
  }
  const handleCopyTo = (shapeId: string) => {
    if (copyCandidates.length === 0) {
      notify('No compatible meshes with same topology found.')
      return
    }
    setCopyShapeId(shapeId)
    setCopyTargetId(copyCandidates[0]!.id)
    setCopyMirrored(false)
    setCopyAxis('x')
  }
  const handleCopyConfirm = () => {
    if (!copyShapeId || !copyTargetId) return
    const result = dispatch(
      new CopyShapeToMeshCommand({
        sourceNodeId: target.id,
        sourceShapeId: copyShapeId,
        targetNodeId: copyTargetId,
        mirrored: copyMirrored,
        axis: copyAxis,
      }),
    )
    if (!result.ok) notify(result.error.message)
    else {
      notify(
        `Copied shape to ${copyCandidates.find((c) => c.id === copyTargetId)?.name ?? 'target'}${copyMirrored ? ` (mirrored ${copyAxis})` : ''}`,
      )
      setCopyShapeId(null)
    }
  }
  const handleRenameCategoryCommit = (catId: string, raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setRenameCatError('Category name must be a non-empty string')
      return
    }
    const cat = categories.find((c) => c.id === catId)!
    if (
      categories.some((c) => c.id !== catId && c.parentId === cat.parentId && c.name === trimmed)
    ) {
      setRenameCatError(`A category with name "${trimmed}" already exists in this folder`)
      return
    }
    const result = dispatch(
      new RenameShapeCategoryCommand({ nodeId: target.id, categoryId: catId, newName: trimmed }),
    )
    if (!result.ok) {
      const msg = result.error.message
      if (msg.toLowerCase().includes('already exists')) setRenameCatError(msg)
      else {
        notify(msg)
        setRenameCatError(null)
      }
      return
    }
    setRenameCatError(null)
    setRenameCatId(null)
  }
  const handleDeleteCategory = (catId: string) => {
    const result = dispatch(
      new DeleteShapeCategoryCommand({ nodeId: target.id, categoryId: catId }),
    )
    if (!result.ok) notify(result.error.message)
  }
  const handleMoveShape = (shapeId: string, targetCatId: string | null) => {
    const shape = shapes.find((s) => s.id === shapeId)!
    if ((shape.categoryId ?? null) === targetCatId) {
      setMoveShapeId(null)
      return
    }
    const result = dispatch(
      new MoveShapeToCategoryCommand({ nodeId: target.id, shapeId, targetCategoryId: targetCatId }),
    )
    if (!result.ok) notify(result.error.message)
    else setMoveShapeId(null)
  }
  const handleReorderShape = (shapeId: string, dir: -1 | 1) => {
    const shape = shapes.find((s) => s.id === shapeId)!
    const catId = shape.categoryId ?? null
    const siblings = shapes.filter((s) => (s.categoryId ?? null) === catId)
    const idx = siblings.findIndex((s) => s.id === shapeId)
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= siblings.length) return
    const result = dispatch(
      new ReorderShapeCommand({
        nodeId: target.id,
        shapeId,
        targetCategoryId: catId,
        newIndex: newIdx,
      }),
    )
    if (!result.ok) notify(result.error.message)
  }
  const handleReorderCategory = (catId: string, dir: -1 | 1) => {
    const cat = categories.find((c) => c.id === catId)!
    const siblings = categories.filter((c) => c.parentId === cat.parentId)
    const idx = siblings.findIndex((c) => c.id === catId)
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= siblings.length) return
    const result = dispatch(
      new ReorderShapeCategoryCommand({
        nodeId: target.id,
        categoryId: catId,
        newParentId: cat.parentId,
        newIndex: newIdx,
      }),
    )
    if (!result.ok) notify(result.error.message)
  }

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, import('../../engine/shapeCategory').ShapeCategory[]>()
    for (const c of categories) {
      const key = c.parentId ?? null
      const list = map.get(key)
      if (!list) map.set(key, [c])
      else list.push(c)
    }
    return map
  }, [categories])

  const shapesByCategory = useMemo(() => {
    const map = new Map<string | null, typeof shapes>()
    for (const s of shapes) {
      const key = s.categoryId ?? null
      const arr = map.get(key)
      if (!arr) map.set(key, [s] as unknown as typeof shapes)
      else (arr as unknown as import('../../engine/shape').Shape[]).push(s)
    }
    return map
  }, [shapes])

  const isDragging = !!dragCatId || !!dragShapeId

  const computeZone = (e: React.DragEvent, mode: 'cat' | 'shape'): 'before' | 'into' | 'after' => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    const h = rect.height
    if (mode === 'cat') {
      if (dragCatId) {
        if (offsetY < h * 0.25) return 'before'
        if (offsetY > h * 0.75) return 'after'
        return 'into'
      }
      // shape over cat → into
      return 'into'
    } else {
      // shape over shape
      if (offsetY < h * 0.5) return 'before'
      return 'after'
    }
  }

  const renderCategory = (catId: string, depth: number): React.ReactNode => {
    const cat = categories.find((c) => c.id === catId)!
    const isCollapsed = collapsedMap[`${target.id}:${catId}`] === true
    const hasChildrenCats = categories.some((c) => c.parentId === catId)
    const childCats = childrenByParent.get(catId) ?? []
    const catShapes = shapesByCategory.get(catId) ?? []
    const isBeingDragged = dragCatId === catId
    const over = dragOver?.id === catId && dragOver.kind === 'cat' ? dragOver.zone : null
    const showBefore = over === 'before'
    const showAfter = over === 'after'
    const showInto = over === 'into'
    return (
      <li
        key={catId}
        draggable={!playing}
        onDragStart={(e) => {
          e.stopPropagation()
          setDragCatId(catId)
          setDragShapeId(null)
          e.dataTransfer.setData('text/plain', catId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          setDragCatId(null)
          setDragOver(null)
        }}
        onDragOver={(e) => {
          if (!dragCatId && !dragShapeId) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const zone = computeZone(e, 'cat')
          // forbid dropping category into itself or descendant
          if (dragCatId) {
            if (dragCatId === catId) {
              setDragOver(null)
              return
            }
            // check descendant via categories
            const isDesc = (() => {
              const byId = new Map(categories.map((c) => [c.id, c] as const))
              let cur: string | null = catId
              while (cur) {
                if (cur === dragCatId) return true
                cur = byId.get(cur)?.parentId ?? null
              }
              return false
            })()
            if (isDesc) {
              setDragOver(null)
              return
            }
            // into only allowed if not already child? allow anyway
            setDragOver({ id: catId, zone, kind: 'cat' })
          } else if (dragShapeId) {
            e.stopPropagation()
            setDragOver({ id: catId, zone: 'into', kind: 'cat' })
          }
        }}
        onDragLeave={(e) => {
          // only clear if leaving this element (not child)
          const related = e.relatedTarget as HTMLElement | null
          if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
            if (dragOver?.id === catId) setDragOver(null)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          // recompute zone at drop time (state may be stale)
          const zoneAtDrop = computeZone(e, 'cat')
          setDragOver(null)
          if (dragCatId && dragCatId !== catId) {
            // forbid descendant
            const isDesc = (() => {
              const byId = new Map(categories.map((c) => [c.id, c] as const))
              let cur: string | null = catId
              while (cur) {
                if (cur === dragCatId) return true
                cur = byId.get(cur)?.parentId ?? null
              }
              return false
            })()
            if (isDesc) {
              notify('Cannot move category into its own descendant')
              setDragCatId(null)
              return
            }
            const zone = dragCatId ? zoneAtDrop : 'into'
            if (zone === 'into') {
              const sibCount = (childrenByParent.get(catId) ?? []).length
              const res = dispatch(
                new ReorderShapeCategoryCommand({
                  nodeId: target.id,
                  categoryId: dragCatId,
                  newParentId: catId,
                  newIndex: sibCount,
                }),
              )
              if (!res.ok) notify(res.error.message)
            } else {
              const newParentId = cat.parentId
              const siblings = categories.filter((c) => c.parentId === newParentId)
              let targetIdx = siblings.findIndex((c) => c.id === catId)
              const draggedIdx = siblings.findIndex((c) => c.id === dragCatId)
              if (draggedIdx !== -1 && draggedIdx < targetIdx) targetIdx -= 1
              const newIndex = zone === 'before' ? targetIdx : targetIdx + 1
              const res = dispatch(
                new ReorderShapeCategoryCommand({
                  nodeId: target.id,
                  categoryId: dragCatId,
                  newParentId,
                  newIndex,
                }),
              )
              if (!res.ok) notify(res.error.message)
            }
            setDragCatId(null)
          } else if (dragShapeId) {
            const targetCat = catId
            const sib = shapes.filter((s) => (s.categoryId ?? null) === targetCat)
            const res = dispatch(
              new ReorderShapeCommand({
                nodeId: target.id,
                shapeId: dragShapeId,
                targetCategoryId: targetCat,
                newIndex: sib.length,
              }),
            )
            if (!res.ok) notify(res.error.message)
            setDragShapeId(null)
          }
        }}
        style={{
          position: 'relative',
          border: `1px solid ${isBeingDragged ? '#1a73e8' : showInto ? '#1a73e8' : 'var(--color-border)'}`,
          borderRadius: 6,
          padding: 6,
          marginLeft: depth * 12,
          background: isBeingDragged
            ? 'color-mix(in srgb, #1a73e8 6%, var(--color-bg))'
            : showInto
              ? 'color-mix(in srgb, #1a73e8 12%, var(--color-bg))'
              : 'var(--color-bg)',
          opacity: isBeingDragged ? 0.6 : 1,
          boxShadow: showInto ? 'inset 0 0 0 2px #1a73e8' : undefined,
        }}
      >
        {showBefore && (
          <div
            style={{
              position: 'absolute',
              top: -4,
              left: 0,
              right: 0,
              height: 4,
              background: '#1a73e8',
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        {showAfter && (
          <div
            style={{
              position: 'absolute',
              bottom: -4,
              left: 0,
              right: 0,
              height: 4,
              background: '#1a73e8',
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          />
        )}
        {showInto && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              border: '2px dashed #1a73e8',
              borderRadius: 6,
              pointerEvents: 'none',
              opacity: 0.8,
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {hasChildrenCats || catShapes.length > 0 ? (
            <button
              aria-label={isCollapsed ? `Expand ${cat.name}` : `Collapse ${cat.name}`}
              aria-expanded={!isCollapsed}
              data-testid={`shape-category-chevron-${cat.id}`}
              onClick={() => toggleCat(target.id, catId)}
              style={{
                width: 18,
                height: 18,
                display: 'grid',
                placeItems: 'center',
                border: '1px solid var(--color-border)',
                borderRadius: 3,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              {isCollapsed ? '▶' : '▼'}
            </button>
          ) : (
            <span style={{ width: 18 }} />
          )}
          <span
            draggable={!playing}
            style={{ cursor: playing ? 'default' : 'grab', fontSize: 11, opacity: 0.6 }}
            title={
              dragCatId
                ? 'Dragging…'
                : 'Drag category — drop before/after to reorder, drop in middle to nest'
            }
          >
            ⋮⋮
          </span>
          <strong style={{ flex: '1 1 90px', fontSize: 12 }}>{cat.name}</strong>
          <span style={{ fontSize: 10, opacity: 0.6 }}>
            {catShapes.length} shapes {hasChildrenCats ? `· ${childCats.length} sub` : ''}
          </span>
          <button
            aria-label={`Create subcategory in ${cat.name}`}
            onClick={() => handleCreateCategory(catId)}
            disabled={playing}
            style={{ fontSize: 10, padding: '2px 4px' }}
          >
            + Sub
          </button>
          <button
            aria-label={`Create shape in ${cat.name}`}
            onClick={() => handleCreateShape(catId)}
            disabled={playing}
            style={{ fontSize: 10, padding: '2px 4px' }}
          >
            + Shape
          </button>
          <button
            aria-label={`Rename category ${cat.name}`}
            onClick={() => {
              setRenameCatId(catId)
              setRenameCatError(null)
            }}
            disabled={playing}
            style={{ fontSize: 10, padding: '2px 4px' }}
          >
            Rename
          </button>
          <button
            aria-label={`Delete category ${cat.name}`}
            onClick={() => handleDeleteCategory(catId)}
            disabled={playing}
            title={
              childCats.length > 0 || catShapes.length > 0
                ? 'Must be empty to delete — move or delete contents first'
                : 'Delete category'
            }
            style={{ fontSize: 10, padding: '2px 4px', color: 'var(--color-danger, #c00)' }}
          >
            Delete
          </button>
          <button
            aria-label={`Move category ${cat.name} up`}
            onClick={() => handleReorderCategory(catId, -1)}
            disabled={playing}
            style={{ fontSize: 10 }}
          >
            ↑
          </button>
          <button
            aria-label={`Move category ${cat.name} down`}
            onClick={() => handleReorderCategory(catId, 1)}
            disabled={playing}
            style={{ fontSize: 10 }}
          >
            ↓
          </button>
        </div>
        {showInto && !isCollapsed && (
          <div
            style={{
              fontSize: 10,
              color: '#1a73e8',
              marginTop: 4,
              textAlign: 'center',
              fontWeight: 600,
              pointerEvents: 'none',
            }}
          >
            Drop to nest inside “{cat.name}”
          </div>
        )}
        {showBefore && (
          <div
            style={{ fontSize: 9, color: '#1a73e8', textAlign: 'center', pointerEvents: 'none' }}
          >
            Drop before “{cat.name}”
          </div>
        )}
        {showAfter && (
          <div
            style={{ fontSize: 9, color: '#1a73e8', textAlign: 'center', pointerEvents: 'none' }}
          >
            Drop after “{cat.name}”
          </div>
        )}
        {renameCatId === catId && (
          <div style={{ marginTop: 6 }}>
            <NameField
              label={`Rename ${cat.name}`}
              value={cat.name}
              onCommit={(raw) => handleRenameCategoryCommit(catId, raw)}
              error={renameCatError}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={() => {
                  setRenameCatId(null)
                  setRenameCatError(null)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {!isCollapsed && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {catShapes.map((shape) => renderShapeRow(shape))}
            {childCats.map((child) => renderCategory(child.id, depth + 1))}
            {isDragging && dragShapeId && (
              <div
                style={{
                  border: '1px dashed #1a73e8',
                  borderRadius: 4,
                  padding: '6px',
                  fontSize: 11,
                  color: '#1a73e8',
                  textAlign: 'center',
                }}
              >
                Drop shape to move into “{cat.name}”
              </div>
            )}
          </div>
        )}
      </li>
    )
  }

  const renderShapeRow = (shape: import('../../engine/shape').Shape) => {
    const selected = isPreviewSelected(shape.id)
    const isRenaming = renameId === shape.id
    const isMove = moveShapeId === shape.id
    const isDrag = dragShapeId === shape.id
    const over = dragOver?.id === shape.id && dragOver.kind === 'shape' ? dragOver.zone : null
    const showBefore = over === 'before'
    const showAfter = over === 'after'
    return (
      <li
        key={shape.id}
        draggable={!playing}
        onDragStart={(e) => {
          e.stopPropagation()
          setDragShapeId(shape.id)
          setDragCatId(null)
          e.dataTransfer.setData('text/plain', shape.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          setDragShapeId(null)
          setDragOver(null)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          const zone = computeZone(e, 'shape')
          setDragOver({ id: shape.id, zone, kind: 'shape' })
        }}
        onDragLeave={(e) => {
          const related = e.relatedTarget as HTMLElement | null
          if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
            if (dragOver?.id === shape.id) setDragOver(null)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const zoneAtDrop = computeZone(e, 'shape')
          setDragOver(null)
          if (dragShapeId && dragShapeId !== shape.id) {
            const targetCat = shape.categoryId ?? null
            const siblings = shapes.filter((s) => (s.categoryId ?? null) === targetCat)
            let targetIdx = siblings.findIndex((s) => s.id === shape.id)
            const dragged = shapes.find((s) => s.id === dragShapeId)!
            const draggedInSameCat = (dragged.categoryId ?? null) === targetCat
            const draggedIdx = draggedInSameCat
              ? siblings.findIndex((s) => s.id === dragShapeId)
              : -1
            if (draggedIdx !== -1 && draggedIdx < targetIdx) targetIdx -= 1
            const newIndex = zoneAtDrop === 'before' ? targetIdx : targetIdx + 1
            const res = dispatch(
              new ReorderShapeCommand({
                nodeId: target.id,
                shapeId: dragShapeId,
                targetCategoryId: targetCat,
                newIndex,
              }),
            )
            if (!res.ok) notify(res.error.message)
            setDragShapeId(null)
          } else if (dragCatId) {
            // dropping category onto shape → treat as sibling of shape's category parent?
            const shapeCatId = shape.categoryId
            // move category to be sibling of shape's category (or root if shape uncategorized)
            // To move category to root when dropping on uncategorized shape, newParentId = null
            // To move into same folder as shape's category, newParentId = parent of shape's category
            let newParentId: string | null = null
            if (shapeCatId) {
              const shapeCat = categories.find((c) => c.id === shapeCatId)
              newParentId = shapeCat?.parentId ?? null
            } else {
              newParentId = null
            }
            const siblings = categories.filter((c) => c.parentId === newParentId)
            void categories.find((c) => c.id === dragCatId)!
            // avoid descendant check already? do quick check
            const isDesc = (() => {
              const byId = new Map(categories.map((c) => [c.id, c] as const))
              let cur: string | null = shapeCatId ?? null
              while (cur) {
                if (cur === dragCatId) return true
                cur = byId.get(cur)?.parentId ?? null
              }
              return false
            })()
            if (isDesc) {
              notify('Cannot move category into its own descendant')
              setDragCatId(null)
              return
            }
            const targetCatIdForPos = shapeCatId
            let targetIdx = targetCatIdForPos
              ? siblings.findIndex((c) => c.id === targetCatIdForPos)
              : siblings.length
            if (targetIdx === -1) targetIdx = siblings.length
            const draggedIdx = siblings.findIndex((c) => c.id === dragCatId)
            if (draggedIdx !== -1 && draggedIdx < targetIdx) targetIdx -= 1
            const newIndex = zoneAtDrop === 'before' ? targetIdx : targetIdx + 1
            const res = dispatch(
              new ReorderShapeCategoryCommand({
                nodeId: target.id,
                categoryId: dragCatId,
                newParentId,
                newIndex,
              }),
            )
            if (!res.ok) notify(res.error.message)
            setDragCatId(null)
          }
        }}
        style={{
          position: 'relative',
          border: `1px solid ${selected ? '#1a73e8' : isDrag ? '#1a73e8' : over ? '#1a73e8' : 'var(--color-border)'}`,
          borderRadius: 6,
          padding: 6,
          background: selected
            ? 'color-mix(in srgb, #1a73e8 8%, var(--color-bg))'
            : isDrag
              ? 'color-mix(in srgb, #1a73e8 6%, var(--color-bg))'
              : over
                ? 'color-mix(in srgb, #1a73e8 10%, var(--color-bg))'
                : 'var(--color-bg)',
          opacity: isDrag ? 0.6 : 1,
        }}
      >
        {showBefore && (
          <div
            style={{
              position: 'absolute',
              top: -4,
              left: 0,
              right: 0,
              height: 4,
              background: '#1a73e8',
              borderRadius: 2,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        )}
        {showAfter && (
          <div
            style={{
              position: 'absolute',
              bottom: -4,
              left: 0,
              right: 0,
              height: 4,
              background: '#1a73e8',
              borderRadius: 2,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: isRenaming || isMove ? 6 : 0,
          }}
        >
          <span
            style={{ cursor: playing ? 'default' : 'grab', fontSize: 11, opacity: 0.6 }}
            title={
              dragShapeId
                ? 'Dragging…'
                : 'Drag to reorder — drop above/below to reorder within category, drag onto category to move'
            }
          >
            ⋮⋮
          </span>
          <button
            aria-label={`Preview shape ${shape.name}`}
            aria-pressed={selected}
            onClick={() => handlePreviewToggle(shape.id)}
            title={
              selected ? 'Click to restore base mesh' : 'Preview at coefficient 1 (no keyframe)'
            }
            style={{
              flex: '1 1 100px',
              minWidth: 70,
              textAlign: 'left',
              background: selected ? '#1a73e8' : 'transparent',
              color: selected ? '#fff' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: '6px 8px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: selected ? 600 : 400,
            }}
          >
            {shape.name} {selected ? '● Preview' : ''}
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Move shape ${shape.name} up`}
            onClick={() => handleReorderShape(shape.id, -1)}
            disabled={playing}
            style={{ fontSize: 11, padding: '2px 4px' }}
          >
            ↑
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Move shape ${shape.name} down`}
            onClick={() => handleReorderShape(shape.id, 1)}
            disabled={playing}
            style={{ fontSize: 11, padding: '2px 4px' }}
          >
            ↓
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Duplicate shape ${shape.name}`}
            onClick={() => handleDuplicate(shape.id)}
            disabled={playing}
            style={{ fontSize: 11, padding: '4px 6px' }}
          >
            Duplicate
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Rename shape ${shape.name}`}
            onClick={() => {
              setRenameId(shape.id)
              setRenameError(null)
            }}
            disabled={playing}
            style={{ fontSize: 11, padding: '4px 6px' }}
          >
            Rename
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Move shape ${shape.name} to category`}
            onClick={() => setMoveShapeId(isMove ? null : shape.id)}
            disabled={playing}
            style={{ fontSize: 11, padding: '4px 6px' }}
          >
            Move to…
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Copy shape ${shape.name} to another mesh`}
            onClick={() => handleCopyTo(shape.id)}
            disabled={playing}
            style={{ fontSize: 11, padding: '4px 6px' }}
          >
            Copy to…
          </button>
          <button
            className="inspector-section__link"
            aria-label={`Delete shape ${shape.name}`}
            onClick={() => handleDelete(shape.id)}
            disabled={playing}
            style={{ fontSize: 11, padding: '4px 6px', color: 'var(--color-danger, #c00)' }}
          >
            Delete
          </button>
        </div>
        {showBefore && (
          <div
            style={{ fontSize: 9, color: '#1a73e8', textAlign: 'center', pointerEvents: 'none' }}
          >
            Drop before
          </div>
        )}
        {showAfter && (
          <div
            style={{ fontSize: 9, color: '#1a73e8', textAlign: 'center', pointerEvents: 'none' }}
          >
            Drop after
          </div>
        )}
        {isMove && (
          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
              Category
              <select
                value={shape.categoryId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null
                  handleMoveShape(shape.id, v)
                }}
                style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4 }}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => setMoveShapeId(null)}
            >
              Cancel
            </button>
          </div>
        )}
        {copyShapeId === shape.id && (
          <div
            style={{
              marginTop: 6,
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              background: 'var(--color-bg-elevated)',
              color: 'var(--color-text)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600 }}>Copy “{shape.name}” to…</div>
            {copyCandidates.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                No compatible meshes (same vertex count) found.
              </span>
            ) : (
              <>
                <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Target mesh
                  <select
                    value={copyTargetId}
                    onChange={(e) => setCopyTargetId(e.target.value)}
                    style={{
                      fontSize: 11,
                      padding: '4px 6px',
                      borderRadius: 4,
                      background: 'var(--color-bg-panel)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {copyCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={copyMirrored}
                    onChange={(e) => setCopyMirrored(e.target.checked)}
                  />{' '}
                  Mirrored
                </label>
                {copyMirrored && (
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Axis
                    <select
                      value={copyAxis}
                      onChange={(e) => setCopyAxis(e.target.value as 'x' | 'y')}
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--color-bg-panel)',
                        color: 'var(--color-text)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <option value="x">X (mirror left ↔ right)</option>
                      <option value="y">Y (mirror top ↔ bottom)</option>
                    </select>
                  </label>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleCopyConfirm}
                    disabled={!copyTargetId}
                    style={{
                      fontSize: 11,
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: copyTargetId ? 'var(--color-accent)' : 'var(--color-bg-panel)',
                      color: copyTargetId ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
                      cursor: copyTargetId ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => setCopyShapeId(null)}
                    style={{
                      fontSize: 11,
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-panel)',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {isRenaming && (
          <div style={{ marginTop: 6 }}>
            <NameField
              label={`Rename ${shape.name}`}
              value={shape.name}
              onCommit={(raw) => handleRenameCommit(shape.id, raw)}
              error={renameError}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={() => {
                  setRenameId(null)
                  setRenameError(null)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const rootCats = childrenByParent.get(null) ?? []
  const uncategorizedShapes = shapesByCategory.get(null) ?? []

  if (!target.components.mesh) return null

  return (
    <section className="inspector-section" aria-label="Mesh">
      <h3 className="inspector-section__title">Mesh</h3>
      {isFrozen && (
        <div
          className="inspector-section__notice"
          role="alert"
          style={{
            background: '#3c2a00',
            border: '1px solid #8a6d00',
            color: '#ffed8a',
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: '1.4',
            marginBottom: 8,
          }}
        >
          Topology locked — Remove Shapes to edit topology. Delete, extrude, subdivide, mirror are
          disabled while Shapes exist.
        </div>
      )}
      <div
        className="inspector-field"
        style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}
      >
        <button
          className="inspector-reset"
          onClick={() => handleCreateCategory(null)}
          disabled={playing}
          aria-label="Create Category"
        >
          Create Category
        </button>
        <button
          className="inspector-reset"
          onClick={() => handleCreateShape(null)}
          disabled={playing}
          aria-label="Create Shape"
        >
          Create Shape
        </button>
        <button
          className="inspector-reset"
          onClick={handleBakePose}
          disabled={playing}
          aria-label="Bake Pose as Shape"
          title="Create a new Shape from the current deformed pose (morph · symmetry · bones at playhead) — snapshot of what you see on canvas"
          data-testid="bake-pose-shape"
        >
          Bake Pose as Shape
        </button>
        <span className="inspector-section__notice" style={{ fontSize: 11 }}>
          {shapes.length} {shapes.length === 1 ? 'Shape' : 'Shapes'} · {categories.length}{' '}
          {categories.length === 1 ? 'Category' : 'Categories'}
        </span>
      </div>

      <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6, lineHeight: 1.4 }}>
        Tip: Drag <strong>⋮⋮</strong> on a category — top 25% = before, middle = nest inside, bottom
        25% = after. Drag shapes above/below to reorder within a category, or onto a category header
        to move there. Drag a subcategory onto “Uncategorized” or the top-level drop zone to make it
        a root category.
      </div>

      {categories.length === 0 && shapes.length === 0 ? (
        <p className="inspector-section__notice">
          No Shapes or Categories. Create a category first, then a shape or snapshot current
          vertices.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
          onDragOver={(e) => {
            if (!isDragging) return
            // allow dropping to root when dragging over empty area of list
            const target = e.target as HTMLElement
            if (target === e.currentTarget) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(e) => {
            if (!isDragging) return
            const targetEl = e.target as HTMLElement
            if (targetEl !== e.currentTarget) return
            e.preventDefault()
            e.stopPropagation()
            setDragOver(null)
            if (dragCatId) {
              const res = dispatch(
                new ReorderShapeCategoryCommand({
                  nodeId: target.id,
                  categoryId: dragCatId,
                  newParentId: null,
                  newIndex: rootCats.length,
                }),
              )
              if (!res.ok) notify(res.error.message)
              setDragCatId(null)
            } else if (dragShapeId) {
              const sib = shapes.filter((s) => (s.categoryId ?? null) === null)
              const res = dispatch(
                new ReorderShapeCommand({
                  nodeId: target.id,
                  shapeId: dragShapeId,
                  targetCategoryId: null,
                  newIndex: sib.length,
                }),
              )
              if (!res.ok) notify(res.error.message)
              setDragShapeId(null)
            }
          }}
        >
          {rootCats.map((cat) => renderCategory(cat.id, 0))}
          {isDragging && dragCatId && (
            <li
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDragOver({ id: '__root', zone: 'into', kind: 'cat' })
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragOver(null)
                if (dragCatId) {
                  const res = dispatch(
                    new ReorderShapeCategoryCommand({
                      nodeId: target.id,
                      categoryId: dragCatId,
                      newParentId: null,
                      newIndex: rootCats.length,
                    }),
                  )
                  if (!res.ok) notify(res.error.message)
                  setDragCatId(null)
                } else if (dragShapeId) {
                  const sib = shapes.filter((s) => (s.categoryId ?? null) === null)
                  const res = dispatch(
                    new ReorderShapeCommand({
                      nodeId: target.id,
                      shapeId: dragShapeId,
                      targetCategoryId: null,
                      newIndex: sib.length,
                    }),
                  )
                  if (!res.ok) notify(res.error.message)
                  setDragShapeId(null)
                }
              }}
              style={{
                border: `1px dashed ${dragOver?.id === '__root' ? '#1a73e8' : 'var(--color-border)'}`,
                borderRadius: 6,
                padding: '10px',
                background:
                  dragOver?.id === '__root'
                    ? 'color-mix(in srgb, #1a73e8 12%, var(--color-bg))'
                    : 'transparent',
                textAlign: 'center',
                fontSize: 11,
                color: dragOver?.id === '__root' ? '#1a73e8' : 'var(--color-text-muted)',
                fontWeight: dragOver?.id === '__root' ? 600 : 400,
              }}
            >
              Drop here to move to <strong>top level</strong> (root)
            </li>
          )}
          {/* Uncategorized shapes section */}
          <li
            onDragOver={(e) => {
              const isCatDrag = !!dragCatId
              const isShapeDrag = !!dragShapeId
              if (!isCatDrag && !isShapeDrag) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              if (isShapeDrag) setDragOver({ id: '__uncat', zone: 'into', kind: 'shape' })
              else if (isCatDrag) setDragOver({ id: '__uncat', zone: 'into', kind: 'cat' })
            }}
            onDragLeave={(e) => {
              const related = e.relatedTarget as HTMLElement | null
              if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
                if (dragOver?.id === '__uncat') setDragOver(null)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(null)
              if (dragShapeId) {
                const sib = shapes.filter((s) => (s.categoryId ?? null) === null)
                const res = dispatch(
                  new ReorderShapeCommand({
                    nodeId: target.id,
                    shapeId: dragShapeId,
                    targetCategoryId: null,
                    newIndex: sib.length,
                  }),
                )
                if (!res.ok) notify(res.error.message)
                setDragShapeId(null)
              } else if (dragCatId) {
                const res = dispatch(
                  new ReorderShapeCategoryCommand({
                    nodeId: target.id,
                    categoryId: dragCatId,
                    newParentId: null,
                    newIndex: rootCats.length,
                  }),
                )
                if (!res.ok) notify(res.error.message)
                setDragCatId(null)
              }
            }}
            style={{
              border: `1px dashed ${dragOver?.id === '__uncat' ? '#1a73e8' : 'var(--color-border)'}`,
              borderRadius: 6,
              padding: 6,
              background:
                dragOver?.id === '__uncat'
                  ? 'color-mix(in srgb, #1a73e8 12%, var(--color-bg))'
                  : 'var(--color-bg-elevated)',
              boxShadow: dragOver?.id === '__uncat' ? 'inset 0 0 0 2px #1a73e8' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <strong style={{ fontSize: 12, flex: 1 }}>
                Uncategorized {dragOver?.id === '__uncat' ? '● Drop to move here' : ''}
              </strong>
              <span style={{ fontSize: 10, opacity: 0.6 }}>
                {uncategorizedShapes.length} shapes
              </span>
              <button
                aria-label="Create shape in Uncategorized"
                onClick={() => handleCreateShape(null)}
                disabled={playing}
                style={{ fontSize: 10, padding: '2px 4px' }}
              >
                + Shape
              </button>
            </div>
            {uncategorizedShapes.length === 0 ? (
              <p className="inspector-section__notice" style={{ margin: 0 }}>
                {isDragging
                  ? 'Drop shapes or categories here to move to top level / Uncategorized'
                  : 'No shapes in Uncategorized. Drag shapes here or create new.'}
              </p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {uncategorizedShapes.map((shape) => renderShapeRow(shape))}
              </ul>
            )}
            {isDragging && (
              <div
                style={{
                  fontSize: 10,
                  color: '#1a73e8',
                  textAlign: 'center',
                  marginTop: 6,
                  fontWeight: 600,
                }}
              >
                Drop here to move to top level / Uncategorized
              </div>
            )}
          </li>
        </ul>
      )}

      {isFrozen && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span
            className="inspector-section__notice"
            title="Remove Shapes to edit topology"
            style={{
              fontSize: 11,
              opacity: 0.7,
              border: '1px dashed var(--color-border)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            Delete — disabled (Remove Shapes to edit topology)
          </span>
          <span
            className="inspector-section__notice"
            title="Remove Shapes to edit topology"
            style={{
              fontSize: 11,
              opacity: 0.7,
              border: '1px dashed var(--color-border)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            Extrude — disabled
          </span>
          <span
            className="inspector-section__notice"
            title="Remove Shapes to edit topology"
            style={{
              fontSize: 11,
              opacity: 0.7,
              border: '1px dashed var(--color-border)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            Subdivide — disabled
          </span>
          <span
            className="inspector-section__notice"
            title="Remove Shapes to edit topology"
            style={{
              fontSize: 11,
              opacity: 0.7,
              border: '1px dashed var(--color-border)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            Mirror — disabled
          </span>
        </div>
      )}
    </section>
  )
}
