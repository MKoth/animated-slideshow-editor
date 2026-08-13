import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

if (typeof globalThis.DataTransfer === 'undefined') {
  const TEXT_PLAIN = 'text/plain'

  class FakeDataTransfer {
    // Own property on purpose: RTL clones passed data transfers by copying
    // their own enumerable properties onto a new instance; sharing the map
    // keeps the clone and the original in sync.
    readonly data = new Map<string, string>()

    get types(): readonly string[] {
      return [...this.data.keys()]
    }

    get dropEffect(): string {
      return this.data.get('__dropEffect') ?? 'none'
    }

    set dropEffect(value: string) {
      this.data.set('__dropEffect', value)
    }

    get effectAllowed(): string {
      return this.data.get('__effectAllowed') ?? 'uninitialized'
    }

    set effectAllowed(value: string) {
      this.data.set('__effectAllowed', value)
    }

    setData(type: string, value: string): void {
      this.data.set(normalizeType(type), value)
    }

    getData(type: string): string {
      return this.data.get(normalizeType(type)) ?? ''
    }

    clearData(type?: string): void {
      if (type === undefined) {
        this.data.clear()
      } else {
        this.data.delete(normalizeType(type))
      }
    }

    setDragImage(): void {
      // The real drag image is browser-managed; nothing to do in jsdom.
    }
  }

  class FakeDragEvent extends MouseEvent {
    readonly dataTransfer: FakeDataTransfer

    constructor(type: string, init: DragEventInit = {}) {
      super(type, init)
      this.dataTransfer =
        (init.dataTransfer as FakeDataTransfer | undefined) ?? new FakeDataTransfer()
    }
  }

  function normalizeType(type: string): string {
    switch (type) {
      case 'Text':
      case 'text':
        return TEXT_PLAIN
      case 'Url':
      case 'URL':
        return 'text/uri-list'
      default:
        return type.toLowerCase()
    }
  }

  Object.assign(globalThis, { DataTransfer: FakeDataTransfer, DragEvent: FakeDragEvent })
}

interface FakeContentRect {
  readonly x: number
  readonly y: number
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly bottom: number
  readonly right: number
}

class FakeResizeObserver {
  readonly callback: ResizeObserverCallback
  readonly targets = new Set<Element>()
  static readonly instances: FakeResizeObserver[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
  }

  trigger(): void {
    const entries = [...this.targets].map((target) => {
      const width = (target as HTMLElement).clientWidth
      const height = (target as HTMLElement).clientHeight
      const contentRect: FakeContentRect = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width,
        height,
        bottom: height,
        right: width,
      }
      return { target, contentRect }
    })
    this.callback(entries as unknown as ResizeObserverEntry[], this)
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.assign(globalThis, { ResizeObserver: FakeResizeObserver })
}

export function resizeObserverFor(
  target: Element,
): InstanceType<typeof FakeResizeObserver> | undefined {
  return FakeResizeObserver.instances.find((observer) => observer.targets.has(target))
}
