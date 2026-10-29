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
  readonly receivedFrames?: number
  readonly basename?: string
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
  readonly receivedFrames?: number
  readonly basename?: string
  readonly artifactReady?: boolean
  readonly error?: string | null
}

export interface ExportCreateOptions {
  readonly projectName?: string
  readonly subtitles?: { readonly srt: string; readonly vtt: string }
}

export interface ExportFrameUpload {
  readonly slideId: string
  readonly frameIndex: number
  readonly timestamp: number
  readonly data: string
}

export class ExportApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async createJob(
    descriptor: ExportJobDescriptor,
    options?: ExportCreateOptions,
  ): Promise<ExportJobCreated> {
    const payload = {
      ...descriptor,
      ...(options?.projectName !== undefined ? { projectName: options.projectName } : {}),
      ...(options?.subtitles !== undefined ? { subtitles: options.subtitles } : {}),
    }
    return this.client.post<ExportJobCreated>('/api/export/jobs', JSON.stringify(payload))
  }

  async getJob(jobId: string): Promise<ExportJobStatus> {
    return this.client.get<ExportJobStatus>(`/api/export/jobs/${jobId}`)
  }

  async listJobs(): Promise<ExportJobStatus[]> {
    return this.client.get<ExportJobStatus[]>('/api/export/jobs')
  }

  async uploadFrame(jobId: string, frame: ExportFrameUpload): Promise<ExportJobStatus> {
    return this.client.post<ExportJobStatus>(
      `/api/export/jobs/${jobId}/frames`,
      JSON.stringify(frame),
    )
  }

  async uploadSubtitles(
    jobId: string,
    subtitles: { srt: string; vtt: string },
  ): Promise<ExportJobStatus> {
    return this.client.post<ExportJobStatus>(
      `/api/export/jobs/${jobId}/subtitles`,
      JSON.stringify(subtitles),
    )
  }

  async uploadAudio(
    jobId: string,
    audio: { assetId: string; data: string; mimeType: string },
  ): Promise<{ jobId: string; assetId: string; stored: boolean }> {
    return this.client.post<{ jobId: string; assetId: string; stored: boolean }>(
      `/api/export/jobs/${jobId}/audio`,
      JSON.stringify(audio),
    )
  }

  async completeJob(jobId: string): Promise<ExportJobStatus> {
    return this.client.post<ExportJobStatus>(`/api/export/jobs/${jobId}/complete`, '{}')
  }

  async cancelJob(jobId: string): Promise<ExportJobStatus> {
    return this.client.post<ExportJobStatus>(`/api/export/jobs/${jobId}/cancel`, '{}')
  }

  async downloadArtifact(jobId: string): Promise<Blob> {
    const response = await globalThis.fetch(`/api/export/jobs/${jobId}/artifact`, {
      headers: { Accept: 'application/zip' },
    })
    if (!response.ok) {
      let detail: string | null = null
      try {
        const body = (await response.json()) as { detail?: unknown }
        if (typeof body.detail === 'string') detail = body.detail
      } catch {
        // ignore non-JSON error bodies
      }
      const { ApiError } = await import('./apiClient')
      throw new ApiError(
        `Request to /api/export/jobs/${jobId}/artifact failed with status ${response.status}`,
        response.status,
        `/api/export/jobs/${jobId}/artifact`,
        detail,
      )
    }
    return response.blob()
  }
}
