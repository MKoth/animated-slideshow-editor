import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../api'
import {
  AiApi,
  type AiConversationSummary,
  type AiMessage,
  type AiPlan,
  type AiPlanPatch,
  type AiPlanSummary,
  type AiProposal,
  type AiProposalCreateInput,
  type AiProposalValidationError,
  type AiScenario,
  type AiScenarioPatch,
  type AiScenarioSummary,
} from '../api/aiApi'
import { streamAiChat } from '../ai/sse'

export type AiBackendStatus = 'idle' | 'loading' | 'streaming' | 'unavailable'

interface AiState {
  conversations: AiConversationSummary[]
  messagesById: Record<string, AiMessage[]>
  activeByProject: Record<string, string>
  drafts: Record<string, string>
  search: string
  panelOpen: boolean
  settingsOpen: boolean
  status: AiBackendStatus
  streamingConversationId: string | null
  streamingContent: string
  lastError: { code: string; message: string } | null
  api: AiApi
  aborter: AbortController | null
  plans: AiPlanSummary[]
  planById: Record<string, AiPlan>
  activePlanId: string | null
  planGenerating: boolean
  planError: { code: string; message: string } | null
  planRequest: string
  scenarios: AiScenarioSummary[]
  scenarioById: Record<string, AiScenario>
  activeScenarioId: string | null
  scenarioGenerating: boolean
  scenarioError: { code: string; message: string } | null
  scenarioRequest: string
  proposals: AiProposal[]
  proposalById: Record<string, AiProposal>
  activeProposalId: string | null
  proposalBusy: boolean
  proposalError: { code: string; message: string } | null

  setPanelOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSearch: (search: string) => void
  setDraft: (projectId: string, draft: string) => void
  setActive: (projectId: string, conversationId: string) => void
  activeIdFor: (projectId: string) => string | null
  setPlanRequest: (request: string) => void
  setActivePlan: (id: string | null) => void

  loadConversations: (projectId: string) => Promise<void>
  createConversation: (projectId: string) => Promise<AiConversationSummary | null>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (projectId: string, id: string) => Promise<void>
  loadMessages: (conversationId: string) => Promise<void>
  sendMessage: (
    projectId: string,
    conversationId: string,
    text: string,
    context: unknown,
  ) => Promise<void>
  regenerate: (projectId: string, conversationId: string, context: unknown) => Promise<void>
  stopStreaming: () => void
  markUnavailable: () => void

  loadPlans: (projectId: string) => Promise<void>
  proposePlan: (
    projectId: string,
    conversationId: string,
    requestText: string,
    context: unknown,
    planId?: string,
  ) => Promise<AiPlan | null>
  loadPlan: (id: string) => Promise<void>
  updatePlan: (id: string, patch: AiPlanPatch) => Promise<void>
  acceptPlan: (id: string) => Promise<void>
  rejectPlan: (id: string) => Promise<void>

  setScenarioRequest: (request: string) => void
  setActiveScenario: (id: string | null) => void
  loadScenarios: (projectId: string) => Promise<void>
  proposeScenario: (
    projectId: string,
    conversationId: string,
    requestText: string,
    context: unknown,
    scenarioId?: string,
  ) => Promise<AiScenario | null>
  loadScenario: (id: string) => Promise<void>
  updateScenario: (id: string, patch: AiScenarioPatch) => Promise<void>
  acceptScenario: (id: string) => Promise<void>
  rejectScenario: (id: string) => Promise<void>

  setActiveProposal: (id: string | null) => void
  loadProposals: (projectId: string) => Promise<void>
  createProposal: (input: AiProposalCreateInput) => Promise<AiProposal | null>
  loadProposal: (id: string) => Promise<void>
  reportDryRun: (
    id: string,
    input: {
      projectFingerprint: string
      ok: boolean
      errors: AiProposalValidationError[]
      validatedIndexes?: number[]
    },
  ) => Promise<void>
  approveProposal: (
    id: string,
    currentFingerprint: string,
    selectedIndexes: number[],
  ) => Promise<AiProposal | null>
  recordExecution: (
    id: string,
    input: { historyEntryId: string; executedIndexes: number[]; success: boolean; error?: string },
  ) => Promise<void>
}

