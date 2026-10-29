import { ApiClient } from './apiClient'

export interface ModelCapabilities {
  languages: string[]
  speakers: string[]
  instructionSupported: boolean
  downloaded?: boolean
  speakerHints?: Record<string, string>
  speakerMeta?: Record<string, { description: string; nativeLanguage: string; iso: string }>
  mode?: 'custom_voice' | 'voice_clone' | 'voice_design' | 'cartesia' | string
}

export interface CartesiaVoice {
  id: string
  name?: string | null
  language?: string | null
  description?: string | null
}

export interface CartesiaVoicesResponse {
  voices: CartesiaVoice[]
  defaultVoiceId: string
  cartesiaConfigured: boolean
}

export interface TtsModelsResponse {
  models: string[]
  providers: string[]
  defaultModel: string
  defaultProvider: string
  default_model_id?: string
  default_provider?: string
  capabilities?: Record<string, ModelCapabilities>
  perModel?: Record<string, ModelCapabilities>
  defaults?: { provider: string; modelId: string }
  downloaded?: Record<string, boolean>
  modelsStatus?: Array<{ id: string; downloaded: boolean }>
  mlxAvailable?: boolean
  reference?: { audioConfigured: boolean; textConfigured: boolean }
  cartesiaConfigured?: boolean
}

export interface TtsCapabilitiesResponse {
  models: string[]
  providers: string[]
  defaultModel: string
  defaultProvider: string
  languages: string[]
  speakers: string[]
  capabilities: Record<string, ModelCapabilities>
  perModel: Record<string, ModelCapabilities>
  per_model?: Record<string, ModelCapabilities>
  defaults: { provider: string; modelId: string }
  downloaded?: Record<string, boolean>
  modelsStatus?: Array<{ id: string; downloaded: boolean }>
  mlxAvailable?: boolean
  cartesiaConfigured?: boolean
}

export interface TtsSettings {
  provider: string
  modelId: string
  model_id?: string
  tts_provider?: string
  tts_model_id?: string
  downloaded?: Record<string, boolean>
  modelsStatus?: Array<{ id: string; downloaded: boolean }>
  mlxAvailable?: boolean
  cartesiaConfigured?: boolean
}

export class TtsSettingsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async getModels(): Promise<TtsModelsResponse> {
    return this.client.get<TtsModelsResponse>('/api/tts/models')
  }

  async getCapabilities(): Promise<TtsCapabilitiesResponse> {
    return this.client.get<TtsCapabilitiesResponse>('/api/tts/capabilities')
  }

  async getSettings(): Promise<TtsSettings> {
    return this.client.get<TtsSettings>('/api/tts/settings')
  }

  async getVoices(params?: { q?: string; limit?: number }): Promise<CartesiaVoicesResponse> {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.limit) search.set('limit', String(params.limit))
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return this.client.get<CartesiaVoicesResponse>(`/api/tts/voices${suffix}`)
  }

  async updateSettings(input: { provider?: string; modelId?: string }): Promise<TtsSettings> {
    return this.client.put<TtsSettings>('/api/tts/settings', JSON.stringify(input))
  }

  async downloadModel(
    modelId: string,
  ): Promise<{ modelId: string; downloaded: boolean; path: string }> {
    return this.client.post<{ modelId: string; downloaded: boolean; path: string }>(
      '/api/tts/models/download',
      JSON.stringify({ modelId }),
    )
  }
}
