import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../api'
import { AiApi, type AiConversationSummary, type AiMessage } from '../api/aiApi'
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

  setPanelOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSearch: (search: string) => void
  setDraft: (projectId: string, draft: string) => void
  setActive: (projectId: string, conversationId: string) => void
  activeIdFor: (projectId: string) => string | null

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
    }),
    {
      name: 'ai-ui-prefs',
      partialize: (state) => ({
        activeByProject: state.activeByProject,
        drafts: state.drafts,
        panelOpen: state.panelOpen,
      }),
    },
  ),
)
