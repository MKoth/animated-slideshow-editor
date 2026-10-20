import { useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { ScenarioDocMarkdown } from '../../ai/markdown'
import {
  buildScenarioCommentsMessage,
  commentStepLabel,
  truncateCommentText,
  type ScenarioDocCellAnchor,
  type ScenarioDocComment,
} from '../../engine/scenarioDocComments'
import { useAiStore } from '../../stores/aiStore'

interface PendingAnchor {
  readonly step?: number
  readonly stepTitle?: string
  readonly blockKind: string
  readonly blockIndex: number
  readonly cell?: ScenarioDocCellAnchor
  readonly quote: string
  readonly x: number
  readonly y: number
}

const MAX_QUOTE = 2000
const QUOTE_PREVIEW = 280
const BLOCK_BTN_TESTID = 'ai-scenario-comment-block-btn'
const CELL_BTN_TESTID = 'ai-scenario-comment-cell-btn'
const BTN_SELECTOR = '[data-comment-btn]'

function markdownRoot(doc: HTMLElement): HTMLElement | null {
  return doc.querySelector(':scope > .ai-markdown') ?? doc.querySelector('.ai-markdown')
}

function kindOfBlock(block: HTMLElement): string {
  if (block.matches('h1')) return 'title'
  if (block.matches('h2')) return 'step heading'
  if (block.matches('h3, h4, h5, h6')) return 'heading'
  if (block.matches('p.scenario-narrator')) return 'narrator'
  if (block.matches('p.scenario-action-line')) return 'board action'
  if (block.matches('p.scenario-visual-line')) return 'visual'
  if (block.matches('blockquote.scenario-brief')) return 'brief'
  if (block.matches('blockquote.scenario-reuse')) return 'reuse'
  if (block.matches('blockquote.scenario-label')) return 'label'
  if (block.matches('blockquote')) return 'quote'
  if (block.matches('table')) return 'table'
  if (block.matches('ul, ol')) return 'list'
  if (block.matches('pre')) return 'code'
  if (block.matches('hr')) return 'divider'
  return block.tagName.toLowerCase()
}

function parseStepHeading(head: HTMLElement): { step?: number; stepTitle?: string } {
  const badge = head.querySelector('.scenario-step-badge')?.textContent ?? ''
  const title = head.querySelector('.scenario-step-title')?.textContent?.trim() ?? ''
  const fromBadge = /Step\s+(\d+)/i.exec(badge)
  if (fromBadge) {
    return {
      step: Number.parseInt(fromBadge[1] ?? '', 10),
      ...(title ? { stepTitle: title } : {}),
    }
  }
  const fallback = /^\s*Step\s+(\d+)\s*(?:[—–\-:.]?\s*(.*))?$/i.exec(head.textContent ?? '')
  if (fallback) {
    return {
      step: Number.parseInt(fallback[1] ?? '', 10),
      ...((fallback[2] ?? '').trim() ? { stepTitle: (fallback[2] ?? '').trim() } : {}),
    }
  }
  return {}
}

/** 1-based coordinates in document order (thead/tbody-agnostic). */
function cellCoords(cell: HTMLElement): { row: number; col: number } {
  const row = cell.parentElement
  const table = cell.closest('table')
  const allRows: HTMLElement[] = table ? Array.from(table.querySelectorAll('tr')) : []
  const rowIdx = row ? allRows.indexOf(row) : -1
  const colIdx = row ? Array.from(row.children).indexOf(cell) : -1
  return { row: Math.max(1, rowIdx + 1), col: Math.max(1, colIdx + 1) }
}

function unwrapMarks(doc: HTMLElement): void {
  for (const mark of Array.from(doc.querySelectorAll('mark.scenario-comment-mark'))) {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  }
  for (const el of Array.from(doc.querySelectorAll('.has-doc-comment, .has-doc-comment-cell'))) {
    el.classList.remove('has-doc-comment', 'has-doc-comment-cell')
  }
}

/** Best-effort exact-range highlight: wraps the first same-text-node match. */
function markQuoteInBlock(block: HTMLElement, quote: string): void {
  if (!quote) return
  try {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      if (node.parentElement?.closest('mark.scenario-comment-mark')) {
        node = walker.nextNode() as Text | null
        continue
      }
      const at = node.data.indexOf(quote)
      if (at >= 0) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + quote.length)
        const mark = document.createElement('mark')
        mark.className = 'scenario-comment-mark'
        range.surroundContents(mark)
        return
      }
      node = walker.nextNode() as Text | null
    }
  } catch {
    // jsdom or split-text edge cases: block outline still marks the anchor.
  }
}

