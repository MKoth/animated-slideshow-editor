import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiMarkdown } from '../ai/markdown'

describe('AiMarkdown', () => {
  it('renders headings, lists, tables, quotes, links, and code', async () => {
    const content = [
      '# Lesson',
      '',
      '- first',
      '- second',
      '',
      '> note',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '[docs](https://example.com)',
      '',
      '```typescript',
      'const x: number = 1',
      '```',
      '',
      '`inline`',
    ].join('\n')

    render(<AiMarkdown content={content} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lesson')
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('note')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
    expect(screen.getByText(/const x/)).toBeInTheDocument()
    expect(screen.getByText('inline')).toBeInTheDocument()
  })

  it('renders GLSL, Python, JSON, and Markdown code blocks', () => {
    render(
      <AiMarkdown
        content={'```glsl\nvoid main() {}\n```\n\n```python\nx = 1\n```\n\n```json\n{"a": 1}\n```'}
      />,
    )
    expect(screen.getByText(/void main/)).toBeInTheDocument()
    expect(screen.getByText(/x = 1/)).toBeInTheDocument()
    expect(screen.getByText(/"a"/)).toBeInTheDocument()
  })

  it('never renders asset: references as broken images', () => {
    const { container } = render(
      <AiMarkdown
        content={['![Oak tree](asset:oak-tree)', '', '![Red fox](asset:red-fox)'].join('\n')}
      />,
    )
    // No <img> may point at an asset: reference (chat/streaming surfaces
    // have no base for them, so each rendered as a broken-image icon).
    for (const img of Array.from(container.querySelectorAll('img'))) {
      expect(img.getAttribute('src') ?? '').not.toMatch(/^asset:/i)
    }
    expect(container.textContent).toContain('Oak tree')
    expect(container.textContent).toContain('oak-tree')
  })
})
