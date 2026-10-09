import type { EnginePublic } from '../engine'

export interface ContextSnapshotSlide {
  id: string
  name: string
  order: number
}

export interface ContextSnapshot {
  projectName: string
  activeSlideName: string | null
  activeSlideDuration: number | null
  slides: ContextSnapshotSlide[]
  sceneNodes: string[]
  selection: string[]
  materials: string[]
  shaders: string[]
  clips: string[]
  assets: string[]
}

export interface SnapshotSources {
  selection?: readonly string[]
  assetNames?: readonly string[]
}

/**
 * Assemble a read-only digest of the current project state for AI requests.
 * Reads only from the engine read API + UI stores — never from mutation paths.
 * Regenerated per request, never serialized into conversations or the project.
 */
export function buildContextSnapshot(
  engine: EnginePublic,
  sources: SnapshotSources = {},
): ContextSnapshot {
  const started = performance.now()
  const project = engine.project
  const slides: ContextSnapshotSlide[] = project
    ? project.slides.map((slide, index) => ({ id: slide.id, name: slide.name, order: index }))
    : []
  let active: import('../engine').Slide | null = null
  try {
    active = engine.getActiveSlide()
  } catch {
    active = null
  }
  const sceneNodes: string[] = []
  if (active) {
    const visit = (nodeId: string): void => {
      try {
        const node = engine.getNode(nodeId)
        const isCamera = Boolean(node.components?.camera)
        sceneNodes.push(
          isCamera ? `${node.name} [${node.id}] (camera)` : `${node.name} [${node.id}]`,
        )
        for (const child of node.children) visit(child.id)
      } catch {
        // Unresolvable node ids are skipped — snapshot never throws.
      }
    }
    try {
      visit(active.scene.root.id)
    } catch {
      // No scene — empty hierarchy.
    }
  }
  const snapshot: ContextSnapshot = {
    projectName: project?.name ?? '',
    activeSlideName: active?.name ?? null,
    activeSlideDuration: active ? active.duration : null,
    slides,
    sceneNodes: sceneNodes.slice(0, 200),
    selection: [...(sources.selection ?? [])].slice(0, 100),
    materials: engine.materialDefinitions.map((m) => m.name).slice(0, 200),
    shaders: engine.shaderDefinitions.map((s) => s.name).slice(0, 200),
    clips: engine.clips.map((c) => c.name).slice(0, 200),
    assets: [...(sources.assetNames ?? [])].slice(0, 300),
  }
  const elapsed = performance.now() - started
  if (elapsed > 50) {
    // Performance contract: typical projects assemble well under 50 ms.
    // We log rather than throw so degraded machines still function.
    console.warn(`Context snapshot took ${elapsed.toFixed(1)} ms`)
  }
  return snapshot
}

export function filterConversations<
  T extends { id: string; title: string },
  M extends { content: string; role: string },
>(
  conversations: readonly T[],
  messagesById: ReadonlyMap<string, readonly M[]> | Record<string, readonly M[] | undefined>,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...conversations]
  const lookup = (id: string): readonly M[] => {
    if (messagesById instanceof Map) return messagesById.get(id) ?? []
    const record = messagesById as Record<string, readonly M[] | undefined>
    return record[id] ?? []
  }
  return conversations.filter((conv) => {
    if (conv.title.toLowerCase().includes(needle)) return true
    for (const message of lookup(conv.id)) {
      if (message.content.toLowerCase().includes(needle)) return true
    }
    return false
  })
}
