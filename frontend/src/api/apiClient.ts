export class ApiError extends Error {
  readonly status: number
  readonly path: string

  constructor(message: string, status: number, path: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
  }
}

export class ApiClient {
  async get<T>(path: string): Promise<T> {
    const response = await this.request(path, { headers: { Accept: 'application/json' } })
    return (await response.json()) as T
  }

  async post<T>(path: string, body: string): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
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

  async delete(path: string): Promise<void> {
    await this.request(path, { method: 'DELETE' })
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
      console.error(`API ${init.method ?? 'GET'} ${path} returned ${response.status}`)
      throw new ApiError(
        `Request to ${path} failed with status ${response.status}`,
        response.status,
        path,
      )
    }
    return response
  }
}
