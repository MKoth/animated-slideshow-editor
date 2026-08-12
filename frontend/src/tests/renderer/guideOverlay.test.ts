import { describe, expect, it } from 'vitest'
import { GUIDE_COLOR, GuideOverlay } from '../../pixi/renderer/guideOverlay'
import type { PixiContainer, RendererPixi } from '../../pixi/renderer/pixi'
import type { WorldRect } from '../../pixi/renderer/worldGeometry'
import { createPixiFake, FakeContainer, FakeGraphics } from './pixiFake'

const SPAN: WorldRect = { minX: 0, minY: 0, maxX: 100, maxY: 200 }

function mount(): { world: FakeContainer; overlay: GuideOverlay; graphics: FakeGraphics } {
  const world = new FakeContainer()
  const overlay = new GuideOverlay(
    createPixiFake() as unknown as RendererPixi,
    world as unknown as PixiContainer,
  )
  overlay.attach()
  return { world, overlay, graphics: world.children[0] as FakeGraphics }
}

describe('GuideOverlay', () => {
  it('joins the world as a labelled graphics child', () => {
    const { world } = mount()
    expect(world.children[0].label).toBe('guides')
    expect(world.children[0].kind).toBe('graphics')
  })

  it('draws one magenta line per vertical and horizontal guide', () => {
    const { overlay, graphics } = mount()
    graphics.calls.length = 0

    overlay.show([10, 20], [30], SPAN)

    const strokes = graphics.calls.filter((call) => call.method === 'stroke')
    expect(strokes).toHaveLength(3)
    for (const call of strokes) {
      expect((call.args[0] as { color: number }).color).toBe(GUIDE_COLOR)
    }
  })

  it('clear empties the drawing', () => {
    const { overlay, graphics } = mount()

    overlay.show([10], [], SPAN)
    overlay.clear()

    expect(graphics.calls.at(-1)?.method).toBe('clear')
  })

  it('detach destroys the graphics', () => {
    const { overlay, graphics } = mount()
    overlay.detach()
    expect(graphics.destroyed).toBe(true)
  })
})
