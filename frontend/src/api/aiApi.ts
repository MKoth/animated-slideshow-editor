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

export type AiScenarioPartTag = 'intro' | 'middle' | 'outro'
export type AiScenarioStatus = 'draft' | 'accepted' | 'rejected'

export interface AiScenarioStep {
  id: string
  order: number
  partTag: AiScenarioPartTag
  spokenLine: string
  onScreenAction: string
  assetHints: string[]
  estimatedDurationSec: number
}

export interface AiScenarioSummary {
  id: string
  projectId: string
  conversationId: string
  title: string
  status: AiScenarioStatus
  stepCount: number
  modified: string
}

export interface AiScenarioRevision {
  id: string
  sourceRequest: string
  created: string
}

export interface AiScenario {
  id: string
  projectId: string
  conversationId: string
  title: string
  description: string
  status: AiScenarioStatus
  steps: AiScenarioStep[]
  revisions: AiScenarioRevision[]
  created: string
  modified: string
}

export interface AiScenarioProposeInput {
  projectId: string
  conversationId: string
  request: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
  scenarioId?: string
}

export interface AiScenarioStepPatch {
  id: string
  partTag?: AiScenarioPartTag
  spokenLine?: string
  onScreenAction?: string
  assetHints?: string[]
  estimatedDurationSec?: number
}

export interface AiScenarioPatch {
  title?: string
  description?: string
  steps?: AiScenarioStepPatch[]
}

export type AiReconciliationStatus = 'draft' | 'accepted' | 'rejected'
export type AiMotionState =
  'feasible' | 'feasible-with-substitution' | 'needs-new-asset' | 'needs-new-motion'

export interface AiReconciliationCandidate {
  definitionId: string
  name: string
  score: number
  explanation: string
}

export interface AiAssetVerdict {
  hint: string
  verdict: 'matched' | 'missing'
  candidates: AiReconciliationCandidate[]
  alternatives: AiReconciliationCandidate[]
}

export interface AiMotionVerdict {
  state: AiMotionState
  explanation: string
  evidence: Record<string, unknown>
}

export interface AiStepReconciliation {
  stepId: string
  order: number
  partTag: AiScenarioPartTag
  skipped: boolean
  reason?: string
  assetVerdicts: AiAssetVerdict[]
  motion: AiMotionVerdict | null
  soundVerdicts: AiAssetVerdict[]
}

export interface AiImageBrief {
  id: string
  stepId: string
  hint: string
  name: string
  note: string
  styleProfile: { name: string; description: string; promptSuffix: string }
  productionConstraints: string
  providerNote: string
  variants: { detailed: string; concise: string; stylized: string }
  prompt: string
  editable: boolean
  wizardEntry: {
    assetName: string
    note: string
    styleProfile: { name: string; description: string; promptSuffix: string }
    productionConstraints: string
    providerNote: string
  }
}

export interface AiReconciliationRevision {
  id: string
  sourceRequest: string
  created: string
}

export interface AiReconciliation {
  id: string
  projectId: string
  scenarioId: string
  conversationId: string
  title: string
  status: AiReconciliationStatus
  verdicts: AiStepReconciliation[]
  briefs: AiImageBrief[]
  decisions: Record<
    string,
    { stepId: string; hint: string; decision: string; definitionId: string | null }
  >
  revisions: AiReconciliationRevision[]
  middleStepCount: number
  missingCount: number
  created: string
  modified: string
}

export interface AiReconciliationSummary {
  id: string
  projectId: string
  scenarioId: string
  conversationId: string
  title: string
  status: AiReconciliationStatus
  middleStepCount: number
  modified: string
}

export interface AiReconciliationCreateInput {
  projectId: string
  scenarioId: string
  conversationId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
}

export interface AiReconciliationBriefPatch {
  id: string
  prompt?: string
  name?: string
  note?: string
  variants?: { detailed?: string; concise?: string; stylized?: string }
  styleProfile?: { name: string; description: string; promptSuffix: string }
}

