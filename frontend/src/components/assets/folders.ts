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
