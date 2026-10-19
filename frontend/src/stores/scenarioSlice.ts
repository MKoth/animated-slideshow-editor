import type { AiScenario, AiScenarioPatch, AiScenarioSummary } from '../api/aiApi'

/**
 * Scenario client-state slice seam (issue #460 prefactor).
 *
 * Small owner for the scenario request slice. Later scenario markdown
 * tickets (notably #461-#464) land here plus new scenario modules, without
 * edits inside the current god owner (`stores/aiStore.ts`).
 *
 * No author-visible behaviour change: logic moved verbatim, `aiStore.ts`
 * keeps thin delegation via `initialScenarioSliceState` +
 * `createScenarioSlice`.
 */

export interface ScenarioSliceState {
  scenarios: AiScenarioSummary[]
  scenarioById: Record<string, AiScenario>
  activeScenarioId: string | null
  scenarioGenerating: boolean
  scenarioError: { code: string; message: string } | null
  scenarioRequest: string
}

export interface ScenarioSliceActions {
  setScenarioRequest: (request: string) => void
  setActiveScenario: (id: string | null) => void
  loadScenarios: (projectId: string) => Promise<void>
  proposeScenario: (
    projectId: string,
    conversationId: string,
    requestText: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: any,
    scenarioId?: string,
  ) => Promise<AiScenario | null>
  loadScenario: (id: string) => Promise<void>
  updateScenario: (id: string, patch: AiScenarioPatch) => Promise<void>
  acceptScenario: (id: string) => Promise<void>
  rejectScenario: (id: string) => Promise<void>
}

export type ScenarioSlice = ScenarioSliceState & ScenarioSliceActions

export const initialScenarioSliceState: ScenarioSliceState = {
  scenarios: [],
  scenarioById: {},
  activeScenarioId: null,
  scenarioGenerating: false,
  scenarioError: null,
  scenarioRequest: '',
}

function isBackendDown(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message))
    return true
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SliceSet = (...args: any[]) => void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SliceGet = () => any

export function createScenarioSlice(set: SliceSet, get: SliceGet): ScenarioSliceActions {
  return {
    setScenarioRequest: (request) => set({ scenarioRequest: request }),
    setActiveScenario: (id) => set({ activeScenarioId: id }),

    loadScenarios: async (projectId) => {
      try {
        const scenarios = await get().api.listScenarios(projectId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set((state: any) => ({
          scenarios,
          activeScenarioId:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            state.activeScenarioId && scenarios.some((p: any) => p.id === state.activeScenarioId)
              ? state.activeScenarioId
              : (scenarios[0]?.id ?? null),
        }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },

    proposeScenario: async (projectId, conversationId, requestText, context, scenarioId) => {
      const clean = requestText.trim()
      if (!clean || (get() as unknown as ScenarioSliceState).scenarioGenerating) return null
      set({ scenarioGenerating: true, scenarioError: null })
      try {
        const scenario = await get().api.proposeScenario({
          projectId,
          conversationId,
          request: clean,
          context,
          scenarioId,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set((state: any) => ({
          scenarioById: { ...state.scenarioById, [scenario.id]: scenario },
          scenarios: [
            {
              id: scenario.id,
              projectId: scenario.projectId,
              conversationId: scenario.conversationId,
              title: scenario.title,
              status: scenario.status,
              stepCount: scenario.steps.length,
              modified: scenario.modified,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...state.scenarios.filter((p: any) => p.id !== scenario.id),
          ],
          activeScenarioId: scenario.id,
          scenarioRequest: '',
        }))
        try {
          const messages = await get().api.listMessages(conversationId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          set((state: any) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(state as any),
            messagesById: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...((state as any).messagesById ?? {}),
              [conversationId]: messages,
            },
          }))
        } catch {
          // Scenario itself succeeded; message refresh is best-effort.
        }
        return scenario
      } catch (error) {
        if (isBackendDown(error)) {
          set({ status: 'unavailable' })
          return null
        }
        const message =
          error instanceof Error ? error.message : 'Scenario generation failed — retry.'
        set({ scenarioError: { code: 'provider_error', message } })
        try {
          const messages = await get().api.listMessages(conversationId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          set((state: any) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(state as any),
            messagesById: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...((state as any).messagesById ?? {}),
              [conversationId]: messages,
            },
          }))
        } catch {
          // Keep the scenario error visible even if refresh fails.
        }
        return null
      } finally {
        set({ scenarioGenerating: false })
      }
    },

    loadScenario: async (id) => {
      try {
        const scenario = await get().api.getScenario(id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set((state: any) => ({ scenarioById: { ...state.scenarioById, [id]: scenario } }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },

    updateScenario: async (id, patch) => {
      try {
        const scenario = await get().api.updateScenario(id, patch)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set((state: any) => ({
          scenarioById: { ...state.scenarioById, [id]: scenario },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          scenarios: state.scenarios.map((p: any) =>
            p.id === id
              ? {
                  ...p,
                  title: scenario.title,
                  status: scenario.status,
                  modified: scenario.modified,
                }
              : p,
          ),
        }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },

    acceptScenario: async (id) => {
      try {
        const scenario = await get().api.acceptScenario(id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set((state: any) => ({
          scenarioById: { ...state.scenarioById, [id]: scenario },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          scenarios: state.scenarios.map((p: any) =>
            p.id === id ? { ...p, status: scenario.status, modified: scenario.modified } : p,
          ),
        }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },

    rejectScenario: async (id) => {
      try {
        const scenario = await get().api.rejectScenario(id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set((state: any) => ({
          scenarioById: { ...state.scenarioById, [id]: scenario },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          scenarios: state.scenarios.map((p: any) =>
            p.id === id ? { ...p, status: scenario.status, modified: scenario.modified } : p,
          ),
        }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },
  }
}
