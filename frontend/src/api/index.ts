import { ApiClient } from './apiClient'
import { AssetsApi } from './assetsApi'
import { HealthApi } from './healthApi'
import { PingApi } from './pingApi'

export const apiClient = new ApiClient()
export const assetsApi = new AssetsApi(apiClient)
export const healthApi = new HealthApi(apiClient)
export const pingApi = new PingApi(apiClient)

export type { AssetDefinition, AssetSortKey, AssetSortOrder, AssetUploadResult } from './assetsApi'
export type { HealthResponse } from './healthApi'
export type { PingResponse } from './pingApi'
