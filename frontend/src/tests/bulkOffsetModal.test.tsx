import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BulkOffsetModal } from '../components/panels/BulkOffsetModal'
import type {
  BulkOffsetBindingRow,
  BulkOffsetConfirmSelection,
} from '../components/panels/BulkOffsetModal'

const ROWS: BulkOffsetBindingRow[] = [
  {
    collectionId: 'colA',
    collectionName: 'Walk',
    semanticName: 'head',
    clipId: 'clipHead',
    clipName: 'HeadWalk',
    uses: 2,
  },
  {
    collectionId: 'colA',
    collectionName: 'Walk',
    semanticName: 'body',
    clipId: 'clipBody',
    clipName: 'BodyWalk',
    uses: 1,
  },
  {
    collectionId: 'colB',
    collectionName: 'Run',
    semanticName: 'head',
    clipId: 'clipHeadRun',
    clipName: 'HeadRun',
    uses: 1,
  },
]

function setup(onConfirm?: (sel: BulkOffsetConfirmSelection) => string | null) {
  const spy = vi.fn(onConfirm ?? (() => null))
  render(
    <BulkOffsetModal
      parentName="Rig"
      rows={ROWS}
      initialFilter="head"
      getPreview={(clipIds) => ({
        clipCount: clipIds.length,
        keyframeCount: clipIds.length * 2,
        skippedLinked: 0,
        skippedMissing: 0,
      })}
      onClose={() => {}}
      onConfirm={spy}
    />,
  )
  return { spy }
}

describe('BulkOffsetModal', () => {
  it('filters by semantic and confirms checked rows with channel deltas', () => {
    const { spy } = setup()
    // body row filtered out by initial "head" filter
    expect(screen.queryByTestId('bulk-offset-row-colA-body')).toBeNull()
    expect(screen.getByTestId('bulk-offset-row-colA-head')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-offset-row-colB-head')).toBeInTheDocument()

    // clearing the filter reveals the body row still checked (filter never drops selection)
    fireEvent.change(screen.getByTestId('bulk-offset-filter'), { target: { value: '' } })
    expect(screen.getByTestId('bulk-offset-row-colA-body')).toBeInTheDocument()
    // uncheck everything but head
    fireEvent.click(screen.getByTestId('bulk-offset-row-colA-body'))

    fireEvent.click(screen.getByTestId('bulk-offset-channel-positionY'))
    fireEvent.change(screen.getByTestId('bulk-offset-delta-positionY'), {
      target: { value: '100' },
    })
    fireEvent.click(screen.getByTestId('bulk-offset-confirm'))

    expect(spy).toHaveBeenCalledOnce()
    const selection = spy.mock.calls[0]![0] as BulkOffsetConfirmSelection
    expect([...selection.clipIds].sort()).toEqual(['clipHead', 'clipHeadRun'].sort())
    expect(selection.offsets).toEqual({ positionY: 100 })
  })

  it('keeps checked rows hidden by the filter in the confirm set', () => {
    const { spy } = setup()
    fireEvent.click(screen.getByTestId('bulk-offset-channel-positionY'))
    fireEvent.change(screen.getByTestId('bulk-offset-delta-positionY'), {
      target: { value: '100' },
    })
    fireEvent.click(screen.getByTestId('bulk-offset-confirm'))

    expect(spy).toHaveBeenCalledOnce()
    const selection = spy.mock.calls[0]![0] as BulkOffsetConfirmSelection
    expect([...selection.clipIds].sort()).toEqual(['clipBody', 'clipHead', 'clipHeadRun'].sort())
  })

  it('select-none blocks confirm with an error', () => {
    const { spy } = setup()
    fireEvent.change(screen.getByTestId('bulk-offset-filter'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('bulk-offset-select-none'))
    fireEvent.click(screen.getByTestId('bulk-offset-channel-positionY'))
    fireEvent.change(screen.getByTestId('bulk-offset-delta-positionY'), {
      target: { value: '100' },
    })
    fireEvent.click(screen.getByTestId('bulk-offset-confirm'))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('bulk-offset-error')).toBeInTheDocument()
  })

  it('requires a non-zero finite delta', () => {
    const { spy } = setup()
    fireEvent.click(screen.getByTestId('bulk-offset-channel-positionY'))
    fireEvent.click(screen.getByTestId('bulk-offset-confirm'))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('bulk-offset-error')).toHaveTextContent('non-zero finite')
  })
})
