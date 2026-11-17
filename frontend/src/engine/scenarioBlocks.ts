/**
 * Scenario doc block seam (pure, no I/O, no DOM).
 *
 * The scenario doc view renders markdown through `ScenarioDocMarkdown`,
 * which unwraps a whole-doc `markdown` fence, rewrites whole-line
 * `<!-- reuse: Name -->` comments to `> Reuse: Name` quotes, and isolates
 * glued board lines with blank lines before ReactMarkdown parses it. A
 * rendered top-level block is therefore NOT one blank-separated source
 * chunk: glued board lines render as several blocks while splitting the raw
 * source on blank lines sees a single chunk. Indexing that naive split by
 * the rendered block index edits or deletes the wrong block (deleting the
 * last rendered block can even no-op when its index is out of range).
 *
 * `splitScenarioDocBlocks` mirrors that preprocessing (same fence unwrap,
 * same board-line isolation) and splits the result the way the renderer
 * does, returning the ORIGINAL source text per rendered block so manual
 * block edits preserve markdown syntax (`##`, `![alt](asset:...)`,
 * `<!-- reuse: -->`, ...). Callers must still verify the returned array
 * length matches the rendered top-level block count before indexing by it —
 * pathological CommonMark inputs (a glued `#` heading, a setext `---`)
 * can disagree, and a loud error beats touching the wrong block.
 */

export const SCENARIO_REUSE_COMMENT_RE = /^<!--\s*reuse:\s*(.+?)\s*-->$/gim

