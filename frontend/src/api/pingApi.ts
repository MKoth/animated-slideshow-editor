import { ApiClient } from './apiClient'

export interface PingResponse {
  message: string
}

export class PingApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async ping(): Promise<PingResponse> {
    return this.client.get<PingResponse>('/ping')
  }
}
