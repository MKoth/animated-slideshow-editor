import type { EnginePublic, Slide } from '../engine'

export interface ScriptFocusPromptBlock {
  id: string
  start: number
  end: number
  text: string
}

export interface ScriptFocusDiagnostic {
  severity: 'error' | 'warning'
  line: number
  column: number
  message: string
}

export interface ScriptFocus {
  slideId: string
  slideName: string
  duration: number
  source: string
  promptBlocks: ScriptFocusPromptBlock[]
  diagnostics: ScriptFocusDiagnostic[]
}

function findSlide(engine: EnginePublic, slideId: string): Slide | null {
  try {
    const slides = engine.project?.slides ?? []
    return slides.find((slide) => slide.id === slideId) ?? null
  } catch {
    return null
  }
}

/**
 * Script-assistant focus: the slide's current script source, its prompt
 * blocks (id + spoken window + text), and the latest check diagnostics.
 * Pure and read-only: reads engine state, never touches mutation paths.
 */
export function buildScriptFocus(
  engine: EnginePublic,
  slideId: string,
  draft: string,
  diagnostics: readonly ScriptFocusDiagnostic[],
): ScriptFocus | null {
  const slide = findSlide(engine, slideId)
  if (!slide) return null
  const promptBlocks: ScriptFocusPromptBlock[] = []
  try {
    for (const part of slide.prompter?.parts ?? []) {
      if (!part.id) continue
      promptBlocks.push({
        id: part.id,
        start: part.startTime,
        end: part.endTime,
        text: part.text,
      })
    }
  } catch {
    // Prompter unreadable — focus carries the script without blocks.
  }
  return {
    slideId: slide.id,
    slideName: slide.name,
    duration: slide.duration,
    source: draft,
    promptBlocks: promptBlocks.slice(0, 50),
    diagnostics: diagnostics.slice(0, 20).map((diagnostic) => ({
      severity: diagnostic.severity,
      line: diagnostic.line,
      column: diagnostic.column,
      message: diagnostic.message,
    })),
  }
}

/** Canned "improve timing" request: narration-fit editing of the draft. */
export const IMPROVE_SCRIPT_PROMPT =
  'Improve this script so the visuals fit the narration better: ' +
  'no visual appears before the narrator mentions it; labels appear when their text is pronounced; ' +
  'tables are drawn on a general mention and each cell fills as its text is spoken; ' +
  'use mark() to re-emphasize things already on screen instead of recreating them; ' +
  'for long spoken stretches with no visual, add one short phrase that appears at the stretch start ' +
  'and leaves at its end. ' +
  'If anything is ambiguous, ask me with choice buttons before rewriting.'

/** One-button resubmission of check/run errors for the assistant to fix. */
export function formatScriptErrorPrompt(
  errors: readonly { message: string; line: number; column: number }[],
): string {
  const lines = errors
    .slice(0, 20)
    .map((error) => `Line ${error.line}, Col ${error.column}: ${error.message}`)
  return (
    'Fix these script errors, keeping everything else the same:\n' +
    lines.map((line) => `- ${line}`).join('\n')
  )
}
