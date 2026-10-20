import { Children, isValidElement, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useUiStore } from '../stores/uiStore'

const SUPPORTED = new Set([
  'typescript',
  'ts',
  'glsl',
  'python',
  'py',
  'json',
  'markdown',
  'md',
  'engine-command',
  'engine-commands',
])

function langFor(className?: string): string | null {
  if (!className) return null
  const match = /language-([\w-]+)/.exec(className)
  if (!match) return null
  const lang = match[1].toLowerCase()
  if (lang === 'ts') return 'typescript'
  if (lang === 'py') return 'python'
  if (lang === 'md') return 'markdown'
  if (lang === 'engine-command' || lang === 'engine-commands') return 'typescript'
  return SUPPORTED.has(lang) ? lang : null
}

export function ShikiCode({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    const highlight = async () => {
      try {
        const { codeToHtml } = await import('shiki')
        const out = await codeToHtml(code, {
          lang: language,
          theme: theme === 'dark' ? 'github-dark' : 'github-light',
        })
        if (!cancelled) setHtml(out)
      } catch {
        if (!cancelled) setHtml(null)
      }
    }
    void highlight()
    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  if (html) {
    return <span data-testid="shiki-code" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <code className={`language-${language}`}>{code}</code>
}

export function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-markdown" data-testid="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={AI_MARKDOWN_COMPONENTS}
        urlTransform={scenarioUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// Module-scope components: inline literals would create new component
// identities on every render, forcing React to unmount/remount the whole
// doc tree (destroying in-progress text selections and hover state).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AI_MARKDOWN_COMPONENTS: any = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code(props: any) {
    return <MarkdownCode className={props.className}>{props.children}</MarkdownCode>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  img(props: any) {
    return <ScenarioVisualImage src={props.src} alt={props.alt} title={props.title} />
  },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MarkdownCode({ className, children }: { className?: string; children?: any }) {
  const text = String(children ?? '').replace(/\n$/, '')
  const language = langFor(className)
  const isBlock = text.includes('\n') || language !== null
  if (!isBlock) {
    return <code className={className}>{children}</code>
  }
  if (language) {
    return <ShikiCode code={text} language={language} />
  }
  return (
    <pre>
      <code className={className}>{children}</code>
    </pre>
  )
}

function plainText(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(plainText).join('')
  if (isValidElement(children)) {
    return plainText((children.props as { children?: ReactNode } | null)?.children)
  }
  return ''
}

function isVisualLine(children: ReactNode): boolean {
  const arr = Children.toArray(children)
  if (arr.length !== 1 || !isValidElement(arr[0])) return false
  const className = (arr[0].props as { className?: unknown } | null)?.className
  return typeof className === 'string' && className.split(' ').includes('scenario-visual')
}

const REUSE_COMMENT_RE = /^<!--\s*reuse:\s*(.+?)\s*-->$/gim

// Board lines that must stand alone: the model often writes them glued to
// surrounding paragraphs (no blank lines), which markdown then merges into
// one paragraph so no chip renders. Isolation inserts the blank lines;
// fenced code blocks are left untouched. Table rows must never match.
const BOARD_LINE_RE =
  /^\s*(\[place:|\[reveal:|\[remove:|\[wipe\]|!\[|> Brief:|> Label:|<!-- reuse:)/i

function isolateBoardLines(content: string): string {
  const lines = content.split('\n')
  const out: string[] = []
  let fenced = false
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced
    const marker = !fenced && BOARD_LINE_RE.test(line)
    if (marker && out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('')
    out.push(line)
    if (marker) {
      const next = lines[index + 1]
      if (next !== undefined && next.trim() !== '') out.push('')
    }
  })
  return out.join('\n')
}

/** Reveal targets are bookkeeping ids (`text1`); chips show the kind only. */
function revealKind(target: string): string {
  const kind = target.replace(/\d+$/g, '').trim() || target.trim()
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** Board-action marker lines (`[place:]`, `[reveal:]`, `[remove:]`, `[wipe]`) render as chips. */
function parseBoardAction(
  trimmed: string,
): { label: string; target?: string; title?: string } | null {
  const remove = /^\[remove:\s*(.+?)\]$/i.exec(trimmed)
  if (remove) return { label: 'Remove', target: remove[1]?.trim() }
  const place = /^\[place:\s*(.+?)\]$/i.exec(trimmed)
  if (place) return { label: 'Place', target: place[1]?.trim() }
  const reveal = /^\[reveal:\s*(.+?)\]$/i.exec(trimmed)
  if (reveal) {
    const full = (reveal[1] ?? '').trim()
    return { label: 'Reveal', target: revealKind(full), title: full }
  }
  const wipe = /^\[wipe(?::\s*(.+?))?\]$/i.exec(trimmed)
  if (wipe) {
    const targets = (wipe[1] ?? '').trim()
    return targets ? { label: 'Wipe', target: targets } : { label: 'Wipe board' }
  }
  return null
}

/**
 * `asset:slug` references are doc-contract pointers, not loadable URLs:
 * react-markdown's default URL sanitizer strips them, leaving a bare
 * `<img alt>` that renders as a broken-image icon. Pass them through so the
 * `img` renderers below can surface the visual chip instead.
 */
function scenarioUrlTransform(url: string): string {
  if (/^asset:/i.test(url.trim())) return url
  return defaultUrlTransform(url)
}

/** Board visual chip shared by the doc and chat renderers. */
function ScenarioVisualImage({
  src,
  alt,
  title,
}: {
  src?: unknown
  alt?: unknown
  title?: unknown
}): ReactNode {
  const target = String(src ?? '').trim()
  if (/^asset:/i.test(target)) {
    const label = String(alt ?? '')
    return (
      <span className="scenario-visual">
        <span className="scenario-visual-label">Visual</span>
        {label ? <span className="scenario-visual-alt">{label}</span> : null}
        <code className="scenario-visual-slug">{target.slice('asset:'.length)}</code>
      </span>
    )
  }
  return <img alt={String(alt ?? '')} src={String(src ?? '')} title={String(title ?? '')} />
}
export function ScenarioDocMarkdown({ content }: { content: string }) {
  // `<!-- reuse: X -->` is invisible to markdown renderers — surface it as a
  // quote line so the reference stays visible (whole-line form only).
  // Board lines are isolated so glued markers still render as their own blocks.
  const prepared = useMemo(
    () => isolateBoardLines(content.replace(REUSE_COMMENT_RE, '> Reuse: $1')),
    [content],
  )
  return (
    <div className="ai-markdown" data-testid="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={SCENARIO_DOC_COMPONENTS}
        urlTransform={scenarioUrlTransform}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  )
}

// Module-scope components: see AI_MARKDOWN_COMPONENTS above — inline
// literals would remount the doc tree on every parent render, destroying
// in-progress text selections and any DOM-anchored comment state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCENARIO_DOC_COMPONENTS: any = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code(props: any) {
    return <MarkdownCode className={props.className}>{props.children}</MarkdownCode>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2(props: any) {
    const text = plainText(props.children)
    const match = /^Step\s+(\d+)\s*(?:[—–\-:.]?\s*(.*))?$/i.exec(text.trim())
    if (match) {
      const title = (match[2] ?? '').trim()
      return (
        <h2 className="scenario-step">
          <span className="scenario-step-badge">Step {match[1]}</span>
          {title ? <span className="scenario-step-title">{title}</span> : null}
        </h2>
      )
    }
    return <h2>{props.children}</h2>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p(props: any) {
    const text = plainText(props.children)
    const trimmed = text.trim()
    const action = parseBoardAction(trimmed)
    if (action) {
      return (
        <p className="scenario-action-line">
          <span className="scenario-board-action" title={action.title}>
            <span className="scenario-board-action-label">{action.label}</span>
            {action.target ? (
              <span className="scenario-board-action-target">{action.target}</span>
            ) : null}
          </span>
        </p>
      )
    }
    if (isVisualLine(props.children)) {
      return <p className="scenario-visual-line">{props.children}</p>
    }
    if (/^\s*Narrator:/i.test(text)) {
      return <p className="scenario-narrator">{props.children}</p>
    }
    return <p>{props.children}</p>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockquote(props: any) {
    const text = plainText(props.children)
    const brief = /^\s*Brief:\s*([\s\S]*)$/i.exec(text)
    if (brief) {
      return (
        <blockquote className="scenario-brief">
          <p>
            <span className="scenario-brief-label">Brief:</span> {brief[1]?.trim()}
          </p>
        </blockquote>
      )
    }
    const reuse = /^\s*Reuse:\s*([\s\S]*)$/i.exec(text)
    if (reuse) {
      return (
        <blockquote className="scenario-reuse">
          <p>
            <span className="scenario-reuse-label">Reuse:</span> {reuse[1]?.trim()}
          </p>
        </blockquote>
      )
    }
    const label = /^\s*Label:\s*([\s\S]*)$/i.exec(text)
    if (label) {
      return (
        <blockquote className="scenario-label">
          <p>
            <span className="scenario-label-tag">Label:</span> {label[1]?.trim()}
          </p>
        </blockquote>
      )
    }
    return <blockquote>{props.children}</blockquote>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  img(props: any) {
    return <ScenarioVisualImage src={props.src} alt={props.alt} title={props.title} />
  },
}
