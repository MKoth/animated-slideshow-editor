import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AiAnimationScriptPreview } from '../components/ai/AiAnimationScriptPreview'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'

describe('isolated Animation Script preview', () => {
  it('shows time-labelled scene snapshots without changing the live project', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Preview' })
    const slide = engine.createSlide('Room')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Paw', {
      components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
    })
    const before = JSON.stringify(engine.toJSON())

    render(
      <AiAnimationScriptPreview
        engine={toReadOnly(engine)}
        slideId={slide.id}
        revision="1"
        source={'script "Preview" from 0\nbind paw = node("Paw")\npaw.tween({ x: 10 }, 1)'}
      />,
    )

    expect(screen.getByTestId('ai-animation-script-preview')).toBeInTheDocument()
    expect(screen.getByTestId('ai-animation-script-preview-frame-0')).toHaveAccessibleName(
      /0\.00 seconds/i,
    )
    expect(screen.getByTestId('ai-animation-script-preview-frame-4')).toHaveAccessibleName(
      /1\.00 seconds/i,
    )
    expect(JSON.stringify(engine.toJSON())).toBe(before)
  })
})
