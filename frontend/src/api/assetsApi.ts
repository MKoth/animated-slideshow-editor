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
  folder_id?: string | null
}

export interface AssetFolder {
  id: string
  name: string
  parent_id: string | null
  created_at: string
  updated_at: string
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
  /** Folder scope: a folder id, the literal 'root' for root-level assets, or undefined for global. */
  folderId?: string
}

export interface UploadAssetsOptions {
  categories?: string[]
  /** Destination folder id. Omitted/null uploads to root. */
  folderId?: string | null
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
    if (params.folderId !== undefined) {
      query.set('folder_id', params.folderId)
    }
    return this.client.get<AssetDefinition[]>(`/api/assets?${query.toString()}`)
  }

  async uploadAssets(
    files: File[],
    categoriesOrOptions?: string[] | UploadAssetsOptions,
  ): Promise<AssetUploadResult> {
    const options: UploadAssetsOptions = Array.isArray(categoriesOrOptions)
      ? { categories: categoriesOrOptions }
      : (categoriesOrOptions ?? {})
    const formData = new FormData()
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i])
    }
    if (options.categories) {
      for (const category of options.categories) {
        formData.append('categories', category)
      }
    }
    if (options.folderId) {
      formData.append('folder_id', options.folderId)
    }
    return this.client.postForm<AssetUploadResult>('/api/assets', formData)
  }

  async deleteAsset(assetId: string): Promise<void> {
    return this.client.delete(`/api/assets/${assetId}`)
  }

  async moveAsset(assetId: string, folderId: string | null): Promise<AssetDefinition> {
    return this.client.patch<AssetDefinition>(
      `/api/assets/${assetId}`,
      JSON.stringify({ folder_id: folderId }),
    )
  }

  async listFolders(): Promise<AssetFolder[]> {
    return this.client.get<AssetFolder[]>('/api/assets/folders')
  }

  async createFolder(name: string, parentId: string | null = null): Promise<AssetFolder> {
    return this.client.post<AssetFolder>(
      '/api/assets/folders',
      JSON.stringify({ name, parent_id: parentId }),
    )
  }

  async renameFolder(folderId: string, name: string): Promise<AssetFolder> {
    return this.client.patch<AssetFolder>(
      `/api/assets/folders/${folderId}`,
      JSON.stringify({ name }),
    )
  }

  async moveFolder(folderId: string, parentId: string | null): Promise<AssetFolder> {
    return this.client.patch<AssetFolder>(
      `/api/assets/folders/${folderId}`,
      JSON.stringify({ parent_id: parentId }),
    )
  }

  async deleteFolder(folderId: string): Promise<void> {
    return this.client.delete(`/api/assets/folders/${folderId}`)
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
