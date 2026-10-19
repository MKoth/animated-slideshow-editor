import type {
  AiScenario,
  AiScenarioPatch,
  AiScenarioSummary,
  ScenarioChatApplyResult,
  ScenarioMarkdownAudit,
  ScenarioMarkdownVersion,
} from '../api/aiApi'

/**
 * Scenario client-state slice seam (issue #460 prefactor).
 *
 * Small owner for the scenario request slice. Markdown versioned edits
 * (issue #462) land here plus new scenario modules, without edits inside
 * the current god owner (`stores/aiStore.ts`).
 */

export interface ScenarioSliceState {
  scenarios: AiScenarioSummary[]
  scenarioById: Record<string, AiScenario>
  activeScenarioId: string | null
  scenarioGenerating: boolean
  scenarioError: { code: string; message: string } | null
  scenarioRequest: string
  /** Server-side markdown versions ordered oldest-first, keyed by project. */
  markdownVersionsByProject: Record<string, ScenarioMarkdownVersion[]>
  /** Per-project active version pointer (last-writer-wins). */
  activeMarkdownVersionIdByProject: Record<string, string | null>
  /** Proposal-bypass audit trail per project. */
  markdownAuditsByProject: Record<string, ScenarioMarkdownAudit[]>
  markdownBusy: boolean
  markdownError: { code: string; message: string } | null
  /** Doc versus History tab for the scenario surface. */
  scenarioTab: 'doc' | 'history'
  /** Doc-first modal visibility (issue #463): entry button always present. */
  scenarioModalOpen: boolean
  /** Checklist missing-only filter (issue #463): one-click missing filter. */
  scenarioMissingOnly: boolean
}

export interface ScenarioSliceActions {
  setScenarioRequest: (request: string) => void
  setActiveScenario: (id: string | null) => void
  setScenarioModalOpen: (open: boolean) => void
  setScenarioMissingOnly: (missingOnly: boolean) => void
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
  setScenarioTab: (tab: 'doc' | 'history') => void
  loadMarkdownVersions: (projectId: string, conversationId?: string) => Promise<void>
  applyScenarioChat: (
    projectId: string,
    conversationId: string,
    userText: string,
    assistantText: string,
    messageId?: string,
  ) => Promise<ScenarioChatApplyResult | null>
  restoreMarkdownVersion: (
    projectId: string,
    conversationId: string,
    versionId: string,
    messageId?: string,
  ) => Promise<ScenarioMarkdownVersion | null>
  loadMarkdownAudits: (projectId: string) => Promise<void>
}

export type ScenarioSlice = ScenarioSliceState & ScenarioSliceActions

export const initialScenarioSliceState: ScenarioSliceState = {
  scenarios: [],
  scenarioById: {},
  activeScenarioId: null,
  scenarioGenerating: false,
  scenarioError: null,
  scenarioRequest: '',
  markdownVersionsByProject: {},
  activeMarkdownVersionIdByProject: {},
  markdownAuditsByProject: {},
  markdownBusy: false,
  markdownError: null,
  scenarioTab: 'doc',
  scenarioModalOpen: false,
  scenarioMissingOnly: false,
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
    setScenarioModalOpen: (open) => set({ scenarioModalOpen: open }),
    setScenarioMissingOnly: (missingOnly) => set({ scenarioMissingOnly: missingOnly }),

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

    setScenarioTab: (tab) => set({ scenarioTab: tab }),

    loadMarkdownVersions: async (projectId, conversationId) => {
      try {
        const versions = await get().api.listMarkdownVersions(projectId, conversationId)
        const active = await get().api.getActiveMarkdownVersion(projectId)
        set((state: ScenarioSliceState) => ({
          markdownVersionsByProject: {
            ...state.markdownVersionsByProject,
            [projectId]: versions,
          },
          activeMarkdownVersionIdByProject: {
            ...state.activeMarkdownVersionIdByProject,
            [projectId]: active.activeVersionId,
          },
        }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },

    applyScenarioChat: async (projectId, conversationId, userText, assistantText, messageId) => {
      if (get().markdownBusy) return null
      set({ markdownBusy: true, markdownError: null })
      try {
        const result = await get().api.applyScenarioChat({
          projectId,
          conversationId,
          messageId,
          userText,
          assistantText,
        })
        if (result.version) {
          set((state: ScenarioSliceState) => ({
            markdownVersionsByProject: {
              ...state.markdownVersionsByProject,
              [projectId]: [...(state.markdownVersionsByProject[projectId] ?? []), result.version!],
            },
            activeMarkdownVersionIdByProject: {
              ...state.activeMarkdownVersionIdByProject,
              [projectId]: result.version!.id,
            },
          }))
        }
        try {
          const messages = await get().api.listMessages(conversationId)
          set((state: ScenarioSliceState & { messagesById: Record<string, unknown> }) => ({
            messagesById: { ...state.messagesById, [conversationId]: messages },
          }))
        } catch {
          // Version itself succeeded; message refresh is best-effort.
        }
        return result
      } catch (error) {
        if (isBackendDown(error)) {
          set({ status: 'unavailable' })
          return null
        }
        set({
          markdownError: {
            code: 'markdown_apply_failed',
            message: error instanceof Error ? error.message : 'Version apply failed — retry.',
          },
        })
        return null
      } finally {
        set({ markdownBusy: false })
      }
    },

    restoreMarkdownVersion: async (projectId, conversationId, versionId, messageId) => {
      if (get().markdownBusy) return null
      set({ markdownBusy: true, markdownError: null })
      try {
        const version = await get().api.restoreMarkdownVersion(versionId, {
          projectId,
          conversationId,
          messageId,
        })
        set((state: ScenarioSliceState) => ({
          markdownVersionsByProject: {
            ...state.markdownVersionsByProject,
            [projectId]: [...(state.markdownVersionsByProject[projectId] ?? []), version],
          },
          activeMarkdownVersionIdByProject: {
            ...state.activeMarkdownVersionIdByProject,
            [projectId]: version.id,
          },
        }))
        try {
          const messages = await get().api.listMessages(conversationId)
          set((state: ScenarioSliceState & { messagesById: Record<string, unknown> }) => ({
            messagesById: { ...state.messagesById, [conversationId]: messages },
          }))
        } catch {
          // Restore itself succeeded; message refresh is best-effort.
        }
        return version
      } catch (error) {
        if (isBackendDown(error)) {
          set({ status: 'unavailable' })
          return null
        }
        set({
          markdownError: {
            code: 'markdown_restore_failed',
            message: error instanceof Error ? error.message : 'Restore failed — retry.',
          },
        })
        return null
      } finally {
        set({ markdownBusy: false })
      }
    },

    loadMarkdownAudits: async (projectId) => {
      try {
        const audits = await get().api.listMarkdownAudits(projectId)
        set((state: ScenarioSliceState) => ({
          markdownAuditsByProject: { ...state.markdownAuditsByProject, [projectId]: audits },
        }))
      } catch (error) {
        if (isBackendDown(error)) set({ status: 'unavailable' })
      }
    },
  }
}
