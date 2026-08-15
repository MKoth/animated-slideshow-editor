import { ApiClient } from './apiClient'

export type ShaderUniformDefault = string | number | boolean | readonly number[] | null

export interface ShaderUniformInput {
  key: string
  kind: string
  default: ShaderUniformDefault
}

export interface ShaderDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  created_at: string
  updated_at: string
  source: string
  default_uniforms: Record<string, unknown>[]
  is_builtin: boolean
}

export interface ShaderImportInput {
  name?: string
  description?: string
  tags?: string[]
}

export class ShadersApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async listShaders(): Promise<ShaderDefinition[]> {
    return this.client.get<ShaderDefinition[]>('/api/shaders')
  }

  async importShader(file: File, input: ShaderImportInput = {}): Promise<ShaderDefinition> {
    const formData = new FormData()
    formData.append('file', file)
    if (input.name) {
      formData.append('name', input.name)
    }
    if (input.description) {
      formData.append('description', input.description)
    }
    for (const tag of input.tags ?? []) {
      formData.append('tags', tag)
    }
    return this.client.postForm<ShaderDefinition>('/api/shaders/import', formData)
  }

  async reuploadSource(shaderId: string, file: File): Promise<ShaderDefinition> {
    const formData = new FormData()
    formData.append('file', file)
    return this.client.putForm<ShaderDefinition>(`/api/shaders/${shaderId}/source`, formData)
  }

  async renameShader(shaderId: string, name: string): Promise<ShaderDefinition> {
    return this.client.put<ShaderDefinition>(`/api/shaders/${shaderId}`, JSON.stringify({ name }))
  }

  async updateUniformDefaults(
    shaderId: string,
    uniforms: readonly ShaderUniformInput[],
  ): Promise<ShaderDefinition> {
    return this.client.put<ShaderDefinition>(
      `/api/shaders/${shaderId}/uniforms`,
      JSON.stringify({ default_uniforms: uniforms }),
    )
  }

  async duplicateShader(sourceId: string, name: string): Promise<ShaderDefinition> {
    return this.client.post<ShaderDefinition>(
      '/api/shaders/duplicate',
      JSON.stringify({ name, source_id: sourceId }),
    )
  }

  async deleteShader(shaderId: string): Promise<void> {
    return this.client.delete(`/api/shaders/${shaderId}`)
  }
}
