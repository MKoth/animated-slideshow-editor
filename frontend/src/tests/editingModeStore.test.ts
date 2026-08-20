import { describe, expect, it, beforeEach } from 'vitest'
import { useEditingModeStore } from '../stores/editingModeStore'

describe('editingModeStore', () => {
  beforeEach(() => {
    useEditingModeStore.setState({ mode: 'default', selectedNodeId: null })
  })

  it('starts in default mode', () => {
    const state = useEditingModeStore.getState()
    expect(state.mode).toBe('default')
    expect(state.selectedNodeId).toBeNull()
  })

  it('sets mode to boneCreation', () => {
    useEditingModeStore.getState().setMode('boneCreation')
    expect(useEditingModeStore.getState().mode).toBe('boneCreation')
  })

  it('sets mode to ikTarget', () => {
    useEditingModeStore.getState().setMode('ikTarget')
    expect(useEditingModeStore.getState().mode).toBe('ikTarget')
  })

  it('sets mode to poleVector', () => {
    useEditingModeStore.getState().setMode('poleVector')
    expect(useEditingModeStore.getState().mode).toBe('poleVector')
  })

  it('sets mode to meshEdit', () => {
    useEditingModeStore.getState().setMode('meshEdit')
    expect(useEditingModeStore.getState().mode).toBe('meshEdit')
  })

  it('sets mode to weightPaint', () => {
    useEditingModeStore.getState().setMode('weightPaint')
    expect(useEditingModeStore.getState().mode).toBe('weightPaint')
  })

  it('exits mode back to default', () => {
    useEditingModeStore.getState().setMode('boneCreation')
    expect(useEditingModeStore.getState().mode).toBe('boneCreation')

    useEditingModeStore.getState().exitMode()
    expect(useEditingModeStore.getState().mode).toBe('default')
    expect(useEditingModeStore.getState().selectedNodeId).toBeNull()
  })

  it('sets selected node id', () => {
    useEditingModeStore.getState().setSelectedNodeId('node1')
    expect(useEditingModeStore.getState().selectedNodeId).toBe('node1')
  })

  it('clears selected node id on exit', () => {
    useEditingModeStore.getState().setMode('meshEdit')
    useEditingModeStore.getState().setSelectedNodeId('mesh1')
    expect(useEditingModeStore.getState().selectedNodeId).toBe('mesh1')

    useEditingModeStore.getState().exitMode()
    expect(useEditingModeStore.getState().selectedNodeId).toBeNull()
  })
})