export type AiProposalStatus =
  | 'draft'
  | 'validated'
  | 'dry_run_ok'
  | 'dry_run_failed'
  | 'approved'
  | 'executed'
  | 'execution_failed'

export type AiNarrationStatus = 'draft' | 'accepted' | 'rejected'
export type AiNarrationPartStatus = 'pending' | 'ready' | 'failed'

export interface AiNarrationPart {
  stepId: string
  order: number
  partTag: 'middle'
  spokenLine: string
  estimatedDuration: number
  audioDuration: number | null
  assetId: string | null
  status: AiNarrationPartStatus
  stale: boolean
  voicePromptId: string | null
  error: string | null
  timelineStart: number
  timelineEnd: number
}

export interface AiNarrationRevision {
  id: string
  sourceRequest: string
  created: string
}

export interface AiNarration {
  id: string
  projectId: string
  reconciliationId: string
  scenarioId: string
  conversationId: string
  title: string
  status: AiNarrationStatus
  defaultVoicePromptId: string | null
  secondsPerCharacter: number
  parts: AiNarrationPart[]
  slideDuration: number
  revisions: AiNarrationRevision[]
  created: string
  modified: string
}

export interface AiNarrationSummary {
  id: string
  projectId: string
  reconciliationId: string
  conversationId: string
  title: string
  status: AiNarrationStatus
  partCount: number
  modified: string
}

export interface AiNarrationGenerateResult {
  stepId: string
  ok: boolean
  audioDuration?: number
  mimeType?: string
  wavData?: string
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AiProposalCommand = { type: string } & Record<string, any>

export interface AiProposalValidationError {
  index: number
  type: string
  message: string
}

export interface AiProposalExecution {
  id: string
  executedIndexes: number[]
  historyEntryId: string
  success: boolean
  error: string
  created: string
}

export interface AiProposal {
  id: string
  projectId: string
  conversationId: string
  title: string
  status: AiProposalStatus
  commands: AiProposalCommand[]
  validation: { ok: boolean; errors: AiProposalValidationError[] }
  baseFingerprint: string
  validatedFingerprint: string | null
  dryRun: { ok?: boolean; errors?: AiProposalValidationError[] }
  selectedIndexes: number[]
  executions: AiProposalExecution[]
  executableCommands?: AiProposalCommand[]
  created: string
  modified: string
}

export interface AiProposalCreateInput {
  projectId: string
  conversationId: string
  title?: string
  commands: AiProposalCommand[]
  projectFingerprint: string
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

  async proposeScenario(input: AiScenarioProposeInput): Promise<AiScenario> {
    return this.client.post<AiScenario>('/api/ai/scenarios', JSON.stringify(input))
  }

  async listScenarios(projectId: string): Promise<AiScenarioSummary[]> {
    return this.client.get<AiScenarioSummary[]>(
      `/api/ai/scenarios?projectId=${encodeURIComponent(projectId)}`,
    )
  }

  async getScenario(id: string): Promise<AiScenario> {
    return this.client.get<AiScenario>(`/api/ai/scenarios/${encodeURIComponent(id)}`)
  }

  async getScenarioCanonical(id: string): Promise<{
    id: string
    projectId: string
    conversationId: string
    title: string
    description: string
    status: AiScenarioStatus
    steps: AiScenarioStep[]
  }> {
    return this.client.get(`/api/ai/scenarios/${encodeURIComponent(id)}/canonical`)
  }

  async updateScenario(id: string, patch: AiScenarioPatch): Promise<AiScenario> {
    return this.client.patch<AiScenario>(
      `/api/ai/scenarios/${encodeURIComponent(id)}`,
      JSON.stringify(patch),
    )
  }

  async acceptScenario(id: string): Promise<AiScenario> {
    return this.client.post<AiScenario>(`/api/ai/scenarios/${encodeURIComponent(id)}/accept`, '')
  }

