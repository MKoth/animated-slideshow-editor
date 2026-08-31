export class ApiError extends Error {
  readonly status: number
  readonly path: string
  readonly detail: string | null

  constructor(message: string, status: number, path: string, detail: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    this.detail = detail
  }
}

export class ApiClient {
  async get<T>(path: string): Promise<T> {
    const response = await this.request(path, { headers: { Accept: 'application/json' } })
    return (await response.json()) as T
  }

  async getText(path: string): Promise<string> {
    const response = await this.request(path, { headers: { Accept: 'application/json' } })
    return response.text()
  }

  async post<T>(path: string, body: string): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
    return (await response.json()) as T
  }

  async put<T>(path: string, body: string): Promise<T> {
    const response = await this.request(path, {
      method: 'PUT',
      body,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
    return (await response.json()) as T
  }

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json' },
    })
    return (await response.json()) as T
  }

  async putForm<T>(path: string, formData: FormData): Promise<T> {
    const response = await this.request(path, {
      method: 'PUT',
      body: formData,
      headers: { Accept: 'application/json' },
    })
    return (await response.json()) as T
  }

  async delete(path: string): Promise<void> {
    await this.request(path, { method: 'DELETE' })
  }

  async postForWav(path: string, body: string): Promise<Uint8Array> {
    const response = await this.request(path, {
      method: 'POST',
      body,
      headers: { Accept: 'audio/wav', 'Content-Type': 'application/json' },
    })
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await globalThis.fetch(path, init)
    } catch (error) {
      console.error(`API ${init.method ?? 'GET'} ${path} failed:`, error)
      throw error
    }
    if (!response.ok) {
      const detail = await errorDetail(response)
      console.error(
        `API ${init.method ?? 'GET'} ${path} returned ${response.status}${detail ? `: ${detail}` : ''}`,
      )
      throw new ApiError(
        `Request to ${path} failed with status ${response.status}`,
        response.status,
        path,
        detail,
      )
    }
    return response
  }
}

async function errorDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { detail?: unknown }).detail === 'string'
    ) {
      return (body as { detail: string }).detail
    }
  } catch {
    // the body is not JSON; keep the generic status message
  }
  return null
}
