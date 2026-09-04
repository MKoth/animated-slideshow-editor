import { ApiClient } from './apiClient'

export interface ClipCollectionLibraryEntry {
  id: string
  name: string
  bindings: Record<string, string>
  source_node_id: string | null
  clips?: Record<string, unknown>[] | null
  created_at: string
  updated_at: string
}

export interface ClipCollectionCreateInput {
  id: string
  name: string
  bindings: Record<string, string>
  source_node_id?: string | null
  clips?: Record<string, unknown>[] | null
}

export interface ClipCollectionUpdateInput {
  name?: string
  bindings?: Record<string, string>
  source_node_id?: string | null
  clips?: Record<string, unknown>[] | null
}

export class ClipCollectionsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async listCollections(): Promise<ClipCollectionLibraryEntry[]> {
    return this.client.get<ClipCollectionLibraryEntry[]>('/api/clip-collections/library')
  }

  async getCollection(collectionId: string): Promise<ClipCollectionLibraryEntry> {
    return this.client.get<ClipCollectionLibraryEntry>(`/api/clip-collections/library/${collectionId}`)
  }

  async createCollection(input: ClipCollectionCreateInput): Promise<ClipCollectionLibraryEntry> {
    return this.client.post<ClipCollectionLibraryEntry>(
      '/api/clip-collections/library',
      JSON.stringify({
        id: input.id,
        name: input.name,
        bindings: input.bindings,
        source_node_id: input.source_node_id ?? null,
        clips: input.clips ?? null,
      }),
    )
  }

  async updateCollection(
    collectionId: string,
    input: ClipCollectionUpdateInput,
  ): Promise<ClipCollectionLibraryEntry> {
    const body: Record<string, unknown> = {}
    if (input.name !== undefined) body.name = input.name
    if (input.bindings !== undefined) body.bindings = input.bindings
    if (input.source_node_id !== undefined) body.source_node_id = input.source_node_id
    if (input.clips !== undefined) body.clips = input.clips
    return this.client.put<ClipCollectionLibraryEntry>(
      `/api/clip-collections/library/${collectionId}`,
      JSON.stringify(body),
    )
  }

  async deleteCollection(collectionId: string): Promise<void> {
    return this.client.delete(`/api/clip-collections/library/${collectionId}`)
  }
}
