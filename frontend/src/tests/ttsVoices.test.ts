import { describe, expect, it } from 'vitest'
import {
  migrateStoredVoice,
  getFallbackSpeakersForModel,
  defaultSpeakerForModel,
  dropdownLabelForVoice,
  SPEAKER_HINTS,
  filterSpeakersByLanguage,
  getSpeakersForModelAndLanguage,
} from '../engine/ttsVoices'

describe('ttsVoices per-model dropdown', () => {
  it('CustomVoice has 9 canonical speakers with hints', () => {
    const speakers = getFallbackSpeakersForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16')
    expect(speakers).toHaveLength(9)
    expect(speakers).toEqual(['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'])
    // hints contain description + language
    expect(SPEAKER_HINTS['Vivian']).toBe('Bright edgy young female, Chinese')
    expect(SPEAKER_HINTS['Ryan']).toBe('Dynamic, English')
    expect(dropdownLabelForVoice('Vivian')).toBe('Vivian (Bright edgy young female, Chinese)')
    expect(dropdownLabelForVoice('Ryan')).toBe('Ryan (Dynamic, English)')
  })

  it('Base model shows Chelsie/Ethan', () => {
    const base = getFallbackSpeakersForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16')
    expect(base).toEqual(['Chelsie', 'Ethan', 'Vivian', 'Serena', 'Ryan', 'Aiden'])
    const hints = base.map((s) => `${s} (${SPEAKER_HINTS[s]})`)
    expect(hints).toContain('Chelsie (Clear female, English)')
  })

  it('legacy nova maps to Ryan', () => {
    const mig = migrateStoredVoice('nova', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'en')
    expect(mig.value).toBe('Ryan')
    expect(mig.isUnknown).toBe(false)
    const mig2 = migrateStoredVoice('NOVA', 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16', 'zh')
    expect(mig2.value).toBe('Ryan')
  })

  it('unknown voice shows warning and defaults to Ryan/Vivian per language', () => {
    const unkEn = migrateStoredVoice('foobar', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'en')
    expect(unkEn.value).toBe('')
    expect(unkEn.isUnknown).toBe(true)
    expect(unkEn.warning).toContain('Unknown voice')
    expect(unkEn.warning).toContain('Ryan')

    const unkZh = migrateStoredVoice('foobar', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'zh')
    expect(unkZh.warning).toContain('Vivian')

    const chelsieOnCustom = migrateStoredVoice('Chelsie', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'en')
    expect(chelsieOnCustom.isUnknown).toBe(true)
    expect(chelsieOnCustom.warning).toContain('not supported')
    expect(chelsieOnCustom.warning).toContain('Ryan')
  })

  it('default speaker per model and language', () => {
    expect(defaultSpeakerForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'zh')).toBe('Vivian')
    expect(defaultSpeakerForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'en')).toBe('Ryan')
    expect(defaultSpeakerForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', '')).toBe('Ryan')
    expect(defaultSpeakerForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'Chinese')).toBe('Vivian')
  })

  it('valid voice for model is case-insensitive', () => {
    const mig = migrateStoredVoice('ryan', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'en')
    expect(mig.value).toBe('Ryan')
    const mig2 = migrateStoredVoice('VIVIAN', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'zh')
    expect(mig2.value).toBe('Vivian')
  })

  it('strict native filter by language', () => {
    const base = getFallbackSpeakersForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16')
    expect(filterSpeakersByLanguage(base, 'zh').filtered).toEqual(['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric'])
    expect(filterSpeakersByLanguage(base, 'en').filtered).toEqual(['Ryan', 'Aiden'])
    expect(filterSpeakersByLanguage(base, 'ja').filtered).toEqual(['Ono_Anna'])
    expect(filterSpeakersByLanguage(base, 'ko').filtered).toEqual(['Sohee'])
    expect(filterSpeakersByLanguage(base, '').filtered).toHaveLength(9)
    expect(filterSpeakersByLanguage(base, null).filtered).toHaveLength(9)
    // no native for es -> shows all with isExact false
    const es = filterSpeakersByLanguage(base, 'es')
    expect(es.filtered).toHaveLength(9)
    expect(es.isExact).toBe(false)
    // Base model filtering
    const baseSpeakers = getFallbackSpeakersForModel('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16')
    expect(filterSpeakersByLanguage(baseSpeakers, 'zh').filtered).toEqual(['Vivian', 'Serena'])
    expect(filterSpeakersByLanguage(baseSpeakers, 'en').filtered).toEqual(['Chelsie', 'Ethan', 'Ryan', 'Aiden'])
    expect(filterSpeakersByLanguage(baseSpeakers, 'ja').filtered).toHaveLength(6) // no native -> all
    expect(filterSpeakersByLanguage(baseSpeakers, 'ja').isExact).toBe(false)
  })

  it('getSpeakersForModelAndLanguage combines model and language', () => {
    const { speakers, isExact } = getSpeakersForModelAndLanguage(
      'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16',
      'zh',
    )
    expect(speakers).toEqual(['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric'])
    expect(isExact).toBe(true)
    const es = getSpeakersForModelAndLanguage('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', 'es')
    expect(es.speakers).toHaveLength(9)
    expect(es.isExact).toBe(false)
    const auto = getSpeakersForModelAndLanguage('mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16', '')
    expect(auto.speakers).toHaveLength(9)
    expect(auto.isExact).toBe(true)
  })
})
