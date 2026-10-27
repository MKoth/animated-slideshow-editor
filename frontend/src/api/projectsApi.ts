import { ApiClient } from './apiClient'

export interface StoredProject {
  id: string
  name: string
  description: string
  author: string
  created: string
  lastModified: string
  version: number
  folder_id?: string | null
}

export interface ProjectSummary {
  id: string
  name: string
  lastModified: string
  folder_id?: string | null
}

export interface ProjectFolder {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export class ProjectsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async upsert(blob: string, folderId?: string | null): Promise<StoredProject> {
    const path =
      typeof folderId === 'string' && folderId !== ''
        ? `/api/projects?folder_id=${encodeURIComponent(folderId)}`
        : '/api/projects'
    return this.client.post<StoredProject>(path, blob)
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

  async move(id: string, folderId: string | null): Promise<StoredProject> {
    return this.client.patch<StoredProject>(
      `/api/projects/${id}`,
      JSON.stringify({ folder_id: folderId }),
    )
  }

  async listFolders(): Promise<ProjectFolder[]> {
    return this.client.get<ProjectFolder[]>('/api/project-folders')
  }

  async createFolder(name: string): Promise<ProjectFolder> {
    return this.client.post<ProjectFolder>('/api/project-folders', JSON.stringify({ name }))
  }

  async renameFolder(id: string, name: string): Promise<ProjectFolder> {
    return this.client.patch<ProjectFolder>(`/api/project-folders/${id}`, JSON.stringify({ name }))
  }

  async deleteFolder(id: string, deleteProjects: boolean): Promise<void> {
    const mode = deleteProjects ? 'delete_projects' : 'move_to_root'
    return this.client.delete(`/api/project-folders/${id}?mode=${mode}`)
  }
}
