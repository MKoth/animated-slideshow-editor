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
    // No block cap: the assistant must see the full narration span, otherwise
    // a long prompter reads as ending early (e.g. 45.8s on a 107s slide).
    promptBlocks,
    // No cap: every check diagnostic rides the context.
    diagnostics: diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      line: diagnostic.line,
      column: diagnostic.column,
      message: diagnostic.message,
    })),
  }
}

/** Canned "improve timing" request: narration-fit editing of the draft. */
export const IMPROVE_SCRIPT_PROMPT =
  'Improve this script so the visuals fit the narration better — timing only: retime reveals, wipes, ' +
  'marks, waits, and effect at/over placements; ' +
  'preserve the existing staging exactly: keep the script header `from`, any `setCamera(...)`, and ' +
  'every background/board `create` line (asset, position, scale) unchanged; do not add, remove, or ' +
  'retune camera or background/board transforms; ' +
  'trust the active camera visible-world area from context as authoritative by default — never ask ' +
  'whether to trust the camera versus board dimensions and never emit camera-geometry questions; ' +
  'no visual appears before the narrator mentions it; labels appear when their text is pronounced; ' +
  'tables are drawn on a general mention and each cell fills as its text is spoken; ' +
  'make tables as large as the current board layout safely allows without moving or resizing the ' +
  'background/board or changing the camera: estimate available space from ' +
  'the current setting and surrounding content, then enlarge the table and its text together so it ' +
  'is easy to read without clipping or obscuring important visuals; increase table font sizes too ' +
  'when they fit; ' +
  'for a table with separately timed cell reveals, use reveal(nodeOnly(table)) for the border: ' +
  'reveal(table) also reveals all descendant cell text, and per-cell future reveal masks hide text ' +
  'until its turn, so do not add mask-setup wipes; use reveal(table) only for a composite reveal; ' +
  'default to a purposeful variety of distinct, coordinated colors across the board (for example, ' +
  'different colors for headings, categories, highlights, and table groups) instead of relying on ' +
  'one color throughout — never leave tables or text all in the same color; keep contrast and ' +
  'readability high; ' +
  'use mark() often to re-emphasize things already on screen instead of recreating them — when the ' +
  'narrator returns to written text or a cell, accentuate it again with mark(); mark() takes no ' +
  'wobbleX/wobbleY/wobbleSpeed/direction (they are compile errors) and its visual is optional: omit ' +
  'visual for a quiet built-in marker underline that avoids on-screen clutter, pass `visual: chalkHand, ' +
  'visualScale: 4, visualAnchor: "top-center", sound: writeSfx` only when a paw performer is wanted; ' +
  'for long spoken stretches with no visual, add one short phrase that appears at the stretch start ' +
  'and leaves at its end. Prompter blocks can overlap: when a later block overlaps and its end is ' +
  "later than the current block's end, the current block effectively ends at the later block's start; " +
  'the farther-ending block then has priority, until another overlapping block ends even later. ' +
  'A later block with an earlier end does not take priority. Respect these effective handoffs when ' +
  'placing visuals against the spoken text; do not treat overlapping block windows as simultaneous ' +
  'subtitle ownership. ' +
  'If anything is ambiguous (other than camera/board geometry, which you already trust), ask me with choice buttons before rewriting.'

/** One-button resubmission of check/run errors for the assistant to fix. */
export function formatScriptErrorPrompt(
  errors: readonly { message: string; line: number; column: number }[],
): string {
  const lines = errors.map((error) => `Line ${error.line}, Col ${error.column}: ${error.message}`)
  return (
    'Fix these script errors, keeping everything else the same:\n' +
    lines.map((line) => `- ${line}`).join('\n')
  )
}

/** Send the exact rejected script with its diagnostics so the assistant can repair it. */
export function formatScriptRepairPrompt(source: string, errors: string): string {
  return (
    'Repair the failed animation script below. Use the validation errors to fix it, preserve ' +
    'its intended behavior, and return the complete corrected script in the required script block. ' +
    'Do not reply with only an explanation or a list of changes.\n\n' +
    `Validation errors:\n${errors}\n\n` +
    `Complete failed script:\n<failed-script>\n${source}\n</failed-script>`
  )
}
