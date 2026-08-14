import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '../api'
import {
  createAndOpenFreshProject,
  deleteLibraryProject,
  formatLastModified,
  openLibraryProject,
  refreshProjects,
} from '../app/projectBrowser'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { serialize } from '../engine/lessonSerializer'
import { makeProjectWithAssets } from './engine/helpers'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'
import { useSelectionStore } from '../stores/selectionStore'

const SUMMARY_1: ProjectSummary = {
  id: 'p-1',
  name: 'Spanish Lesson',
  lastModified: '2026-08-14T10:00:00',
}
const SUMMARY_2: ProjectSummary = {
  id: 'p-2',
  name: 'Maths Lesson',
  lastModified: '2026-08-14T11:30:00',
}

function stubProjects(list: ProjectSummary[], blobs: Record<string, string>): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    if (String(input) === '/api/projects') {
      return Promise.resolve(new Response(JSON.stringify(list), { status: 200 }))
    }
    const match = /^\/api\/projects\/([^/]+)$/.exec(String(input))
    if (match) {
      const blob = blobs[match[1]]
      if (blob === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }),
        )
      }
      return Promise.resolve(new Response(blob, { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
  })
}

function makeBlob(name: string): string {
  const engine = createEngine()
  engine.createProject({ name })
  engine.createSlide('Slide 1')
  if (!engine.project) {
    throw new Error('No project created')
  }
  return serialize(engine.project)
}

function setupEditor(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Current' })
  engine.createSlide('Old A')
  return engine
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useProjectBrowserStore.setState({ projects: [], loading: false, error: null })
  useNotificationStore.setState({ notifications: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false })
  useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
  usePlaybackController.setState({
    currentTimes: {},
    status: 'stopped',
    playbackSpeed: 1,
    loopEnabled: false,
  })
  useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  usePlaybackController.getState().reset()
})

describe('formatLastModified', () => {
  it('formats the backend timestamp as a locale-independent date and time', () => {
    expect(formatLastModified('2026-08-14T10:00:00')).toBe('2026-08-14 10:00')
    expect(formatLastModified('2026-08-14T10:00:00.000')).toBe('2026-08-14 10:00')
  })
})

describe('refreshProjects', () => {
  it('loads the library list into the browser store', async () => {
    stubProjects([SUMMARY_1, SUMMARY_2], {})

    await refreshProjects()

    expect(useProjectBrowserStore.getState().projects).toEqual([SUMMARY_1, SUMMARY_2])
    expect(useProjectBrowserStore.getState().loading).toBe(false)
    expect(useProjectBrowserStore.getState().error).toBeNull()
  })

  it('reports the failure in the store when the fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))

    await refreshProjects()

    const state = useProjectBrowserStore.getState()
    expect(state.projects).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).not.toBeNull()
  })
})

describe('openLibraryProject', () => {
  it('loads the project through the openProject flow and reports success', async () => {
    stubProjects([SUMMARY_1], { 'p-1': makeBlob('Spanish Lesson') })
    const engine = setupEditor()

    const result = await openLibraryProject(engine, 'p-1')

    expect(result).toBe(true)
    expect(engine.project?.name).toBe('Spanish Lesson')
    expect(engine.activeSlideId).toBe(engine.project?.slides[0].id)
  })

  it('runs the missing-assets reconciliation on open', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Current' })
    const { project } = makeProjectWithAssets('With Assets', [
      { name: 'Boy', definitionId: 'def-boy' },
    ])
    useAssetLibraryStore.setState({ definitions: [], loaded: true, unavailable: false })
    stubProjects([SUMMARY_1], { 'p-1': serialize(project) })

    await openLibraryProject(engine, 'p-1')

    expect(useMissingAssetsStore.getState().report?.names).toEqual(['Boy'])
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(true)
  })

  it('resets playback times and selection like every open', async () => {
    stubProjects([SUMMARY_1], { 'p-1': makeBlob('Spanish Lesson') })
    const engine = setupEditor()
    usePlaybackController.getState().setCurrentTime('stale', 4.5, 10)
    usePlaybackController.setState({ status: 'playing' })
    useSelectionStore.getState().select('node-1')

    await openLibraryProject(engine, 'p-1')

    expect(usePlaybackController.getState().currentTimes).toEqual({})
    expect(usePlaybackController.getState().status).toBe('stopped')
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('fails gracefully on an invalid blob, leaving the editor untouched', async () => {
    stubProjects([SUMMARY_1], { 'p-1': '{not json' })
    const engine = setupEditor()
    const before = engine.toJSON()

    const result = await openLibraryProject(engine, 'p-1')

    expect(result).toBe(false)
    expect(engine.toJSON()).toEqual(before)
    expect(useNotificationStore.getState().notifications.length).toBeGreaterThan(0)
  })

  it('fails gracefully when the backend cannot fetch the project', async () => {
    stubProjects([SUMMARY_1], {})
    const engine = setupEditor()

    const result = await openLibraryProject(engine, 'missing')

    expect(result).toBe(false)
    expect(engine.project?.name).toBe('Current')
  })
})

describe('deleteLibraryProject', () => {
  it('deletes the backend record and removes the row from the list', async () => {
    stubProjects([SUMMARY_1, SUMMARY_2], {})
    await refreshProjects()
    const calls: string[] = []
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.method ?? 'GET'))
      return Promise.resolve(new Response(null, { status: 204 }))
    })
    const result = await deleteLibraryProject('p-1')

    expect(result).toBe(true)
    expect(calls).toEqual(['DELETE'])
    expect(useProjectBrowserStore.getState().projects).toEqual([SUMMARY_2])
  })

  it('keeps the row and notifies when the delete fails', async () => {
    stubProjects([SUMMARY_1], {})
    await refreshProjects()
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }))

    const result = await deleteLibraryProject('p-1')

    expect(result).toBe(false)
    expect(useProjectBrowserStore.getState().projects).toEqual([SUMMARY_1])
    expect(useNotificationStore.getState().notifications.length).toBeGreaterThan(0)
  })
})

describe('createAndOpenFreshProject', () => {
  it('creates a fresh project with one Slide 1 and opens it through the openProject flow', async () => {
    const engine = setupEditor()

    const result = createAndOpenFreshProject(engine, 'Untitled lesson')

    expect(result).toBe(true)
    expect(engine.project?.name).toBe('Untitled lesson')
    expect(engine.project?.slides).toHaveLength(1)
    expect(engine.project?.slides[0].name).toBe('Slide 1')
    expect(engine.activeSlideId).toBe(engine.project?.slides[0].id)
  })
})
