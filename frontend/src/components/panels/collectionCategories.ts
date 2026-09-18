import type { ClipCollection } from '../../engine/clipCollection'
import type { ClipDefinition } from '../../engine/clipDefinition'

/** Filter value showing collections/clips of every category. */
export const ALL_COLLECTION_CATEGORIES = '__all'

/** Display label for the empty (uncategorized) category. */
export const UNCATEGORIZED_LABEL = 'Uncategorized'

/** Normalized category of a collection ('' = Uncategorized). */
export function collectionCategoryOf(collection: Pick<ClipCollection, 'category'>): string {
  return typeof collection.category === 'string' ? collection.category.trim() : ''
}

/** Sorted distinct non-empty collection categories (global list). */
export function distinctCollectionCategories(
  collections: readonly Pick<ClipCollection, 'category'>[],
): string[] {
  const seen = new Set<string>()
  for (const c of collections) {
    const cat = collectionCategoryOf(c)
    if (cat !== '') seen.add(cat)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Whether a collection matches a category filter: '__all' matches everything,
 * '' matches Uncategorized, otherwise exact match.
 */
export function matchesCollectionCategory(
  collection: Pick<ClipCollection, 'category'>,
  filter: string,
): boolean {
  if (filter === ALL_COLLECTION_CATEGORIES) return true
  return collectionCategoryOf(collection) === filter
}

/** Display label for a category filter value. */
export function collectionCategoryLabel(filter: string): string {
  if (filter === ALL_COLLECTION_CATEGORIES) return 'All categories'
  return filter === '' ? UNCATEGORIZED_LABEL : filter
}

/** Sorted distinct non-empty clip categories (usually semantic names). */
export function distinctClipCategories(
  clips: readonly Pick<ClipDefinition, 'category'>[],
): string[] {
  const seen = new Set<string>()
  for (const c of clips) {
    const cat = typeof c.category === 'string' ? c.category.trim() : ''
    if (cat !== '') seen.add(cat)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}
