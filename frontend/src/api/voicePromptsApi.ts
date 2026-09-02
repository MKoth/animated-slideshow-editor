import { ApiClient } from './apiClient'
import type { VoicePrompt } from '../engine/ttsProvider'

export interface VoicePromptCreate {
  title: string
  instruction: string
  language?: string
  voice?: string
  params?: Record<string, unknown>
  modelId?: string
  provider?: string
}

export interface VoicePromptUpdate {
  title?: string
  instruction?: string
  language?: string | null
  voice?: string | null
  params?: Record<string, unknown> | null
  modelId?: string | null
  provider?: string | null
}

export interface VoicePromptOut extends VoicePrompt {
  readonly created_at: string
  readonly updated_at: string
}

export class VoicePromptsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async list(): Promise<VoicePromptOut[]> {
    return this.client.get<VoicePromptOut[]>('/api/voice-prompts')
  }

  async get(promptId: string): Promise<VoicePromptOut> {
    return this.client.get<VoicePromptOut>(`/api/voice-prompts/${promptId}`)
  }

  async create(input: VoicePromptCreate): Promise<VoicePromptOut> {
    return this.client.post<VoicePromptOut>('/api/voice-prompts', JSON.stringify(input))
  }

  async update(promptId: string, input: VoicePromptUpdate): Promise<VoicePromptOut> {
    return this.client.put<VoicePromptOut>(`/api/voice-prompts/${promptId}`, JSON.stringify(input))
  }

  async delete(promptId: string): Promise<void> {
    return this.client.delete(`/api/voice-prompts/${promptId}`)
  }
}