const COMMENT_ICON_BUBBLE =
  'M3 1.8h10c1.2 0 2.2 1 2.2 2.2v5.6c0 1.2-1 2.2-2.2 2.2H8.5l-3.8 2.9c-.4.3-1 0-1-.5v-2.4H3c-1.2 0-2.2-1-2.2-2.2V4c0-1.2 1-2.2 2.2-2.2z'
const COMMENT_ICON_LINES = 'M4.3 6.2h7.4M4.3 8.6h4.6'

function commentIconSvg(size: number): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">` +
    `<path d="${COMMENT_ICON_BUBBLE}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="${COMMENT_ICON_LINES}" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` +
    '</svg>'
  )
}

function CommentIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={COMMENT_ICON_BUBBLE}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d={COMMENT_ICON_LINES} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

interface AiScenarioDocCommentsProps {
  projectId: string
  conversationId: string | null
  context?: unknown
  markdown: string
  comments: ScenarioDocComment[]
  onCommentsChange: (next: ScenarioDocComment[]) => void
}

let commentSeq = 0
function nextCommentId(): string {
  commentSeq += 1
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `doc-comment-${crypto.randomUUID()}`
  }
  return `doc-comment-${Date.now()}-${commentSeq}`
}

/**
 * Commentable wrapper around the rendered scenario doc.
 *
 * Hover buttons live *inside* each rendered block (plus one per table cell)
 * and reveal purely through CSS `:hover` — no mousemove hit-testing, so the
 * button can never flicker or unmount under the cursor. Buttons are injected
 * by an effect that re-runs only when the markdown changes; the doc tree is a
 * pure function of the markdown with stable component identities, so React
 * reconciliation preserves the DOM (and any in-progress text selection)
 * across unrelated re-renders.
 *
 * Selecting arbitrary text still surfaces a floating icon button. Saved
 * comments outline their anchor block (exact ranges get a mark highlight when
 * the quote matches verbatim) and stay editable in the thread below the doc
 * until the doc itself changes — a new markdown version clears them. One
 * resolve button bundles every comment into a single `edit:` chat message.
 */
