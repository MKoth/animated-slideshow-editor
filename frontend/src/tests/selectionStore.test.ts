import { beforeEach, describe, expect, it } from 'vitest'
import { useSelectionStore } from '../stores/selectionStore'

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
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
})
