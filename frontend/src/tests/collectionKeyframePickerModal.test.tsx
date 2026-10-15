import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollectionKeyframePickerModal } from '../components/panels/CollectionKeyframePickerModal'

describe('CollectionKeyframePickerModal', () => {
  it('shows collection names and timeline ranges and attaches to the chosen placement', () => {
    const onAttach = vi.fn()
    render(
      <CollectionKeyframePickerModal
        choices={[
          { placementId: 'placement-a', name: 'Jump', start: 1, end: 2.5 },
          { placementId: 'placement-b', name: 'Walk', start: 4, end: 6 },
        ]}
        onClose={vi.fn()}
        onAttach={onAttach}
      />,
    )

    const picker = screen.getByRole('combobox', { name: 'Collection' })
    expect(picker).toHaveTextContent('Jump (1.00–2.50s)')
    expect(picker).toHaveTextContent('Walk (4.00–6.00s)')
    fireEvent.change(picker, { target: { value: 'placement-b' } })
    fireEvent.click(screen.getByTestId('confirm-collection-attachment'))

    expect(onAttach).toHaveBeenCalledWith('placement-b', false)
  })

  it('offers delete-or-keep when changing or removing an existing attachment', () => {
    const onAttach = vi.fn()
    render(
      <CollectionKeyframePickerModal
        choices={[{ placementId: 'placement-a', name: 'Jump', start: 1, end: 2.5 }]}
        hasAttachedKeyframes
        initialPlacementId="placement-a"
        onClose={vi.fn()}
        onAttach={onAttach}
      />,
    )

    fireEvent.click(screen.getByLabelText('Delete attached keyframes'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Collection' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByTestId('confirm-collection-attachment'))

    expect(onAttach).toHaveBeenCalledWith('', true)
  })
})
