import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendStatus } from '../components/editor/BackendStatus'
import { useBackendStore } from '../stores/backendStore'

describe('BackendStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useBackendStore.setState({ status: 'checking' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders backend connected when /health responds ok', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    )

    render(<BackendStatus />)

    expect(await screen.findByText('Backend connected')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/health', expect.anything())
    expect(useBackendStore.getState().status).toBe('available')
  })

  it('renders backend unavailable when /health fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))

    render(<BackendStatus />)

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
    expect(useBackendStore.getState().status).toBe('unavailable')
  })

  it('reflects availability changes reported from elsewhere', () => {
    useBackendStore.getState().markUnavailable()

    render(<BackendStatus />)

    expect(screen.getByText('Backend unavailable')).toBeInTheDocument()
  })
})
