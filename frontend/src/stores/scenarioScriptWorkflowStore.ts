import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlannerResult } from '../ai/scenarioPlanner'

/**
 * Persisted script-draft workflow (per project): the generated plan plus
 * which steps completed, so closing and reopening the Scenario modal keeps
 * the draft, the active buttons, and the per-step Regenerate states instead
 * of forcing a re-generate. Completed buttons flip to Regenerate labels.
 *
 * Keyed by project id. A stored workflow is only reused while its
 * `fingerprint` (the plan inputs: reading speed, split chars, bindings,
 * chalk HTML, foreign words) still matches the live project — otherwise
 * the plan is meaningless and Generate starts over. An accepted-version
 * change does NOT discard: the preview stays visible and reads stale
 * (re-generate to refresh), matching the previous in-memory behaviour.
 */
export interface ScenarioScriptWorkflow {
  readonly acceptedVersionId: string
  readonly fingerprint: string
  readonly plan: PlannerResult
  /** Effective foreign vocabulary the plan was built from (HTML highlights
   *  + stored list): batch TTS speaks exact matches in the foreign
   *  language, everything else in English. */
  readonly foreignWords: readonly string[]
  readonly prompterApplied: boolean
  /** Slide positions (1-based) with finished batch TTS. */
  readonly ttsDone: Readonly<Record<number, true>>
  /** Slide positions (1-based) with applied board scripts. */
  readonly boardDone: Readonly<Record<number, true>>
}

interface ScenarioScriptWorkflowState {
  readonly workflowsByProject: Record<string, ScenarioScriptWorkflow>
  savePreview: (projectId: string, workflow: ScenarioScriptWorkflow) => void
  /** Step 1 (re-)apply: marks prompter done and clears per-step TTS/board
   *  states, since parts are recreated with new ids (audio links dropped). */
  markPrompterApplied: (projectId: string) => void
  markTtsDone: (projectId: string, position: number) => void
  markBoardDone: (projectId: string, position: number) => void
  clearWorkflow: (projectId: string) => void
}

/** Short stable hash for large plan inputs (chalk HTML). Pure. */
export function hashPlanInputText(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function buildScriptWorkflowFingerprint(input: {
  secondsPerCharacter: number
  splitChars: readonly string[]
  bindings: Readonly<Record<string, string>> | undefined
  html: string | undefined
  foreignWords: readonly string[] | undefined
}): string {
  return JSON.stringify({
    spc: input.secondsPerCharacter,
    split: [...input.splitChars],
    bindings: input.bindings ?? {},
    html: hashPlanInputText(input.html ?? ''),
    foreign: [...(input.foreignWords ?? [])],
  })
}

export const useScenarioScriptWorkflowStore = create<ScenarioScriptWorkflowState>()(
  persist(
    (set) => ({
      workflowsByProject: {},

      savePreview: (projectId, workflow) => {
        set((state) => ({
          workflowsByProject: { ...state.workflowsByProject, [projectId]: workflow },
        }))
      },

      markPrompterApplied: (projectId) => {
        set((state) => {
          const current = state.workflowsByProject[projectId]
          if (!current) return state
          return {
            workflowsByProject: {
              ...state.workflowsByProject,
              [projectId]: { ...current, prompterApplied: true, ttsDone: {}, boardDone: {} },
            },
          }
        })
      },

      markTtsDone: (projectId, position) => {
        set((state) => {
          const current = state.workflowsByProject[projectId]
          if (!current) return state
          return {
            workflowsByProject: {
              ...state.workflowsByProject,
              [projectId]: { ...current, ttsDone: { ...current.ttsDone, [position]: true } },
            },
          }
        })
      },

      markBoardDone: (projectId, position) => {
        set((state) => {
          const current = state.workflowsByProject[projectId]
          if (!current) return state
          return {
            workflowsByProject: {
              ...state.workflowsByProject,
              [projectId]: { ...current, boardDone: { ...current.boardDone, [position]: true } },
            },
          }
        })
      },

      clearWorkflow: (projectId) => {
        set((state) => {
          if (!(projectId in state.workflowsByProject)) return state
          const next = { ...state.workflowsByProject }
          delete next[projectId]
          return { workflowsByProject: next }
        })
      },
    }),
    {
      name: 'scenario-script-workflow',
      partialize: (state) => ({ workflowsByProject: state.workflowsByProject }),
    },
  ),
)
