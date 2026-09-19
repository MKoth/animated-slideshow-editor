import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { DEFAULT_TIMELINE_VIEWPORT_WIDTH } from '../../stores/timelineViewStore'

export function useViewportWidth(
  scrollerRef: RefObject<HTMLDivElement | null>,
  deps: readonly unknown[],
): number {
  const [width, setWidth] = useState(DEFAULT_TIMELINE_VIEWPORT_WIDTH)
  useEffect(() => {
    const measure = () => {
      const el = scrollerRef.current
      setWidth(el && el.clientWidth > 0 ? el.clientWidth : DEFAULT_TIMELINE_VIEWPORT_WIDTH)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollerRef, ...deps])
  return width
}