  async rejectScenario(id: string): Promise<AiScenario> {
    return this.client.post<AiScenario>(`/api/ai/scenarios/${encodeURIComponent(id)}/reject`, '')
  }

  async reconcileScenario(input: AiReconciliationCreateInput): Promise<AiReconciliation> {
    return this.client.post<AiReconciliation>('/api/ai/reconciliations', JSON.stringify(input))
  }

  async listReconciliations(
    projectId: string,
    scenarioId?: string,
  ): Promise<AiReconciliationSummary[]> {
    const params = new URLSearchParams({ projectId })
    if (scenarioId) params.set('scenarioId', scenarioId)
    return this.client.get<AiReconciliationSummary[]>(
      `/api/ai/reconciliations?${params.toString()}`,
    )
  }

  async getReconciliation(id: string): Promise<AiReconciliation> {
    return this.client.get<AiReconciliation>(`/api/ai/reconciliations/${encodeURIComponent(id)}`)
  }

  async getReconciliationCanonical(id: string): Promise<{
    id: string
    projectId: string
    scenarioId: string
    conversationId: string
    status: AiReconciliationStatus
    verdicts: AiStepReconciliation[]
    briefs: AiImageBrief[]
    decisions: AiReconciliation['decisions']
  }> {
    return this.client.get(`/api/ai/reconciliations/${encodeURIComponent(id)}/canonical`)
  }

  async decideReconciliation(
    id: string,
    input: { stepId: string; hint: string; decision: 'accept' | 'reject'; definitionId?: string },
  ): Promise<AiReconciliation> {
    return this.client.post<AiReconciliation>(
      `/api/ai/reconciliations/${encodeURIComponent(id)}/decisions`,
      JSON.stringify(input),
    )
  }

  async clearReconciliationDecision(
    id: string,
    stepId: string,
    hint: string,
  ): Promise<AiReconciliation> {
    const params = new URLSearchParams({ stepId, hint })
    return this.client.deleteJson<AiReconciliation>(
      `/api/ai/reconciliations/${encodeURIComponent(id)}/decisions?${params.toString()}`,
    )
  }

  async updateReconciliation(
    id: string,
    patch: { title?: string; briefs?: AiReconciliationBriefPatch[] },
  ): Promise<AiReconciliation> {
    return this.client.patch<AiReconciliation>(
      `/api/ai/reconciliations/${encodeURIComponent(id)}`,
      JSON.stringify(patch),
    )
  }

  async acceptReconciliation(id: string): Promise<AiReconciliation> {
    return this.client.post<AiReconciliation>(
      `/api/ai/reconciliations/${encodeURIComponent(id)}/accept`,
      '',
    )
  }

  async rejectReconciliation(id: string): Promise<AiReconciliation> {
    return this.client.post<AiReconciliation>(
      `/api/ai/reconciliations/${encodeURIComponent(id)}/reject`,
      '',
    )
  }

  async createProposal(input: AiProposalCreateInput): Promise<AiProposal> {
    return this.client.post<AiProposal>('/api/ai/proposals', JSON.stringify(input))
  }

  async listProposals(projectId: string): Promise<AiProposal[]> {
    return this.client.get<AiProposal[]>(
      `/api/ai/proposals?projectId=${encodeURIComponent(projectId)}`,
    )
  }

  async getProposal(id: string): Promise<AiProposal> {
    return this.client.get<AiProposal>(`/api/ai/proposals/${encodeURIComponent(id)}`)
  }

  async reportDryRun(
    id: string,
    input: {
      projectFingerprint: string
      ok: boolean
      errors: AiProposalValidationError[]
      validatedIndexes?: number[]
    },
  ): Promise<AiProposal> {
    return this.client.post<AiProposal>(
      `/api/ai/proposals/${encodeURIComponent(id)}/dry-run`,
      JSON.stringify(input),
    )
  }