export function AiScenarioDocComments({
  projectId,
  conversationId,
  context,
  markdown,
  comments,
  onCommentsChange,
}: AiScenarioDocCommentsProps): JSX.Element {
  const docRef = useRef<HTMLDivElement | null>(null)
  const [float, setFloat] = useState<PendingAnchor | null>(null)
  const [pending, setPending] = useState<PendingAnchor | null>(null)
  const [draft, setDraft] = useState('')
  const streaming = useAiStore((s) => s.status) === 'streaming'

  // A new doc version resolves every anchor: drop the thread.
  const prevMarkdownRef = useRef(markdown)
  useEffect(() => {
    if (prevMarkdownRef.current !== markdown) {
      prevMarkdownRef.current = markdown
      setFloat(null)
      setPending(null)
      setDraft('')
      if (comments.length > 0) onCommentsChange([])
    }
    // `comments`/`onCommentsChange` intentionally excluded: only a markdown
    // change may clear the thread, never a thread edit itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown])

  // Tag every top-level block with its anchor dataset and inject one icon
  // button per block (plus one per table cell). Re-runs only when the
  // markdown changes; React leaves these nodes alone between renders because
  // the rendered tree is a pure function of the markdown.
  useEffect(() => {
    const doc = docRef.current
    if (!doc) return undefined
    const md = markdownRoot(doc)
    if (!md) return undefined
    doc.classList.add('commentable')
    let step: number | undefined
    let stepTitle: string | undefined
    for (const child of Array.from(md.children)) {
      if (!(child instanceof HTMLElement)) continue
      if (/^h2$/i.test(child.tagName)) {
        const parsed = parseStepHeading(child)
        step = parsed.step
        stepTitle = parsed.stepTitle
      }
      const kind = kindOfBlock(child)
      child.dataset.commentBlock = '1'
      child.dataset.commentKind = kind
      if (step !== undefined) child.dataset.commentStep = String(step)
      else delete child.dataset.commentStep
      if (stepTitle) child.dataset.commentStepTitle = stepTitle
      else delete child.dataset.commentStepTitle
      const label =
        step !== undefined ? `Step ${step}${stepTitle ? ` — ${stepTitle}` : ''}` : 'General'
      // `<hr>` cannot render children; dividers stay uncommentable.
      if (child.tagName.toLowerCase() !== 'hr') {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'scenario-comment-hover-btn'
        btn.setAttribute('data-testid', BLOCK_BTN_TESTID)
        btn.setAttribute('data-comment-btn', 'block')
        btn.setAttribute('aria-label', `Add comment on ${label} ${kind}`)
        btn.setAttribute('title', `Comment on ${label} · ${kind}`)
        btn.innerHTML = commentIconSvg(16)
        child.appendChild(btn)
      }
      if (child.tagName.toLowerCase() === 'table') {
        const rows = child.querySelectorAll('tr')
        rows.forEach((row) => {
          Array.from(row.children).forEach((cell) => {
            if (!(cell instanceof HTMLElement)) return
            if (!/^(td|th)$/i.test(cell.tagName)) return
            const coords = cellCoords(cell)
            const cellBtn = document.createElement('button')
            cellBtn.type = 'button'
            cellBtn.className = 'scenario-comment-cell-btn'
            cellBtn.setAttribute('data-testid', CELL_BTN_TESTID)
            cellBtn.setAttribute('data-comment-btn', 'cell')
            cellBtn.setAttribute(
              'aria-label',
              `Add comment on table cell (row ${coords.row}, column ${coords.col})`,
            )
            cellBtn.setAttribute(
              'title',
              `Comment on table cell (row ${coords.row}, column ${coords.col})`,
            )
            cellBtn.innerHTML = commentIconSvg(14)
            cell.appendChild(cellBtn)
          })
        })
      }
    }
    return () => {
      doc.classList.remove('commentable')
      for (const btn of Array.from(doc.querySelectorAll(BTN_SELECTOR))) btn.remove()
      for (const el of Array.from(doc.querySelectorAll('[data-comment-block]'))) {
        if (el instanceof HTMLElement) {
          delete el.dataset.commentBlock
          delete el.dataset.commentKind
          delete el.dataset.commentStep
          delete el.dataset.commentStepTitle
        }
      }
    }
  }, [markdown])

  // Anchor outlines plus best-effort exact-range marks, re-applied after
  // every render since the markdown tree is React-owned.
  useEffect(() => {
    const doc = docRef.current
    if (!doc) return
    unwrapMarks(doc)
    const md = markdownRoot(doc)
    if (!md) return
    const blocks = Array.from(md.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    )
    const byBlock = new Map<number, ScenarioDocComment[]>()
    for (const comment of comments) {
      const list = byBlock.get(comment.blockIndex) ?? []
      list.push(comment)
      byBlock.set(comment.blockIndex, list)
    }
    for (const [blockIndex, list] of byBlock) {
      const block = blocks[blockIndex]
      if (!block) continue
      block.classList.add('has-doc-comment')
      for (const comment of list) {
        if (comment.cell) {
          const rows = block.querySelectorAll('tr')
          const row = rows[comment.cell.row - 1]
          const cell = row?.children[comment.cell.col - 1]
          if (cell instanceof HTMLElement) cell.classList.add('has-doc-comment-cell')
        }
        markQuoteInBlock(block, comment.quote)
      }
    }
  }, [markdown, comments])

  const clearSelection = (): void => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      // Selection API absence (tests) is fine.
    }
  }

  const handleSelect = (): void => {
    const doc = docRef.current
    if (!doc || pending) return
    let selection: Selection | null = null
    try {
      selection = window.getSelection()
    } catch {
      selection = null
    }
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (float) setFloat(null)
      return
    }
    const text = selection.toString().trim()
    if (!text || !selection.anchorNode || !doc.contains(selection.anchorNode)) {
      if (float) setFloat(null)
      return
    }
    const anchorEl =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode.parentElement
    const block = anchorEl?.closest?.('[data-comment-block]') ?? null
    if (!(block instanceof HTMLElement)) {
      if (float) setFloat(null)
      return
    }
    const md = markdownRoot(doc)
    const blockIndex = md ? Array.from(md.children).indexOf(block) : -1
    if (blockIndex < 0) {
      if (float) setFloat(null)
      return
    }
    const anchorCell = (
      anchorEl instanceof Element ? anchorEl.closest('td, th') : null
    ) as HTMLElement | null
    const inBlockCell = anchorCell && block.contains(anchorCell) ? anchorCell : null
    const cell = inBlockCell
      ? {
          ...cellCoords(inBlockCell),
          cellText: truncateCommentText(inBlockCell.textContent ?? '', 140),
        }
      : undefined
    const stepRaw = block.dataset.commentStep
    const parsedStep = stepRaw !== undefined ? Number.parseInt(stepRaw, 10) : NaN
    let rect: DOMRect | null = null
    try {
      rect = selection.getRangeAt(0).getBoundingClientRect()
    } catch {
      rect = null
    }
    setFloat({
      ...(!Number.isNaN(parsedStep) ? { step: parsedStep } : {}),
      ...(block.dataset.commentStepTitle ? { stepTitle: block.dataset.commentStepTitle } : {}),
      blockKind: cell ? 'table cell' : (block.dataset.commentKind ?? 'block'),
      ...(cell ? { cell } : {}),
      blockIndex,
      quote: truncateCommentText(text, MAX_QUOTE),
      x: rect ? rect.right : window.innerWidth - 60,
      y: rect ? rect.bottom : window.innerHeight - 60,
    })
  }

  const openComposer = (anchor: PendingAnchor): void => {
    setPending(anchor)
    setDraft('')
    setFloat(null)
  }

  const handleDocClick = (event: ReactMouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    const btn = target?.closest?.(BTN_SELECTOR) ?? null
    if (!(btn instanceof HTMLElement)) return
    const scope = btn.closest('[data-comment-block]')
    if (!(scope instanceof HTMLElement)) return
    const doc = docRef.current
    const md = doc ? markdownRoot(doc) : null
    const blockIndex = md ? Array.from(md.children).indexOf(scope) : -1
    if (blockIndex < 0) return
    const isCell = btn.getAttribute('data-comment-btn') === 'cell'
    const kind = scope.dataset.commentKind ?? 'block'
    const stepRaw = scope.dataset.commentStep
    const parsedStep = stepRaw !== undefined ? Number.parseInt(stepRaw, 10) : NaN
    const anchor: PendingAnchor = {
      ...(!Number.isNaN(parsedStep) ? { step: parsedStep } : {}),
      ...(scope.dataset.commentStepTitle ? { stepTitle: scope.dataset.commentStepTitle } : {}),
      blockKind: isCell ? 'table cell' : kind,
      blockIndex,
      quote: '',
      x: event.clientX,
      y: event.clientY,
    }
    if (isCell) {
      const cell = btn.closest('td, th')
      if (!(cell instanceof HTMLElement)) return
      const quote = truncateCommentText(cell.textContent ?? '', MAX_QUOTE).trim()
      if (!quote) return
      openComposer({
        ...anchor,
        cell: {
          ...cellCoords(cell),
          cellText: truncateCommentText(cell.textContent ?? '', 140),
        },
        quote,
      })
      return
    }
    const quote = truncateCommentText(scope.textContent ?? '', MAX_QUOTE).trim()
    if (!quote) return
    openComposer({ ...anchor, quote })
  }

  const handleSave = (): void => {
    const body = draft.trim()
    if (!pending || !body) return
    onCommentsChange([
      ...comments,
      {
        id: nextCommentId(),
        step: pending.step,
        stepTitle: pending.stepTitle,
        blockKind: pending.blockKind,
        quote: pending.quote,
        comment: body,
        blockIndex: pending.blockIndex,
        ...(pending.cell ? { cell: pending.cell } : {}),
      },
    ])
    setPending(null)
    setDraft('')
    clearSelection()
  }

  const handleSend = (): void => {
    if (!projectId || !conversationId || comments.length === 0) return
    const store = useAiStore.getState()
    void store.sendMessage(
      projectId,
      conversationId,
      buildScenarioCommentsMessage(comments),
      context,
      'scenario',
    )
  }

  const composerX = pending ? Math.max(8, Math.min(pending.x, window.innerWidth - 344)) : 0
  const composerY = pending ? Math.max(8, Math.min(pending.y + 12, window.innerHeight - 260)) : 0

  return (
    <div data-testid="ai-scenario-doc-comments">
      <div
        ref={docRef}
        data-testid="ai-scenario-modal-doc"
        className="ai-scenario-modal-doc"
        onClick={handleDocClick}
        onMouseUp={handleSelect}
        onKeyUp={handleSelect}
      >
        {markdown ? (
          <ScenarioDocMarkdown content={markdown} />
        ) : (
          <div data-testid="ai-scenario-modal-empty">
            No scenario markdown yet — chat to iterate or edit the doc.
          </div>
        )}
      </div>

      {float && !pending && (
        <button
          type="button"
          data-testid="ai-scenario-comment-float-btn"
          className="scenario-comment-float-btn"
          style={{
            left: Math.max(8, Math.min(float.x - 16, window.innerWidth - 48)),
            top: Math.max(8, float.y + 8),
          }}
          aria-label="Comment on selected text"
          title="Comment on selected text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openComposer(float)}
        >
          <CommentIcon size={17} />
        </button>
      )}

      {pending && (
        <div
          data-testid="ai-scenario-comment-composer"
          className="scenario-comment-composer"
          style={{ left: composerX, top: composerY }}
        >
          <div className="scenario-comment-composer-head">
            {commentStepLabel(pending)} · {pending.blockKind}
          </div>
          <blockquote
            data-testid="ai-scenario-comment-quote"
            className="scenario-comment-composer-quote"
          >
            {truncateCommentText(pending.quote, QUOTE_PREVIEW)}
          </blockquote>
          <textarea
            data-testid="ai-scenario-comment-input"
            aria-label="Comment for the assistant"
            placeholder="What should the assistant fix here?"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
          />
          <div className="scenario-comment-composer-actions">
            <button
              type="button"
              data-testid="ai-scenario-comment-save"
              disabled={!draft.trim()}
              onClick={handleSave}
            >
              Add comment
            </button>
            <button
              type="button"
              data-testid="ai-scenario-comment-cancel"
              onClick={() => {
                setPending(null)
                setDraft('')
                clearSelection()
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="scenario-comments" data-testid="ai-scenario-comments-panel">
        <div className="scenario-comments-head">
          <span data-testid="ai-scenario-comments-count">
            {comments.length === 0
              ? 'No inline comments'
              : `${comments.length} inline comment${comments.length === 1 ? '' : 's'}`}
          </span>
          <button
            type="button"
            data-testid="ai-scenario-comments-send"
            disabled={!conversationId || comments.length === 0 || streaming}
            title={
              !conversationId
                ? 'Start a conversation to send fix requests'
                : comments.length === 0
                  ? 'Add a comment on the doc first'
                  : `Send ${comments.length} comment${comments.length === 1 ? '' : 's'} to the assistant as one edit request`
            }
            onClick={handleSend}
          >
            {comments.length === 0
              ? 'Resolve comments'
              : `Resolve ${comments.length} comment${comments.length === 1 ? '' : 's'}`}
          </button>
        </div>
        {comments.length > 0 && (
          <ul data-testid="ai-scenario-comments-list" className="scenario-comments-list">
            {comments.map((comment) => (
              <li
                key={comment.id}
                data-testid={`ai-scenario-comment-${comment.id}`}
                className="scenario-comment-item"
              >
                <div className="scenario-comment-item-head">
                  {commentStepLabel(comment)} ·{' '}
                  {comment.cell
                    ? `${comment.blockKind} (row ${comment.cell.row}, column ${comment.cell.col})`
                    : comment.blockKind}
                  <button
                    type="button"
                    data-testid={`ai-scenario-comment-delete-${comment.id}`}
                    aria-label={`Delete comment on ${commentStepLabel(comment)}`}
                    title="Delete this comment"
                    onClick={() => onCommentsChange(comments.filter((c) => c.id !== comment.id))}
                  >
                    Delete
                  </button>
                </div>
                <blockquote className="scenario-comment-item-quote">
                  {truncateCommentText(comment.quote, QUOTE_PREVIEW)}
                </blockquote>
                <textarea
                  data-testid={`ai-scenario-comment-edit-${comment.id}`}
                  aria-label={`Edit comment on ${commentStepLabel(comment)}`}
                  value={comment.comment}
                  rows={2}
                  onChange={(event) =>
                    onCommentsChange(
                      comments.map((c) =>
                        c.id === comment.id ? { ...c, comment: event.target.value } : c,
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
