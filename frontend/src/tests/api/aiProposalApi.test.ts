import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { AiApi } from '../../api/aiApi'

describe('AiApi edit proposals', () => {
  const api = new AiApi(new ApiClient())

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a proposal with server validation first', async () => {
    const proposal = {
      id: 'prop-1',
      status: 'validated',
      commands: [{ type: 'CreateSlide', name: 'Middle 1' }],
      validation: { ok: true, errors: [] },
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(proposal), { status: 201 }))

    const result = await api.createProposal({
      projectId: 'p-1',
      conversationId: 'c-1',
      title: 'Middle fill',
      commands: [{ type: 'CreateSlide', name: 'Middle 1' }],
      projectFingerprint: 'fp-1',
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/ai/proposals')
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('fp-1')
    expect(result.status).toBe('validated')
  })

  it('reports dry-run, approves a partial subset, and records execution', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'prop-1', status: 'dry_run_ok' }), { status: 200 }),
    )
    await api.reportDryRun('prop-1', { projectFingerprint: 'fp-live', ok: true, errors: [] })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/proposals/prop-1/dry-run')

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'prop-1', status: 'approved', selectedIndexes: [0] }), {
        status: 200,
      }),
    )
    const approved = await api.approveProposal('prop-1', {
      currentFingerprint: 'fp-live',
      selectedIndexes: [0],
    })
    expect(approved.status).toBe('approved')

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'prop-1', status: 'executed' }), { status: 200 }),
    )
    const executed = await api.recordExecution('prop-1', {
      historyEntryId: 'hist-1',
      executedIndexes: [0],
      success: true,
    })
    expect(executed.status).toBe('executed')
  })

  it('lists and fetches proposals', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'prop-1', title: 'T' }]), { status: 200 }),
    )
    const listing = await api.listProposals('p-1')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/proposals?projectId=p-1')
    expect(listing).toHaveLength(1)

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'prop-1', title: 'T' }), { status: 200 }),
    )
    await api.getProposal('prop-1')
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/ai/proposals/prop-1')
  })
})
