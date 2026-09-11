import { rulerTickStep, rulerTickTimes, tickLabel } from '../../stores/timelineViewStore'

export interface ManagerRulerProps {
  readonly durationSec: number // for label context, but ticks computed from startSec..endSec
  readonly startSec?: number // default 0
  readonly endSec?: number // default durationSec
  readonly pps: number
  readonly widthPx: number
  readonly testId?: string
  readonly heightPx?: number
}

export function ManagerRuler({
  durationSec,
  startSec,
  endSec,
  pps,
  widthPx,
  testId = 'manager-ruler',
  heightPx = 22,
}: ManagerRulerProps) {
  const start = startSec ?? 0
  const end = endSec ?? durationSec
  const step = rulerTickStep(pps)
  const span = Math.max(1e-9, end - start)
  // ticks within [start, end]
  const ticks = rulerTickTimes(start, end, step)
  // widthPx corresponds to span * pps (caller should ensure consistency)
  // If widthPx mismatches span*pps, we still map proportionally
  const pxPerSec = widthPx / span
  return (
    <div
      data-testid={testId}
      style={{
        position: 'relative',
        width: `${widthPx}px`,
        height: heightPx,
        borderBottom: '1px solid var(--color-border, #ddd)',
        background: 'var(--color-bg, #fff)',
        userSelect: 'none',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {ticks.map((time) => {
        const left = (time - start) * pxPerSec
        return (
          <div
            key={time}
            data-testid={`${testId}-tick-${time}`}
            style={{
              position: 'absolute',
              left,
              top: 0,
              bottom: 0,
              borderLeft: '1px solid var(--color-border, #ddd)',
              fontSize: 9,
              color: 'var(--color-text-muted, #666)',
              paddingLeft: 3,
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {tickLabel(time, step)}s
          </div>
        )
      })}
    </div>
  )
}

// Orphan-specific ruler that spans orphanBounds [min, max]
export function OrphanRuler({
  min,
  max,
  pps,
  widthPx,
  testId = 'orphan-ruler',
}: {
  readonly min: number
  readonly max: number
  readonly pps: number
  readonly widthPx: number
  readonly testId?: string
}) {
  const span = Math.max(1e-9, max - min)
  const durationSec = span // for step calc we use span; still pps-based
  return (
    <ManagerRuler
      durationSec={durationSec}
      startSec={min}
      endSec={max}
      pps={pps}
      widthPx={widthPx}
      testId={testId}
    />
  )
}
