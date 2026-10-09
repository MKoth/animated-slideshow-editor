import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../api'
import {
  AiApi,
  type AiBoard,
  type AiBoardSummary,
  type AiCalibration,
  type AiCalibrationSummary,
  type AiConversationSummary,
  type AiMessage,
  type AiNarration,
  type AiNarrationGenerateResult,
  type AiNarrationSummary,
  type AiPlan,
  type AiPlanPatch,
  type AiPlanSummary,
  type AiProposal,
  type AiProposalCreateInput,
  type AiProposalValidationError,
  type AiReconciliation,
  type AiReconciliationBriefPatch,
  type AiReconciliationSummary,
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
  reconciliations: AiReconciliationSummary[]
  reconciliationById: Record<string, AiReconciliation>
  activeReconciliationId: string | null
  reconciliationBusy: boolean
  reconciliationError: { code: string; message: string } | null
  narrations: AiNarrationSummary[]
  narrationById: Record<string, AiNarration>
  activeNarrationId: string | null
  narrationBusy: boolean
  narrationError: { code: string; message: string } | null
  calibrations: AiCalibrationSummary[]
  calibrationById: Record<string, AiCalibration>
  activeCalibrationId: string | null
  calibrationBusy: boolean
  calibrationError: { code: string; message: string } | null
  boards: AiBoardSummary[]
  boardById: Record<string, AiBoard>
  activeBoardId: string | null
  boardBusy: boolean
  boardError: { code: string; message: string } | null
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

  setActiveReconciliation: (id: string | null) => void
  loadReconciliations: (projectId: string, scenarioId?: string) => Promise<void>
  reconcileScenario: (
    projectId: string,
    scenarioId: string,
    conversationId: string,
    context: unknown,
  ) => Promise<AiReconciliation | null>
  loadReconciliation: (id: string) => Promise<void>
  decideReconciliation: (
    id: string,
    input: { stepId: string; hint: string; decision: 'accept' | 'reject'; definitionId?: string },
  ) => Promise<void>
  clearReconciliationDecision: (id: string, stepId: string, hint: string) => Promise<void>
  updateReconciliationBriefs: (id: string, briefs: AiReconciliationBriefPatch[]) => Promise<void>
  acceptReconciliation: (id: string) => Promise<void>
  rejectReconciliation: (id: string) => Promise<void>

  setActiveNarration: (id: string | null) => void
  loadNarrations: (projectId: string, reconciliationId?: string) => Promise<void>
  createNarration: (
    projectId: string,
    reconciliationId: string,
    conversationId: string,
    input?: { defaultVoicePromptId?: string; secondsPerCharacter?: number },
  ) => Promise<AiNarration | null>
  loadNarration: (id: string) => Promise<void>
  updateNarrationVoices: (
    id: string,
    patch: { defaultVoicePromptId?: string | null; partVoices?: Record<string, string | null> },
  ) => Promise<void>
  generateNarration: (id: string) => Promise<AiNarrationGenerateResult[] | null>
  markNarrationPartReady: (
    id: string,
    stepId: string,
    assetId: string,
    audioDuration: number,
  ) => Promise<void>
  markNarrationPartFailed: (id: string, stepId: string, error: string) => Promise<void>
  retryNarrationPart: (id: string, stepId: string) => Promise<void>
  acceptNarration: (id: string) => Promise<void>
  rejectNarration: (id: string) => Promise<void>

  setActiveCalibration: (id: string | null) => void
  loadCalibrations: (projectId: string, narrationId?: string) => Promise<void>
  createCalibration: (
    projectId: string,
    narrationId: string,
    conversationId: string,
    input?: {
      mouthShapes?: string[]
      morphBinding?: { fromShape?: string | null; toShape?: string | null } | null
      phonemeMap?: Record<string, string>
    },
  ) => Promise<AiCalibration | null>
  loadCalibration: (id: string) => Promise<void>
  fallbackCalibrationPart: (id: string, stepId: string, peaks: number[]) => Promise<void>
  acceptCalibration: (id: string) => Promise<void>
  rejectCalibration: (id: string) => Promise<void>

  setActiveBoard: (id: string | null) => void
  loadBoards: (projectId: string, narrationId?: string) => Promise<void>
  createBoard: (
    projectId: string,
    narrationId: string,
    conversationId: string,
    input?: { slides?: { slideId?: string; slideIndex?: number }[] },
  ) => Promise<AiBoard | null>
  loadBoard: (id: string) => Promise<void>
  updateBoardScripts: (
    id: string,
    scripts: { slideId?: string; slideIndex?: number; source: string }[],
  ) => Promise<void>
  compileBoard: (
    id: string,
    input: {
      footprints: AiBoard['footprints']
      marksMap?: AiBoard['marksMap']
      diagnostics?: AiBoard['diagnostics']
    },
  ) => Promise<void>
  acceptBoard: (id: string) => Promise<void>
  rejectBoard: (id: string) => Promise<void>

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
      reconciliations: [],
      reconciliationById: {},
      activeReconciliationId: null,
      reconciliationBusy: false,
      reconciliationError: null,
      narrations: [],
      narrationById: {},
      activeNarrationId: null,
      narrationBusy: false,
      narrationError: null,
      calibrations: [],
      calibrationById: {},
      activeCalibrationId: null,
      calibrationBusy: false,
      calibrationError: null,
      boards: [],
      boardById: {},
      activeBoardId: null,
      boardBusy: false,
      boardError: null,
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

      setActiveReconciliation: (id) => set({ activeReconciliationId: id }),

      loadReconciliations: async (projectId, scenarioId) => {
        try {
          const reconciliations = await get().api.listReconciliations(projectId, scenarioId)
          set((state) => ({
            reconciliations,
            activeReconciliationId:
              state.activeReconciliationId &&
              reconciliations.some((r) => r.id === state.activeReconciliationId)
                ? state.activeReconciliationId
                : (reconciliations[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      reconcileScenario: async (projectId, scenarioId, conversationId, context) => {
        if (get().reconciliationBusy) return null
        set({ reconciliationBusy: true, reconciliationError: null })
        try {
          const reconciliation = await get().api.reconcileScenario({
            projectId,
            scenarioId,
            conversationId,
            context,
          })
          set((state) => ({
            reconciliationById: {
              ...state.reconciliationById,
              [reconciliation.id]: reconciliation,
            },
            reconciliations: [
              {
                id: reconciliation.id,
                projectId: reconciliation.projectId,
                scenarioId: reconciliation.scenarioId,
                conversationId: reconciliation.conversationId,
                title: reconciliation.title,
                status: reconciliation.status,
                middleStepCount: reconciliation.middleStepCount,
                modified: reconciliation.modified,
              },
              ...state.reconciliations.filter((r) => r.id !== reconciliation.id),
            ],
            activeReconciliationId: reconciliation.id,
          }))
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
            }))
          } catch {
            // Reconciliation itself succeeded; message refresh is best-effort.
          }
          return reconciliation
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            reconciliationError: {
              code: 'reconcile_failed',
              message: error instanceof Error ? error.message : 'Reconciliation failed — retry.',
            },
          })
          return null
        } finally {
          set({ reconciliationBusy: false })
        }
      },

      loadReconciliation: async (id) => {
        try {
          const reconciliation = await get().api.getReconciliation(id)
          set((state) => ({
            reconciliationById: { ...state.reconciliationById, [id]: reconciliation },
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      decideReconciliation: async (id, input) => {
        try {
          const reconciliation = await get().api.decideReconciliation(id, input)
          set((state) => ({
            reconciliationById: { ...state.reconciliationById, [id]: reconciliation },
            reconciliations: state.reconciliations.map((r) =>
              r.id === id
                ? { ...r, status: reconciliation.status, modified: reconciliation.modified }
                : r,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return
          }
          set({
            reconciliationError: {
              code: 'decision_failed',
              message: error instanceof Error ? error.message : 'Decision failed.',
            },
          })
        }
      },

      clearReconciliationDecision: async (id, stepId, hint) => {
        try {
          const reconciliation = await get().api.clearReconciliationDecision(id, stepId, hint)
          set((state) => ({
            reconciliationById: { ...state.reconciliationById, [id]: reconciliation },
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      updateReconciliationBriefs: async (id, briefs) => {
        try {
          const reconciliation = await get().api.updateReconciliation(id, { briefs })
          set((state) => ({
            reconciliationById: { ...state.reconciliationById, [id]: reconciliation },
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      acceptReconciliation: async (id) => {
        try {
          const reconciliation = await get().api.acceptReconciliation(id)
          set((state) => ({
            reconciliationById: { ...state.reconciliationById, [id]: reconciliation },
            reconciliations: state.reconciliations.map((r) =>
              r.id === id
                ? { ...r, status: reconciliation.status, modified: reconciliation.modified }
                : r,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      rejectReconciliation: async (id) => {
        try {
          const reconciliation = await get().api.rejectReconciliation(id)
          set((state) => ({
            reconciliationById: { ...state.reconciliationById, [id]: reconciliation },
            reconciliations: state.reconciliations.map((r) =>
              r.id === id
                ? { ...r, status: reconciliation.status, modified: reconciliation.modified }
                : r,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      setActiveNarration: (id) => set({ activeNarrationId: id }),

      loadNarrations: async (projectId, reconciliationId) => {
        try {
          const narrations = await get().api.listNarrations(projectId, reconciliationId)
          set((state) => ({
            narrations,
            activeNarrationId:
              state.activeNarrationId && narrations.some((n) => n.id === state.activeNarrationId)
                ? state.activeNarrationId
                : (narrations[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      createNarration: async (projectId, reconciliationId, conversationId, input) => {
        if (get().narrationBusy) return null
        set({ narrationBusy: true, narrationError: null })
        try {
          const narration = await get().api.createNarration({
            projectId,
            reconciliationId,
            conversationId,
            ...(input?.defaultVoicePromptId
              ? { defaultVoicePromptId: input.defaultVoicePromptId }
              : {}),
            ...(input?.secondsPerCharacter
              ? { secondsPerCharacter: input.secondsPerCharacter }
              : {}),
          })
          set((state) => ({
            narrationById: { ...state.narrationById, [narration.id]: narration },
            narrations: [
              {
                id: narration.id,
                projectId: narration.projectId,
                reconciliationId: narration.reconciliationId,
                conversationId: narration.conversationId,
                title: narration.title,
                status: narration.status,
                partCount: narration.parts.length,
                modified: narration.modified,
              },
              ...state.narrations.filter((n) => n.id !== narration.id),
            ],
            activeNarrationId: narration.id,
          }))
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
            }))
          } catch {
            // Narration itself succeeded; message refresh is best-effort.
          }
          return narration
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            narrationError: {
              code: 'narration_create_failed',
              message: error instanceof Error ? error.message : 'Prompter fill failed — retry.',
            },
          })
          return null
        } finally {
          set({ narrationBusy: false })
        }
      },

      loadNarration: async (id) => {
        try {
          const narration = await get().api.getNarration(id)
          set((state) => ({ narrationById: { ...state.narrationById, [id]: narration } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      updateNarrationVoices: async (id, patch) => {
        try {
          const narration = await get().api.updateNarrationVoices(id, patch)
          set((state) => ({
            narrationById: { ...state.narrationById, [id]: narration },
          }))
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return
          }
          set({
            narrationError: {
              code: 'narration_voice_failed',
              message: error instanceof Error ? error.message : 'Voice update failed.',
            },
          })
        }
      },

      generateNarration: async (id) => {
        if (get().narrationBusy) return null
        set({ narrationBusy: true, narrationError: null })
        try {
          const { narration, results } = await get().api.generateNarration(id)
          set((state) => ({
            narrationById: { ...state.narrationById, [id]: narration },
            narrations: state.narrations.map((n) =>
              n.id === id ? { ...n, status: narration.status, modified: narration.modified } : n,
            ),
          }))
          try {
            const messages = await get().api.listMessages(narration.conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [narration.conversationId]: messages },
            }))
          } catch {
            // Batch itself succeeded; message refresh is best-effort.
          }
          return results
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            narrationError: {
              code: 'narration_generate_failed',
              message: error instanceof Error ? error.message : 'Voice batch failed — retry.',
            },
          })
          return null
        } finally {
          set({ narrationBusy: false })
        }
      },

      markNarrationPartReady: async (id, stepId, assetId, audioDuration) => {
        try {
          const narration = await get().api.markNarrationPartReady(id, stepId, {
            assetId,
            audioDuration,
          })
          set((state) => ({ narrationById: { ...state.narrationById, [id]: narration } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      markNarrationPartFailed: async (id, stepId, error) => {
        try {
          const narration = await get().api.markNarrationPartFailed(id, stepId, error)
          set((state) => ({ narrationById: { ...state.narrationById, [id]: narration } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      retryNarrationPart: async (id, stepId) => {
        try {
          const narration = await get().api.retryNarrationPart(id, stepId)
          set((state) => ({ narrationById: { ...state.narrationById, [id]: narration } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      acceptNarration: async (id) => {
        try {
          const narration = await get().api.acceptNarration(id)
          set((state) => ({
            narrationById: { ...state.narrationById, [id]: narration },
            narrations: state.narrations.map((n) =>
              n.id === id ? { ...n, status: narration.status, modified: narration.modified } : n,
            ),
          }))
          try {
            const messages = await get().api.listMessages(narration.conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [narration.conversationId]: messages },
            }))
          } catch {
            // Accept itself succeeded; message refresh is best-effort.
          }
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return
          }
          set({
            narrationError: {
              code: 'narration_accept_blocked',
              message:
                error instanceof Error ? error.message : 'Accept blocked — resolve stale parts.',
            },
          })
        }
      },

      rejectNarration: async (id) => {
        try {
          const narration = await get().api.rejectNarration(id)
          set((state) => ({
            narrationById: { ...state.narrationById, [id]: narration },
            narrations: state.narrations.map((n) =>
              n.id === id ? { ...n, status: narration.status, modified: narration.modified } : n,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      setActiveCalibration: (id) => set({ activeCalibrationId: id }),

      loadCalibrations: async (projectId, narrationId) => {
        try {
          const calibrations = await get().api.listCalibrations(projectId, narrationId)
          set((state) => ({
            calibrations,
            activeCalibrationId:
              state.activeCalibrationId &&
              calibrations.some((c) => c.id === state.activeCalibrationId)
                ? state.activeCalibrationId
                : (calibrations[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      createCalibration: async (projectId, narrationId, conversationId, input) => {
        if (get().calibrationBusy) return null
        set({ calibrationBusy: true, calibrationError: null })
        try {
          const calibration = await get().api.createCalibration({
            projectId,
            narrationId,
            conversationId,
            ...(input?.mouthShapes ? { mouthShapes: input.mouthShapes } : {}),
            ...(input?.morphBinding !== undefined ? { morphBinding: input.morphBinding } : {}),
            ...(input?.phonemeMap ? { phonemeMap: input.phonemeMap } : {}),
          })
          set((state) => ({
            calibrationById: { ...state.calibrationById, [calibration.id]: calibration },
            calibrations: [
              {
                id: calibration.id,
                projectId: calibration.projectId,
                narrationId: calibration.narrationId,
                conversationId: calibration.conversationId,
                title: calibration.title,
                status: calibration.status,
                partCount: calibration.timings.length,
                modified: calibration.modified,
              },
              ...state.calibrations.filter((c) => c.id !== calibration.id),
            ],
            activeCalibrationId: calibration.id,
          }))
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
            }))
          } catch {
            // Calibration itself succeeded; message refresh is best-effort.
          }
          return calibration
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            calibrationError: {
              code: 'calibration_create_failed',
              message: error instanceof Error ? error.message : 'Calibration failed — retry.',
            },
          })
          return null
        } finally {
          set({ calibrationBusy: false })
        }
      },

      loadCalibration: async (id) => {
        try {
          const calibration = await get().api.getCalibration(id)
          set((state) => ({ calibrationById: { ...state.calibrationById, [id]: calibration } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      fallbackCalibrationPart: async (id, stepId, peaks) => {
        try {
          const calibration = await get().api.fallbackCalibrationPart(id, stepId, { peaks })
          set((state) => ({ calibrationById: { ...state.calibrationById, [id]: calibration } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      acceptCalibration: async (id) => {
        try {
          const calibration = await get().api.acceptCalibration(id)
          set((state) => ({
            calibrationById: { ...state.calibrationById, [id]: calibration },
            calibrations: state.calibrations.map((c) =>
              c.id === id
                ? { ...c, status: calibration.status, modified: calibration.modified }
                : c,
            ),
          }))
          try {
            const messages = await get().api.listMessages(calibration.conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [calibration.conversationId]: messages },
            }))
          } catch {
            // Accept itself succeeded; message refresh is best-effort.
          }
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return
          }
          set({
            calibrationError: {
              code: 'calibration_accept_blocked',
              message:
                error instanceof Error ? error.message : 'Accept blocked — resolve checks first.',
            },
          })
        }
      },

      rejectCalibration: async (id) => {
        try {
          const calibration = await get().api.rejectCalibration(id)
          set((state) => ({
            calibrationById: { ...state.calibrationById, [id]: calibration },
            calibrations: state.calibrations.map((c) =>
              c.id === id
                ? { ...c, status: calibration.status, modified: calibration.modified }
                : c,
            ),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      setActiveBoard: (id) => set({ activeBoardId: id }),

      loadBoards: async (projectId, narrationId) => {
        try {
          const boards = await get().api.listBoards(projectId, narrationId)
          set((state) => ({
            boards,
            activeBoardId:
              state.activeBoardId && boards.some((b) => b.id === state.activeBoardId)
                ? state.activeBoardId
                : (boards[0]?.id ?? null),
          }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      createBoard: async (projectId, narrationId, conversationId, input) => {
        if (get().boardBusy) return null
        set({ boardBusy: true, boardError: null })
        try {
          const board = await get().api.createBoard({
            projectId,
            narrationId,
            conversationId,
            ...(input?.slides ? { slides: input.slides } : {}),
          })
          set((state) => ({
            boardById: { ...state.boardById, [board.id]: board },
            boards: [
              {
                id: board.id,
                projectId: board.projectId,
                narrationId: board.narrationId,
                conversationId: board.conversationId,
                title: board.title,
                status: board.status,
                scriptCount: board.scripts.length,
                modified: board.modified,
              },
              ...state.boards.filter((b) => b.id !== board.id),
            ],
            activeBoardId: board.id,
          }))
          try {
            const messages = await get().api.listMessages(conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [conversationId]: messages },
            }))
          } catch {
            // Board itself succeeded; message refresh is best-effort.
          }
          return board
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return null
          }
          set({
            boardError: {
              code: 'board_create_failed',
              message: error instanceof Error ? error.message : 'Board authoring failed — retry.',
            },
          })
          return null
        } finally {
          set({ boardBusy: false })
        }
      },

      loadBoard: async (id) => {
        try {
          const board = await get().api.getBoard(id)
          set((state) => ({ boardById: { ...state.boardById, [id]: board } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      updateBoardScripts: async (id, scripts) => {
        try {
          const board = await get().api.updateBoard(id, { scripts })
          set((state) => ({ boardById: { ...state.boardById, [id]: board } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      compileBoard: async (id, input) => {
        try {
          const board = await get().api.compileBoard(id, input)
          set((state) => ({ boardById: { ...state.boardById, [id]: board } }))
        } catch (error) {
          if (isBackendDown(error)) set({ status: 'unavailable' })
        }
      },

      acceptBoard: async (id) => {
        try {
          const board = await get().api.acceptBoard(id)
          set((state) => ({
            boardById: { ...state.boardById, [id]: board },
            boards: state.boards.map((b) =>
              b.id === id ? { ...b, status: board.status, modified: board.modified } : b,
            ),
          }))
          try {
            const messages = await get().api.listMessages(board.conversationId)
            set((state) => ({
              messagesById: { ...state.messagesById, [board.conversationId]: messages },
            }))
          } catch {
            // Accept itself succeeded; message refresh is best-effort.
          }
        } catch (error) {
          if (isBackendDown(error)) {
            set({ status: 'unavailable' })
            return
          }
          set({
            boardError: {
              code: 'board_accept_blocked',
              message:
                error instanceof Error ? error.message : 'Accept blocked — resolve scripts first.',
            },
          })
        }
      },

      rejectBoard: async (id) => {
        try {
          const board = await get().api.rejectBoard(id)
          set((state) => ({
            boardById: { ...state.boardById, [id]: board },
            boards: state.boards.map((b) =>
              b.id === id ? { ...b, status: board.status, modified: board.modified } : b,
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
        activeReconciliationId: state.activeReconciliationId,
        activeProposalId: state.activeProposalId,
        activeNarrationId: state.activeNarrationId,
        activeCalibrationId: state.activeCalibrationId,
        activeBoardId: state.activeBoardId,
      }),
    },
  ),
)
