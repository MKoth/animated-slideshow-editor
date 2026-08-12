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
