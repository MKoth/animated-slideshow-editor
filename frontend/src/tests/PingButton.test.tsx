import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PingButton } from '../components/editor/PingButton'

describe('PingButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('displays the pong message returned by the backend', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'pong' }), { status: 200 }),
    )
    const user = userEvent.setup()
    render(<PingButton />)

    await user.click(screen.getByRole('button', { name: 'Ping Backend' }))

    expect(await screen.findByText('pong')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/ping', expect.anything())
  })

  it('shows Backend unavailable when the ping fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    const user = userEvent.setup()
    render(<PingButton />)

    await user.click(screen.getByRole('button', { name: 'Ping Backend' }))

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
  })
})
