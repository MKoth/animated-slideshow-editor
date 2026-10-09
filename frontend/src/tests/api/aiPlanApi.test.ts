import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../api/apiClient'
import { AiApi } from '../../api/aiApi'

describe('AiApi lesson plans', () => {
  const api = new AiApi(new ApiClient())

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proposes a plan from a conversation without touching the project', async () => {
    const plan = {
      id: 'plan-1',
      projectId: 'p-1',
      conversationId: 'c-1',
      title: 'Intro to Ser and Estar',
      status: 'draft',
      slides: [],
      revisions: [],
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(plan), { status: 200 }))

    const result = await api.proposePlan({
      projectId: 'p-1',
      conversationId: 'c-1',
      request: 'Teach ser vs estar',
      context: { projectName: 'Lesson' },
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/ai/plan')
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('Teach ser vs estar')
    expect(result.title).toBe('Intro to Ser and Estar')
  })

  it('lists, patches, accepts, and rejects plans', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'plan-1', title: 'T', status: 'draft' }]), {
        status: 200,
      }),
    )
    const listing = await api.listPlans('p-1')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/plans?projectId=p-1')
    expect(listing).toHaveLength(1)

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'plan-1', title: 'Edited' }), { status: 200 }),
    )
    await api.updatePlan('plan-1', { title: 'Edited' })
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/ai/plans/plan-1')

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'plan-1', status: 'accepted' }), { status: 200 }),
    )
    const accepted = await api.acceptPlan('plan-1')
    expect(accepted.status).toBe('accepted')

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'plan-1', status: 'rejected' }), { status: 200 }),
    )
    const rejected = await api.rejectPlan('plan-1')
    expect(rejected.status).toBe('rejected')
  })
})
