import { useEffect, useRef } from 'react'

export interface WaveformCanvasProps {
  readonly peaks: readonly number[] | null
  readonly width?: number
  readonly height?: number
  readonly color?: string
  readonly background?: string
  readonly barGap?: number
  readonly className?: string
  readonly ariaLabel?: string
  readonly testId?: string
}

export function WaveformCanvas({
  peaks,
  width = 120,
  height = 24,
  color = '#7c5cff',
  background = 'transparent',
  barGap = 1,
  className,
  ariaLabel,
  testId,
}: WaveformCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    if (background !== 'transparent') {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, width, height)
    }
    if (!peaks || peaks.length === 0) {
      ctx.fillStyle = '#444'
      ctx.fillRect(width * 0.3, height * 0.45, width * 0.4, height * 0.1)
      return
    }
    const barCount = Math.min(peaks.length, Math.floor(width / (1 + barGap)))
    // Downsample peaks to barCount if needed
    const step = peaks.length / barCount
    const barWidth = Math.max(1, (width - barGap * (barCount - 1)) / barCount)
    const midY = height / 2
    ctx.fillStyle = color
    for (let i = 0; i < barCount; i++) {
      const idxStart = Math.floor(i * step)
      const idxEnd = Math.floor((i + 1) * step)
      let max = 0
      for (let j = idxStart; j < idxEnd; j++) max = Math.max(max, peaks[j] ?? 0)
      if (idxEnd === idxStart) max = peaks[idxStart] ?? 0
      const norm = max / 255
      const h = Math.max(2, norm * height * 0.9)
      const y = midY - h / 2
      const x = i * (barWidth + barGap)
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, h, 1)
      } else {
        ctx.rect(x, y, barWidth, h)
      }
      ctx.fill()
    }
  }, [peaks, width, height, color, background, barGap])

  if (!peaks || peaks.length === 0) {
    return (
      <canvas
        ref={ref}
        className={className ?? 'waveform-canvas'}
        aria-label={ariaLabel ?? 'waveform'}
        data-testid={testId ?? 'waveform-canvas'}
        width={width}
        height={height}
      />
    )
  }

  return (
    <canvas
      ref={ref}
      className={className ?? 'waveform-canvas'}
      aria-label={ariaLabel ?? 'waveform'}
      data-testid={testId ?? 'waveform-canvas'}
      width={width}
      height={height}
    />
  )
}
