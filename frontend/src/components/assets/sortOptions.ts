import type { AssetSortKey, AssetSortOrder } from '../../api'

export interface SortOption {
  label: string
  sort: AssetSortKey
  order: AssetSortOrder
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { label: 'Newest first', sort: 'import_date', order: 'desc' },
  { label: 'Oldest first', sort: 'import_date', order: 'asc' },
  { label: 'Name (A–Z)', sort: 'name', order: 'asc' },
  { label: 'Name (Z–A)', sort: 'name', order: 'desc' },
]
