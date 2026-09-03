import { ApiClient } from './apiClient'

export interface AssetPivot {
  x: number
  y: number
}

export interface AssetAnchor {
  name: string
  x: number
  y: number
}

export interface AssetDefinition {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  ai_description: string
  original_filename: string
  import_date: string
  width: number
  height: number
  file_size: number
  aspect_ratio: number
  default_scale: number
  default_rotation: number
  pivot: AssetPivot
  anchors: AssetAnchor[]
  original_url: string
  thumbnail_url: string
  mimeType?: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface AssetUploadError {
  filename: string
  error: string
}

export interface AssetUploadResult {
  created: AssetDefinition[]
  errors: AssetUploadError[]
}

export type AssetSortKey = 'name' | 'import_date'
export type AssetSortOrder = 'asc' | 'desc'

export interface AssetListParams {
  search?: string
  sort?: AssetSortKey
  order?: AssetSortOrder
}

export class AssetsApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async listAssets(params: AssetListParams): Promise<AssetDefinition[]> {
    const query = new URLSearchParams({
      sort: params.sort ?? 'import_date',
      order: params.order ?? 'desc',
    })
    if (params.search) {
      query.set('search', params.search)
    }
    return this.client.get<AssetDefinition[]>(`/api/assets?${query.toString()}`)
  }

  async uploadAssets(files: File[], categories?: string[]): Promise<AssetUploadResult> {
    const formData = new FormData()
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i])
    }
    if (categories) {
      for (const category of categories) {
        formData.append('categories', category)
      }
    }
    return this.client.postForm<AssetUploadResult>('/api/assets', formData)
  }

  async deleteAsset(assetId: string): Promise<void> {
    return this.client.delete(`/api/assets/${assetId}`)
  }

  async getPeaks(assetId: string): Promise<PeaksResponse> {
    return this.client.get<PeaksResponse>(`/api/assets/${assetId}/peaks`)
  }
}

export interface PeaksResponse {
  peaks: number[]
  duration: number | null
  sampleRate: number | null
  channels: number | null
}
