import { useState } from 'react'

export function escapeAnimHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ANIM_KEYWORDS = /\b(script|from|let|create|bind|as|at)\b/g
const ANIM_FUNCTIONS = /\b(group|asset|material|node|audio|reveal|mark|wipe|carry|tween|hop)\b/g
const ANIM_PROPERTIES = /\b([A-Za-z_][A-Za-z0-9_]*)(:)/g

export function highlightAnimationScript(source: string): string {
  // Escape first, then carve out strings + comments as placeholders so the
  // keyword/function/number passes never match inside them.
  const escaped = escapeAnimHtml(source)
  const placeholders: string[] = []
  const stash = (html: string): string => {
    const idx = placeholders.length
    placeholders.push(html)
    return `__ANIM_PH_${idx}__`
  }

  // Strings first: // inside a string is not a comment.
  let working = escaped.replace(/&quot;.*?&quot;/g, (match) => {
    return stash(`<span class="anim-token anim-string">${match}</span>`)
  })
  // Block comments, then line comments.
  working = working.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    return stash(`<span class="anim-token anim-comment">${match}</span>`)
  })
  working = working.replace(/\/\/[^\n]*/g, (match) => {
    return stash(`<span class="anim-token anim-comment">${match}</span>`)
  })

  working = working.replace(ANIM_KEYWORDS, '<span class="anim-token anim-keyword">$1</span>')
  working = working.replace(ANIM_FUNCTIONS, '<span class="anim-token anim-function">$1</span>')
  working = working.replace(
    /\b(\d+\.\d*|\.\d+|\d+)\b/g,
    '<span class="anim-token anim-number">$1</span>',
  )
  working = working.replace(ANIM_PROPERTIES, '<span class="anim-token anim-property">$1</span>$2')

  for (let i = 0; i < placeholders.length; i++) {
    working = working.replace(`__ANIM_PH_${i}__`, placeholders[i]!)
  }
  return working.replace(/__ANIM_PH_\d+__/g, '')
}

async function copyToClipboard(text: string): Promise<void> {
  const nav = navigator as unknown as { clipboard?: { writeText?: (t: string) => Promise<void> } }
  if (nav.clipboard?.writeText) {
    await nav.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function AnimationScriptViewer({
  source,
  ariaLabel,
  title,
}: {
  source: string
  ariaLabel?: string
  title?: string
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const highlighted = highlightAnimationScript(source)

  const handleCopy = async () => {
    try {
      await copyToClipboard(source)
      setCopied(true)
      setCopyFailed(false)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
      window.setTimeout(() => setCopyFailed(false), 2000)
    }
  }

  return (
    <div
      className="shader-source-viewer"
      role="region"
      aria-label={ariaLabel ?? 'Animation source'}
    >
      <div className="shader-source-viewer__header">
        <h4 className="shader-source-viewer__title">{title ?? 'Animation Source'}</h4>
        <button
          className="shader-source-viewer__copy"
          aria-label="Copy animation source"
          onClick={handleCopy}
        >
          Copy
        </button>
        {copied && (
          <span className="shader-source-viewer__feedback" role="status" aria-live="polite">
            Copied!
          </span>
        )}
        {copyFailed && (
          <span
            className="shader-source-viewer__feedback shader-source-viewer__feedback--error"
            role="alert"
          >
            Copy failed
          </span>
        )}
      </div>
      <pre className="shader-source-viewer__code">
        <code className="anim-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}
