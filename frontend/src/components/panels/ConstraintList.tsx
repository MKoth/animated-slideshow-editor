import { useState, useEffect, useRef, useCallback } from 'react'
import type { EnginePublic } from '../../engine'
import type { Command, CommandResult } from '../../engine/commands'
import type {
  ConstraintType,
  ConstraintParams,
  Constraint,
  RotationLimitParams,
  LookAtParams,
  DistanceParams,
  ParentConstraintParams,
} from '../../engine/constraint'
import {
  AddConstraintCommand,
  RemoveConstraintCommand,
  SetConstraintParamsCommand,
} from '../../engine/commands'
import { useSelectionStore } from '../../stores/selectionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { walkPreOrder } from '../../engine/sceneNode'

interface ConstraintListProps {
  engine: EnginePublic
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
}

const CONSTRAINT_TYPES: readonly { type: ConstraintType; label: string }[] = [
  { type: 'rotationLimit', label: 'Rotation Limit' },
  { type: 'lookAt', label: 'Look At' },
  { type: 'distance', label: 'Distance' },
  { type: 'parent', label: 'Parent' },
]

function defaultParams(type: ConstraintType): ConstraintParams {
  switch (type) {
    case 'rotationLimit':
      return { minRotation: -45, maxRotation: 45 }
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
      return `${p.minRotation}\u00B0 \u2013 ${p.maxRotation}\u00B0`
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

interface PickTarget {
  readonly nodeId: string
  readonly constraintId: string
  readonly field: string
  readonly currentParams: ConstraintParams
}

interface NodePickerProps {
  engine: EnginePublic
  value: string
  label: string
  constraintId: string
  field: string
  activePickField: string | null
  onPick: (target: PickTarget) => void
  onCancelPick: () => void
}

function NodePicker({
  engine,
  value,
  label,
  constraintId,
  field,
  activePickField,
  onPick,
  onCancelPick,
}: NodePickerProps) {
  const isActive = activePickField === field

  let nodeName = ''
  if (value) {
    try {
      nodeName = engine.getNode(value).name
    } catch {
      nodeName = value
    }
  }

  return (
    <div className="rigging-constraint-editor__target">
      <span className="rigging-constraint-editor__target-label">{label}:</span>
      {nodeName && <span className="rigging-constraint-editor__target-name">{nodeName}</span>}
      <button
        className={`rigging-constraint-editor__pick${isActive ? ' rigging-constraint-editor__pick--active' : ''}`}
        type="button"
        onClick={() =>
          isActive
            ? onCancelPick()
            : onPick({ nodeId: '', constraintId, field, currentParams: {} as ConstraintParams })
        }
      >
        {isActive ? 'Cancel' : nodeName ? 'Change' : 'Pick Node'}
      </button>
    </div>
  )
}

interface ConstraintEditorProps {
  engine: EnginePublic
  constraint: Constraint
  dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
  nodeId: string
  activePickField: string | null
  onPick: (target: PickTarget) => void
  onCancelPick: () => void
}

function ConstraintEditor({
  engine,
  constraint,
  dispatch,
  nodeId,
  activePickField,
  onPick,
  onCancelPick,
}: ConstraintEditorProps) {
  const updateParams = useCallback(
    (newParams: ConstraintParams) => {
      dispatch(
        new SetConstraintParamsCommand({
          nodeId,
          constraintId: constraint.id,
          params: newParams,
        }),
      )
    },
    [dispatch, nodeId, constraint.id],
  )

  const pick = useCallback(
    (target: PickTarget) => onPick({ ...target, currentParams: constraint.params, nodeId }),
    [onPick, constraint.params, nodeId],
  )

  switch (constraint.type) {
    case 'rotationLimit': {
      const p = constraint.params as RotationLimitParams
      return (
        <div className="rigging-constraint-editor__fields">
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Min \u00B0</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              value={p.minRotation}
              onChange={(e) => updateParams({ ...p, minRotation: Number(e.target.value) })}
            />
          </label>
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Max \u00B0</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              value={p.maxRotation}
              onChange={(e) => updateParams({ ...p, maxRotation: Number(e.target.value) })}
            />
          </label>
        </div>
      )
    }

    case 'lookAt': {
      const p = constraint.params as LookAtParams
      return (
        <div className="rigging-constraint-editor__fields">
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Target X</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              value={p.targetX}
              onChange={(e) => updateParams({ ...p, targetX: Number(e.target.value) })}
            />
          </label>
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Target Y</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              value={p.targetY}
              onChange={(e) => updateParams({ ...p, targetY: Number(e.target.value) })}
            />
          </label>
          <NodePicker
            engine={engine}
            value={p.targetNodeId ?? ''}
            label="Target Node"
            constraintId={constraint.id}
            field="targetNodeId"
            activePickField={activePickField}
            onPick={pick}
            onCancelPick={onCancelPick}
          />
        </div>
      )
    }

    case 'distance': {
      const p = constraint.params as DistanceParams
      return (
        <div className="rigging-constraint-editor__fields">
          <NodePicker
            engine={engine}
            value={p.targetNodeId ?? ''}
            label="Target Node"
            constraintId={constraint.id}
            field="targetNodeId"
            activePickField={activePickField}
            onPick={pick}
            onCancelPick={onCancelPick}
          />
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Min Dist</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              value={p.minDistance}
              onChange={(e) => updateParams({ ...p, minDistance: Number(e.target.value) })}
            />
          </label>
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Max Dist</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              value={p.maxDistance}
              onChange={(e) => updateParams({ ...p, maxDistance: Number(e.target.value) })}
            />
          </label>
        </div>
      )
    }

    case 'parent': {
      const p = constraint.params as ParentConstraintParams
      return (
        <div className="rigging-constraint-editor__fields">
          <NodePicker
            engine={engine}
            value={p.targetNodeId ?? ''}
            label="Target Node"
            constraintId={constraint.id}
            field="targetNodeId"
            activePickField={activePickField}
            onPick={pick}
            onCancelPick={onCancelPick}
          />
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Position</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={p.positionInfluence}
              onChange={(e) => updateParams({ ...p, positionInfluence: Number(e.target.value) })}
            />
          </label>
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Rotation</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={p.rotationInfluence}
              onChange={(e) => updateParams({ ...p, rotationInfluence: Number(e.target.value) })}
            />
          </label>
          <label className="rigging-constraint-editor__field">
            <span className="rigging-constraint-editor__label">Scale</span>
            <input
              className="rigging-constraint-editor__input"
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={p.scaleInfluence}
              onChange={(e) => updateParams({ ...p, scaleInfluence: Number(e.target.value) })}
            />
          </label>
        </div>
      )
    }
  }
}

export function ConstraintList({ engine, dispatch }: ConstraintListProps) {
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const selectedNodeId = selectedIds.length === 1 ? selectedIds[0] : null
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activePickField, setActivePickField] = useState<string | null>(null)
  const pickTargetRef = useRef<PickTarget | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const notify = useNotificationStore((s) => s.notify)

  const cancelPick = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
    pickTargetRef.current = null
    setActivePickField(null)
  }, [])

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [])

  const handlePickStart = useCallback(
    (target: PickTarget) => {
      pickTargetRef.current = target
      setActivePickField(target.field)
      notify('Select a bone in the scene')

      const unsub = useSelectionStore.subscribe((state) => {
        if (!pickTargetRef.current) return
        const ids = state.selectedIds
        if (ids.length === 0) return
        const pickedNodeId = ids[ids.length - 1]

        let node
        try {
          node = engine.getNode(pickedNodeId)
        } catch {
          notify('Node not found')
          cancelPick()
          return
        }
        if (!node.components.bone) {
          notify('Selected node is not a bone. Please select a bone.')
          return
        }

        const t = pickTargetRef.current
        if (t) {
          const newParams = { ...t.currentParams, [t.field]: pickedNodeId }
          dispatch(
            new SetConstraintParamsCommand({
              nodeId: t.nodeId,
              constraintId: t.constraintId,
              params: newParams,
            }),
          )
        }
        cancelPick()
      })

      unsubscribeRef.current = unsub
    },
    [engine, dispatch, notify, cancelPick],
  )

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
    if (expandedId === constraintId) {
      cancelPick()
      setExpandedId(null)
    }
  }

  const handleToggleExpand = (constraintId: string) => {
    if (expandedId === constraintId) {
      cancelPick()
      setExpandedId(null)
    } else {
      if (expandedId !== null) {
        cancelPick()
      }
      setExpandedId(constraintId)
    }
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
          {filtered.map(({ nodeId, nodeName, constraint }) => {
            const isExpanded = expandedId === constraint.id
            return (
              <li key={constraint.id} className="rigging-list__item rigging-list__item--expandable">
                <div
                  className={`rigging-list__info${isExpanded ? ' rigging-list__info--selected' : ''}`}
                  onClick={() => handleToggleExpand(constraint.id)}
                >
                  <span className="rigging-list__name">{constraintLabel(constraint.type)}</span>
                  <span className="rigging-list__detail">
                    {constraintDetail(constraint.type, constraint.params)}
                  </span>
                  <span className="rigging-list__detail">
                    Node: {nodeName} \u00B7 Priority: {constraint.priority}
                  </span>
                </div>
                <div className="rigging-list__actions">
                  <button
                    aria-label={`Remove ${constraintLabel(constraint.type)} constraint`}
                    title={`Remove ${constraintLabel(constraint.type)} constraint`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveConstraint(nodeId, constraint.id)
                    }}
                  >
                    Remove
                  </button>
                </div>
                {isExpanded && (
                  <div className="rigging-constraint-editor">
                    <ConstraintEditor
                      engine={engine}
                      constraint={constraint}
                      dispatch={dispatch}
                      nodeId={nodeId}
                      activePickField={activePickField}
                      onPick={handlePickStart}
                      onCancelPick={cancelPick}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
