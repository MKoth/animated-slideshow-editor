import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProportionalCopyModal } from '../components/panels/ProportionalCopyModal'
import type { ProportionalCopyDialogSelection } from '../components/panels/ProportionalCopyModal'
import type {
  ProportionalCopyDestRow,
  ProportionalCopySourceRow,
} from '../app/clipProportionalCopyAction'

const SOURCE_ROWS: ProportionalCopySourceRow[] = [
  {
    semanticName: 'head',
    clipId: 'clipHead',
    clipName: 'HeadLeft',
    duration: 8,
    channels: ['positionX', 'positionY'],
    linkedChannels: [],
    uses: 2,
  },
  {
    semanticName: 'body',
    clipId: 'clipBody',
    clipName: 'BodyLeft',
    duration: 8,
    channels: ['positionY'],
    linkedChannels: ['positionX'],
    uses: 1,
  },
]

const DEST_ROWS: ProportionalCopyDestRow[] = [
  {
    key: 'colB',
    origin: 'project',
    refId: 'colB',
    collectionName: 'TurnRight',
    category: '',
    bindingCount: 2,
  },
  {
    key: 'colC',
    origin: 'project',
    refId: 'colC',
    collectionName: 'Nod',
    category: 'gestures',
    bindingCount: 1,
  },
  {
    key: 'library:lib1',
    origin: 'library',
    refId: 'lib1',
    collectionName: 'Wave',
    category: 'gestures',
    bindingCount: 2,
  },
]

function setup(onConfirm?: (sel: ProportionalCopyDialogSelection) => string | null) {
  const spy = vi.fn(onConfirm ?? (() => null))
  render(
    <ProportionalCopyModal
      sourceCollectionName="TurnLeft"
      sourceLongestDuration={8}
      sourceRows={SOURCE_ROWS}
      destRows={DEST_ROWS}
      getPreview={(selection) => ({
        keyframeCount: selection.bindings.reduce((n, b) => n + b.channels.length, 0) * 2,
        destClipCount: selection.destProjectIds.length,
        replacedCount: 0,
        skippedLinked: 0,
        skippedMissingSemantic: 0,
        skippedMissingClip: 0,
        skippedSelf: 0,
      })}
      onClose={() => {}}
      onConfirm={spy}
    />,
  )
  return { spy }
}

describe('ProportionalCopyModal', () => {
  it('confirms the selected semantics, channels, range, dests and mode', async () => {
    const { spy } = setup()
    expect(screen.getByTestId('proportional-copy-semantic-head')).toBeInTheDocument()
    expect(screen.getByTestId('proportional-copy-semantic-body')).toBeInTheDocument()

    // narrow to a 0–4s sub-range of the 8s source
    fireEvent.change(screen.getByTestId('proportional-copy-to'), { target: { value: '4' } })
    expect(screen.getByTestId('proportional-copy-range-hint')).toHaveTextContent('0%–50%')

    // uncheck body/positionY, keep head fully checked
    fireEvent.click(
      screen.getByTestId('proportional-copy-channel-body-positionY').querySelector('input')!,
    )
    fireEvent.click(screen.getByTestId('proportional-copy-dest-colB').querySelector('input')!)
    fireEvent.click(screen.getByTestId('proportional-copy-mode-x'))

    fireEvent.click(screen.getByTestId('proportional-copy-confirm'))
    await waitFor(() => expect(spy).toHaveBeenCalledOnce())
    const selection = spy.mock.calls[0]![0] as ProportionalCopyDialogSelection
    expect(selection.fromNorm).toBe(0)
    expect(selection.toNorm).toBe(0.5)
    expect(selection.bindings).toEqual([
      { semanticName: 'head', channels: ['positionX', 'positionY'] },
    ])
    expect(selection.destProjectIds).toEqual(['colB'])
    expect(selection.destLibraryIds).toEqual([])
    expect(selection.mode).toBe('mirrorX')
  })

  it('groups destinations by category and toggles a whole category at once', async () => {
    const { spy } = setup()
    expect(screen.getByTestId('proportional-copy-dest-group-gestures')).toBeInTheDocument()
    expect(screen.getByTestId('proportional-copy-dest-group-Uncategorized')).toBeInTheDocument()

    // one checkbox on the category selects every collection inside it
    fireEvent.click(
      screen.getByTestId('proportional-copy-dest-group-gestures').querySelector('input')!,
    )
    expect(screen.getByTestId('proportional-copy-dest-group-gestures')).toHaveTextContent(
      '2/2 checked',
    )

    fireEvent.click(screen.getByTestId('proportional-copy-confirm'))
    await waitFor(() => expect(spy).toHaveBeenCalledOnce())
    const selection = spy.mock.calls[0]![0] as ProportionalCopyDialogSelection
    expect(selection.destProjectIds).toEqual(['colC'])
    expect(selection.destLibraryIds).toEqual(['lib1'])
  })

  it('marks library destinations as imported on confirm', () => {
    setup()
    expect(screen.getByText('library · imported on confirm')).toBeInTheDocument()
    expect(screen.getByText('Copy to (0 selected)')).toBeInTheDocument()
  })

  it('passes the reverse flag through and shows it in the preview', async () => {
    const { spy } = setup()
    fireEvent.click(screen.getByTestId('proportional-copy-dest-colB').querySelector('input')!)
    fireEvent.click(screen.getByTestId('proportional-copy-reverse').querySelector('input')!)
    expect(screen.getByTestId('proportional-copy-preview')).toHaveTextContent('reversed')

    fireEvent.click(screen.getByTestId('proportional-copy-confirm'))
    await waitFor(() => expect(spy).toHaveBeenCalledOnce())
    const selection = spy.mock.calls[0]![0] as ProportionalCopyDialogSelection
    expect(selection.reverse).toBe(true)
    expect(selection.destProjectIds).toEqual(['colB'])
  })

  it('blocks confirm without destinations and rejects a bad range', () => {
    const { spy } = setup()
    fireEvent.click(screen.getByTestId('proportional-copy-confirm'))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('proportional-copy-error')).toHaveTextContent('No destination')

    fireEvent.click(screen.getByTestId('proportional-copy-dest-colB').querySelector('input')!)
    fireEvent.change(screen.getByTestId('proportional-copy-from'), { target: { value: '9' } })
    fireEvent.click(screen.getByTestId('proportional-copy-confirm'))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('proportional-copy-error')).toHaveTextContent('Invalid range')
  })

  it('select-none leaves no bindings and blocks confirm', () => {
    const { spy } = setup()
    fireEvent.click(screen.getByTestId('proportional-copy-select-none'))
    fireEvent.click(screen.getByTestId('proportional-copy-dest-colB').querySelector('input')!)
    fireEvent.click(screen.getByTestId('proportional-copy-confirm'))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId('proportional-copy-error')).toHaveTextContent('Nothing selected')
  })
})
