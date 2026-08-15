import type { EnginePublic } from '../../engine'

/** Run a dispatch action, surfacing command errors through the notifier. */
export function runCommand(
  notify: (message: string) => void,
  action: () => { ok: boolean; error?: Error } | null,
): void {
  try {
    const result = action()
    if (result && !result.ok) {
      throw result.error
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error))
  }
}

/** Resolve a library definition's display name, falling back to its id. */
export function definitionNameOf(
  engine: EnginePublic,
  definitionId: string,
  kind: 'material' | 'shader',
): string {
  try {
    const definition =
      kind === 'material'
        ? engine.getMaterialDefinition(definitionId)
        : engine.getShaderDefinition(definitionId)
    return definition.name
  } catch {
    return definitionId
  }
}
