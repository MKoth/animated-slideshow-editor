import { ApiClient } from './apiClient'

export interface ClipParamDef {
  key: string
  label: string
  kind: string
  default: number
}

export interface ClipChannelDefApi {
  property: string
  paramKey?: string
  linkMode?: string
}

export interface ClipLibraryEntry {
  id: string
  name: string
  duration: number
  category: string | null
  params: ClipParamDef[]
  channels: ClipChannelDefApi[]
  channelAnimations: Record<string, Record<string, unknown>> | null
  created_at: string
  updated_at: string
}

export interface ClipCreateInput {
  id: string
  name: string
  duration: number
  category?: string | null
  params?: ClipParamDef[]
  channels?: ClipChannelDefApi[]
  channelAnimations?: Record<string, Record<string, unknown>> | null
}

export interface ClipUpdateInput {
  name?: string
  duration?: number
  category?: string | null
  params?: ClipParamDef[]
  channels?: ClipChannelDefApi[]
  channelAnimations?: Record<string, Record<string, unknown>> | null
}

export class ClipsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async listClips(): Promise<ClipLibraryEntry[]> {
    return this.client.get<ClipLibraryEntry[]>('/api/clips/library')
  }

  async getClip(clipId: string): Promise<ClipLibraryEntry> {
    return this.client.get<ClipLibraryEntry>(`/api/clips/library/${clipId}`)
  }

  async createClip(input: ClipCreateInput): Promise<ClipLibraryEntry> {
    return this.client.post<ClipLibraryEntry>(
      '/api/clips/library',
      JSON.stringify({
        id: input.id,
        name: input.name,
        duration: input.duration,
        category: input.category ?? null,
        params: input.params ?? [],
        channels: input.channels ?? [],
        channel_animations: input.channelAnimations ?? null,
      }),
    )
  }

  async updateClip(clipId: string, input: ClipUpdateInput): Promise<ClipLibraryEntry> {
    const body: Record<string, unknown> = {}
    if (input.name !== undefined) body.name = input.name
    if (input.duration !== undefined) body.duration = input.duration
    if (input.category !== undefined) body.category = input.category
    if (input.params !== undefined) body.params = input.params
    if (input.channels !== undefined) body.channels = input.channels
    if (input.channelAnimations !== undefined) body.channel_animations = input.channelAnimations
    return this.client.put<ClipLibraryEntry>(`/api/clips/library/${clipId}`, JSON.stringify(body))
  }

  async deleteClip(clipId: string): Promise<void> {
    return this.client.delete(`/api/clips/library/${clipId}`)
  }
}
