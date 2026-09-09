// ShapeCategory — per-mesh hierarchical folders for Shapes (unlimited nesting)
import { newId } from './ids'

export interface ShapeCategory {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
}

export interface ShapeCategoryJSON {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
}

export function createShapeCategory(name: string, parentId: string | null): ShapeCategory {
  return { id: newId('shapeCategory'), name, parentId }
}

export function shapeCategoryFromJSON(json: unknown): ShapeCategory {
  if (typeof json !== 'object' || json === null)
    throw new Error('ShapeCategory JSON must be object')
  const r = json as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') {
    throw new Error('ShapeCategory JSON missing id/name')
  }
  if (r.parentId !== null && typeof r.parentId !== 'string') {
    throw new Error('ShapeCategory parentId must be string or null')
  }
  return { id: r.id as string, name: r.name as string, parentId: r.parentId as string | null }
}

export function shapeCategoryToJSON(cat: ShapeCategory): ShapeCategoryJSON {
  return { id: cat.id, name: cat.name, parentId: cat.parentId }
}

export function uniqueCategoryName(
  base: string,
  categories: readonly ShapeCategory[],
  parentId: string | null,
): string {
  const siblingNames = new Set(categories.filter((c) => c.parentId === parentId).map((c) => c.name))
  if (!siblingNames.has(base)) return base
  let i = 2
  while (siblingNames.has(`${base} ${i}`)) i += 1
  return `${base} ${i}`
}

export function validateShapeCategories(categories: readonly ShapeCategory[]): string | null {
  const ids = new Set<string>()
  for (const c of categories) {
    if (ids.has(c.id)) return `Duplicate shape category id "${c.id}"`
    ids.add(c.id)
    if (typeof c.name !== 'string' || c.name.trim() === '')
      return `Shape category "${c.id}" must have a non-empty name`
  }
  // parentId exists and no cycles, sibling uniqueness
  const byId = new Map(categories.map((c) => [c.id, c] as const))
  const siblingKeys = new Set<string>()
  for (const c of categories) {
    if (c.parentId !== null && !byId.has(c.parentId)) {
      return `Shape category "${c.name}" has unknown parentId "${c.parentId}"`
    }
    const key = `${c.parentId ?? '__root'}::${c.name}`
    if (siblingKeys.has(key))
      return `A category with name "${c.name}" already exists in this folder`
    siblingKeys.add(key)
    // cycle check
    const visited = new Set<string>([c.id])
    let cur = c.parentId
    while (cur !== null) {
      if (visited.has(cur)) return `Cycle detected in category hierarchy at "${c.name}"`
      visited.add(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
  }
  return null
}

export function isDescendantCategory(
  categories: readonly ShapeCategory[],
  ancestorId: string,
  descendantId: string,
): boolean {
  const byId = new Map(categories.map((c) => [c.id, c] as const))
  let cur = byId.get(descendantId)?.parentId ?? null
  while (cur !== null) {
    if (cur === ancestorId) return true
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}