function isBackendDown(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message))
    return true
  return false
}

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      conversations: [],
      messagesById: {},
      activeByProject: {},
      drafts: {},
      search: '',
      panelOpen: false,
      settingsOpen: false,
      status: 'idle',
      streamingConversationId: null,
      streamingContent: '',
      lastError: null,
      api: new AiApi(apiClient),
      aborter: null,
      plans: [],
      planById: {},
      activePlanId: null,
      planGenerating: false,
      planError: null,
      planRequest: '',
      scenarios: [],
      scenarioById: {},
      activeScenarioId: null,
      scenarioGenerating: false,
      scenarioError: null,
      scenarioRequest: '',
      proposals: [],
      proposalById: {},
      activeProposalId: null,
      proposalBusy: false,
      proposalError: null,

      setPanelOpen: (open) => set({ panelOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSearch: (search) => set({ search }),
      setDraft: (projectId, draft) =>
        set((state) => ({ drafts: { ...state.drafts, [projectId]: draft } })),
      setActive: (projectId, conversationId) =>
        set((state) => ({
          activeByProject: { ...state.activeByProject, [projectId]: conversationId },
        })),
      activeIdFor: (projectId) => get().activeByProject[projectId] ?? null,

      loadConversations: async (projectId) => {
        set({ status: 'loading' })
        try {
          const conversations = await get().api.listConversations(projectId)
          set((state) => {
            const active = state.activeByProject[projectId]
            const stillThere = active && conversations.some((c) => c.id === active)
            return {
              conversations,
              status: 'idle' as const,
              activeByProject: stillThere
                ? state.activeByProject
                : conversations[0]
                  ? { ...state.activeByProject, [projectId]: conversations[0].id }
                  : state.activeByProject,
            }
          })
        } catch (error) {
          set({ status: isBackendDown(error) ? 'unavailable' : 'idle' })
        }
      },

      createConversation: async (projectId) => {
        try {
          const created = await get().api.createConversation(projectId)
          const summary: AiConversationSummary = {
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            modified: created.modified,
          }
          set((state) => ({
            conversations: [summary, ...state.conversations],
            messagesById: { ...state.messagesById, [summary.id]: [] },
            activeByProject: { ...state.activeByProject, [projectId]: summary.id },
            status: 'idle' as const,
          }))
          return summary
        } catch (error) {
          set({ status: isBackendDown(error) ? 'unavailable' : 'idle' })
          return null
        }
      },

      renameConversation: async (id, title) => {
        const clean = title.trim()
        if (!clean) return
        try {
          const updated = await get().api.renameConversation(id, clean)
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === id ? { ...c, title: updated.title, modified: updated.modified } : c,
            ),
          }))
        } catch (error) {
          set({ status: isBackendDown(error) ? 'unavailable' : get().status })
        }
      },

      deleteConversation: async (projectId, id) => {
        try {
          await get().api.deleteConversation(id)
          set((state) => {
            const conversations = state.conversations.filter((c) => c.id !== id)
            const messagesById = { ...state.messagesById }
            delete messagesById[id]
            const activeByProject = { ...state.activeByProject }
            if (activeByProject[projectId] === id) {
              if (conversations[0]) activeByProject[projectId] = conversations[0].id
              else delete activeByProject[projectId]
            }
            return { conversations, messagesById, activeByProject }
          })
        } catch (error) {
          set({ status: isBackendDown(error) ? 'unavailable' : get().status })
        }
      },

      loadMessages: async (conversationId) => {
        try {
          const messages = await get().api.listMessages(conversationId)
          set((state) => ({
            messagesById: { ...state.messagesById, [conversationId]: messages },
            status: 'idle' as const,
          }))
        } catch (error) {
          set({ status: isBackendDown(error) ? 'unavailable' : 'idle' })
        }
      },

      sendMessage: async (projectId, conversationId, text, context) => {
        const clean = text.trim()
        if (!clean || get().status === 'streaming') return
        const aborter = new AbortController()
        set({
          status: 'streaming',
          streamingConversationId: conversationId,
          streamingContent: '',
          lastError: null,
          aborter,
        })
        // Clear the draft for this project once sent.
        set((state) => ({ drafts: { ...state.drafts, [projectId]: '' } }))
        let collected = ''
        try {
          await streamAiChat(
            { conversationId, message: clean, mode: 'send', context },
            {
              onToken: (delta) => {
                collected += delta
                set({ streamingContent: collected })
              },
              onDone: (content) => {
                if (content) collected = content
              },
              onError: (code, message) => {
                set({ lastError: { code, message } })
              },
            },
            aborter.signal,
          )
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') {
            // Stop preserves partial content: reload will show the persisted partial.
          } else if (isBackendDown(error)) {
            set({ status: 'unavailable', streamingConversationId: null, aborter: null })
            return
          }
        }
        // Refresh from the server: source of truth (user + assistant persisted).
        try {
          const messages = await get().api.listMessages(conversationId)
          set((state) => ({
            messagesById: { ...state.messagesById, [conversationId]: messages },
            conversations: state.conversations.map((c) =>
              c.id === conversationId ? { ...c, modified: new Date().toISOString() } : c,
            ),
          }))
        } catch {
          // Keep the streamed content visible even if the refresh fails.
          if (collected) {
            set((state) => {
              const existing = state.messagesById[conversationId] ?? []
              return {
                messagesById: {
                  ...state.messagesById,
                  [conversationId]: [
                    ...existing,
                    {
                      id: `local-${Date.now()}`,
                      role: 'assistant' as const,
                      content: collected,
                      stopped: aborter.signal.aborted,
                      errorCode: null,
                      created: new Date().toISOString(),
                    },
                  ],
                },
              }
            })
          }
        }
        set({ status: 'idle', streamingConversationId: null, streamingContent: '', aborter: null })
      },

      regenerate: async (_projectId, conversationId, context) => {
        if (get().status === 'streaming') return
        const aborter = new AbortController()
        set({
          status: 'streaming',
          streamingConversationId: conversationId,
          streamingContent: '',
          lastError: null,
          aborter,
        })
        let collected = ''
        try {
          await streamAiChat(
            { conversationId, mode: 'regenerate', context },
            {
              onToken: (delta) => {
                collected += delta
                set({ streamingContent: collected })
              },
              onError: (code, message) => {
                set({ lastError: { code, message } })
              },
            },
            aborter.signal,
          )
        } catch (error) {
          if (!isBackendDown(error) && (error as Error)?.name !== 'AbortError') {
            set({ lastError: { code: 'provider_error', message: 'Provider error — retry.' } })
          }
          if (isBackendDown(error)) {
            set({ status: 'unavailable', streamingConversationId: null, aborter: null })
            return
          }
        }
        try {
          const messages = await get().api.listMessages(conversationId)
          set((state) => ({
            messagesById: { ...state.messagesById, [conversationId]: messages },
          }))
        } catch {
          // Keep idle even if refresh fails.
        }
        set({ status: 'idle', streamingConversationId: null, streamingContent: '', aborter: null })
      },

      stopStreaming: () => {
        get().aborter?.abort()
      },

      markUnavailable: () => set({ status: 'unavailable' }),

      setPlanRequest: (request) => set({ planRequest: request }),
      setActivePlan: (id) => set({ activePlanId: id }),

      loadPlans: async (projectId) => {
        try {
          const plans = await get().api.listPlans(projectId)
          set((state) => ({
            plans,
            activePlanId:
              state.activePlanId && plans.some((p) => p.id === state.activePlanId)
                ? state.activePlanId
                : (plans[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      proposePlan: async (projectId, conversationId, requestText, context, planId) => {
        const clean = requestText.trim()
        if (!clean || get().planGenerating) return null
        set({ planGenerating: true, planError: null })
        try {
          const plan = await get().api.proposePlan({
            projectId,
            conversationId,
            request: clean,
            context,
            planId,
          })
          set((state) => ({
            planById: { ...state.planById, [plan.id]: plan },
            plans: [
              {
                id: plan.id,
                projectId: plan.projectId,
                conversationId: plan.conversationId,
                title: plan.title,
                status: plan.status,
                slideCount: plan.slides.length,
                modified: plan.modified,
              },
              ...state.plans.filter((p) => p.id !== plan.id),
            ],
            activePlanId: plan.id,
            planRequest: '',
          }))
          // Refresh conversation messages: plan generation appends narration.
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
            }))
          } catch {
            // Plan itself succeeded; message refresh is best-effort.
          }
          return plan
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          const code = 'provider_error'
          const message = error instanceof Error ? error.message : 'Plan generation failed — retry.'
          set({ planError: { code, message } })
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
            }))
          } catch {
            // Keep the plan error visible even if refresh fails.
          }
          return null
        } finally {
          set({ planGenerating: false })
        }
      },

      loadPlan: async (id) => {
        try {
          const plan = await get().api.getPlan(id)
          set((state) => ({ planById: { ...state.planById, [id]: plan } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      updatePlan: async (id, patch) => {
        try {
          const plan = await get().api.updatePlan(id, patch)
          set((state) => ({
            planById: { ...state.planById, [id]: plan },
            plans: state.plans.map((p) =>
              p.id === id
                ? { ...p, title: plan.title, status: plan.status, modified: plan.modified }
                : p,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      acceptPlan: async (id) => {
        try {
          const plan = await get().api.acceptPlan(id)
          set((state) => ({
            planById: { ...state.planById, [id]: plan },
            plans: state.plans.map((p) =>
              p.id === id ? { ...p, status: plan.status, modified: plan.modified } : p,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      rejectPlan: async (id) => {
        try {
          const plan = await get().api.rejectPlan(id)
          set((state) => ({
            planById: { ...state.planById, [id]: plan },
            plans: state.plans.map((p) =>
              p.id === id ? { ...p, status: plan.status, modified: plan.modified } : p,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      setScenarioRequest: (request) => set({ scenarioRequest: request }),
      setActiveScenario: (id) => set({ activeScenarioId: id }),

      loadScenarios: async (projectId) => {
        try {
          const scenarios = await get().api.listScenarios(projectId)
          set((state) => ({
            scenarios,
            activeScenarioId:
              state.activeScenarioId && scenarios.some((p) => p.id === state.activeScenarioId)
                ? state.activeScenarioId
                : (scenarios[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      proposeScenario: async (projectId, conversationId, requestText, context, scenarioId) => {
        const clean = requestText.trim()
        if (!clean || get().scenarioGenerating) return null
        set({ scenarioGenerating: true, scenarioError: null })
        try {
          const scenario = await get().api.proposeScenario({
            projectId,
            conversationId,
            request: clean,
            context,
            scenarioId,
          })
          set((state) => ({
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
              ...state.scenarios.filter((p) => p.id !== scenario.id),
            ],
            activeScenarioId: scenario.id,
            scenarioRequest: '',
          }))
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
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
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
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
          set((state) => ({ scenarioById: { ...state.scenarioById, [id]: scenario } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      updateScenario: async (id, patch) => {
        try {
          const scenario = await get().api.updateScenario(id, patch)
          set((state) => ({
            scenarioById: { ...state.scenarioById, [id]: scenario },
            scenarios: state.scenarios.map((p) =>
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
          set((state) => ({
            scenarioById: { ...state.scenarioById, [id]: scenario },
            scenarios: state.scenarios.map((p) =>
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
          set((state) => ({
            scenarioById: { ...state.scenarioById, [id]: scenario },
            scenarios: state.scenarios.map((p) =>
              p.id === id ? { ...p, status: scenario.status, modified: scenario.modified } : p,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      setActiveProposal: (id) => set({ activeProposalId: id }),

      loadProposals: async (projectId) => {
        try {
          const proposals = await get().api.listProposals(projectId)
          set((state) => ({
            proposals,
            proposalById: {
              ...state.proposalById,
              ...Object.fromEntries(proposals.map((p) => [p.id, p])),
            },
            activeProposalId:
              state.activeProposalId && proposals.some((p) => p.id === state.activeProposalId)
                ? state.activeProposalId
                : (proposals[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      createProposal: async (input) => {
        if (get().proposalBusy) return null
        set({ proposalBusy: true, proposalError: null })
        try {
          const proposal = await get().api.createProposal(input)
          set((state) => ({
            proposalById: { ...state.proposalById, [proposal.id]: proposal },
            proposals: [proposal, ...state.proposals.filter((p) => p.id !== proposal.id)],
            activeProposalId: proposal.id,
          }))
          return proposal
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            proposalError: {
              code: 'proposal_create_failed',
              message: error instanceof Error ? error.message : 'Proposal creation failed.',
            },
          })
          return null
        } finally {
          set({ proposalBusy: false })
        }
      },

      loadProposal: async (id) => {
        try {
          const proposal = await get().api.getProposal(id)
          set((state) => ({
            proposalById: { ...state.proposalById, [id]: proposal },
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      reportDryRun: async (id, input) => {
        try {
          const proposal = await get().api.reportDryRun(id, input)
          set((state) => ({
            proposalById: { ...state.proposalById, [id]: proposal },
            proposals: state.proposals.map((p) => (p.id === id ? proposal : p)),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      approveProposal: async (id, currentFingerprint, selectedIndexes) => {
        set({ proposalBusy: true, proposalError: null })
        try {
          const proposal = await get().api.approveProposal(id, {
            currentFingerprint,
            selectedIndexes,
          })
          set((state) => ({
            proposalById: { ...state.proposalById, [id]: proposal },
            proposals: state.proposals.map((p) => (p.id === id ? proposal : p)),
          }))
          return proposal
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            proposalError: {
              code: 'proposal_approve_failed',
              message: error instanceof Error ? error.message : 'Approval failed.',
            },
          })
          try {
            const refreshed = await get().api.getProposal(id)
            set((state) => ({
              proposalById: { ...state.proposalById, [id]: refreshed },
              proposals: state.proposals.map((p) => (p.id === id ? refreshed : p)),
            }))
          } catch {
            // Keep the approval error visible even if refresh fails.
          }
          return null
        } finally {
          set({ proposalBusy: false })
        }
      },

      recordExecution: async (id, input) => {
        try {
          const proposal = await get().api.recordExecution(id, input)
          set((state) => ({
            proposalById: { ...state.proposalById, [id]: proposal },
            proposals: state.proposals.map((p) => (p.id === id ? proposal : p)),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },
    }),
    {
      name: 'ai-ui-prefs',
      partialize: (state) => ({
        activeByProject: state.activeByProject,
        drafts: state.drafts,
        panelOpen: state.panelOpen,
        activePlanId: state.activePlanId,
        planRequest: state.planRequest,
        activeScenarioId: state.activeScenarioId,
        scenarioRequest: state.scenarioRequest,
        activeProposalId: state.activeProposalId,
      }),
    },
  ),
)
