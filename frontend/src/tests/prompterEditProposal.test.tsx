import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PrompterEditProposal } from '../components/ai/PrompterEditProposal'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'

function renderProposal(content: string, onFix = vi.fn()) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'TTS test' })
  const slide = engine.createSlide('Intro')
  engine.createPrompterPart(slide.id, { id: 'part-1', text: 'Hello mundo', duration: 1.1 })
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatcher,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  render(
    <EngineContext.Provider value={value}>
      <PrompterEditProposal
        content={content.replace('"slideId":"slide-1"', `"slideId":"${slide.id}"`)}
        onFix={onFix}
      />
    </EngineContext.Provider>,
  )
  return { engine, slide, onFix }
}

function editResponse(sourcePartIds: string[], outputPartIds = sourcePartIds) {
  return `Proposed split.\n\n\`\`\`prompter-edit\n${JSON.stringify({
    slideId: 'slide-1',
    blocks: outputPartIds.map((_id, index) => ({
      text: outputPartIds.length === 1 ? 'Hello mundo.' : index === 0 ? 'Hello' : '"mundo"',
      language: index === 0 ? 'en' : 'es',
    })),
  })}\n\`\`\``
}

describe('Prompter edit proposal local dry-run', () => {
  it('applies a per-block language choice when updating an existing block', async () => {
    const { slide } = renderProposal(editResponse(['part-1']))
    const user = userEvent.setup()
    await user.click(screen.getByTestId('prompter-edit-dry-run'))
    await user.click(screen.getByTestId('prompter-edit-apply'))

    expect(slide.prompter?.parts[0].ttsLanguage).toBe('en')
  })

  it('rejects a block when the assistant omits its required language', async () => {
    const response = JSON.parse(
      editResponse(['part-1']).match(/```prompter-edit\s*([\s\S]*?)```/)![1],
    )
    delete response.blocks[0].language
    renderProposal(`\`\`\`prompter-edit\n${JSON.stringify(response)}\n\`\`\``)

    expect(screen.getByTestId('prompter-edit-dry-run-errors')).toHaveTextContent(
      'Each block needs non-empty text and an explicit language ("en" or "es").',
    )
  })

  it('derives source mappings from preserved word order instead of trusting model-supplied IDs', async () => {
    const response = JSON.parse(
      editResponse(['part-1']).match(/```prompter-edit\s*([\s\S]*?)```/)![1],
    )
    renderProposal(`\`\`\`prompter-edit\n${JSON.stringify(response)}\n\`\`\``)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('prompter-edit-dry-run'))

    expect(screen.getByTestId('prompter-edit-dry-run')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Dry-run passed')
  })

  it('rejects a truncated proposal that omits spoken words', async () => {
    const response = JSON.parse(
      editResponse(['part-1']).match(/```prompter-edit\s*([\s\S]*?)```/)![1],
    )
    response.blocks[0].text = 'Hello.'
    renderProposal(`\`\`\`prompter-edit\n${JSON.stringify(response)}\n\`\`\``)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('prompter-edit-dry-run'))

    expect(screen.getByTestId('prompter-edit-dry-run-errors')).toHaveTextContent(
      'changes spoken words',
    )
  })

  it('enables Apply only after a successful local dry-run, then applies as one change', async () => {
    const { engine, slide } = renderProposal(editResponse(['part-1'], ['part-1', 'part-1']))
    const user = userEvent.setup()
    const apply = screen.getByTestId('prompter-edit-apply')
    expect(apply).toBeDisabled()
    await user.click(screen.getByTestId('prompter-edit-dry-run'))
    expect(screen.getByRole('status')).toHaveTextContent('Dry-run passed')
    expect(apply).toBeEnabled()
    await user.click(apply)
    expect(slide.prompter?.parts.map((part) => part.text)).toEqual(['Hello', '"mundo"'])
    expect(slide.prompter?.parts.map((part) => part.ttsLanguage)).toEqual(['en', 'es'])
    expect(engine.getSlide(slide.id).prompter?.parts).toHaveLength(2)
    expect(screen.getByTestId('prompter-edit-applied')).toHaveTextContent(
      'Applied as one undoable change',
    )
  })

  it('shows local compile errors and sends them only after an explicit request', async () => {
    const onFix = vi.fn()
    const response = JSON.parse(
      editResponse(['part-1']).match(/```prompter-edit\s*([\s\S]*?)```/)![1],
    )
    response.blocks[0].text = 'Hello amigo.'
    renderProposal(`\`\`\`prompter-edit\n${JSON.stringify(response)}\n\`\`\``, onFix)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('prompter-edit-dry-run'))
    const errors = screen.getByTestId('prompter-edit-dry-run-errors')
    expect(errors).toHaveTextContent('changes spoken words')
    expect(onFix).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('prompter-edit-send-errors'))
    expect(onFix).toHaveBeenCalledWith([
      'This suggestion changes spoken words. Only punctuation and block boundaries can be applied automatically.',
    ])
  })
})