// Board lines that must stand alone: the model often writes them glued to
// surrounding paragraphs (no blank lines), which markdown then merges into
// one paragraph so no chip renders. Isolation inserts the blank lines;
// fenced code blocks are left untouched. Table rows must never match.
export const SCENARIO_BOARD_LINE_RE =
  /^\s*(\[place:|\[reveal:|\[remove:|\[wipe\]|!\[|> Brief:|> Label:|<!-- reuse:)/i

const FENCED_CODE_RE = /^\s*```/
const INDENTED_RE = /^\s+\S/

/** Unwrap chat responses that fence the entire scenario as `markdown` code. */
export function unwrapScenarioMarkdownFence(content: string): string {
  const lines = content.trim().split('\n')
  if (
    lines.length >= 3 &&
    /^\s*```(?:markdown|md)?\s*$/i.test(lines[0] ?? '') &&
    /^\s*```\s*$/.test(lines[lines.length - 1] ?? '')
  ) {
    return lines.slice(1, -1).join('\n')
  }
  return content
}

export function isolateScenarioBoardLines(content: string): string {
  const lines = content.split('\n')
  const out: string[] = []
  let fenced = false
  lines.forEach((line, index) => {
    if (FENCED_CODE_RE.test(line)) fenced = !fenced
    const marker = !fenced && SCENARIO_BOARD_LINE_RE.test(line)
    if (marker && out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('')
    out.push(line)
    if (marker) {
      const next = lines[index + 1]
      if (next !== undefined && next.trim() !== '') out.push('')
    }
  })
  return out.join('\n')
}

/** Bullet char (`-`/`*`/`+`) or `ordered`; null when not a list item line. */
function listMarkerKey(line: string): string | null {
  const match = /^\s*([-*+]|\d+[.)])\s+/.exec(line)
  if (!match) return null
  const marker = match[1] ?? ''
  return /^\d/.test(marker) ? 'ordered' : marker
}

/**
 * Split scenario markdown into one ORIGINAL-source chunk per rendered
 * top-level block, in document order. Mirrors `ScenarioDocMarkdown`:
 * fence unwrap, reuse-comment rewrite (line-preserving), board-line
 * isolation, then a blank-line split that never breaks fenced code and
 * never breaks one list across blank-separated items (both render as a
 * single block). Joined with `'\n\n'`, the result normalizes glued board
 * lines apart but otherwise preserves the source byte-for-byte.
 */
export function splitScenarioDocBlocks(markdown: string): string[] {
  const unwrapped = unwrapScenarioMarkdownFence(markdown)
  const originalLines = unwrapped.split('\n')
  // Same whole-line rewrite the renderer applies before parsing. Each match
  // stays on its own line, so prepared line N is original line N.
  const preparedLines = unwrapped.replace(SCENARIO_REUSE_COMMENT_RE, '> Reuse: $1').split('\n')
  // Insert blanks around glued board lines exactly like the renderer,
  // remembering the original line number (-1 for inserted blanks).
  interface Tracked {
    readonly text: string
    readonly origin: number
  }
  const tracked: Tracked[] = []
  let fenced = false
  preparedLines.forEach((text, index) => {
    if (FENCED_CODE_RE.test(text)) fenced = !fenced
    const marker = !fenced && SCENARIO_BOARD_LINE_RE.test(text)
    if (marker && tracked.length > 0 && tracked[tracked.length - 1]!.text.trim() !== '') {
      tracked.push({ text: '', origin: -1 })
    }
    tracked.push({ text, origin: index })
    if (marker) {
      const next = preparedLines[index + 1]
      if (next !== undefined && next.trim() !== '') tracked.push({ text: '', origin: -1 })
    }
  })
  const chunks: Tracked[][] = []
  let current: Tracked[] = []
  let chunkHasListItem = false
  let chunkHasNonListContent = false
  let chunkListKey: string | null = null
  let inFence = false
  const flush = (): void => {
    if (current.some((line) => line.origin >= 0)) chunks.push(current)
    current = []
    chunkHasListItem = false
    chunkHasNonListContent = false
    chunkListKey = null
  }
  const absorb = (line: Tracked): void => {
    current.push(line)
    if (line.origin < 0 || FENCED_CODE_RE.test(line.text)) return
    const key = listMarkerKey(line.text)
    if (key !== null) {
      chunkHasListItem = true
      if (chunkListKey === null) chunkListKey = key
    } else if (!INDENTED_RE.test(line.text)) {
      chunkHasNonListContent = true
    }
  }
  for (let i = 0; i < tracked.length; i += 1) {
    const line = tracked[i]!
    if (FENCED_CODE_RE.test(line.text)) inFence = !inFence
    if (inFence || line.text.trim() !== '') {
      absorb(line)
      continue
    }
    // Blank line outside fenced code: separator, unless it sits between the
    // items of one list (blank-separated `- a` / `- b` renders as one <ul>).
    let j = i + 1
    while (j < tracked.length && tracked[j]!.text.trim() === '') j += 1
    const next = tracked[j]
    const nextKey = next ? listMarkerKey(next.text) : null
    if (
      next &&
      nextKey !== null &&
      chunkHasListItem &&
      !chunkHasNonListContent &&
      chunkListKey !== null &&
      nextKey === chunkListKey
    ) {
      for (let k = i; k < j; k += 1) current.push(tracked[k]!)
      i = j - 1
      continue
    }
    flush()
  }
  flush()
  return chunks
    .map((chunk) => {
      const origins = chunk.map((line) => line.origin).filter((n) => n >= 0)
      const start = Math.min(...origins)
      const end = Math.max(...origins)
      return originalLines.slice(start, end + 1).join('\n')
    })
    .filter((block) => block.trim() !== '')
}

const STEP_HEADING_BLOCK_RE = /^\s*##\s+Step\b/i
const VISUAL_IMAGE_BLOCK_RE = /!\[[^\]]*\]\(\s*asset:[^)\s]+\s*\)/i
const VISUAL_META_BLOCK_RE = /^\s*(>\s*Brief:|>\s*Label:|<!--\s*reuse:|>\s*Reuse:)/i
const PLACE_BLOCK_RE = /^\s*\[place:\s*(.+?)\s*\]\s*$/i

function normalizeBlockKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ /g, '-')
}

/**
 * Deletion range for one rendered block index (inclusive start/end).
 *
 * Single-block deletes are exact except for two semantic units that never
 * survive alone:
 * - a `## Step N` heading deletes the whole step (heading through the last
 *   block before the next step heading), otherwise the orphaned body merges
 *   into the previous step on the next parse and the section "comes back".
 * - a visual image `![alt](asset:slug)` deletes its attached meta lines
 *   (`> Brief:` / `> Label:` / reuse) plus an immediately following
 *   `[place: slug]` for the same slug, otherwise the visual (or a dangling
 *   place) survives the delete and reappears in HTML/script prompt blocks.
 */
export function getScenarioBlockDeletionRange(
  blocks: readonly string[],
  blockIndex: number,
): { readonly start: number; readonly end: number } {
  if (blockIndex < 0 || blockIndex >= blocks.length) return { start: blockIndex, end: blockIndex }
  const head = (blocks[blockIndex] ?? '').trim()
  if (STEP_HEADING_BLOCK_RE.test(head)) {
    let end = blockIndex
    for (let i = blockIndex + 1; i < blocks.length; i += 1) {
      if (STEP_HEADING_BLOCK_RE.test((blocks[i] ?? '').trim())) break
      end = i
    }
    return { start: blockIndex, end }
  }
  const visualMatch = VISUAL_IMAGE_BLOCK_RE.exec(blocks[blockIndex] ?? '')
  if (visualMatch) {
    const slugMatch = /\(\s*asset:([^)\s]+)\s*\)/i.exec(blocks[blockIndex] ?? '')
    const visualKey = normalizeBlockKey(slugMatch?.[1] ?? '')
    let end = blockIndex
    for (let i = blockIndex + 1; i < blocks.length; i += 1) {
      const next = (blocks[i] ?? '').trim()
      if (VISUAL_META_BLOCK_RE.test(next)) {
        end = i
        continue
      }
      const placeMatch = PLACE_BLOCK_RE.exec(next)
      if (placeMatch && visualKey !== '' && normalizeBlockKey(placeMatch[1] ?? '') === visualKey) {
        end = i
        continue
      }
      break
    }
    return { start: blockIndex, end }
  }
  return { start: blockIndex, end: blockIndex }
}
