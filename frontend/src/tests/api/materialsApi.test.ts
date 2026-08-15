import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { MaterialsApi } from '../../api/materialsApi'

describe('MaterialsApi', () => {
  const api = new MaterialsApi(new ApiClient())

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists materials with a GET request', async () => {
    const definition = { id: 'm1', name: 'Red Slime' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([definition]), { status: 200 }))

    const result = await api.listMaterials()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/materials')
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual({ headers: { Accept: 'application/json' } })
    expect(result).toEqual([definition])
  })

  it('creates a material with a JSON body', async () => {
    const definition = { id: 'm1', name: 'Red Slime' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(definition), { status: 200 }))

    const result = await api.createMaterial({
      name: 'Red Slime',
      description: 'Slimy',
      tags: ['monster'],
      parameters: [{ key: 'tint', kind: 'color', default: '#ff0000' }],
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/materials')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Red Slime',
      description: 'Slimy',
      tags: ['monster'],
      parameters: [{ key: 'tint', kind: 'color', default: '#ff0000' }],
    })
    expect(result).toEqual(definition)
  })

  it('duplicates a material by sending the source id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'm2', name: 'Red Slime Copy' }), { status: 200 }),
    )

    await api.createMaterial({ name: 'Red Slime Copy', sourceId: 'm1' })

    const init = vi.mocked(fetch).mock.calls[0][1]
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Red Slime Copy',
      description: '',
      tags: [],
      parameters: [],
      source_id: 'm1',
    })
  })

  it('renames a material with a PUT carrying the new name', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'm1', name: 'New Name' }), { status: 200 }),
    )

    await api.renameMaterial('m1', 'New Name')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/materials/m1')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'New Name' })
  })

  it('updates defaults with a PUT carrying the full fields', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'm1', name: 'Red Slime' }), { status: 200 }),
    )

    await api.updateMaterial('m1', {
      description: 'Updated',
      tags: ['new'],
      parameters: [{ key: 'tint', kind: 'color', default: '#00ff00' }],
    })

    const init = vi.mocked(fetch).mock.calls[0][1]
    expect(JSON.parse(String(init?.body))).toEqual({
      description: 'Updated',
      tags: ['new'],
      parameters: [{ key: 'tint', kind: 'color', default: '#00ff00' }],
    })
  })

  it('deletes a material with a DELETE request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))

    await api.deleteMaterial('m1')

    expect(fetch).toHaveBeenCalledWith(
      '/api/materials/m1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
