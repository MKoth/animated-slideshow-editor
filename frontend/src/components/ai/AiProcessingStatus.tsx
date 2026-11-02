import type { JSX, ReactNode } from 'react'

/** Lightweight, non-blocking status shared by asynchronous AI workflows. */
export function AiProcessingStatus({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <span className="ai-processing-status" role="status" aria-live="polite" data-testid={testId}>
      <span className="ai-processing-status__spinner" aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}
