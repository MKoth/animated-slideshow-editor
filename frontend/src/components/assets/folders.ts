import type { AssetFolder } from '../../api'

/** Drag payload identifying a library folder (internal move, never a scene drop). */
export const ASSET_FOLDER_MIME = 'application/x-asset-folder'

/** Ordered breadcrumb path from root to the given folder (empty when at root). */
export function folderPath(folders: AssetFolder[], folderId: string | null): AssetFolder[] {
  if (folderId === null) return []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const path: AssetFolder[] = []
  const seen = new Set<string>()
  let current: string | null = folderId
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const folder = byId.get(current)
    if (!folder) break
    path.unshift(folder)
    current = folder.parent_id
  }
  return path
}

/**
 * User-visible group label for an asset: the folder path (`folder1/folder2`)
 * when the asset lives in a folder, `Uncategorized` when it sits at root.
 * The AI `category` field stays as library metadata; grouping is folders.
 */
export function folderDisplayName(
  folders: AssetFolder[],
  folderId: string | null | undefined,
): string {
  if (!folderId) return 'Uncategorized'
  const path = folderPath(folders, folderId)
  if (path.length === 0) return 'Uncategorized'
  return path.map((folder) => folder.name).join('/')
}