  async approveProposal(
    id: string,
    input: { currentFingerprint: string; selectedIndexes?: number[] },
  ): Promise<AiProposal> {
    return this.client.post<AiProposal>(
      `/api/ai/proposals/${encodeURIComponent(id)}/approve`,
      JSON.stringify(input),
    )
  }

  async recordExecution(
    id: string,
    input: { historyEntryId: string; executedIndexes: number[]; success: boolean; error?: string },
  ): Promise<AiProposal> {
    return this.client.post<AiProposal>(
      `/api/ai/proposals/${encodeURIComponent(id)}/execute`,
      JSON.stringify(input),
    )
  }

  async createNarration(input: {
    projectId: string
    reconciliationId: string
    conversationId: string
    defaultVoicePromptId?: string
    secondsPerCharacter?: number
  }): Promise<AiNarration> {
    return this.client.post<AiNarration>('/api/ai/narrations', JSON.stringify(input))
  }

  async listNarrations(
    projectId: string,
    reconciliationId?: string,
  ): Promise<AiNarrationSummary[]> {
    const params = new URLSearchParams({ projectId })
    if (reconciliationId) params.set('reconciliationId', reconciliationId)
    return this.client.get<AiNarrationSummary[]>(`/api/ai/narrations?${params.toString()}`)
  }

  async getNarration(id: string): Promise<AiNarration> {
    return this.client.get<AiNarration>(`/api/ai/narrations/${encodeURIComponent(id)}`)
  }

  async getNarrationCanonical(id: string): Promise<{
    id: string
    projectId: string
    reconciliationId: string
    scenarioId: string
    conversationId: string
    status: AiNarrationStatus
    defaultVoicePromptId: string | null
    secondsPerCharacter: number
    parts: AiNarrationPart[]
    slideDuration: number
  }> {
    return this.client.get(`/api/ai/narrations/${encodeURIComponent(id)}/canonical`)
  }

  async updateNarrationVoices(
    id: string,
    patch: { defaultVoicePromptId?: string | null; partVoices?: Record<string, string | null> },
  ): Promise<AiNarration> {
    return this.client.patch<AiNarration>(
      `/api/ai/narrations/${encodeURIComponent(id)}`,
      JSON.stringify(patch),
    )
  }

  async generateNarration(id: string): Promise<{
    narration: AiNarration
    results: AiNarrationGenerateResult[]
  }> {
    return this.client.post(`/api/ai/narrations/${encodeURIComponent(id)}/generate`, '')
  }

  async markNarrationPartReady(
    id: string,
    stepId: string,
    input: { assetId: string; audioDuration: number },
  ): Promise<AiNarration> {
    return this.client.post<AiNarration>(
      `/api/ai/narrations/${encodeURIComponent(id)}/parts/${encodeURIComponent(stepId)}/ready`,
      JSON.stringify(input),
    )
  }

  async markNarrationPartFailed(id: string, stepId: string, error: string): Promise<AiNarration> {
    return this.client.post<AiNarration>(
      `/api/ai/narrations/${encodeURIComponent(id)}/parts/${encodeURIComponent(stepId)}/fail`,
      JSON.stringify({ error }),
    )
  }

  async retryNarrationPart(id: string, stepId: string): Promise<AiNarration> {
    return this.client.post<AiNarration>(
      `/api/ai/narrations/${encodeURIComponent(id)}/parts/${encodeURIComponent(stepId)}/retry`,
      '',
    )
  }

  async acceptNarration(id: string): Promise<AiNarration> {
    return this.client.post<AiNarration>(`/api/ai/narrations/${encodeURIComponent(id)}/accept`, '')
  }

  async rejectNarration(id: string): Promise<AiNarration> {
    return this.client.post<AiNarration>(`/api/ai/narrations/${encodeURIComponent(id)}/reject`, '')
  }
}
