import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { ShadersApi } from '../../api/shadersApi'

describe('ShadersApi', () => {
  const api = new ShadersApi(new ApiClient())

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists shaders with a GET request', async () => {
    const definition = { id: 's1', name: 'Ink Wash' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([definition]), { status: 200 }))

    const result = await api.listShaders()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/shaders')
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual({ headers: { Accept: 'application/json' } })
    expect(result).toEqual([definition])
  })

  it('imports a shader with a multipart POST carrying the file and metadata', async () => {
    const definition = { id: 's1', name: 'Ink Wash' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(definition), { status: 200 }))
    const file = new File(['#version 300 es\n'], 'wash.glsl', { type: 'text/plain' })

    const result = await api.importShader(file, { name: 'Ink Wash', tags: ['art'] })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/shaders/import')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ Accept: 'application/json' })
    const body = init?.body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.get('name')).toBe('Ink Wash')
    expect(body.get('tags')).toBe('art')
    expect(result).toEqual(definition)
  })

  it('re-uploads the source with a multipart PUT preserving the id', async () => {
    const definition = { id: 's1', name: 'Ink Wash' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(definition), { status: 200 }))
    const file = new File(['#version 300 es\n'], 'wash.glsl', { type: 'text/plain' })

    const result = await api.reuploadSource('s1', file)

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/shaders/s1/source')
    expect(init?.method).toBe('PUT')
    expect((init?.body as FormData).get('file')).toBe(file)
    expect(result).toEqual(definition)
  })

  it('renames a shader with a PUT carrying the new name', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 's1', name: 'New Name' }), { status: 200 }),
    )

    await api.renameShader('s1', 'New Name')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/shaders/s1')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'New Name' })
  })

  it('duplicates a shader by posting the source id and new name', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 's2', name: 'Ink Wash Copy' }), { status: 200 }),
    )

    await api.duplicateShader('s1', 'Ink Wash Copy')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/shaders/duplicate')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Ink Wash Copy', source_id: 's1' })
  })

  it('deletes a shader with a DELETE request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))

    await api.deleteShader('s1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/shaders/s1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('updates uniform defaults with a PUT carrying the uniforms', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 's1', name: 'Ink Wash' }), { status: 200 }),
    )

    await api.updateUniformDefaults('s1', [
      { key: 'uIntensity', kind: 'float', default: 0.5 },
      { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
    ])

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/shaders/s1/uniforms')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      default_uniforms: [
        { key: 'uIntensity', kind: 'float', default: 0.5 },
        { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
      ],
    })
  })
})
