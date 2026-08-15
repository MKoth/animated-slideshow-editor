import { ApiClient } from './apiClient'
import { AssetsApi } from './assetsApi'
import { HealthApi } from './healthApi'
import { MaterialsApi } from './materialsApi'
import { PingApi } from './pingApi'
import { ProjectsApi } from './projectsApi'

export const apiClient = new ApiClient()
export const assetsApi = new AssetsApi(apiClient)
export const healthApi = new HealthApi(apiClient)
export const materialsApi = new MaterialsApi(apiClient)
export const pingApi = new PingApi(apiClient)
export const projectsApi = new ProjectsApi(apiClient)

export type { AssetDefinition, AssetSortKey, AssetSortOrder, AssetUploadResult } from './assetsApi'
export type { HealthResponse } from './healthApi'
export type {
  MaterialCreateInput,
  MaterialDefinition,
  MaterialParameter,
  MaterialParameterKind,
  MaterialUpdateInput,
} from './materialsApi'
export type { PingResponse } from './pingApi'
export type { ProjectSummary, StoredProject } from './projectsApi'
