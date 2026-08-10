import { ApiClient } from './apiClient'

export interface HealthResponse {
  status: string
}

export class HealthApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async getHealth(): Promise<HealthResponse> {
    return this.client.get<HealthResponse>('/health')
  }
}
