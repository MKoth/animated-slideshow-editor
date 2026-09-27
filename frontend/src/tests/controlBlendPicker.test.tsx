import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ControlValuePickerModal } from '../components/panels/ControlValuePickerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { Keyframe } from '../engine/keyframe'
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

describe('ControlValuePickerModal wrap checkbox', () => {
  function setupWithKeyframe() {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    host.controlSet = createControlSet(host.id, [createControl({ key: 'Open', bindings: {} })])
    const track = slide.animation.ensure(host.id)
    track.addControl('Open', new Keyframe('kf-1', 0, 0.2))
    track.addControl('Open', new Keyframe('kf-2', slide.duration, 0.75))
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const onClose = vi.fn()
    render(
      <ControlValuePickerModal
        open
        nodeId={host.id}
        controlKey="Open"
        keyframeId="kf-1"
        value={0.2}
        blend={[]}
        engine={toReadOnly(engine)}
        dispatch={(c) => dispatcher.dispatch(c)}
        notify={() => {}}
        onClose={onClose}
      />,
    )
    const wrapSlide = engine.project?.slides[0]
    if (!wrapSlide) throw new Error('expected a slide')
    const trackOf = () => wrapSlide.animation.node(host.id)!.controlKeyframes('Open')
    return { engine, dispatcher, trackOf }
  }

  it('saves wrap checked on the control keyframe and undoes', () => {
    const { dispatcher, trackOf } = setupWithKeyframe()
    const box = screen.getByTestId('control-wrap-checkbox')
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(box).toBeChecked()
    fireEvent.click(screen.getByTestId('control-value-save'))
    expect(trackOf().find((k) => k.id === 'kf-1')?.wrap).toBe(true)
    expect(dispatcher.undo()).toBe(true)
    expect(trackOf().find((k) => k.id === 'kf-1')?.wrap).toBe(false)
  })
})
