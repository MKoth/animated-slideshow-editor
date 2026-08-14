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

  it('lists projects with a GET /api/projects', async () => {
    const summaries = [
      { id: 'p-1', name: 'Spanish Lesson', lastModified: '2026-08-14T10:00:00' },
      { id: 'p-2', name: 'Maths Lesson', lastModified: '2026-08-14T11:30:00' },
    ]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(summaries), { status: 200 }))

    const result = await api.list()

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual(summaries)
  })

  it('fetches a project blob with GET /api/projects/{id} as raw text', async () => {
    const blob = '{"version":1,"project":{"name":"Lesson"}}'
    vi.mocked(fetch).mockResolvedValue(new Response(blob, { status: 200 }))

    const result = await api.get('p-1')

    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/projects/p-1')
    expect(result).toBe(blob)
  })

  it('deletes a project with DELETE /api/projects/{id}', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))

    await api.delete('p-1')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/projects/p-1')
    expect(init?.method).toBe('DELETE')
  })
})
