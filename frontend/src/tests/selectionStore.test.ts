import { beforeEach, describe, expect, it } from 'vitest'
import { useSelectionStore } from '../stores/selectionStore'

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
})

describe('selectionStore', () => {
  it('selects a single node, replacing any previous selection', () => {
    useSelectionStore.getState().selectMany(['a', 'b'])

    useSelectionStore.getState().select('c')

    expect(useSelectionStore.getState().selectedIds).toEqual(['c'])
  })

  it('selects many nodes, preserving the given insertion order without duplicates', () => {
    useSelectionStore.getState().selectMany(['b', 'a', 'b', 'c'])

    expect(useSelectionStore.getState().selectedIds).toEqual(['b', 'a', 'c'])
  })

  it('appends a node that is not selected and removes it when toggled again', () => {
    useSelectionStore.getState().selectMany(['a', 'b'])

    useSelectionStore.getState().toggle('c')
    expect(useSelectionStore.getState().selectedIds).toEqual(['a', 'b', 'c'])

    useSelectionStore.getState().toggle('a')
    expect(useSelectionStore.getState().selectedIds).toEqual(['b', 'c'])
  })

  it('extends the selection by appending a node that is not selected', () => {
    useSelectionStore.getState().selectMany(['a', 'b'])

    useSelectionStore.getState().extend('c')
    useSelectionStore.getState().extend('a')

    expect(useSelectionStore.getState().selectedIds).toEqual(['a', 'b', 'c'])
  })

  it('clears the selection', () => {
    useSelectionStore.getState().selectMany(['a', 'b'])

    useSelectionStore.getState().clear()

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('prunes the selection to the nodes that still exist, preserving order', () => {
    useSelectionStore.getState().selectMany(['a', 'b', 'c', 'd'])

    useSelectionStore.getState().prune(new Set(['a', 'c', 'd']))

    expect(useSelectionStore.getState().selectedIds).toEqual(['a', 'c', 'd'])
  })

  it('selects keyframes, clearing any node selection', () => {
    useSelectionStore.getState().selectMany(['a', 'b'])

    useSelectionStore.getState().selectKeyframes(['k1', 'k2'])

    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual(['k1', 'k2'])
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('toggles a keyframe in and out of the selection', () => {
    useSelectionStore.getState().selectKeyframes(['k1'])

    useSelectionStore.getState().toggleKeyframe('k2')
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual(['k1', 'k2'])

    useSelectionStore.getState().toggleKeyframe('k1')
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual(['k2'])
  })

  it('clears the keyframe selection without touching node selection', () => {
    useSelectionStore.getState().selectKeyframes(['k1', 'k2'])

    useSelectionStore.getState().clearKeyframes()

    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])
  })

  it('prunes the keyframe selection to keyframes that still exist', () => {
    useSelectionStore.getState().selectKeyframes(['k1', 'k2', 'k3'])

    useSelectionStore.getState().pruneKeyframes(new Set(['k2']))

    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual(['k2'])
  })

  it('clears both node and keyframe selection', () => {
    useSelectionStore.getState().selectMany(['a'])
    useSelectionStore.getState().selectKeyframes(['k1'])

    useSelectionStore.getState().clear()

    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])
  })

  it('node selection actions clear the keyframe selection', () => {
    useSelectionStore.getState().selectKeyframes(['k1'])

    useSelectionStore.getState().select('a')
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])

    useSelectionStore.getState().selectKeyframes(['k1'])
    useSelectionStore.getState().selectMany(['b'])
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])

    useSelectionStore.getState().selectKeyframes(['k1'])
    useSelectionStore.getState().toggle('b')
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])

    useSelectionStore.getState().selectKeyframes(['k1'])
    useSelectionStore.getState().extend('c')
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])
  })
})
