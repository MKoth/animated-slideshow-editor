import { describe, expect, it, vi } from 'vitest'
import {
  IkOverlay,
  TARGET_COLOR,
  TARGET_SELECTED_COLOR,
  POLE_COLOR,
  POLE_SELECTED_COLOR,
} from '../../pixi/renderer/ikOverlay'
import type { IkOverlayContext } from '../../pixi/renderer/ikOverlay'
import { FakeContainer, FakeGraphics, createPixiFake } from './pixiFake'
import type { PixiContainer, RendererPixi } from '../../pixi/renderer/pixi'
import { useIKSelectionStore } from '../../stores/ikSelectionStore'

vi.mock('../../stores/ikSelectionStore', () => ({
  useIKSelectionStore: {
    getState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}))

const mockGetState = vi.mocked(useIKSelectionStore.getState)
const mockSubscribe = vi.mocked(useIKSelectionStore.subscribe)

function makeChain(id: string, targetX: number, targetY: number, poleX?: number, poleY?: number) {
  return {
    id,
    boneIds: ['bone1', 'bone2'],
    target: { position: { x: targetX, y: targetY } },
    poleTarget:
      poleX !== undefined && poleY !== undefined ? { position: { x: poleX, y: poleY } } : null,
  }
}

function mount(selectedChainId: string | null = null) {
  mockGetState.mockReturnValue({ selectedChainId, selectChain: vi.fn() })
  mockSubscribe.mockReturnValue(() => {})

  const world = new FakeContainer()
  const chainA = makeChain('chainA', 100, 200, 50, 100)
  const chainB = makeChain('chainB', 300, 400)
  const chains = [chainA, chainB]

  const engine = {
    getActiveSlide: vi.fn().mockReturnValue({ id: 'slide1' }),
    getIKManager: vi.fn().mockReturnValue({
      getChainsForSlide: vi.fn().mockReturnValue(chains),
      getChain: vi.fn().mockImplementation((id: string) => {
        const c = chains.find((ch) => ch.id === id)
        if (!c) throw new Error(`Chain ${id} not found`)
        return c
      }),
    }),
    subscribe: vi.fn().mockReturnValue(() => {}),
  }

  const pixiFake = createPixiFake()
  const context: IkOverlayContext = {
    pixi: pixiFake as unknown as RendererPixi,
    world: world as unknown as PixiContainer,
    engine: engine as never,
    getScene: vi.fn().mockReturnValue({ id: 'scene1' }),
  }

  const overlay = new IkOverlay(context)
  overlay.attach()
  const graphics = world.children[0] as FakeGraphics

  return { overlay, graphics, engine, world, chains }
}

describe('IkOverlay', () => {
  it('joins the world as a labelled graphics child', () => {
    const { world } = mount()
    expect(world.children[0].label).toBe('ik-overlay')
    expect(world.children[0].kind).toBe('graphics')
  })

  describe('redraw — always-visible handles', () => {
    it('draws handles for all chains, not just the selected one', () => {
      const { overlay, graphics } = mount(null)
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      expect(fills.length).toBeGreaterThanOrEqual(3)
    })

    it('draws target + pole for each chain', () => {
      const { overlay, graphics } = mount(null)
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      expect(fills).toHaveLength(3)
    })

    it('draws chainA target with default blue when no chain is selected', () => {
      const { overlay, graphics } = mount(null)
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      const targetFill = fills[0]
      expect((targetFill.args[0] as { color: number }).color).toBe(TARGET_COLOR)
    })

    it('draws chainA pole with default purple when no chain is selected', () => {
      const { overlay, graphics } = mount(null)
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      const poleFill = fills[1]
      expect((poleFill.args[0] as { color: number }).color).toBe(POLE_COLOR)
    })

    it('draws selected chain handles with orange highlight', () => {
      const { overlay, graphics } = mount('chainA')
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      expect(fills[0].args[0]).toMatchObject({ color: TARGET_SELECTED_COLOR })
      expect(fills[1].args[0]).toMatchObject({ color: POLE_SELECTED_COLOR })
    })

    it('draws non-selected chain handles with default colors', () => {
      const { overlay, graphics } = mount('chainA')
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      expect(fills[2].args[0]).toMatchObject({ color: TARGET_COLOR })
    })

    it('does not skip non-selected chains', () => {
      const { overlay, graphics } = mount('chainB')
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      expect(fills).toHaveLength(3)
    })

    it('draws pole targets for all chains that have them', () => {
      const { overlay, graphics } = mount(null)
      graphics.calls.length = 0
      overlay.redraw()

      const fills = graphics.calls.filter((c) => c.method === 'fill')
      const poleFills = fills.filter((f) => {
        const color = (f.args[0] as { color: number }).color
        return color === POLE_COLOR || color === POLE_SELECTED_COLOR
      })
      expect(poleFills).toHaveLength(1)
    })

    it('clears and redraws on every call', () => {
      const { graphics, overlay } = mount(null)
      graphics.calls.length = 0

      overlay.redraw()
      expect(graphics.calls[0].method).toBe('clear')
    })
  })

  describe('hitTestTarget — all chains hittable', () => {
    it('hits target on chainB even when chainA is selected', () => {
      const { overlay } = mount('chainA')
      const result = overlay.hitTestTarget(300, 400)
      expect(result).toEqual({ chainId: 'chainB', kind: 'target' })
    })

    it('hits target on chainA when chainB is selected', () => {
      const { overlay } = mount('chainB')
      const result = overlay.hitTestTarget(100, 200)
      expect(result).toEqual({ chainId: 'chainA', kind: 'target' })
    })

    it('returns null when no handle is near the point', () => {
      const { overlay } = mount('chainA')
      const result = overlay.hitTestTarget(999, 999)
      expect(result).toBeNull()
    })

    it('hits pole on a non-selected chain', () => {
      const { overlay } = mount('chainB')
      const result = overlay.hitTestTarget(50, 100)
      expect(result).toEqual({ chainId: 'chainA', kind: 'pole' })
    })

    it('returns null when no chain exists on the slide', () => {
      const { engine } = mount()
      engine.getIKManager().getChainsForSlide.mockReturnValue([])
      const overlay = new IkOverlay({
        pixi: createPixiFake() as never,
        world: new FakeContainer() as never,
        engine: engine as never,
        getScene: vi.fn().mockReturnValue({ id: 'scene1' }),
      })
      overlay.attach()
      expect(overlay.hitTestTarget(100, 200)).toBeNull()
    })
  })
})
