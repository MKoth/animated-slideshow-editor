import { describe, expect, it } from 'vitest'
import { parseWavHeader, wavDurationFromBytes } from '../engine/ttsProvider'
import {
  CARTESIA_LANGUAGE_OPTIONS,
  isCartesiaLanguageCode,
  migrateStoredCartesiaLanguage,
} from '../engine/ttsLanguages'
import {
  CARTESIA_MODEL_ID,
  DEFAULT_CARTESIA_VOICE_ID,
  SUPPORTED_MODELS,
  SUPPORTED_PROVIDERS,
  getFallbackCapabilities,
  isCartesiaModel,
  isCartesiaProvider,
} from '../engine/ttsRegistry'
import { getModelMode, isCartesiaModel as isCartesiaModelByVoice } from '../engine/ttsVoices'

describe('cartesia remote TTS wiring', () => {
  it('registry lists cartesia provider and sonic-3.6 model', () => {
    expect(SUPPORTED_PROVIDERS).toContain('cartesia')
    expect(SUPPORTED_MODELS).toContain('sonic-3.6')
    expect(CARTESIA_MODEL_ID).toBe('sonic-3.6')
    expect(DEFAULT_CARTESIA_VOICE_ID).toBe('f6184e65-98f2-4e3d-84e5-a2eb198b8688')
  })

  it('model mode routes sonic-3.6 to cartesia', () => {
    expect(getModelMode('sonic-3.6')).toBe('cartesia')
    expect(isCartesiaModel('sonic-3.6')).toBe(true)
    expect(isCartesiaModelByVoice('sonic-3.6')).toBe(true)
    expect(isCartesiaModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16')).toBe(false)
    expect(getModelMode('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16')).toBe('voice_clone')
  })

  it('provider check is case-insensitive', () => {
    expect(isCartesiaProvider('cartesia')).toBe(true)
    expect(isCartesiaProvider('  Cartesia ')).toBe(true)
    expect(isCartesiaProvider('auto')).toBe(false)
    expect(isCartesiaProvider(null)).toBe(false)
    expect(isCartesiaProvider(undefined)).toBe(false)
  })

  it('fallback capabilities for sonic-3.6 are remote (no speakers/download, no instruction)', () => {
    const caps = getFallbackCapabilities('sonic-3.6')
    expect(caps.mode).toBe('cartesia')
    expect(caps.speakers).toEqual([])
    expect(caps.instructionSupported).toBe(false)
    expect(caps.languages).toHaveLength(44)
    expect(caps.languages).toContain('hi')
    expect(caps.languages).toContain('ur')
  })

  it('cartesia language options are Auto + 44 with labels', () => {
    expect(CARTESIA_LANGUAGE_OPTIONS).toHaveLength(45)
    expect(CARTESIA_LANGUAGE_OPTIONS[0]).toEqual({ value: '', label: 'Auto' })
    const byValue = Object.fromEntries(CARTESIA_LANGUAGE_OPTIONS.map((o) => [o.value, o.label]))
    expect(byValue['en']).toBe('English (en)')
    expect(byValue['hi']).toBe('Hindi (hi)')
    expect(byValue['ur']).toBe('Urdu (ur)')
  })

  it('cartesia language codes accept locale forms, reject unknown', () => {
    expect(isCartesiaLanguageCode('en')).toBe(true)
    expect(isCartesiaLanguageCode('en-US')).toBe(true)
    expect(isCartesiaLanguageCode('hi')).toBe(true)
    expect(isCartesiaLanguageCode('xx')).toBe(false)
    expect(isCartesiaLanguageCode('')).toBe(false)
  })

  it('stored cartesia language migrates or falls back to Auto', () => {
    expect(migrateStoredCartesiaLanguage('hi').value).toBe('hi')
    expect(migrateStoredCartesiaLanguage('en-US').value).toBe('en')
    expect(migrateStoredCartesiaLanguage('').value).toBe('')
    expect(migrateStoredCartesiaLanguage(null).value).toBe('')
    const bad = migrateStoredCartesiaLanguage('xx')
    expect(bad.value).toBe('')
    expect(bad.isUnknown).toBe(true)
    expect(bad.warning).toContain('Cartesia')
  })

  it('parses Cartesia streaming-style WAV (LIST chunk, data size 0xFFFFFFFF)', () => {
    // Cartesia /tts/bytes returns: fmt(16) + LIST(26) + data(0xFFFFFFFF) + pcm.
    // The parser must clamp data to EOF instead of bailing to the text heuristic.
    const sampleRate = 44100
    const channels = 1
    const seconds = 2
    const dataSize = sampleRate * channels * 2 * seconds
    const total = 12 + 8 + 16 + 8 + 26 + 8 + dataSize
    const buffer = new ArrayBuffer(total)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    const write = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
    }
    write(0, 'RIFF')
    view.setUint32(4, 0xffffffff, true)
    write(8, 'WAVE')
    write(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channels * 2, true)
    view.setUint16(32, channels * 2, true)
    view.setUint16(34, 16, true)
    let off = 12 + 8 + 16
    write(off, 'LIST')
    view.setUint32(off + 4, 26, true)
    off += 8 + 26
    write(off, 'data')
    view.setUint32(off + 4, 0xffffffff, true)

    const parsed = parseWavHeader(bytes)
    expect(parsed).not.toBeNull()
    expect(parsed!.sampleRate).toBe(sampleRate)
    expect(parsed!.channels).toBe(channels)
    expect(parsed!.duration).toBeCloseTo(seconds, 5)
    expect(wavDurationFromBytes(bytes)).toBeCloseTo(seconds, 5)
  })
})
