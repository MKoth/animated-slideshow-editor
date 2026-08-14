import { useEffect, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineContextValue } from '../app/engineContext'
import { EngineProvider } from '../app/EngineProvider'
import { readShadow, recordLastSaved, writeShadow } from '../app/recoveryShadow'
import { useEngine } from '../app/useEngine'
import { RecoveryDialog } from '../components/recovery/RecoveryDialog'
import { serialize } from '../engine/lessonSerializer'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { makeProject } from './engine/helpers'

const RECOVERY_MESSAGE = /Recovered project found/

let engineValue: EngineContextValue | null = null

function Host() {
  const value = useEngine()
  const [, reRender] = useState(0)
  useEffect(() => {
    engineValue = value
    return value.engine.subscribe(() => reRender((n) => n + 1))
  }, [value])
  return (
    <>
      <RecoveryDialog />
      <span data-testid="project-name">{value.engine.project?.name ?? 'none'}</span>
    </>
  )
}

function renderHost() {
  engineValue = null
  return render(
    <EngineProvider>
      <Host />
    </EngineProvider>,
  )
}

function seedRecovery(): void {
  writeShadow(serialize(makeProject('Recovered', ['R1', 'R2'])))
  recordLastSaved(serialize(makeProject('Saved', ['S1'])))
}

beforeEach(() => {
  localStorage.clear()
  usePlaybackController.getState().reset()
  useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
})

afterEach(() => {
  localStorage.clear()
})

describe('RecoveryDialog', () => {
  it('does not appear when no shadow exists', () => {
    renderHost()

    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })

  it('does not appear when the shadow matches the last saved state', () => {
    const blob = serialize(makeProject('Saved', ['S1']))
    writeShadow(blob)
    recordLastSaved(blob)

    renderHost()

    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })

  it('appears when the shadow differs from the last saved state', () => {
    seedRecovery()

    renderHost()

    expect(screen.getByText(RECOVERY_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('Restore opens the shadow through the openProject flow and keeps the shadow', () => {
    seedRecovery()
    usePlaybackController.getState().setCurrentTime('stale-slide', 4.5, 10)
    useSelectionStore.getState().select('node-1')

    renderHost()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    const engine = engineValue!.engine
    expect(screen.getByTestId('project-name').textContent).toBe('Recovered')
    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['R1', 'R2'])
    expect(engine.activeSlideId).toBe(engine.project?.slides[0].id)
    expect(usePlaybackController.getState().currentTimes).toEqual({})
    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(readShadow()).not.toBeNull()
    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })

  it('offers recovery again after a reload following a restore without a save', () => {
    seedRecovery()

    const { unmount } = renderHost()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    unmount()

    renderHost()

    expect(screen.getByText(RECOVERY_MESSAGE)).toBeInTheDocument()
  })

  it('Discard clears the shadow and leaves the project untouched', () => {
    seedRecovery()

    renderHost()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.getByTestId('project-name').textContent).toBe('none')
    expect(readShadow()).toBeNull()
    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })

  it('appears and restores in degraded mode with the backend unreachable', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))
    seedRecovery()

    renderHost()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(screen.getByTestId('project-name').textContent).toBe('Recovered')
    expect(readShadow()).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('clears a corrupt shadow and does not offer a restore', () => {
    writeShadow('{not valid json')
    recordLastSaved('{"version":1}')

    renderHost()

    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
    expect(readShadow()).toBeNull()
  })
})
