import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { ProjectsApi } from '../../api/projectsApi'

describe('ProjectsApi', () => {
  const api = new ProjectsApi(new ApiClient())

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the serialized blob to /api/projects as JSON', async () => {
    const metadata = { id: 'p-1', name: 'Lesson' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(metadata), { status: 200 }))

    await api.upsert('{"version":1}')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init?.body).toBe('{"version":1}')
  })

  it('returns the stored project metadata from the response', async () => {
    const metadata = {
      id: 'p-1',
      name: 'Lesson',
      description: '',
      author: '',
      created: '2026-08-14T10:00:00',
      lastModified: '2026-08-14T10:00:00',
      version: 1,
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(metadata), { status: 200 }))

    const result = await api.upsert('{}')

    expect(result).toEqual(metadata)
  })

  it('rejects when the backend refuses the blob', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: 'unsupported version' }), { status: 400 }),
    )

    await expect(api.upsert('{"version":9}')).rejects.toThrow(/status 400/)
  })
})
