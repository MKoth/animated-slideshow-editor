import { useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineContextValue } from '../app/engineContext'
import { EngineProvider } from '../app/EngineProvider'
import {
  clearRecoveryStorage,
  readShadow,
  recordLastSaved,
  writeShadow,
} from '../app/recoveryShadow'
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

async function seedRecovery(): Promise<void> {
  await writeShadow(serialize(makeProject('Recovered', ['R1', 'R2'])))
  await recordLastSaved(serialize(makeProject('Saved', ['S1'])))
}

beforeEach(async () => {
  await clearRecoveryStorage()
  usePlaybackController.getState().reset()
  useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
})

afterEach(async () => {
  await clearRecoveryStorage()
})

describe('RecoveryDialog', () => {
  it('does not appear when no shadow exists', async () => {
    renderHost()

    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
    await screen.findByTestId('project-name')
  })

  it('does not appear when the shadow matches the last saved state', async () => {
    const blob = serialize(makeProject('Saved', ['S1']))
    await writeShadow(blob)
    await recordLastSaved(blob)

    renderHost()

    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
    await screen.findByTestId('project-name')
  })

  it('appears when the shadow differs from the last saved state', async () => {
    await seedRecovery()

    renderHost()

    expect(await screen.findByText(RECOVERY_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('Restore opens the shadow through the openProject flow and keeps the shadow', async () => {
    await seedRecovery()
    usePlaybackController.getState().setCurrentTime('stale-slide', 4.5, 10)
    useSelectionStore.getState().select('node-1')

    renderHost()
    await screen.findByText(RECOVERY_MESSAGE)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    const engine = engineValue!.engine
    expect(screen.getByTestId('project-name').textContent).toBe('Recovered')
    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['R1', 'R2'])
    expect(engine.activeSlideId).toBe(engine.project?.slides[0].id)
    expect(usePlaybackController.getState().currentTimes).toEqual({})
    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(await readShadow()).not.toBeNull()
    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })

  it('offers recovery again after a reload following a restore without a save', async () => {
    await seedRecovery()

    const { unmount } = renderHost()
    await screen.findByText(RECOVERY_MESSAGE)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    unmount()

    renderHost()

    expect(await screen.findByText(RECOVERY_MESSAGE)).toBeInTheDocument()
  })

  it('Discard clears the shadow and leaves the project untouched', async () => {
    await seedRecovery()

    renderHost()
    await screen.findByText(RECOVERY_MESSAGE)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.getByTestId('project-name').textContent).toBe('none')
    expect(await readShadow()).toBeNull()
    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })

  it('appears and restores in degraded mode with the backend unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))
    await seedRecovery()

    renderHost()
    await screen.findByText(RECOVERY_MESSAGE)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(screen.getByTestId('project-name').textContent).toBe('Recovered')
    expect(await readShadow()).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('clears a corrupt shadow and does not offer a restore', async () => {
    await writeShadow('{not valid json')
    await recordLastSaved('{"version":1}')

    renderHost()

    await waitFor(async () => {
      expect(await readShadow()).toBeNull()
    })
    expect(screen.queryByText(RECOVERY_MESSAGE)).not.toBeInTheDocument()
  })
})
