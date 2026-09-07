import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useUiStore } from '../../stores/uiStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { SymmetrizeSubtreeCommand } from '../../engine/commands/symmetrizeSubtreeCommand'
import { symmetryKeyframeCommandsForSubtree } from '../../engine/symmetryHelpers'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import { TransactionCommand } from '../../engine/commands/transactionCommand'
import type { SymmetryAxis } from '../../engine/symmetry'
import { playheadTimeOf } from '../../app/keyframeActions'
import { useNotificationStore } from '../../stores/notificationStore'
import { walkPreOrder } from '../../engine/sceneNode'
import { AddKeyframeCommand } from '../../engine/commands/addKeyframeCommand'
import { SetKeyframeValueCommand } from '../../engine/commands/setKeyframeValueCommand'

export function SymmetryInspectorSection() {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((s) => s.notify)
  const selectedIds = useSelectionStore((s) => s.selectedIds)
  const animationMode = useUiStore((s) => s.animationMode)
  const [, setTick] = useState(0)
  const [axis, setAxis] = useState<SymmetryAxis>('x')
  const [factor, setFactor] = useState(1)

  useEngineEvent(() => setTick((t) => t + 1))

  if (selectedIds.length === 0) return null
  const activeSlide = engine.getActiveSlide()
  if (!activeSlide) return null

  // Show only if at least one selected node is in current slide and has mesh or children with mesh
  const hasMeshInSubtree = (() => {
    for (const id of selectedIds) {
      try {
        const node = engine.getNode(id)
        // check via scene membership
        if (!activeSlide.scene.getNode(id)) continue
        for (const n of walkPreOrder(node)) {
          if (n.components.mesh) return true
        }
        if (node.children.length > 0) return true
      } catch {
        void 0
      }
    }
    return false
  })()

  void hasMeshInSubtree

  const handleSymmetrize = () => {
    if (selectedIds.length === 0) return
    const rootId = selectedIds[0]!
    try {
      // Validate root in active slide
      activeSlide.scene.getNode(rootId)
    } catch {
      notify('Selected node not in active slide')
      return
    }

    if (animationMode) {
      // Create keyframes at playhead for each node in subtree
      const time = playheadTimeOf(engine, rootId) ?? 0
      const cmds = symmetryKeyframeCommandsForSubtree(engine as unknown as import('../../engine/internal').Engine, rootId, axis, time)
      if (cmds.length === 0) {
        notify('Already symmetric at playhead')
        return
      }
      const result = dispatchKeyframeCommands(dispatch, cmds)
      if (result && !result.ok) notify(result.error.message)
      else notify(`Symmetry keyframes created on ${axis} at ${time.toFixed(2)}s`)
    } else {
      // Direct in-place mutate
      if (selectedIds.length === 1) {
        const result = dispatch(new SymmetrizeSubtreeCommand({ nodeId: selectedIds[0]!, axis }))
        if (!result.ok) notify(result.error.message)
        else notify(`Symmetrized subtree on ${axis}`)
      } else {
        const cmds = selectedIds.map((id) => new SymmetrizeSubtreeCommand({ nodeId: id, axis }))
        const result = dispatch(new TransactionCommand(cmds as unknown as import('../../engine/commands/command').Command<unknown>[]))
        if (!result.ok) notify(result.error.message)
        else notify(`Symmetrized ${selectedIds.length} subtree(s) on ${axis}`)
      }
    }
  }

  const handleApplyFactor = () => {
    if (selectedIds.length === 0) return
    const rootId = selectedIds[0]!
    const time = playheadTimeOf(engine, rootId) ?? 0
    const cmds: import('../../engine/commands/command').Command<unknown>[] = []
    try {
      const root = engine.getNode(rootId)
      for (const node of walkPreOrder(root)) {
        if (!node.components.mesh) continue
        const target = { kind: 'symmetry' as const, nodeId: node.id }
        const value = { axis, factor }
        const existing = engine.getSymmetryKeyframes(node.id).find((k) => k.time === time)
        if (existing) {
          if (JSON.stringify(existing.value) !== JSON.stringify(value)) {
            cmds.push(new SetKeyframeValueCommand({ target, keyframeId: existing.id, newValue: value }))
          }
        } else {
          cmds.push(new AddKeyframeCommand({ target, time, value }))
        }
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
      return
    }
    if (cmds.length === 0) {
      notify('No mesh nodes to apply factor')
      return
    }
    const result = dispatchKeyframeCommands(dispatch, cmds)
    if (result && !result.ok) notify(result.error.message)
    else notify(`Symmetry factor ${factor} on ${axis} at ${time.toFixed(2)}s`)
  }

  const showFactor = animationMode

  return (
    <section className="inspector-section" aria-label="Symmetry">
      <h3 className="inspector-section__title">Symmetry</h3>
      <div className="inspector-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label className="inspector-field__label">Axis</label>
        <select value={axis} onChange={(e) => setAxis(e.target.value as SymmetryAxis)}>
          <option value="x">X (mirror left↔right)</option>
          <option value="y">Y (mirror top↔bottom)</option>
        </select>
      </div>
      {showFactor && (
        <div className="inspector-field" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <label className="inspector-field__label">Factor</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={factor}
            onChange={(e) => setFactor(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ minWidth: 32, textAlign: 'right' }}>{factor.toFixed(2)}</span>
          <button className="inspector-button" onClick={handleApplyFactor} title="Create symmetry keyframe with factor">
            Keyframe
          </button>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button className="inspector-button" onClick={handleSymmetrize}>
          {animationMode ? `Symmetrize (keyframe ${axis})` : `Symmetrize subtree (${axis})`}
        </button>
      </div>
      <p className="inspector-section__notice" style={{ fontSize: 11, marginTop: 8 }}>
        Walks selected parent and all children. Mirrors meshes & shapes (in-place negate, flip UVs, faces), transforms (x/y + rotation)
        {animationMode ? ' — creates keyframes at playhead (symmetry 0→1 and mirrored position/rotation).' : ' — direct mutation (undoable).'}
      </p>
    </section>
  )
}
