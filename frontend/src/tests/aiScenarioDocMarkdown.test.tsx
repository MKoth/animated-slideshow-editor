import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScenarioDocMarkdown } from '../ai/markdown'

const MD = [
  '# Lesson',
  '',
  '## Step 1 — One',
  '',
  '[place: green-tree]',
  '',
  '![Green tree](asset:green-tree)',
  '',
  '> Brief: A tree.',
  '',
  '[reveal: text]',
  '',
  'Ser is identity.',
  '',
  '[reveal: table]',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '[remove: green-tree]',
  '',
  '[wipe]',
  '',
].join('\n')

describe('ScenarioDocMarkdown board actions', () => {
  it('renders place/reveal/remove/wipe markers as separate action cards', () => {
    const { container } = render(<ScenarioDocMarkdown content={MD} />)
    expect(container.querySelectorAll('p.scenario-action-line')).toHaveLength(5)
    expect(screen.getByText('Place')).toBeInTheDocument()
    expect(screen.getAllByText('Reveal')).toHaveLength(2)
    expect(screen.getByText('Remove')).toBeInTheDocument()
    expect(screen.getByText('Wipe board')).toBeInTheDocument()
    // Raw marker source never leaks as readable text.
    expect(screen.queryByText('[place: green-tree]')).not.toBeInTheDocument()
    expect(screen.queryByText('[wipe]')).not.toBeInTheDocument()
    // Step content still renders around the markers.
    expect(screen.getByText('Ser is identity.')).toBeInTheDocument()
  })

  it('renders a targeted wipe with its ids', () => {
    render(<ScenarioDocMarkdown content={['[wipe: text1, table1]', ''].join('\n')} />)
    expect(screen.getByText('Wipe')).toBeInTheDocument()
    expect(screen.getByText('text1, table1')).toBeInTheDocument()
    expect(screen.queryByText('[wipe: text1, table1]')).not.toBeInTheDocument()
  })

  it('shows the reveal kind without the bookkeeping id', () => {
    render(<ScenarioDocMarkdown content={['[reveal: text1]', ''].join('\n')} />)
    expect(screen.getByText('Reveal')).toBeInTheDocument()
    expect(screen.getByText('Text')).toBeInTheDocument()
    expect(screen.queryByText('text1')).not.toBeInTheDocument()
    expect(screen.queryByText('[reveal: text1]')).not.toBeInTheDocument()
  })

  it('isolates glued markers into their own blocks', () => {
    const glued = [
      '**Narrator:** You will learn ser and estar.',
      '[reveal: text1]',
      'Ser and Estar',
      '[wipe]',
      '',
    ].join('\n')
    const { container } = render(<ScenarioDocMarkdown content={glued} />)
    expect(container.querySelectorAll('p.scenario-action-line')).toHaveLength(2)
    expect(screen.getByText('Reveal')).toBeInTheDocument()
    expect(screen.getByText('Wipe board')).toBeInTheDocument()
    expect(screen.queryByText('[reveal: text1]')).not.toBeInTheDocument()
    expect(screen.queryByText('[wipe]')).not.toBeInTheDocument()
  })
})
