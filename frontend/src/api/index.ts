import { ApiClient } from './apiClient'
import { HealthApi } from './healthApi'
import { PingApi } from './pingApi'

export const apiClient = new ApiClient()
export const healthApi = new HealthApi(apiClient)
export const pingApi = new PingApi(apiClient)

export type { HealthResponse } from './healthApi'
export type { PingResponse } from './pingApi'
