import { useState } from 'react'

export interface ShaderSourceViewerProps {
  source: string
  ariaLabel?: string
  title?: string
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const GLSL_KEYWORDS =
  /\b(if|else|for|while|do|return|discard|break|continue|struct|precision|uniform|varying|in|out|inout|attribute|const|lowp|mediump|highp)\b/g
const GLSL_TYPES = /\b(void|bool|int|float|vec2|vec3|vec4|mat2|mat3|mat4|sampler2D|samplerCube)\b/g
const GLSL_BUILTINS =
  /\b(gl_FragColor|gl_FragCoord|gl_Position|fragColor|texture|texture2D|mix|step|smoothstep|length|normalize|dot|cross|sin|cos|tan|pow|exp|log|sqrt|abs|min|max|clamp|fract|mod)\b/g

export function highlightGlsl(source: string): string {
  // Escape first, then apply token spans. Order matters to avoid double-wrapping.
  let escaped = escapeHtml(source)
  // Comments are already escaped: // ... and /* ... */  (no HTML inside)
  // We highlight comments after escaping: look for // till end of line and /* */ blocks.
  // Use placeholders for comments to avoid inner keyword highlighting.
  const placeholders: string[] = []
  // Block comments
  escaped = escaped.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const idx = placeholders.length
    placeholders.push(
      match.replace(/.*/, (m) => `<span class="glsl-token glsl-comment">${m}</span>`),
    )
    return `__GLSL_COMMENT_${idx}__`
  })
  // Line comments (after block replacement, line comments won't contain block placeholders)
  escaped = escaped.replace(/\/\/[^\n]*/g, (match) => {
    const idx = placeholders.length
    placeholders.push(`<span class="glsl-token glsl-comment">${match}</span>`)
    return `__GLSL_COMMENT_${idx}__`
  })
  // Preprocessor directives: #version, #define, #ifdef etc.
  escaped = escaped.replace(/^(\s*)#(\w+[^\n]*)/gm, (_m, indent: string, rest: string) => {
    return `${indent}<span class="glsl-token glsl-preprocessor">#${rest}</span>`
  })

  escaped = escaped.replace(GLSL_KEYWORDS, '<span class="glsl-token glsl-keyword">$1</span>')
  escaped = escaped.replace(GLSL_TYPES, '<span class="glsl-token glsl-type">$1</span>')
  escaped = escaped.replace(GLSL_BUILTINS, '<span class="glsl-token glsl-builtin">$1</span>')
  // Numbers
  escaped = escaped.replace(
    /\b(\d+\.\d*|\.\d+|\d+)\b/g,
    '<span class="glsl-token glsl-number">$1</span>',
  )

  // Restore comments (they already contain span markup)
  for (let i = 0; i < placeholders.length; i++) {
    escaped = escaped.replace(`__GLSL_COMMENT_${i}__`, placeholders[i])
  }
  // If any comment placeholder wasn't replaced (inline with HTML escaping), ensure fallback
  escaped = escaped.replace(/__GLSL_COMMENT_\d+__/g, '')
  return escaped
}

async function copyToClipboard(text: string): Promise<void> {
  const nav = navigator as unknown as { clipboard?: { writeText?: (t: string) => Promise<void> } }
  if (nav.clipboard?.writeText) {
    await nav.clipboard.writeText(text)
    return
  }
  // Fallback for older browsers / jsdom
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

export function ShaderSourceViewer({ source, ariaLabel, title }: ShaderSourceViewerProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const highlighted = highlightGlsl(source)

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
    <div className="shader-source-viewer" role="region" aria-label={ariaLabel ?? 'Shader source'}>
      <div className="shader-source-viewer__header">
        <h4 className="shader-source-viewer__title">{title ?? 'Shader Source'}</h4>
        <button
          className="shader-source-viewer__copy"
          aria-label="Copy shader source"
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
        <code className="glsl-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}
