export interface FakePoint {
  x: number
  y: number
  set(x: number, y: number): void
}

function makePoint(): FakePoint {
  return {
    x: 0,
    y: 0,
    set(x, y) {
      this.x = x
      this.y = y
    },
  }
}

export class FakeContainer {
  kind = 'container'
  label = ''
  destroyed = false
  parent: FakeContainer | null = null
  children: FakeContainer[] = []
  position: FakePoint = makePoint()
  scale: FakePoint = makePoint()
  rotation = 0
  visible = true
  alpha = 1
  anchor: FakePoint = makePoint()

  get childCount(): number {
    return this.children.length
  }

  addChild(...children: FakeContainer[]): FakeContainer | FakeContainer[] {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
    return children.length === 1 ? children[0] : children
  }

  removeChild(child: FakeContainer): void {
    this.children = this.children.filter((entry) => entry !== child)
    child.parent = null
  }

  removeChildren(): void {
    for (const child of this.children) {
      child.parent = null
    }
    this.children = []
  }

  destroy(options?: { children?: boolean }): void {
    if (options?.children) {
      for (const child of [...this.children]) {
        child.destroy(options)
      }
    }
    this.removeChildren()
    this.parent?.removeChild(this)
    this.parent = null
    this.destroyed = true
  }
}

export class FakeGraphics extends FakeContainer {
  readonly kind = 'graphics'
  readonly ops: string[] = []

  rect(): this {
    this.ops.push('rect')
    return this
  }

  roundRect(): this {
    this.ops.push('roundRect')
    return this
  }

  moveTo(): this {
    this.ops.push('moveTo')
    return this
  }

  lineTo(): this {
    this.ops.push('lineTo')
    return this
  }

  fill(): this {
    this.ops.push('fill')
    return this
  }

  stroke(): this {
    this.ops.push('stroke')
    return this
  }
}

export class FakeText extends FakeContainer {
  readonly kind = 'text'
  readonly text: string
  readonly style: unknown

  constructor(options: { text: string; style?: unknown }) {
    super()
    this.text = options.text
    this.style = options.style
  }
}

export class FakeApplication {
  readonly canvas: HTMLCanvasElement = document.createElement('canvas')
  readonly stage = new FakeContainer()
  readonly renderer = { resize: (): void => undefined }
  initOptions: Record<string, unknown> = {}
  destroyed = false

  constructor() {
    pixiRegistry.applications.push(this)
  }

  async init(options: Record<string, unknown>): Promise<void> {
    if (pixiRegistry.failNextInit) {
      pixiRegistry.failNextInit = false
      throw new Error('WebGL context creation failed')
    }
    this.initOptions = options
  }

  destroy(): void {
    this.destroyed = true
  }
}

export const pixiRegistry = {
  applications: [] as FakeApplication[],
  failNextInit: false,
  reset(): void {
    this.applications.length = 0
    this.failNextInit = false
  },
}

export function createPixiFake() {
  return {
    Application: FakeApplication,
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Text: FakeText,
  }
}
