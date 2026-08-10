export class ApiClient {
  async get<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await globalThis.fetch(path, { headers: { Accept: 'application/json' } })
    } catch (error) {
      console.error(`API GET ${path} failed:`, error)
      throw error
    }
    if (!response.ok) {
      console.error(`API GET ${path} returned ${response.status}`)
      throw new Error(`Request to ${path} failed with status ${response.status}`)
    }
    return (await response.json()) as T
  }
}
