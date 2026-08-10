import { useRef } from 'react'

interface SplitterProps {
  orientation: 'vertical' | 'horizontal'
  onDrag: (deltaPixels: number) => void
  ariaLabel: string
}

export function Splitter({ orientation, onDrag, ariaLabel }: SplitterProps) {
  const last = useRef<{ x: number; y: number } | null>(null)

  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    last.current = { x: event.clientX, y: event.clientY }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const previous = last.current
      if (!previous) {
        return
      }
      const delta =
        orientation === 'vertical' ? moveEvent.clientX - previous.x : moveEvent.clientY - previous.y
      last.current = { x: moveEvent.clientX, y: moveEvent.clientY }
      onDrag(delta)
    }

    const handleMouseUp = () => {
      last.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      className={`splitter splitter--${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      onMouseDown={handleMouseDown}
    />
  )
}
