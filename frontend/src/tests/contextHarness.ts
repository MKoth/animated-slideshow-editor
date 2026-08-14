import type { PersistenceService } from '../app/persistence'

export const noopPersistence: PersistenceService = {
  save: () => undefined,
  onCommandSucceeded: () => undefined,
  dispose: () => undefined,
}
