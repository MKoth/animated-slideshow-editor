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
  readonly commentId?: string
  readonly commentIds?: readonly string[]
  readonly x: number
  readonly y: number
}

const MAX_QUOTE = 2000
const QUOTE_PREVIEW = 280
const BLOCK_BTN_TESTID = 'ai-scenario-comment-block-btn'
const CELL_BTN_TESTID = 'ai-scenario-comment-cell-btn'
const EDIT_BTN_SELECTOR = '[data-edit-block-btn]'
const BTN_SELECTOR = `[data-comment-btn], ${EDIT_BTN_SELECTOR}`

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

function editIconSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m2.5 11.8-.6 2.3 2.3-.6 8.1-8.1-1.7-1.7-8.1 8.1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m9.9 4.1 1.7 1.7" stroke="currentColor" stroke-width="1.4"/></svg>`
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

function deleteIconSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 4.5h11M6 4.5V3h4v1.5m2.5 0-.6 9h-7.8l-.6-9M6.5 7v4m3-4v4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

interface AiScenarioDocCommentsProps {
  projectId: string
  conversationId: string | null
  context?: unknown
  markdown: string
  comments: ScenarioDocComment[]
  onCommentsChange: (next: ScenarioDocComment[]) => void
  preserveCommentsOnMarkdownChange?: boolean
  onEditBlock?: (blockIndex: number, text: string) => Promise<void> | void
  onDeleteBlock?: (blockIndex: number) => Promise<void> | void
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
  preserveCommentsOnMarkdownChange = false,
  onEditBlock,
  onDeleteBlock,
}: AiScenarioDocCommentsProps): JSX.Element {
  const docRef = useRef<HTMLDivElement | null>(null)
  const [float, setFloat] = useState<PendingAnchor | null>(null)
  const [pending, setPending] = useState<PendingAnchor | null>(null)
  const [draft, setDraft] = useState('')
  const [sendingComments, setSendingComments] = useState(false)
  const [editingBlock, setEditingBlock] = useState<{
    index: number
    text: string
    original: string
    top: number
    minHeight: number
    font: string
    lineHeight: string
    color: string
  } | null>(null)
  const [savingBlock, setSavingBlock] = useState(false)
  const [blockEditError, setBlockEditError] = useState<string | null>(null)
  const streaming = useAiStore((s) => s.status) === 'streaming'

  const saveEditingBlock = async (): Promise<void> => {
    if (!editingBlock || editingBlock.text === editingBlock.original || !editingBlock.text.trim())
      return
    setSavingBlock(true)
    setBlockEditError(null)
    try {
      await onEditBlock?.(editingBlock.index, editingBlock.text)
      setEditingBlock(null)
    } catch (error) {
      setBlockEditError(error instanceof Error ? error.message : 'Could not save this block.')
    } finally {
      setSavingBlock(false)
    }
  }

  // AI-generated versions clear their old thread; manual edits re-anchor
  // surviving quotes and retain notes whose text was removed as orphans.
  // A reload must not wipe restored drafts: the engine loads the markdown
  // asynchronously ('' -> content on mount), so only a change away from a
  // non-empty doc clears the thread. Reloaded drafts survive that initial
  // load and clear on the next real version change or on Resolve.
  const prevMarkdownRef = useRef(markdown)
  useEffect(() => {
    if (prevMarkdownRef.current !== markdown) {
      const prev = prevMarkdownRef.current
      prevMarkdownRef.current = markdown
      setFloat(null)
      setPending(null)
      setDraft('')
      if (prev === '') return
      if (preserveCommentsOnMarkdownChange && comments.length > 0) {
        const md = docRef.current ? markdownRoot(docRef.current) : null
        const blocks = md
          ? Array.from(md.children).filter(
              (child): child is HTMLElement => child instanceof HTMLElement,
            )
          : []
        onCommentsChange(
          comments.map((comment) => {
            const matches = (block: HTMLElement): boolean => {
              if (comment.cell) {
                const rows = Array.from(block.querySelectorAll('tr'))
                const cell = rows[comment.cell.row - 1]?.children[comment.cell.col - 1]
                return (
                  cell instanceof HTMLElement && (cell.textContent ?? '').includes(comment.quote)
                )
              }
              return (block.textContent ?? '').includes(comment.quote)
            }
            const oldBlock = blocks[comment.blockIndex]
            const matchingBlocks = blocks.flatMap((block, index) => (matches(block) ? [index] : []))
            const index =
              oldBlock && matches(oldBlock)
                ? comment.blockIndex
                : matchingBlocks.length === 1
                  ? matchingBlocks[0]!
                  : -1
            return index >= 0
              ? { ...comment, blockIndex: index, orphaned: false }
              : { ...comment, orphaned: true }
          }),
        )
      } else if (comments.length > 0) onCommentsChange([])
    }
    // `comments`/`onCommentsChange` intentionally excluded: only a markdown
    // change may clear the thread, never a thread edit itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown])

  useEffect(() => {
    const doc = docRef.current
    const md = doc ? markdownRoot(doc) : null
    const blocks = md ? Array.from(md.children) : []
    blocks.forEach((block, index) => {
      if (block instanceof HTMLElement)
        block.classList.toggle('scenario-block-editing', editingBlock?.index === index)
    })
  }, [editingBlock])

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
        const editBtn = document.createElement('button')
        editBtn.type = 'button'
        editBtn.className = 'scenario-comment-hover-btn scenario-edit-hover-btn'
        editBtn.setAttribute('data-edit-block-btn', '1')
        editBtn.setAttribute('aria-label', `Edit ${label} ${kind}`)
        editBtn.setAttribute('title', `Edit ${label} · ${kind}`)
        editBtn.innerHTML = editIconSvg(16)
        child.appendChild(editBtn)
        const deleteBtn = document.createElement('button')
        deleteBtn.type = 'button'
        deleteBtn.className = 'scenario-comment-hover-btn scenario-delete-hover-btn'
        deleteBtn.setAttribute('data-delete-block-btn', '1')
        deleteBtn.setAttribute('aria-label', `Delete ${label} ${kind}`)
        deleteBtn.setAttribute('title', `Delete ${label} · ${kind}`)
        deleteBtn.innerHTML = deleteIconSvg(16)
        child.appendChild(deleteBtn)
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
      const activeComments = list.filter((comment) => !comment.orphaned)
      if (activeComments.length === 0) continue
      block.classList.add('has-doc-comment')
      for (const comment of activeComments) {
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
    const deleteBtn = target?.closest?.('[data-delete-block-btn]') ?? null
    if (deleteBtn instanceof HTMLElement) {
      const scope = deleteBtn.closest('[data-comment-block]')
      const md = docRef.current ? markdownRoot(docRef.current) : null
      const blockIndex = scope && md ? Array.from(md.children).indexOf(scope) : -1
      if (blockIndex >= 0 && window.confirm('Delete this scenario block?')) {
        void onDeleteBlock?.(blockIndex)
      }
      return
    }
    const editBtn = target?.closest?.(EDIT_BTN_SELECTOR) ?? null
    if (editBtn instanceof HTMLElement) {
      const scope = editBtn.closest('[data-comment-block]')
      const md = docRef.current ? markdownRoot(docRef.current) : null
      const blockIndex = scope && md ? Array.from(md.children).indexOf(scope) : -1
      if (blockIndex >= 0 && scope instanceof HTMLElement) {
        // textContent drops the visual line breaks produced by Markdown hard
        // breaks (<br>) and can turn adjacent narrator lines into one string.
        // Start the editor from the displayed text, including those breaks.
        const text = scope.innerText ?? scope.textContent ?? ''
        const doc = docRef.current
        const rootRect = doc?.getBoundingClientRect()
        // The document is its own scroll container. Absolute positioning uses
        // its content coordinates, not the currently visible viewport offset.
        const top = scope.getBoundingClientRect().top - (rootRect?.top ?? 0) + (doc?.scrollTop ?? 0)
        setBlockEditError(null)
        const style = window.getComputedStyle(scope)
        setEditingBlock({
          index: blockIndex,
          text,
          original: text,
          top,
          minHeight: scope.getBoundingClientRect().height,
          font: style.font,
          lineHeight: style.lineHeight,
          color: style.color,
        })
      }
      return
    }
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
    const existingComments = comments.filter((comment) => {
      if (comment.orphaned) return false
      if (comment.blockIndex !== blockIndex) return false
      if (!isCell) return !comment.cell
      const cell = btn.closest('td, th')
      if (!(cell instanceof HTMLElement)) return false
      const coords = cellCoords(cell)
      return comment.cell?.row === coords.row && comment.cell?.col === coords.col
    })
    if (existingComments.length > 0) {
      const existingComment = existingComments[0]!
      setPending({
        ...anchor,
        quote: existingComment.quote,
        commentId: existingComment.id,
        commentIds: existingComments.map((comment) => comment.id),
      })
      setDraft(existingComment.comment)
      setFloat(null)
      return
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
    if (pending.commentId) {
      onCommentsChange(
        comments.map((comment) =>
          comment.id === pending.commentId ? { ...comment, comment: body } : comment,
        ),
      )
    } else {
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
    }
    setPending(null)
    setDraft('')
    clearSelection()
  }

  const handleSend = async (): Promise<void> => {
    if (!projectId || !conversationId || comments.length === 0 || sendingComments || streaming)
      return
    const store = useAiStore.getState()
    setSendingComments(true)
    try {
      await store.sendMessage(
        projectId,
        conversationId,
        buildScenarioCommentsMessage(comments),
        context,
        'scenario',
      )
      // Resolved: drop the thread (and its localStorage copy, via the
      // parent persisting the empty list) so a reload after Resolve stays
      // empty. A failed send keeps the drafts for retry.
      onCommentsChange([])
    } finally {
      setSendingComments(false)
    }
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
        {editingBlock &&
          (() => {
            return (
              <div
                className="scenario-block-editor"
                style={{ top: editingBlock.top, left: 0, width: '100%' }}
              >
                <textarea
                  data-testid="ai-scenario-block-editor-input"
                  aria-label="Edit scenario block"
                  value={editingBlock.text}
                  onBlur={(event) => {
                    if (
                      !event.relatedTarget ||
                      !event.currentTarget.parentElement?.contains(event.relatedTarget)
                    )
                      void saveEditingBlock()
                  }}
                  onChange={(event) =>
                    setEditingBlock({ ...editingBlock, text: event.target.value })
                  }
                  rows={Math.max(3, editingBlock.text.split('\n').length)}
                  spellCheck={false}
                  style={{
                    // The measured block height is the text area's usable target;
                    // don't subtract the wrapper/buttons from it or the edit view
                    // becomes noticeably shorter than the content it replaces.
                    minHeight: Math.max(96, editingBlock.minHeight + 12),
                    font: editingBlock.font,
                    lineHeight: editingBlock.lineHeight,
                    color: editingBlock.color,
                    whiteSpace: 'pre-wrap',
                    padding: '10px 12px',
                    background: 'rgba(0, 0, 0, 0.18)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                  }}
                />
                {blockEditError && <div role="alert">{blockEditError}</div>}
                <div className="scenario-block-editor-actions">
                  <span role="status" aria-live="polite">
                    {savingBlock ? 'Saving…' : 'Changes save when you leave the editor'}
                  </span>
                  <button
                    type="button"
                    data-testid="ai-scenario-block-done"
                    disabled={savingBlock}
                    onClick={() => {
                      if (editingBlock.text === editingBlock.original) setEditingBlock(null)
                      else void saveEditingBlock()
                    }}
                  >
                    Save & close
                  </button>
                </div>
              </div>
            )
          })()}
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
          {pending.commentIds && pending.commentIds.length > 1 && (
            <label>
              Comment
              <select
                data-testid="ai-scenario-comment-select-existing"
                aria-label="Choose comment to edit"
                value={pending.commentId}
                onChange={(event) => {
                  const comment = comments.find((item) => item.id === event.target.value)
                  if (!comment) return
                  setPending({ ...pending, commentId: comment.id, quote: comment.quote })
                  setDraft(comment.comment)
                }}
              >
                {comments
                  .filter((comment) => pending.commentIds?.includes(comment.id))
                  .map((comment) => (
                    <option key={comment.id} value={comment.id}>
                      {truncateCommentText(comment.quote, 80)} —{' '}
                      {truncateCommentText(comment.comment, 80)}
                    </option>
                  ))}
              </select>
            </label>
          )}
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
              {pending.commentId ? 'Save comment' : 'Add comment'}
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
            disabled={!conversationId || comments.length === 0 || streaming || sendingComments}
            title={
              !conversationId
                ? 'Start a conversation to send fix requests'
                : comments.length === 0
                  ? 'Add a comment on the doc first'
                  : `Send ${comments.length} comment${comments.length === 1 ? '' : 's'} to the assistant as one edit request`
            }
            onClick={handleSend}
          >
            {sendingComments ? (
              <>
                <span className="scenario-comments-loader" aria-hidden="true" /> Sending…
              </>
            ) : comments.length === 0 ? (
              'Resolve comments'
            ) : (
              `Resolve ${comments.length} comment${comments.length === 1 ? '' : 's'}`
            )}
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
                {comment.orphaned && (
                  <div className="scenario-comment-item-orphaned" role="status">
                    Anchor no longer appears in the document; this note is retained in the thread.
                  </div>
                )}
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
