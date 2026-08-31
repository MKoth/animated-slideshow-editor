import { ApiClient } from './apiClient'
import { AssetsApi } from './assetsApi'
import { ClipsApi } from './clipsApi'
import { HealthApi } from './healthApi'
import { MaterialsApi } from './materialsApi'
import { PingApi } from './pingApi'
import { ProjectsApi } from './projectsApi'
import { ShadersApi } from './shadersApi'
import { TtsApi } from '../engine/ttsProvider'
import { VoicePromptsApi } from './voicePromptsApi'

export const apiClient = new ApiClient()
export const assetsApi = new AssetsApi(apiClient)
export const clipsApi = new ClipsApi(apiClient)
export const healthApi = new HealthApi(apiClient)
export const materialsApi = new MaterialsApi(apiClient)
export const pingApi = new PingApi(apiClient)
export const projectsApi = new ProjectsApi(apiClient)
export const shadersApi = new ShadersApi(apiClient)
export const voicePromptsApi = new VoicePromptsApi(apiClient)
export const ttsApi = new TtsApi(apiClient)

export type { AssetDefinition, AssetSortKey, AssetSortOrder, AssetUploadResult } from './assetsApi'
export type {
  ClipChannelDefApi,
  ClipCreateInput,
  ClipLibraryEntry,
  ClipParamDef,
  ClipUpdateInput,
} from './clipsApi'
export type { HealthResponse } from './healthApi'
export type {
  MaterialCreateInput,
  MaterialDefinition,
  MaterialParameter,
  MaterialParameterDefault,
  MaterialParameterKind,
  MaterialUpdateInput,
} from './materialsApi'
export type { PingResponse } from './pingApi'
export type { ProjectSummary, StoredProject } from './projectsApi'
export type {
  ShaderDefinition,
  ShaderImportInput,
  ShaderUniformDefault,
  ShaderUniformInput,
} from './shadersApi'
