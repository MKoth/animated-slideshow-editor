import type { ApiClient } from './apiClient'
import type { ExportJobDescriptor } from '../engine/export'

export interface ExportJobCreated {
  readonly jobId: string
  readonly status: string
  readonly version: number
  readonly settings: Record<string, unknown>
  readonly expectedFrameCount: number
  readonly totalDuration: number
  readonly totalFrames: number
  readonly determinismKey: string
  readonly concatMethod: string
  readonly videoPixelFormat: string
  readonly videoMovflags: string
  readonly audioLoudnorm: string
}

export interface ExportJobStatus {
  readonly jobId: string
  readonly status: string
  readonly version: number
  readonly settings: Record<string, unknown>
  readonly expectedFrameCount: number
  readonly totalDuration: number
  readonly totalFrames: number
  readonly determinismKey: string
  readonly concatMethod: string
  readonly videoPixelFormat: string
  readonly videoMovflags: string
  readonly audioLoudnorm: string
  readonly slides?: readonly unknown[]
}

export class ExportApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async createJob(descriptor: ExportJobDescriptor): Promise<ExportJobCreated> {
    return this.client.post<ExportJobCreated>('/api/export/jobs', JSON.stringify(descriptor))
  }

  async getJob(jobId: string): Promise<ExportJobStatus> {
    return this.client.get<ExportJobStatus>(`/api/export/jobs/${jobId}`)
  }

  async listJobs(): Promise<ExportJobStatus[]> {
    return this.client.get<ExportJobStatus[]>('/api/export/jobs')
  }
}
