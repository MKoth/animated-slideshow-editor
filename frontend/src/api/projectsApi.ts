import { ApiClient } from './apiClient'

export interface StoredProject {
  id: string
  name: string
  description: string
  author: string
  created: string
  lastModified: string
  version: number
}

export class ProjectsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async upsert(blob: string): Promise<StoredProject> {
    return this.client.post<StoredProject>('/api/projects', blob)
  }
}
