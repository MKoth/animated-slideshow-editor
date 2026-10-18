import { describe, expect, it } from 'vitest'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  SetSlideAnimationScriptFootprintCommand,
  createCommandSystem,
} from '../../engine/commands'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { compiledFootprintToJSON } from '../../engine/compiledFootprint'

const SETUP = `script "Stale rerun" from 0
create asset "blackboar-background" as bg at (100, 100) { scaleX: 0.2, scaleY: 0.2 }
create text "Demo title" as title at (100, 100) { content: "Ser y estar", fontSize: 30 }
at(0) bg.fadeIn(1.0)
at(0.5) title.fadeIn(1.0)
`

describe('Animation Script stale rerun', () => {
  it('replaces stale script nodes even when the footprint lost them', () => {
    const system = createCommandSystem(() => {})
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'R' }))
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S' }))
    const slide = system.engine.getActiveSlide()!
    system.assetLibrarySync.apply([{ id: 'a-bg', name: 'blackboar-background' }])
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId: slide.id, source: SETUP }),
    )
    const first = runAnimationScript(
      system.engine,
      (command) => system.dispatcher.dispatch(command),
      slide.id,
      SETUP,
    )
    expect(first.ran).toBe(true)
    const footprint = system.engine.getSlide(slide.id).animationScript?.lastCompiled
    expect(footprint?.createdNodes.length).toBeGreaterThan(0)
    // Simulate an older lesson / lost footprint: nodes stay, record goes empty.
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptFootprintCommand({
        slideId: slide.id,
        footprint: compiledFootprintToJSON({
          ...footprint!,
          createdNodes: [],
          createdDataSources: [],
        }),
      }),
    )
    const second = runAnimationScript(
      system.engine,
      (command) => system.dispatcher.dispatch(command),
      slide.id,
      SETUP,
    )
    expect(second.error).toBeNull()
    expect(second.ran).toBe(true)
  })
})
