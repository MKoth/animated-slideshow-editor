import { useState, useSyncExternalStore } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import type { SceneNode } from '../../engine'
import type { Slide } from '../../engine'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  DeleteSlideCommand,
  formatParameters,
} from '../../engine/commands'

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
    const firstSlide = project?.slides[0]
    if (!firstSlide) {
      return
    }
    dispatch(
      new CreateNodeCommand({
        sceneId: firstSlide.scene.id,
        parentId: firstSlide.scene.root.id,
        name: nodeName,
      }),
    )
  }

  const handleDeleteSlide = (slide: Slide) => {
    dispatch(new DeleteSlideCommand({ slideId: slide.id }))
  }

  const handleDeleteNode = (node: SceneNode) => {
    dispatch(new DeleteNodeCommand({ nodeId: node.id }))
  }

  return (
    <div className="debug-panel">
      <h2 className="debug-panel__title">Debug</h2>

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
        </div>
      </section>

      <section className="debug-panel__section">
        <h3>Undo Stack</h3>
        {entries.length > 0 ? (
          <ol className="debug-panel__undo" aria-label="Undo stack">
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
