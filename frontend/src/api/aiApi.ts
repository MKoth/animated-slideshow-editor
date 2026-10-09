import { ApiClient } from './apiClient'

export interface AiSettings {
  endpoint: string
  model: string
  temperature: number
  maxTokens: number
  streaming: boolean
  systemPrompt: string
  keyMasked: string
  hasKey: boolean
}

export interface AiSettingsUpdate {
  endpoint?: string
  model?: string
  temperature?: number
  maxTokens?: number
  streaming?: boolean
  systemPrompt?: string
  apiKey?: string
}

export interface AiConversationSummary {
  id: string
  projectId: string
  title: string
  modified: string
}

export interface AiConversation {
  id: string
  projectId: string
  title: string
  created: string
  modified: string
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  stopped: boolean
  errorCode: string | null
  created: string
}

export interface AiModels {
  models: string[]
  selected: string
  fallback: boolean
}

export type AiChatMode = 'send' | 'regenerate'

export interface AiChatInput {
  conversationId: string
  message?: string
  mode: AiChatMode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
}

export type AiPlanAssetClassification = 'existing' | 'missing' | 'optional'
export type AiPlanStatus = 'draft' | 'accepted' | 'rejected'

export interface AiPlanSlideAsset {
  name: string
  classification: AiPlanAssetClassification
  definitionId?: string | null
}

export interface AiPlanSlide {
  id: string
  order: number
  title: string
  goal: string
  estimatedDurationSec: number
  explanation: string
  suggestedNarration: string
  requiredAssets: AiPlanSlideAsset[]
  recommendedMaterials: string[]
  recommendedShaders: string[]
  recommendedClips: string[]
}

export interface AiPlanSummary {
  id: string
  projectId: string
  conversationId: string
  title: string
  status: AiPlanStatus
  slideCount: number
  modified: string
}

export interface AiPlanRevision {
  id: string
  sourceRequest: string
  created: string
}

export interface AiPlan {
  id: string
  projectId: string
  conversationId: string
  title: string
  description: string
  language: string
  estimatedDurationSec: number
  learningObjective: string
  teachingStrategy: string
  status: AiPlanStatus
  slides: AiPlanSlide[]
  revisions: AiPlanRevision[]
  created: string
  modified: string
}

export interface AiPlanProposeInput {
  projectId: string
  conversationId: string
  request: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
  planId?: string
}

export interface AiPlanSlidePatch {
  id: string
  title?: string
  goal?: string
  explanation?: string
  suggestedNarration?: string
  estimatedDurationSec?: number
}

export interface AiPlanPatch {
  title?: string
  description?: string
  language?: string
  estimatedDurationSec?: number
  learningObjective?: string
  teachingStrategy?: string
  slides?: AiPlanSlidePatch[]
}

export class AiApi {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async getSettings(): Promise<AiSettings> {
    return this.client.get<AiSettings>('/api/ai/settings')
  }

  async updateSettings(input: AiSettingsUpdate): Promise<AiSettings> {
    return this.client.put<AiSettings>('/api/ai/settings', JSON.stringify(input))
  }

  async listModels(): Promise<AiModels> {
    return this.client.get<AiModels>('/api/ai/models')
  }

  async listConversations(projectId: string): Promise<AiConversationSummary[]> {
    return this.client.get<AiConversationSummary[]>(
      `/api/ai/conversations?projectId=${encodeURIComponent(projectId)}`,
    )
  }

  async createConversation(projectId: string, title?: string): Promise<AiConversation> {
    return this.client.post<AiConversation>(
      '/api/ai/conversations',
      JSON.stringify(title ? { projectId, title } : { projectId }),
    )
  }

  async renameConversation(id: string, title: string): Promise<AiConversation> {
    return this.client.patch<AiConversation>(
      `/api/ai/conversations/${encodeURIComponent(id)}`,
      JSON.stringify({ title }),
    )
  }

  async deleteConversation(id: string): Promise<void> {
    return this.client.delete(`/api/ai/conversations/${encodeURIComponent(id)}`)
  }

  async listMessages(conversationId: string): Promise<AiMessage[]> {
    return this.client.get<AiMessage[]>(
      `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
    )
  }

  async proposePlan(input: AiPlanProposeInput): Promise<AiPlan> {
    return this.client.post<AiPlan>('/api/ai/plan', JSON.stringify(input))
  }

  async listPlans(projectId: string): Promise<AiPlanSummary[]> {
    return this.client.get<AiPlanSummary[]>(
      `/api/ai/plans?projectId=${encodeURIComponent(projectId)}`,
    )
  }

  async getPlan(id: string): Promise<AiPlan> {
    return this.client.get<AiPlan>(`/api/ai/plans/${encodeURIComponent(id)}`)
  }

  async updatePlan(id: string, patch: AiPlanPatch): Promise<AiPlan> {
    return this.client.patch<AiPlan>(
      `/api/ai/plans/${encodeURIComponent(id)}`,
      JSON.stringify(patch),
    )
  }

  async acceptPlan(id: string): Promise<AiPlan> {
    return this.client.post<AiPlan>(`/api/ai/plans/${encodeURIComponent(id)}/accept`, '')
  }

  async rejectPlan(id: string): Promise<AiPlan> {
    return this.client.post<AiPlan>(`/api/ai/plans/${encodeURIComponent(id)}/reject`, '')
  }
}
