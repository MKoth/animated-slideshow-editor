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
  'a table cell may contain multiple independently named text nodes: create each with `create text ... inside table.cell(r, c)`, position them independently with `at (x, y)` or transform calls, and time their reveals separately; ' +
  'do not use a backslash-n (`\\n`) escape or literal line breaks inside a text string to wrap cell content — that does not reliably create separate visible lines here; instead split long cell content into multiple text nodes inside that SAME cell, place each on its own line with its own x/y position, and reveal them sequentially at their narration times with a natural stagger — never reveal all the lines simultaneously; when the sentence leaves, remove or fade the lines sequentially in reverse order of appearance, not all at once; split at complete, meaningful phrase boundaries and keep each text node readable; never split one logical cell into multiple table cells as a text-layout workaround; ' +
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
  'Never leave the blackboard empty while the narrator speaks: if no visual is ' +
  'scheduled for a spoken stretch, show a full informative phrase taken from that narration — a complete ' +
  'clause or sentence, never keywords or fragments — timed to the spoken idea. The on-screen phrase must be ' +
  'self-contained: a viewer reading only the board can tell which narration point it supports. Distinguish ' +
  'temporary spoken support from important key ideas, definitions, and translations: do not automatically erase ' +
  'an important phrase as soon as it has been spoken. When it remains relevant and space permits, keep it on ' +
  'the board while the narration continues; add related explanations or translations around it (above, below, ' +
  'left, or right) so the board can build into an organized cumulative summary. Keep these ideas visible until ' +
  'the topic changes, a new table/image/phrase replaces them, they are no longer relevant, or the board would ' +
  'become crowded. Temporary filler may still clear at its natural handoff. Choose deliberately what persists ' +
  'and what leaves; do not use an automatic appear-then-immediately-disappear pattern for every phrase. ' +
  'When removing content, clear it in a natural sequence (including reverse-order removal for split lines) and ' +
  'keep narration timing intact. ' +
  'Use large, readable fontSize values throughout the blackboard, especially inside tables: 40px or larger is ' +
  'preferred; use 50px and 60px or larger whenever the available space allows. Make text larger rather than ' +
  'shrinking it to squeeze too much into one cell: split long content into multiple independently positioned ' +
  'text nodes in the same cell, give the row enough height, and use concise line-sized phrases. Only reduce ' +
  'below 40px when genuinely necessary to fit the camera-visible area without clipping; never emit tiny, ' +
  'hard-to-read text. For standalone transient phrases, use the largest readable size that fits, with ' +
  '`alignment: "center"` ' +
  '(the exact text property name is `alignment`, never `align`), and keep it ' +
  'inside the camera visible area without clipping or covering important visuals. ' +
  'Calculate text placement from its rendered width and height at the chosen fontSize, and recalculate after ' +
  'every size or content change. A regular standalone Text Node is centered on its transform position: its ' +
  'bounds extend roughly half its rendered width/height on each side, so to place its left/top edge at (L, T), ' +
  'set its center to approximately (L + width/2, T + height/2). Table-cell text has a special offset: its ' +
  '`at (x, y)` is effectively an inset from the cell’s padded top-left, so increasing fontSize or text length ' +
  'grows the text to the right and down from that inset. Account for the full resulting bounds, padding, and ' +
  'cell dimensions; do not reuse coordinates calculated for a smaller font or assume the text fits because its ' +
  'center/inset is inside the frame. Keep every text bound fully inside the active camera’s visible-world ' +
  'rectangle and its table cell where applicable, with a deliberate safety margin; if it does not fit, reposition, ' +
  'split into sequential text nodes, resize the row, or choose a different layout before reducing font size. ' +
  'Never split a studied-language phrase: when the narrator pronounces a phrase in the studied language, show that ' +
  'whole phrase intact, never only part of it. Prompter blocks can overlap: when a later block overlaps and its end is ' +
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
    'A table cell may contain multiple independently named text nodes; create them inside the same ' +
    'table.cell(r, c), position each independently, and do not split one logical cell into multiple ' +
    'table cells to work around text layout. ' +
    'Do not reply with only an explanation or a list of changes.\n\n' +
    `Validation errors:\n${errors}\n\n` +
    `Complete failed script:\n<failed-script>\n${source}\n</failed-script>`
  )
}
