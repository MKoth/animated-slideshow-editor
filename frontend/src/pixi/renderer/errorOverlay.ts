export class ErrorOverlay {
  readonly #host: HTMLElement
  #element: HTMLDivElement | null = null

  constructor(host: HTMLElement) {
    this.#host = host
  }

  show(error: unknown): void {
    const element = this.#element ?? this.#create()
    const message = error instanceof Error ? error.message : String(error)
    const messageElement = element.querySelector('.canvas-error-overlay__message')
    if (messageElement) {
      messageElement.textContent = message
    }
  }

  hide(): void {
    this.#element?.remove()
    this.#element = null
  }

  #create(): HTMLDivElement {
    const element = document.createElement('div')
    element.className = 'canvas-error-overlay'
    element.setAttribute('role', 'alert')

    const title = document.createElement('p')
    title.className = 'canvas-error-overlay__title'
    title.textContent = 'Rendering error'

    const message = document.createElement('p')
    message.className = 'canvas-error-overlay__message'

    element.append(title, message)
    this.#host.appendChild(element)
    this.#element = element
    return element
  }
}
