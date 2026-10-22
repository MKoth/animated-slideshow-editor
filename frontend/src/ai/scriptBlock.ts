/**
 * Extracts the first appliable animation script block from an assistant
 * message. The template contract asks the animation advisor to put the
 * single source of truth for Apply inside one fenced block holding real
 * Animation Script DSL plus a `slide:` header line:
 *
 * ```engine-command
 * slide: Slide 1
 * script "Scene Animation Sequence" from 0
 * bind cat = node("Cat")
 * ...
 * ```
 *
 * Pure and read-only: parses text, never touches engine state.
 */

export interface ScriptBlock {
  /** Animation Script DSL source (slide header line excluded). */
  readonly source: string
  /** Slide name from the `slide:` header line, or null when absent. */
  readonly slideHint: string | null
}

const FENCE_RE = /```(\w[\w-]*)\s*\n([\s\S]*?)```/g

/** The block must look like script source, not prose or pseudo-syntax. */
function isScriptSource(body: string): boolean {
  return /^\s*script\s+"[^"]+"\s+from\s+[\d.]+/m.test(body)
}

function parseBlock(body: string): ScriptBlock {
  const lines = body.split('\n')
  let slideHint: string | null = null
  const sourceLines: string[] = []
  for (const line of lines) {
    if (slideHint === null) {
      const match = /^\s*slide\s*[:=]\s*["']?([^"'\n]+?)["']?\s*$/.exec(line)
      if (match?.[1]?.trim()) {
        slideHint = match[1].trim()
        continue
      }
    }
    sourceLines.push(line)
  }
  return { source: sourceLines.join('\n').trim(), slideHint }
}

export function extractScriptBlock(content: string): ScriptBlock | null {
  if (!content) return null
  FENCE_RE.lastIndex = 0
  for (const match of content.matchAll(FENCE_RE)) {
    const lang = (match[1] ?? '').toLowerCase()
    const body = (match[2] ?? '').trim()
    if (!body) continue
    if (lang !== 'engine-command' && lang !== 'engine-commands') continue
    if (!isScriptSource(body)) continue
    const parsed = parseBlock(body)
    if (!parsed.source) continue
    return parsed
  }
  return null
}

export function hasAppliableScript(content: string): boolean {
  return extractScriptBlock(content) !== null
}

export interface SlideRef {
  readonly id: string
  readonly name: string
}

/**
 * Resolves the block's slide name against the snapshot slide list.
 * Exact (case-insensitive) match wins; a stable slide id also matches for an
 * explicit override; a single-slide project resolves without a header;
 * otherwise falls back to the active slide id.
 */
export function resolveScriptSlideId(
  slides: readonly SlideRef[],
  slideHint: string | null,
  activeSlideId: string | null,
): string | null {
  if (slideHint) {
    const needle = slideHint.trim().toLowerCase()
    const exact = slides.find((s) => s.name.toLowerCase() === needle)
    if (exact) return exact.id
    // Explicit override by stable slide id (context renders `Name [id]`).
    const byId = slides.find((s) => s.id.toLowerCase() === needle)
    if (byId) return byId.id
  }
  if (slides.length === 1) return slides[0]?.id ?? null
  return activeSlideId
}
