import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SUPPORTED = new Set(['typescript', 'ts', 'glsl', 'python', 'py', 'json', 'markdown', 'md'])

function langFor(className?: string): string | null {
  if (!className) return null
  const match = /language-([\w-]+)/.exec(className)
  if (!match) return null
  const lang = match[1].toLowerCase()
  if (lang === 'ts') return 'typescript'
  if (lang === 'py') return 'python'
  if (lang === 'md') return 'markdown'
  return SUPPORTED.has(lang) ? lang : null
}

export function ShikiCode({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const highlight = async () => {
      try {
        const { codeToHtml } = await import('shiki')
        const out = await codeToHtml(code, { lang: language, theme: 'github-dark' })
        if (!cancelled) setHtml(out)
      } catch {
        if (!cancelled) setHtml(null)
      }
    }
    void highlight()
    return () => {
      cancelled = true
    }
  }, [code, language])

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
            const { className, children } = props
            const text = String(children ?? '').replace(/\n$/, '')
            const language = langFor(className)
            const isBlock = text.includes('\n') || language !== null
            if (!isBlock) {
              return <code className={className}>{children}</code>
            }
            if (language) {
              return (
                <pre>
                  <ShikiCode code={text} language={language} />
                </pre>
              )
            }
            return (
              <pre>
                <code className={className}>{children}</code>
              </pre>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
