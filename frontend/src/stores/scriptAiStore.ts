import { create } from 'zustand'
import { apiClient } from '../api'
import { AiApi, type AiConversationSummary, type AiMessage } from '../api/aiApi'
import { streamAiChat } from '../ai/sse'

function isBackendDown(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message))
    return true
  return false
}

export type ScriptAiStatus = 'idle' | 'loading' | 'streaming' | 'unavailable'

export function scriptSlideKey(projectId: string, slideId: string): string {
  return `${projectId}:${slideId}`
}

interface ScriptAiState {
  api: AiApi
  conversations: AiConversationSummary[]
  messagesById: Record<string, AiMessage[]>
  activeIdBySlide: Record<string, string>
  drafts: Record<string, string>
  status: ScriptAiStatus
  streamingConversationId: string | null
  streamingContent: string
  lastError: { code: string; message: string } | null
  aborter: AbortController | null
  loadConversations: (projectId: string, slideId: string) => Promise<void>
  ensureConversation: (projectId: string, slideId: string, title: string) => Promise<string | null>
  setDraft: (slideKey: string, text: string) => void
  sendMessage: (
    projectId: string,
    slideId: string,
    conversationId: string,
    text: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: any,
  ) => Promise<void>
  stopStreaming: () => void
  /** Drop one slide's conversations after a deterministic regen (history would pollute the next pass). */
  clearSlideConversations: (projectId: string, slideId: string) => Promise<void>
}

/** In-flight conversation creates per slide: concurrent first sends share one row. */
const pendingEnsures: Record<string, Promise<string | null>> = {}

function slideConversations(
  conversations: AiConversationSummary[],
  projectId: string,
  slideId: string,
): AiConversationSummary[] {
  return conversations.filter(
    (conv) =>
      conv.projectId === projectId &&
      (conv.slideId ?? null) === slideId &&
      (conv.mode ?? 'script') === 'script',
  )
}

/**
 * Slide-basis script assistant state. Conversations persist server-side
 * scoped to (project, slide); this store only holds the loaded view plus
 * streaming/draft ephemera. Proposals stay in the shared aiStore so the
 * draft → dry-run → approve → execute gates are reused verbatim.
 */
export const useScriptAiStore = create<ScriptAiState>()((set, get) => ({
  api: new AiApi(apiClient),
  conversations: [],
  messagesById: {},
  activeIdBySlide: {},
  drafts: {},
  status: 'idle',
  streamingConversationId: null,
  streamingContent: '',
  lastError: null,
  aborter: null,

  loadConversations: async (projectId, slideId) => {
    set({ status: 'loading', lastError: null })
    try {
      const rows = await get().api.listConversations(projectId, 'script', slideId)
      const key = scriptSlideKey(projectId, slideId)
      set((state) => {
        const others = state.conversations.filter(
          (conv) => scriptSlideKey(conv.projectId, conv.slideId ?? '') !== key,
        )
        const merged = [...others, ...rows]
        const nextActive = { ...state.activeIdBySlide }
        const current = nextActive[key]
        const stillThere = current !== undefined && rows.some((conv) => conv.id === current)
        if (!stillThere) {
          if (rows.length > 0 && rows[0]) nextActive[key] = rows[0].id
          else delete nextActive[key]
        }
        return {
          conversations: merged,
          status: 'idle' as const,
          activeIdBySlide: nextActive,
        }
      })
      const activeId = get().activeIdBySlide[scriptSlideKey(projectId, slideId)]
      if (activeId && !get().messagesById[activeId]) {
        try {
          const messages = await get().api.listMessages(activeId)
          set((state) => ({ messagesById: { ...state.messagesById, [activeId]: messages } }))
        } catch {
          // Messages load is best-effort; the thread renders empty.
        }
      }
    } catch (error) {
      set({ status: isBackendDown(error) ? 'unavailable' : 'idle' })
    }
  },

  ensureConversation: async (projectId, slideId, title) => {
    const key = scriptSlideKey(projectId, slideId)
    const pending = pendingEnsures[key]
    if (pending) return pending
    const run = (async () => {
      const existing = slideConversations(get().conversations, projectId, slideId)
      if (existing.length > 0 && existing[0]) {
        const id = existing[0].id
        set((state) => ({
          activeIdBySlide: { ...state.activeIdBySlide, [key]: id },
        }))
        return id
      }
      try {
        const created = await get().api.createConversation(projectId, title, 'script', slideId)
        set((state) => ({
          conversations: [
            ...state.conversations,
            {
              id: created.id,
              projectId: created.projectId,
              title: created.title,
              mode: 'script' as const,
              slideId: created.slideId ?? slideId,
              modified: created.modified,
            },
          ],
          activeIdBySlide: {
            ...state.activeIdBySlide,
            [key]: created.id,
          },
          messagesById: { ...state.messagesById, [created.id]: [] },
        }))
        return created.id
      } catch {
        return null
      } finally {
        delete pendingEnsures[key]
      }
    })()
    pendingEnsures[key] = run
    return run
  },

  setDraft: (slideKey, text) => {
    set((state) => ({ drafts: { ...state.drafts, [slideKey]: text } }))
  },

  sendMessage: async (projectId, slideId, conversationId, text, context) => {
    const clean = text.trim()
    if (!clean || get().status === 'streaming') return
    const existing = get().conversations.find((c) => c.id === conversationId)
    // Strict slide scope: never send into a conversation owned by another slide or mode.
    if (
      !existing ||
      (existing.mode ?? 'script') !== 'script' ||
      (existing.slideId ?? null) !== slideId
    )
      return
    const aborter = new AbortController()
    set({
      status: 'streaming',
      streamingConversationId: conversationId,
      streamingContent: '',
      lastError: null,
      aborter,
    })
    const key = scriptSlideKey(projectId, slideId)
    set((state) => ({ drafts: { ...state.drafts, [key]: '' } }))
    let collected = ''
    try {
      await streamAiChat(
        { conversationId, message: clean, mode: 'send', context, assistantMode: 'script' },
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
      if ((error as Error)?.name !== 'AbortError' && isBackendDown(error)) {
        set({ status: 'unavailable', streamingConversationId: null, aborter: null })
        return
      }
    }
    try {
      const messages = await get().api.listMessages(conversationId)
      set((state) => ({
        messagesById: { ...state.messagesById, [conversationId]: messages },
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, modified: new Date().toISOString() } : c,
        ),
      }))
    } catch {
      if (collected) {
        set((state) => {
          const prior = state.messagesById[conversationId] ?? []
          return {
            messagesById: {
              ...state.messagesById,
              [conversationId]: [
                ...prior,
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

  stopStreaming: () => {
    get().aborter?.abort()
  },

  clearSlideConversations: async (projectId, slideId) => {
    const key = scriptSlideKey(projectId, slideId)
    try {
      await get().api.deleteSlideConversations(projectId, slideId, 'script')
    } catch {
      // Best-effort: the modal refetches on open and self-heals.
    }
    set((state) => {
      const conversations = state.conversations.filter(
        (conv) => scriptSlideKey(conv.projectId, conv.slideId ?? '') !== key,
      )
      const messagesById = { ...state.messagesById }
      for (const conv of state.conversations) {
        if (scriptSlideKey(conv.projectId, conv.slideId ?? '') === key) {
          delete messagesById[conv.id]
        }
      }
      const activeIdBySlide = { ...state.activeIdBySlide }
      delete activeIdBySlide[key]
      const drafts = { ...state.drafts }
      delete drafts[key]
      return { conversations, messagesById, activeIdBySlide, drafts }
    })
  },
}))
