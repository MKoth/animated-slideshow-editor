import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/apiClient'
import { createPersistenceService } from '../app/persistence'
import type { PersistenceDeps } from '../app/persistence'
import { serialize } from '../engine/lessonSerializer'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { useBackendStore } from '../stores/backendStore'
import { usePersistenceStore } from '../stores/persistenceStore'
import { makeProject } from './engine/helpers'

function engineWithProject(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  return engine
}

function createService(overrides: Partial<PersistenceDeps> = {}) {
  const upsert = vi.fn().mockResolvedValue({ id: 'p-1' })
  const notify = vi.fn()
  const engine = engineWithProject()
  const service = createPersistenceService({
    engine,
    upsert,
    notify,
    ...overrides,
  })
  return { service, engine, upsert, notify }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createPersistenceService', () => {
  beforeEach(() => {
    useBackendStore.setState({ status: 'available' })
    usePersistenceStore.setState({ dirty: false })
  })

  afterEach(() => {
    useBackendStore.setState({ status: 'checking' })
    usePersistenceStore.setState({ dirty: false })
  })

  it('serializes the current project and posts it on save, clearing the dirty flag', async () => {
    const { service, engine, upsert } = createService()

    service.save()
    await flushAsync()

    expect(upsert).toHaveBeenCalledWith(serialize(engine.project!))
    expect(usePersistenceStore.getState().dirty).toBe(false)
    expect(useBackendStore.getState().status).toBe('available')
  })

  it('does nothing when there is no project to save', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'p-1' })
    const service = createPersistenceService({
      engine: createEngine(),
      upsert,
    })

    service.save()
    await flushAsync()

    expect(upsert).not.toHaveBeenCalled()
  })

  it('notifies and marks the backend unavailable when a save fails to reach it', async () => {
    const { service, notify } = createService({
      upsert: vi.fn().mockRejectedValue(new TypeError('connection refused')),
    })
    usePersistenceStore.getState().markDirty()

    service.save()
    await flushAsync()

    expect(notify).toHaveBeenCalledWith('Save failed — backend unavailable.')
    expect(useBackendStore.getState().status).toBe('unavailable')
    expect(usePersistenceStore.getState().dirty).toBe(true)
  })

  it('notifies on a rejected save without marking the backend unavailable', async () => {
    const { service, notify } = createService({
      upsert: vi.fn().mockRejectedValue(new ApiError('bad blob', 400, '/api/projects')),
    })

    service.save()
    await flushAsync()

    expect(notify).toHaveBeenCalledWith('Save failed.')
    expect(useBackendStore.getState().status).toBe('available')
  })

  it('restores backend availability after a successful save', async () => {
    useBackendStore.getState().markUnavailable()
    const { service } = createService()

    service.save()
    await flushAsync()

    expect(useBackendStore.getState().status).toBe('available')
  })

  it('marks the project dirty on a successful command and autosaves, clearing it', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()

      service.onCommandSucceeded()
      expect(usePersistenceStore.getState().dirty).toBe(true)

      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).toHaveBeenCalledTimes(1)
      expect(usePersistenceStore.getState().dirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces rapid commands into a single autosave', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()

      service.onCommandSucceeded()
      service.onCommandSucceeded()
      service.onCommandSucceeded()
      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).toHaveBeenCalledTimes(1)
      expect(usePersistenceStore.getState().dirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('autosaves a dirty project on the 30-second timer and skips a clean one', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()

      service.onCommandSucceeded()
      await vi.advanceTimersByTimeAsync(0)
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(usePersistenceStore.getState().dirty).toBe(false)

      await vi.advanceTimersByTimeAsync(30000)
      expect(upsert).toHaveBeenCalledTimes(1)

      usePersistenceStore.getState().markDirty()
      await vi.advanceTimersByTimeAsync(30000)

      expect(upsert).toHaveBeenCalledTimes(2)
      expect(usePersistenceStore.getState().dirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not autosave while the backend is unavailable', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()
      useBackendStore.getState().markUnavailable()

      service.onCommandSucceeded()
      expect(usePersistenceStore.getState().dirty).toBe(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).not.toHaveBeenCalled()
      expect(usePersistenceStore.getState().dirty).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not autosave while the backend availability is unknown', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()
      useBackendStore.setState({ status: 'checking' })

      service.onCommandSucceeded()
      await vi.advanceTimersByTimeAsync(0)
      expect(upsert).not.toHaveBeenCalled()

      useBackendStore.getState().markAvailable()
      service.onCommandSucceeded()
      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).toHaveBeenCalledTimes(1)
      expect(usePersistenceStore.getState().dirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a save completing after the project is opened does not clear the new dirty flag', async () => {
    vi.useFakeTimers()
    try {
      const resolveFirst = vi.fn()
      const upsert = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFirst.mockImplementation(() => resolve({ id: 'p-1' }))
          }),
      )
      const { service, engine } = createService({ upsert })

      service.save()
      engine.openProject(makeProject('New', ['N1']))
      usePersistenceStore.getState().markDirty()
      resolveFirst()
      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).toHaveBeenCalledTimes(1)
      expect(usePersistenceStore.getState().dirty).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('autosaves again once the backend recovers', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()
      useBackendStore.getState().markUnavailable()

      service.onCommandSucceeded()
      expect(usePersistenceStore.getState().dirty).toBe(true)
      await vi.advanceTimersByTimeAsync(30000)
      expect(upsert).not.toHaveBeenCalled()

      service.save()
      await vi.advanceTimersByTimeAsync(0)
      expect(useBackendStore.getState().status).toBe('available')
      expect(usePersistenceStore.getState().dirty).toBe(false)

      usePersistenceStore.getState().markDirty()
      await vi.advanceTimersByTimeAsync(30000)

      expect(upsert).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the dirty flag when a new project is opened', async () => {
    const { service, engine } = createService()
    service.onCommandSucceeded()
    expect(usePersistenceStore.getState().dirty).toBe(true)

    engine.openProject(makeProject('New', ['N1']))

    expect(usePersistenceStore.getState().dirty).toBe(false)
  })

  it('cancels a pending autosave when a new project is opened', async () => {
    vi.useFakeTimers()
    try {
      const { service, engine, upsert } = createService()

      service.onCommandSucceeded()
      engine.openProject(makeProject('New', ['N1']))
      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('edits during an in-flight save trigger exactly one follow-up save', async () => {
    vi.useFakeTimers()
    try {
      const resolveFirst = vi.fn()
      const upsert = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFirst.mockImplementation(() => resolve({ id: 'p-1' }))
          }),
      )
      const { service } = createService({ upsert })

      service.save()
      service.onCommandSucceeded()
      await vi.advanceTimersByTimeAsync(0)
      expect(upsert).toHaveBeenCalledTimes(1)

      resolveFirst()
      await vi.advanceTimersByTimeAsync(0)

      expect(upsert).toHaveBeenCalledTimes(2)
      expect(usePersistenceStore.getState().dirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the 30-second timer once disposed', async () => {
    vi.useFakeTimers()
    try {
      const { service, upsert } = createService()

      service.onCommandSucceeded()
      await vi.advanceTimersByTimeAsync(0)
      expect(upsert).toHaveBeenCalledTimes(1)

      service.dispose()
      usePersistenceStore.getState().markDirty()
      await vi.advanceTimersByTimeAsync(30000)

      expect(upsert).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
