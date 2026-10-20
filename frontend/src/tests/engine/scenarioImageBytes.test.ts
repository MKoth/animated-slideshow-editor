import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  imageBytesToDataUrl,
  resolveScenarioImageBytes,
  uint8ArrayToBase64,
} from '../../engine/scenarioImageBytes'

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

const PNG_BYTES = [137, 80, 78, 71, 1, 2, 3]

describe('resolveScenarioImageBytes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves embedded snapshots without fetching', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([9]).buffer))
    vi.stubGlobal('fetch', fetchSpy)
    const resolved = await resolveScenarioImageBytes(
      ['young-doctor-smiling'],
      { 'young-doctor-smiling': 'emb-doctor' },
      new Map([
        ['emb-doctor', { data: toBase64(PNG_BYTES), mimeType: 'image/png', name: 'doctor.png' }],
      ]),
      new Map(),
    )
    expect([...resolved['young-doctor-smiling']!.bytes]).toEqual(PNG_BYTES)
    expect(resolved['young-doctor-smiling']!.mime).toBe('image/png')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws on a missing binding instead of shipping a broken ref', async () => {
    await expect(
      resolveScenarioImageBytes(['ghost-key'], {}, new Map(), new Map()),
    ).rejects.toThrow('missing a binding for asset "ghost-key"')
  })

  it('throws when a library binding has no retrievable bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )
    await expect(
      resolveScenarioImageBytes(
        ['young-doctor-smiling'],
        { 'young-doctor-smiling': 'def-doctor' },
        new Map(),
        new Map([['def-doctor', { mime: 'image/png', filenameHint: 'Doctor.png' }]]),
      ),
    ).rejects.toThrow('missing image bytes for asset "young-doctor-smiling"')
  })

  it('fetches library originals and reports the mime', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(PNG_BYTES), { status: 200 })),
    )
    const resolved = await resolveScenarioImageBytes(
      ['young-doctor-smiling'],
      { 'young-doctor-smiling': 'def-doctor' },
      new Map(),
      new Map([['def-doctor', { mime: 'image/png', url: 'https://cdn.example/doctor.png' }]]),
    )
    expect([...resolved['young-doctor-smiling']!.bytes]).toEqual(PNG_BYTES)
    expect(resolved['young-doctor-smiling']!.mime).toBe('image/png')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('https://cdn.example/doctor.png')
  })

  it('round-trips bytes through base64 data URIs', () => {
    const bytes = new Uint8Array(PNG_BYTES)
    const url = imageBytesToDataUrl(bytes, 'image/png')
    expect(url).toBe(`data:image/png;base64,${toBase64(PNG_BYTES)}`)
    expect(uint8ArrayToBase64(bytes)).toBe(toBase64(PNG_BYTES))
  })
})
