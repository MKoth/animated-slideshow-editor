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
  readonly projectId?: string
  readonly exportSlide?: boolean
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
      ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
      ...(options?.exportSlide !== undefined ? { exportSlide: options.exportSlide } : {}),
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

  async getExportSettings(): Promise<{ exportRoot: string; defaultExportRoot: string }> {
    return this.client.get('/api/export/settings')
  }

  async updateExportSettings(exportRoot: string): Promise<{ exportRoot: string }> {
    return this.client.put('/api/export/settings', JSON.stringify({ exportRoot }))
  }

  async getProjectExports(projectId: string): Promise<{
    projectId: string
    directory: string
    slides: Record<string, { file: string; name: string; duration: number }>
    joinedReady: boolean
    joinedOutdated: boolean
    subtitlesReady: boolean
    subtitlesOutdated: boolean
  }> {
    return this.client.get(`/api/export/projects/${encodeURIComponent(projectId)}`)
  }

  async joinProjectExports(
    projectId: string,
    slideIds: readonly string[],
  ): Promise<{ file: string }> {
    return this.client.post(
      `/api/export/projects/${encodeURIComponent(projectId)}/join`,
      JSON.stringify({ slideIds }),
    )
  }

  async saveProjectSubtitles(projectId: string, srt: string): Promise<{ file: string }> {
    return this.client.post(
      `/api/export/projects/${encodeURIComponent(projectId)}/subtitles`,
      JSON.stringify({ srt }),
    )
  }
}
