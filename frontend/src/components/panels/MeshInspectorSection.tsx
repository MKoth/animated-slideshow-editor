import { useEffect, useState } from 'react'
import type { EnginePublic, SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  CreateShapeCommand,
  DeleteShapeCommand,
  DuplicateShapeCommand,
  RenameShapeCommand,
} from '../../engine/commands'
import { useEngineEvent } from '../../app/useEngine'
import { useShapePreviewStore } from '../../stores/shapePreviewStore'
import { NameField } from './inspectorFields'

interface MeshInspectorSectionProps {
  target: SceneNode
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}

export function MeshInspectorSection({
  target,
  engine: _engine,
  dispatch,
  notify,
  playing,
}: MeshInspectorSectionProps) {
  void _engine
  const [, setTick] = useState(0)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const previewShapeId = useShapePreviewStore((s) => s.previewShapeId)
  const previewNodeId = useShapePreviewStore((s) => s.previewNodeId)

  useEngineEvent(() => {
    setTick((t) => t + 1)
  })

  const shapes = (target.components.mesh?.shapes ?? []) as readonly import('../../engine/shape').Shape[]
  const shapeIdsKey = shapes.map((s) => s.id).join(',')

  // Clear preview when target changes
  useEffect(() => {
    return () => {
      // clear on unmount or target change: if preview was for this node, clear
      const state = useShapePreviewStore.getState()
      if (state.previewNodeId === target.id) {
        state.clearPreview()
      }
    }
  }, [target.id])

  useEffect(() => {
    if (previewNodeId === target.id && previewShapeId) {
      const exists = shapes.some((s: import('../../engine/shape').Shape) => s.id === previewShapeId)
      if (!exists) {
        useShapePreviewStore.getState().clearPreview()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeIdsKey, previewNodeId, previewShapeId, target.id])

  if (!target.components.mesh) return null

  const isFrozen = shapes.length > 0
  const isPreviewSelected = (shapeId: string) => previewNodeId === target.id && previewShapeId === shapeId

  const handleCreate = () => {
    const existingNames = shapes.map((s: import('../../engine/shape').Shape) => s.name)
    let base = 'Shape'
    let name = base
    let i = 2
    const namesSet = new Set(existingNames)
    while (namesSet.has(name)) {
      name = `${base} ${i}`
      i += 1
    }
    const result = dispatch(new CreateShapeCommand({ nodeId: target.id, name }))
    if (!result.ok) {
      notify(result.error.message)
    }
  }

  const handleDuplicate = (shapeId: string) => {
    const result = dispatch(new DuplicateShapeCommand({ nodeId: target.id, shapeId }))
    if (!result.ok) {
      notify(result.error.message)
    }
  }

  const handleDelete = (shapeId: string) => {
    const result = dispatch(new DeleteShapeCommand({ nodeId: target.id, shapeId }))
    if (!result.ok) {
      notify(result.error.message)
    } else {
      if (previewShapeId === shapeId && previewNodeId === target.id) {
        useShapePreviewStore.getState().clearPreview()
      }
    }
  }

  const handleRenameCommit = (shapeId: string, raw: string) => {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      setRenameError('Shape name must be a non-empty string')
      return
    }
    if (shapes.some((s: import('../../engine/shape').Shape) => s.id !== shapeId && s.name === trimmed)) {
      setRenameError(`A shape with name "${trimmed}" already exists on this mesh`)
      return
    }
    const result = dispatch(new RenameShapeCommand({ nodeId: target.id, shapeId, newName: trimmed }))
    if (!result.ok) {
      const msg = result.error.message
      if (msg.toLowerCase().includes('already exists')) {
        setRenameError(msg)
      } else {
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
    if (store.previewNodeId === target.id && store.previewShapeId === shapeId) {
      store.clearPreview()
    } else {
      store.setPreview(target.id, shapeId)
    }
  }

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

      <div className="inspector-field" style={{ marginBottom: 8 }}>
        <button
          className="inspector-reset"
          onClick={handleCreate}
          disabled={playing}
          aria-label="Create Shape"
        >
          Create Shape
        </button>
        <span className="inspector-section__notice" style={{ fontSize: 11 }}>
          {shapes.length} {shapes.length === 1 ? 'Shape' : 'Shapes'}
        </span>
      </div>

      {shapes.length === 0 ? (
        <p className="inspector-section__notice">No Shapes. Create one to snapshot current vertices.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shapes.map((shape: import('../../engine/shape').Shape) => {
            const selected = isPreviewSelected(shape.id)
            const isRenaming = renameId === shape.id
            return (
              <li
                key={shape.id}
                style={{
                  border: `1px solid ${selected ? '#1a73e8' : 'var(--color-border)'}`,
                  borderRadius: 6,
                  padding: 6,
                  background: selected ? 'color-mix(in srgb, #1a73e8 8%, var(--color-bg))' : 'var(--color-bg)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isRenaming ? 6 : 0 }}>
                  <button
                    aria-label={`Preview shape ${shape.name}`}
                    aria-pressed={selected}
                    onClick={() => handlePreviewToggle(shape.id)}
                    title={selected ? 'Click to restore base mesh' : 'Preview at coefficient 1 (no keyframe)'}
                    style={{
                      flex: 1,
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
                    aria-label={`Duplicate shape ${shape.name}`}
                    onClick={() => handleDuplicate(shape.id)}
                    disabled={playing}
                    title="Duplicate shape with unique name"
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
                    aria-label={`Delete shape ${shape.name}`}
                    onClick={() => handleDelete(shape.id)}
                    disabled={playing}
                    title="Delete shape"
                    style={{ fontSize: 11, padding: '4px 6px', color: 'var(--color-danger, #c00)' }}
                  >
                    Delete
                  </button>
                </div>
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
          })}
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
