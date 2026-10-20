/**
 * Inline doc-comment thread seam (pure, no I/O, no DOM).
 *
 * Comments anchor to a rendered doc block (top-level block index plus an
 * optional table-cell coordinate) with the step inferred from the nearest
 * preceding `## Step N` heading. The resolve step bundles the whole thread
 * into one `edit:`-prefixed chat message so the scenario assistant treats it
 * as an edit request and replies with the corrected full markdown as usual.
 */

export interface ScenarioDocCellAnchor {
  readonly row: number
  readonly col: number
  readonly cellText: string
}

export interface ScenarioDocComment {
  readonly id: string
  readonly step?: number
  readonly stepTitle?: string
  readonly blockKind: string
  readonly quote: string
  readonly comment: string
  readonly blockIndex: number
  readonly cell?: ScenarioDocCellAnchor
}

export function truncateCommentText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function commentStepLabel(comment: Pick<ScenarioDocComment, 'step' | 'stepTitle'>): string {
  if (comment.step === undefined) return 'General'
  const title = (comment.stepTitle ?? '').trim()
  return title ? `Step ${comment.step} — ${title}` : `Step ${comment.step}`
}

/**
 * Single `edit:`-prefixed fix request bundling every inline comment. Each
 * item carries its step, block kind, selected text, and the correction note.
 */
export function buildScenarioCommentsMessage(comments: readonly ScenarioDocComment[]): string {
  const header =
    `edit: Apply ${comments.length} inline doc comment${comments.length === 1 ? '' : 's'} ` +
    `below to the scenario doc. Reply with the corrected full markdown (same steps, ` +
    `corrected) plus Summary: and Touched-steps: lines as usual. ` +
    `Do not claim anything was created.`
  const items = comments.map((comment) => {
    const where =
      comment.cell !== undefined
        ? `${comment.blockKind} (row ${comment.cell.row}, column ${comment.cell.col})`
        : comment.blockKind
    return (
      `\n- ${commentStepLabel(comment)} · ${where}\n` +
      `  Selected: "${comment.quote}"\n` +
      `  Comment: ${comment.comment}`
    )
  })
  return `${header}\n${items.join('\n')}`
}
