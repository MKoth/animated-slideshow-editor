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
  filters: FakeFilter[] = []
  position: FakePoint = makePoint()
  scale: FakePoint = makePoint()
  rotation = 0
  visible = true
  alpha = 1
  anchor: FakePoint = makePoint()
  width = 0
  height = 0

  get childCount(): number {
    return this.children.length
  }

  addChild(...children: FakeContainer[]): FakeContainer | FakeContainer[] {
    for (const child of children) {
      child.parent?.removeChild(child)
      child.parent = this
      this.children.push(child)
    }
    return children.length === 1 ? children[0] : children
  }

  addChildAt(child: FakeContainer, index: number): FakeContainer {
    child.parent?.removeChild(child)
    child.parent = this
    this.children.splice(index, 0, child)
    return child
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

export interface FakeGraphicsCall {
  method: string
  args: unknown[]
}

export class FakeGraphics extends FakeContainer {
  readonly kind = 'graphics'
  readonly ops: string[] = []
  readonly calls: FakeGraphicsCall[] = []

  #record(method: string, args: unknown[]): void {
    this.ops.push(method)
    this.calls.push({ method, args })
  }

  clear(): this {
    this.calls.length = 0
    this.calls.push({ method: 'clear', args: [] })
    this.ops.length = 0
    this.ops.push('clear')
    return this
  }

  rect(x?: number, y?: number, w?: number, h?: number): this {
    this.#record('rect', [x, y, w, h])
    return this
  }

  roundRect(): this {
    this.#record('roundRect', [])
    return this
  }

  moveTo(x?: number, y?: number): this {
    this.#record('moveTo', [x, y])
    return this
  }

  lineTo(x?: number, y?: number): this {
    this.#record('lineTo', [x, y])
    return this
  }

  fill(options?: unknown): this {
    this.#record('fill', [options])
    return this
  }

  stroke(options?: unknown): this {
    this.#record('stroke', [options])
    return this
  }
}

export class FakeText extends FakeContainer {
  readonly kind = 'text'
  text: string
  readonly style: unknown

  constructor(options: { text: string; style?: unknown }) {
    super()
    this.text = options.text
    this.style = options.style
  }
}

export class FakeTexture {
  destroyed = false
  readonly url?: string
  readonly width: number
  readonly height: number

  constructor(url?: string, options: { width?: number; height?: number } = {}) {
    this.url = url
    this.width = options.width ?? 1
    this.height = options.height ?? 1
  }

  destroy(): void {
    this.destroyed = true
  }
}

export class FakeSprite extends FakeContainer {
  readonly kind = 'sprite'
  texture: FakeTexture
  tint = 0xffffff

  constructor(texture: FakeTexture) {
    super()
    this.texture = texture
  }
}

export interface FakeGlProgramOptions {
  vertex: string
  fragment: string
}

export class FakeGlProgram {
  readonly vertex: string
  readonly fragment: string

  constructor(options: FakeGlProgramOptions) {
    this.vertex = options.vertex
    this.fragment = options.fragment
  }
}

export const fakeGlPrograms = {
  cache: new Map<string, FakeGlProgram>(),
  calls: [] as FakeGlProgramOptions[],
  from(options: FakeGlProgramOptions): FakeGlProgram {
    this.calls.push(options)
    const key = `${options.vertex}:${options.fragment}`
    let program = this.cache.get(key)
    if (!program) {
      program = new FakeGlProgram(options)
      this.cache.set(key, program)
    }
    return program
  },
}

export interface FakeFilterOptions {
  glProgram: FakeGlProgram
  resources?: Record<string, unknown>
}

export class FakeFilter {
  readonly kind = 'filter'
  enabled = true
  destroyed = false
  readonly glProgram: FakeGlProgram
  readonly resources: { uniforms: { uniforms: Record<string, unknown> } }

  constructor(options: FakeFilterOptions) {
    this.glProgram = options.glProgram
    const structures = (options.resources?.uniforms ?? {}) as Record<
      string,
      { value: unknown; type: string }
    >
    const uniforms: Record<string, unknown> = {}
    for (const key of Object.keys(structures)) {
      uniforms[key] = structures[key].value
    }
    this.resources = { uniforms: { uniforms } }
  }

  destroy(): void {
    this.destroyed = true
  }
}

export function resetShaderRegistries(): void {
  fakeGlPrograms.calls.length = 0
  fakeGlPrograms.cache.clear()
}

export const fakeTexture = {
  calls: [] as unknown[][],
  from(source?: unknown): FakeTexture {
    this.calls.push([source])
    return new FakeTexture()
  },
}

export const textureLoads = new Map<string, FakeTexture>()
export const textureFailures = new Map<string, Error>()

export interface DeferredTexture {
  promise: Promise<FakeTexture>
  resolve: (texture: FakeTexture) => void
  reject: (error: Error) => void
}

export const textureDeferreds = new Map<string, DeferredTexture>()
export const assetLoadCalls: string[] = []
export const assetUnloadCalls: string[] = []

export function deferredTexture(): DeferredTexture {
  let resolve: (texture: FakeTexture) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<FakeTexture>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function resetTextureRegistries(): void {
  textureLoads.clear()
  textureFailures.clear()
  textureDeferreds.clear()
  assetLoadCalls.length = 0
  assetUnloadCalls.length = 0
  fakeAssets.cache.clear()
}

export const fakeAssets = {
  cache: new Map<string, FakeTexture>(),
  async load(url: string): Promise<FakeTexture> {
    assetLoadCalls.push(url)
    const cached = this.cache.get(url)
    if (cached) {
      return cached
    }
    const deferred = textureDeferreds.get(url)
    if (deferred) {
      return deferred.promise
    }
    const failure = textureFailures.get(url)
    if (failure) {
      throw failure
    }
    const texture = textureLoads.get(url) ?? new FakeTexture(url)
    this.cache.set(url, texture)
    return texture
  },
  async unload(url: string): Promise<void> {
    assetUnloadCalls.push(url)
    const texture = this.cache.get(url)
    if (!texture) {
      return
    }
    this.cache.delete(url)
    texture.destroy()
  },
}

export class FakeTicker {
  readonly listeners = new Set<() => void>()
  FPS = 60

  add(listener: () => void): void {
    this.listeners.add(listener)
  }

  addOnce(listener: () => void): void {
    const once = (): void => {
      this.remove(once)
      listener()
    }
    this.add(once)
  }

  remove(listener: () => void): void {
    this.listeners.delete(listener)
  }

  tick(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

export class FakeApplication {
  readonly canvas: HTMLCanvasElement = document.createElement('canvas')
  readonly stage = new FakeContainer()
  readonly renderer = {
    resize: (): void => undefined,
    background: { color: 0xffffff },
  }
  readonly ticker = new FakeTicker()
  readonly screen = { width: 800, height: 600 }
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
    Sprite: FakeSprite,
    Texture: fakeTexture,
    Assets: fakeAssets,
    Filter: FakeFilter,
    GlProgram: fakeGlPrograms,
  }
}
