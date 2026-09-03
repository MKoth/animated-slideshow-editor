import type { ReusableObjectJSON } from '../engine/reusableObject'

export async function fetchObjectJson(url: string): Promise<ReusableObjectJSON> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch object: ${response.status}`)
  const json = await response.json()
  return json as ReusableObjectJSON
}
