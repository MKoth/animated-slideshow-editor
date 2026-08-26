import { useRef, useState, useSyncExternalStore } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { SceneNode } from '../../engine'
import type { Slide } from '../../engine'
import { defaultTableComponent } from '../../engine/defaultTable'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  DeleteSlideCommand,
  formatParameters,
} from '../../engine/commands'

const MIN_VISIBLE_PX = 48

export function DebugPanel() {
  const { engine, dispatch, undoStack } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((tick) => tick + 1))
  const entries = useSyncExternalStore(
    (listener) => undoStack.subscribe(listener),
    () => undoStack.entries,
  )
  const [projectName, setProjectName] = useState('Demo Project')
  const [slideName, setSlideName] = useState('Slide 1')
  const [nodeName, setNodeName] = useState('Node A')
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  if (!import.meta.env.DEV) {
    return null
  }

  const project = engine.project

  const handleCreateProject = () => {
    dispatch(new CreateProjectCommand({ name: projectName }))
  }

  const handleAddSlide = () => {
    dispatch(new CreateSlideCommand({ name: slideName }))
  }

  const handleAddNode = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) {
      return
    }
    dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name: nodeName,
      }),
    )
  }

  const handleAddTable = () => {
    const targetSlide = engine.getActiveSlide()
    if (!targetSlide) {
      return
    }
    dispatch(
      new CreateNodeCommand({
        sceneId: targetSlide.scene.id,
        parentId: targetSlide.scene.root.id,
        name: 'Table',
        components: { table: defaultTableComponent() },
      }),
    )
  }

  const handleDeleteSlide = (slide: Slide) => {
    dispatch(new DeleteSlideCommand({ slideId: slide.id }))
  }

  const handleDeleteNode = (node: SceneNode) => {
    dispatch(new DeleteNodeCommand({ nodeId: node.id }))
  }

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    const panel = panelRef.current
    if (!panel) {
      return
    }
    event.preventDefault()
    const width = panel.getBoundingClientRect().width
    const maxLeft = window.innerWidth - MIN_VISIBLE_PX
    const maxTop = window.innerHeight - MIN_VISIBLE_PX
    setPosition({
      left: Math.min(
        Math.max(drag.left + event.clientX - drag.startX, -width + MIN_VISIBLE_PX),
        maxLeft,
      ),
      top: Math.min(Math.max(drag.top + event.clientY - drag.startY, 0), maxTop),
    })
  }

  const handlePointerUp = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const rect = panel.getBoundingClientRect()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    }
    event.preventDefault()
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <div
      className="debug-panel"
      ref={panelRef}
      style={position ? { left: position.left, top: position.top, right: 'auto' } : undefined}
    >
      <div className="debug-panel__header" onPointerDown={handlePointerDown}>
        <h2 className="debug-panel__title">Debug</h2>
      </div>

      <section className="debug-panel__section">
        <h3>Project Tree</h3>
        {project ? (
          <ul className="debug-panel__tree" aria-label="Project tree">
            <li>
              <span className="debug-panel__project">{project.name}</span>
              <ul>
                {project.slides.map((slide) => (
                  <li key={slide.id}>
                    <span className="debug-panel__slide">
                      {slide.name}
                      <button
                        className="debug-panel__delete"
                        aria-label={`Delete slide ${slide.name}`}
                        onClick={() => handleDeleteSlide(slide)}
                      >
                        ✕
                      </button>
                    </span>
                    <ul>
                      <NodeTree node={slide.scene.root} onDelete={handleDeleteNode} />
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        ) : (
          <p className="debug-panel__empty">No project. Create one to get started.</p>
        )}
        <div className="debug-panel__controls">
          <input
            aria-label="Project name"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <button onClick={handleCreateProject}>Create Project</button>
          <input
            aria-label="Slide name"
            value={slideName}
            onChange={(event) => setSlideName(event.target.value)}
          />
          <button onClick={handleAddSlide}>Add Slide</button>
          <input
            aria-label="Node name"
            value={nodeName}
            onChange={(event) => setNodeName(event.target.value)}
          />
          <button onClick={handleAddNode}>Add Node</button>
          <button onClick={handleAddTable}>Add Table</button>
        </div>
      </section>

      <section className="debug-panel__section">
        <h3>Command History</h3>
        {entries.length > 0 ? (
          <ol className="debug-panel__undo" aria-label="Command history">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="debug-panel__undo-type">{entry.type}</span>{' '}
                <code className="debug-panel__undo-params">
                  {formatParameters(entry.parameters)}
                </code>
              </li>
            ))}
          </ol>
        ) : (
          <p className="debug-panel__empty">No commands executed yet.</p>
        )}
      </section>
    </div>
  )
}

interface NodeTreeProps {
  node: SceneNode
  onDelete: (node: SceneNode) => void
}

function NodeTree({ node, onDelete }: NodeTreeProps) {
  const deletable = node.parent !== null && !node.components.camera
  return (
    <li>
      <span className="debug-panel__node">
        {node.name}
        {deletable && (
          <button
            className="debug-panel__delete"
            aria-label={`Delete node ${node.name}`}
            onClick={() => onDelete(node)}
          >
            ✕
          </button>
        )}
      </span>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <NodeTree key={child.id} node={child} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  )
}
