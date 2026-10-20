import { Children, isValidElement, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
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
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code(props: any) {
            return <MarkdownCode className={props.className}>{props.children}</MarkdownCode>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
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

/**
 * Scenario-doc renderer for the Scenario MD modal. Same GFM + Shiki base as
 * AiMarkdown, but block types from the scenario template (Step headings,
 * `**Narrator:**`, `![alt](asset:slug)`, `> Brief:`, `<!-- reuse: -->`)
 * get semantic classes so each reads in its own color. Plain paragraphs are
 * the on-screen chalk text and keep the default color.
 */
export function ScenarioDocMarkdown({ content }: { content: string }) {
  // `<!-- reuse: X -->` is invisible to markdown renderers — surface it as a
  // quote line so the reference stays visible (whole-line form only).
  const prepared = content.replace(REUSE_COMMENT_RE, '> Reuse: $1')
  return (
    <div className="ai-markdown" data-testid="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
            if (isVisualLine(props.children)) {
              return <p className="scenario-visual-line">{props.children}</p>
            }
            if (/^\s*Narrator:/i.test(plainText(props.children))) {
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
            return <blockquote>{props.children}</blockquote>
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          img(props: any) {
            const target = String(props.src ?? '').trim()
            if (/^asset:/i.test(target)) {
              return (
                <span className="scenario-visual">
                  <span className="scenario-visual-label">Visual</span>
                  {props.alt ? (
                    <span className="scenario-visual-alt">{String(props.alt)}</span>
                  ) : null}
                  <code className="scenario-visual-slug">{target.slice('asset:'.length)}</code>
                </span>
              )
            }
            return <img alt={props.alt} src={props.src} title={props.title} />
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  )
}
