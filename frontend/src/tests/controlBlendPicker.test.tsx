import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ControlValuePickerModal } from '../components/panels/ControlValuePickerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  addGroupToControlSet,
  createControl,
  createControlSet,
  setBlendNameInControlSet,
} from '../engine/control'

function setup(named: boolean) {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
  let cs = createControlSet(host.id, [createControl({ key: 'Open', bindings: { m: 'clip1' } })])
  cs = addGroupToControlSet(cs, 'Open')
  if (named) cs = setBlendNameInControlSet(cs, 'Open', 0, 'Mouth openness')
  host.controlSet = cs
  const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
  render(
    <ControlValuePickerModal
      open
      nodeId={host.id}
      controlKey="Open"
      keyframeId="kf-1"
      value={0.5}
      blend={[]}
      engine={toReadOnly(engine)}
      dispatch={(c) => dispatcher.dispatch(c)}
      notify={() => {}}
      onClose={() => {}}
    />,
  )
}

describe('ControlValuePickerModal blend labels', () => {
  it('shows the default long label when the blend is unnamed', () => {
    setup(false)
    const label = screen.getByTestId('control-blend-label-0')
    expect(label.textContent).toBe('Blend T1→T2 (Group 1 → Group 2) — 0.00')
    expect(label.getAttribute('title')).toBeNull()
  })

  it('shows the custom blend name with the technical label as tooltip', () => {
    setup(true)
    const label = screen.getByTestId('control-blend-label-0')
    expect(label.textContent).toBe('Mouth openness — 0.00')
    expect(label.getAttribute('title')).toBe('Blend T1→T2 (Group 1 → Group 2)')
  })
})
