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

export interface ProjectSummary {
  id: string
  name: string
  lastModified: string
}

export class ProjectsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async upsert(blob: string): Promise<StoredProject> {
    return this.client.post<StoredProject>('/api/projects', blob)
  }

  async list(): Promise<ProjectSummary[]> {
    return this.client.get<ProjectSummary[]>('/api/projects')
  }

  async get(id: string): Promise<string> {
    return this.client.getText(`/api/projects/${id}`)
  }

  async delete(id: string): Promise<void> {
    return this.client.delete(`/api/projects/${id}`)
  }
}
