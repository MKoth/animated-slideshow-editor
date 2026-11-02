import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PopularAudioModal } from '../components/audio/PopularAudioModal'
import { usePopularAudioStore } from '../stores/popularAudioStore'

describe('PopularAudioModal', () => {
  beforeEach(() => usePopularAudioStore.setState({ recordings: [] }))

  it('renames, inserts, and deletes independent copies', () => {
    usePopularAudioStore.getState().add({
      id: 'copy-1',
      name: 'Original copy',
      data: 'YXVkaW8=',
      mimeType: 'audio/wav',
      duration: 8,
      sourceStart: 0,
      sourceEnd: 8,
      volume: 1,
      playbackRate: 1,
      pitchSemitones: 0,
      noiseReduction: 0,
      waveformPeaks: [0.2, 0.8],
    })
    const onAdd = vi.fn()
    render(<PopularAudioModal slideId="slide-1" onClose={vi.fn()} onAdd={onAdd} />)
    fireEvent.change(screen.getByLabelText('Recording name'), { target: { value: 'Door knock' } })
    expect(usePopularAudioStore.getState().recordings[0].name).toBe('Door knock')
    fireEvent.click(screen.getByText('Add to timeline'))
    expect(onAdd).toHaveBeenCalledWith('copy-1')
    fireEvent.click(screen.getByLabelText('Delete Door knock'))
    expect(usePopularAudioStore.getState().recordings).toHaveLength(0)
  })
})
