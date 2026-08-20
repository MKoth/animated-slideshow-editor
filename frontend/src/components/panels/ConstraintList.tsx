import { useState } from 'react'
import type { EnginePublic } from '../../engine'
import type { Command, CommandResult } from '../../engine/commands'
import type {
  ConstraintType,
  ConstraintParams,
  Constraint,
  RotationLimitParams,
  PositionLimitParams,
  DistanceParams,
} from '../../engine/constraint'
import { AddConstraintCommand, RemoveConstraintCommand } from '../../engine/commands'
import { useSelectionStore } from '../../stores/selectionStore'
import { walkPreOrder } from '../../engine/sceneNode'

interface ConstraintListProps {
  engine: EnginePublic
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
}

const CONSTRAINT_TYPES: readonly { type: ConstraintType; label: string }[] = [
  { type: 'rotationLimit', label: 'Rotation Limit' },
  { type: 'positionLimit', label: 'Position Limit' },
  { type: 'lookAt', label: 'Look At' },
  { type: 'distance', label: 'Distance' },
  { type: 'parent', label: 'Parent' },
]

function defaultParams(type: ConstraintType): ConstraintParams {
  switch (type) {
    case 'rotationLimit':
      return { minRotation: -45, maxRotation: 45 }
    case 'positionLimit':
      return { minX: 0, maxX: 100, minY: 0, maxY: 100 }
    case 'lookAt':
      return { targetX: 0, targetY: 0 }
    case 'distance':
      return { targetNodeId: '', minDistance: 0, maxDistance: 100 }
    case 'parent':
      return {
        targetNodeId: '',
        positionInfluence: 1,
        rotationInfluence: 1,
        scaleInfluence: 1,
      }
  }
}

function constraintLabel(type: ConstraintType): string {
  return CONSTRAINT_TYPES.find((ct) => ct.type === type)?.label ?? type
}

function constraintDetail(type: ConstraintType, params: ConstraintParams): string {
  switch (type) {
    case 'rotationLimit': {
      const p = params as RotationLimitParams
      return `${p.minRotation}° – ${p.maxRotation}°`
    }
    case 'positionLimit': {
      const p = params as PositionLimitParams
      return `X: ${p.minX}–${p.maxX}, Y: ${p.minY}–${p.maxY}`
    }
    case 'lookAt':
      return 'Look at target'
    case 'distance': {
      const p = params as DistanceParams
      return `Min: ${p.minDistance}, Max: ${p.maxDistance}`
    }
    case 'parent':
      return 'Parent constraint'
  }
}

interface ConstraintEntry {
  readonly nodeId: string
  readonly nodeName: string
  readonly constraint: Constraint
}

function collectAllConstraints(engine: EnginePublic): ConstraintEntry[] {
  const slide = engine.getActiveSlide()
  if (!slide) return []

  const entries: ConstraintEntry[] = []
  for (const node of walkPreOrder(slide.scene.root)) {
    const constraints = engine.getConstraintManager().getConstraintsForNode(node.id)
    for (const constraint of constraints) {
      entries.push({ nodeId: node.id, nodeName: node.name, constraint })
    }
  }
  return entries
}

export function ConstraintList({ engine, dispatch }: ConstraintListProps) {
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const selectedNodeId = selectedIds.length === 1 ? selectedIds[0] : null
  const [search, setSearch] = useState('')

  const allConstraints = collectAllConstraints(engine)

  const filtered = allConstraints.filter(({ constraint, nodeName }) => {
    if (!search.trim()) return true
    return (
      constraintLabel(constraint.type).toLowerCase().includes(search.trim().toLowerCase()) ||
      nodeName.toLowerCase().includes(search.trim().toLowerCase())
    )
  })

  const handleAddConstraint = (type: ConstraintType) => {
    if (!selectedNodeId) return
    const params = defaultParams(type)
    dispatch(
      new AddConstraintCommand({
        nodeId: selectedNodeId,
        constraintType: type,
        priority: 0,
        params,
      }),
    )
  }

  const handleRemoveConstraint = (nodeId: string, constraintId: string) => {
    dispatch(new RemoveConstraintCommand({ nodeId, constraintId }))
  }

  return (
    <div className="rigging-section">
      <div className="rigging-toolbar">
        <div className="rigging-toolbar__row">
          {CONSTRAINT_TYPES.map((ct) => (
            <button
              key={ct.type}
              className="rigging-toolbar__create"
              disabled={!selectedNodeId}
              title={selectedNodeId ? `Add ${ct.label} to selected node` : 'Select a node first'}
              onClick={() => handleAddConstraint(ct.type)}
            >
              + {ct.label}
            </button>
          ))}
        </div>
        <div className="rigging-toolbar__row">
          <input
            className="rigging-toolbar__search"
            type="search"
            aria-label="Search constraints"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {allConstraints.length === 0 ? (
        <div className="panel-empty-state">
          <p>No constraints in the scene. Select a node and add one above.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-empty-state">
          <p>No constraints match your search.</p>
        </div>
      ) : (
        <ul className="rigging-list">
          {filtered.map(({ nodeId, nodeName, constraint }) => (
            <li key={constraint.id} className="rigging-list__item">
              <div className="rigging-list__info">
                <span className="rigging-list__name">{constraintLabel(constraint.type)}</span>
                <span className="rigging-list__detail">
                  {constraintDetail(constraint.type, constraint.params)}
                </span>
                <span className="rigging-list__detail">
                  Node: {nodeName} · Priority: {constraint.priority}
                </span>
              </div>
              <div className="rigging-list__actions">
                <button
                  aria-label={`Remove ${constraintLabel(constraint.type)} constraint`}
                  title={`Remove ${constraintLabel(constraint.type)} constraint`}
                  onClick={() => handleRemoveConstraint(nodeId, constraint.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
