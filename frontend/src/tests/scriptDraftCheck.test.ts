import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { checkScriptDraft, formatScriptDraftErrors } from '../ai/scriptDraftCheck'
import { collectGlobalAudioAssets } from '../stores/assetLibraryStore'
import { createEngineInternal, toReadOnly } from '../engine/internal'

function setupSlide() {
  const engine = createEngineInternal()
  act(() => {
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Intro')
  })
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { engine, slideId: slide.id }
}

describe('checkScriptDraft', () => {
  it('passes a minimal runnable script', () => {
    const { engine, slideId } = setupSlide()
    const checked = checkScriptDraft(
      toReadOnly(engine),
      slideId,
      'script "Intro" from 0\ncreate group "Board" as board',
    )
    expect(checked.runnable).toBe(true)
    expect(checked.errors).toEqual([])
  })

  it('fails a block with an unknown binding instead of drafting it', () => {
    const { engine, slideId } = setupSlide()
    const checked = checkScriptDraft(
      toReadOnly(engine),
      slideId,
      'script "Fix" from 0\nbind ghost = node("Nope")\nghost.tween({ x: 1 }, 1)',
    )
    expect(checked.runnable).toBe(false)
    expect(checked.errors.length).toBeGreaterThan(0)
    expect(checked.errors[0]?.severity).toBe('error')
  })

  it('formats draft errors for the fix resubmit', () => {
    const text = formatScriptDraftErrors([
      { message: 'Unknown binding "ghost".', line: 2, column: 1 },
    ])
    expect(text).toContain('failed validation')
    expect(text).toContain('Line 2, Col 1: Unknown binding "ghost".')
  })

  it('collects global audio assets without throwing on an empty library', () => {
    expect(collectGlobalAudioAssets()).toEqual([])
  })
})
