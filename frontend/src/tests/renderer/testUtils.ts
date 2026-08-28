import type { EnginePublic } from '../../engine'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry } from './pixiFake'
import type { FakeApplication } from './pixiFake'

export interface FakeChild {
  label: string
  children: FakeChild[]
  position: { x: number; y: number }
  scale: { x: number; y: number }
  rotation: number
  visible: boolean
  alpha: number
  destroyed: boolean
  kind: string
  width: number
  height: number
  text?: string
  tint?: number
  ops?: string[]
  calls?: { method: string; args: unknown[] }[]
  texture?: { destroyed: boolean }
}

export async function mountRenderer(engine: EnginePublic) {
  const host = document.createElement('div')
  const renderer = new Renderer(host, engine)
  await renderer.start()
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('No pixi application was created')
  }
  return { host, renderer, app }
}

export function worldOf(app: Pick<FakeApplication, 'stage'>): FakeChild {
  const world = app.stage.children[0]
  if (!(world instanceof Object) || !('children' in world)) {
    throw new Error('No world container found')
  }
  return world as unknown as FakeChild
}

export function findByLabel(
  container: { children: FakeChild[] },
  label: string,
): FakeChild | undefined {
  return container.children.find((child) => child.label === label)
}
