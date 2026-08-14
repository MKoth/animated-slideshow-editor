import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadLessonCopy, importLessonFile } from '../app/lessonTransfer'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { serialize } from '../engine/lessonSerializer'
import { makeProjectWithAssets } from './engine/helpers'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

const FILE_CREATED_AT = '2026-01-01T00:00:00.000Z'
const FILE_MODIFIED_AT = '2026-01-02T00:00:00.000Z'

function makeLessonFile(name: string, options: { lessonName?: string } = {}): File {
  const engine = createEngine()
  engine.createProject({
    name: options.lessonName ?? 'Imported Lesson',
    description: 'A lesson about greetings',
    author: 'Anna',
  })
  engine.createSlide('Slide 1')
  if (!engine.project) {
    throw new Error('No project created')
  }
  const json = JSON.parse(serialize(engine.project)) as {
    project: { createdAt: string; modifiedAt: string }
  }
  json.project.createdAt = FILE_CREATED_AT
  json.project.modifiedAt = FILE_MODIFIED_AT
  return new File([JSON.stringify(json)], name, { type: 'application/json' })
}

function lessonFileId(file: File): Promise<string | undefined> {
  return file.text().then((text) => (JSON.parse(text) as { project: { id: string } }).project.id)
}

function setupEditor(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Current' })
  engine.createSlide('Old A')
  return engine
}

function stubObjectURL(): {
  createObjectURL: ReturnType<typeof vi.fn>
  revokeObjectURL: ReturnType<typeof vi.fn>
} {
  const createObjectURL = vi.fn(() => 'blob:mock-lesson')
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  })
  return { createObjectURL, revokeObjectURL }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
})

describe('importLessonFile', () => {
  it('imports a valid lesson with a fresh id and copied metadata', async () => {
    const file = makeLessonFile('lesson.lesson')
    const fileId = await lessonFileId(file)
    const engine = setupEditor()

    const result = await importLessonFile(engine, file)

    expect(result).toBe(true)
    const project = engine.project
    expect(project?.name).toBe('Imported Lesson')
    expect(project?.description).toBe('A lesson about greetings')
    expect(project?.author).toBe('Anna')
    expect(project?.createdAt).toBe(FILE_CREATED_AT)
    expect(project?.updatedAt).toBe(FILE_MODIFIED_AT)
    expect(project?.id).not.toBe(fileId)
    expect(engine.activeSlideId).toBe(project?.slides[0].id)
  })

  it('importing the same file twice yields two distinct projects', async () => {
    const file = makeLessonFile('lesson.lesson')
    const engineA = setupEditor()
    const engineB = setupEditor()

    await importLessonFile(engineA, file)
    const firstId = engineA.project?.id
    await importLessonFile(engineB, file)
    const secondId = engineB.project?.id

    expect(firstId).toBeDefined()
    expect(secondId).toBeDefined()
    expect(firstId).not.toBe(secondId)
  })

  it('never reuses the file id, so a library project sharing it is never overwritten', async () => {
    const file = makeLessonFile('lesson.lesson')
    const fileId = await lessonFileId(file)
    const engine = setupEditor()

    await importLessonFile(engine, file)

    const opened = JSON.parse(serialize(engine.project as never)) as {
      project: { id: string }
    }
    expect(opened.project.id).toBe(engine.project?.id)
    expect(opened.project.id).not.toBe(fileId)
  })

  it('reports friendly validation errors and leaves the current project untouched', async () => {
    const engine = setupEditor()
    const before = engine.toJSON()
    const corrupted = new File(['{not json'], 'broken.lesson', { type: 'application/json' })

    const result = await importLessonFile(engine, corrupted)

    expect(result).toBe(false)
    expect(engine.toJSON()).toEqual(before)
    const messages = useNotificationStore.getState().notifications.map((n) => n.message)
    expect(messages.some((message) => message.includes('Invalid lesson JSON'))).toBe(true)
  })

  it('rejects unsupported versions with a friendly message and no project change', async () => {
    const engine = setupEditor()
    const before = engine.toJSON()
    const future = new File(
      [JSON.stringify({ version: 99, project: {}, slides: [] })],
      'future.lesson',
      { type: 'application/json' },
    )

    const result = await importLessonFile(engine, future)

    expect(result).toBe(false)
    expect(engine.toJSON()).toEqual(before)
    const messages = useNotificationStore.getState().notifications.map((n) => n.message)
    expect(messages.some((message) => message.includes('unsupported version'))).toBe(true)
  })

  it('runs the missing-assets reconciliation on import', async () => {
    const { project } = makeProjectWithAssets('With Assets', [
      { name: 'Boy', definitionId: 'def-boy' },
    ])
    useAssetLibraryStore.setState({ definitions: [], loaded: true, unavailable: false })
    const file = new File([serialize(project)], 'lesson.lesson', { type: 'application/json' })
    const engine = setupEditor()

    await importLessonFile(engine, file)

    expect(useMissingAssetsStore.getState().report?.names).toEqual(['Boy'])
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(true)
  })

  it('resets playback times and selection like every open', async () => {
    const file = makeLessonFile('lesson.lesson')
    const engine = setupEditor()
    usePlaybackController.getState().setCurrentTime('stale', 4.5, 10)
    usePlaybackController.setState({ status: 'playing' })
    useSelectionStore.getState().select('node-1')

    await importLessonFile(engine, file)

    expect(usePlaybackController.getState().currentTimes).toEqual({})
    expect(usePlaybackController.getState().status).toBe('stopped')
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('works in degraded mode with the backend unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))
    const file = makeLessonFile('lesson.lesson')
    const engine = setupEditor()

    const result = await importLessonFile(engine, file)

    expect(result).toBe(true)
    expect(engine.project?.name).toBe('Imported Lesson')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

describe('downloadLessonCopy', () => {
  function anchorFromDownload(engine: Engine): HTMLAnchorElement {
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    const result = downloadLessonCopy(engine)
    expect(result).toBe(true)
    expect(appendSpy).toHaveBeenCalledTimes(1)
    return appendSpy.mock.calls[0][0] as HTMLAnchorElement
  }

  it('downloads the current project as a .lesson blob with the same JSON the backend stores', async () => {
    const { createObjectURL, revokeObjectURL } = stubObjectURL()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const engine = setupEditor()

    const anchor = anchorFromDownload(engine)

    expect(anchor.download).toBe('Current.lesson')
    expect(anchor.href).toBe('blob:mock-lesson')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(await blob.text()).toBe(serialize(engine.project as never))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-lesson')
    clickSpy.mockRestore()
  })

  it('works in degraded mode with the backend unreachable', () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))
    stubObjectURL()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const engine = setupEditor()

    const result = downloadLessonCopy(engine)

    expect(result).toBe(true)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('fails gracefully when no project is open', () => {
    stubObjectURL()
    const engine = createEngine()

    const result = downloadLessonCopy(engine)

    expect(result).toBe(false)
  })
})
