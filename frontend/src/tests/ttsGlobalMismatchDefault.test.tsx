import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TtsGlobalSettings } from '../components/settings/TtsGlobalSettings'
import { useAudioResizePreferenceStore } from '../stores/audioResizePreferenceStore'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useTtsForeignVoiceStore } from '../stores/ttsForeignVoiceStore'

const MODELS_PAYLOAD = {
  models: ['m1'],
  providers: ['auto'],
  defaultModel: 'm1',
  defaultProvider: 'auto',
  default_model_id: 'm1',
  default_provider: 'auto',
  downloaded: { m1: true },
}

const SETTINGS_PAYLOAD = {
  provider: 'auto',
  modelId: 'm1',
  model_id: 'm1',
  tts_provider: 'auto',
  tts_model_id: 'm1',
}

beforeEach(() => {
  useAudioResizePreferenceStore.setState({ preferences: { voice: null, sfx: null, music: null } })
  useAudioResizePreferenceStore.persist.clearStorage()
  useTtsForeignVoiceStore.setState({ referenceAssetId: null, referenceTranscript: '' })
  useTtsForeignVoiceStore.persist.clearStorage()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/tts/settings')) {
        return new Response(JSON.stringify(SETTINGS_PAYLOAD), { status: 200 })
      }
      if (path.startsWith('/api/assets')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(JSON.stringify(MODELS_PAYLOAD), { status: 200 })
    }),
  )
})

describe('TtsGlobalSettings default mismatch handling', () => {
  it('edits the saved voice preference used by batch TTS', async () => {
    render(<TtsGlobalSettings />)
    const select = (await screen.findByTestId('tts-global-mismatch')) as HTMLSelectElement
    expect(select.value).toBe('ask')

    fireEvent.change(select, { target: { value: 'stretch' } })
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBe('stretch')

    fireEvent.change(select, { target: { value: 'trim' } })
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBe('trim')

    fireEvent.change(select, { target: { value: 'ask' } })
    expect(useAudioResizePreferenceStore.getState().getPreference('voice')).toBeNull()

    await waitFor(() => {
      expect(screen.getByTestId('tts-global-mismatch')).toBeInTheDocument()
    })
  })
})

describe('TtsGlobalSettings Spanish voice for batch', () => {
  const SPANISH_ASSET = {
    id: 'spanish-1',
    name: 'Spanish speaker',
    description: '',
    category: 'audio',
    tags: [],
    ai_description: '',
    original_filename: 'spanish.wav',
    import_date: '',
    width: 0,
    height: 0,
    file_size: 0,
    aspect_ratio: 0,
    default_scale: 1,
    default_rotation: 0,
    pivot: { x: 0, y: 0 },
    anchors: [],
    original_url: '',
    thumbnail_url: '',
    mimeType: 'audio/wav',
  }

  it('saves a Spanish reference + transcript for batch foreign blocks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url)
        if (path.includes('/api/tts/settings')) {
          return new Response(JSON.stringify(SETTINGS_PAYLOAD), { status: 200 })
        }
        if (path.startsWith('/api/assets')) {
          return new Response(JSON.stringify([SPANISH_ASSET]), { status: 200 })
        }
        return new Response(JSON.stringify(MODELS_PAYLOAD), { status: 200 })
      }),
    )
    // Start from an empty library so the component loads the mocked asset.
    useAssetLibraryStore.setState({
      definitions: [],
      allDefinitions: [],
      loaded: false,
      loading: false,
      unavailable: false,
    })
    render(<TtsGlobalSettings />)
    const select = (await screen.findByTestId('tts-global-foreign-ref')) as HTMLSelectElement
    expect(select.value).toBe('')
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1))

    fireEvent.change(select, { target: { value: 'spanish-1' } })
    expect(useTtsForeignVoiceStore.getState().referenceAssetId).toBe('spanish-1')

    const transcript = (await screen.findByTestId(
      'tts-global-foreign-ref-transcript',
    )) as HTMLTextAreaElement
    fireEvent.change(transcript, { target: { value: 'hola mundo' } })
    expect(useTtsForeignVoiceStore.getState().referenceTranscript).toBe('hola mundo')

    // Clearing the asset drops back to the default speaker.
    fireEvent.change(select, { target: { value: '' } })
    expect(useTtsForeignVoiceStore.getState().referenceAssetId).toBeNull()
    await waitFor(() => {
      expect(screen.queryByTestId('tts-global-foreign-ref-transcript')).not.toBeInTheDocument()
    })
  })
})
