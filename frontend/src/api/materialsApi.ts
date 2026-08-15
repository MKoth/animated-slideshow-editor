import { ApiClient } from './apiClient'

export type MaterialParameterKind =
  'color' | 'number' | 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'sampler2D'

export type MaterialParameterDefault = string | number | boolean | number[]

export interface MaterialParameter {
  key: string
  kind: MaterialParameterKind
  default: MaterialParameterDefault
}

export interface MaterialDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  created_at: string
  updated_at: string
  parameters: MaterialParameter[]
  shader_id: string | null
}

export interface MaterialCreateInput {
  name: string
  description?: string
  tags?: string[]
  parameters?: MaterialParameter[]
  sourceId?: string
}

export interface MaterialUpdateInput {
  name?: string
  description?: string
  tags?: string[]
  parameters?: MaterialParameter[]
}

export class MaterialsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async listMaterials(): Promise<MaterialDefinition[]> {
    return this.client.get<MaterialDefinition[]>('/api/materials')
  }

  async createMaterial(input: MaterialCreateInput): Promise<MaterialDefinition> {
    return this.client.post<MaterialDefinition>(
      '/api/materials',
      JSON.stringify({
        name: input.name,
        description: input.description ?? '',
        tags: input.tags ?? [],
        parameters: input.parameters ?? [],
        source_id: input.sourceId,
      }),
    )
  }

  async renameMaterial(materialId: string, name: string): Promise<MaterialDefinition> {
    return this.updateMaterial(materialId, { name })
  }

  async assignShader(materialId: string, shaderId: string | null): Promise<MaterialDefinition> {
    return this.client.put<MaterialDefinition>(
      `/api/materials/${materialId}/shader`,
      JSON.stringify({ shader_id: shaderId }),
    )
  }

  async updateMaterial(
    materialId: string,
    input: MaterialUpdateInput,
  ): Promise<MaterialDefinition> {
    return this.client.put<MaterialDefinition>(
      `/api/materials/${materialId}`,
      JSON.stringify(input),
    )
  }

  async deleteMaterial(materialId: string): Promise<void> {
    return this.client.delete(`/api/materials/${materialId}`)
  }
}
