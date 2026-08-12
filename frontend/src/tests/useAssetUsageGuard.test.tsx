import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine as createEngineInternal } from '../engine/internal'
import type { Engine } from '../engine/internal'
import type { LessonJSON } from '../engine'
import { useAssetUsageGuard } from '../app/useAssetUsageGuard'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'

const LIBRARY_ID = 'lib-a1'

function engineWithUsage(): { engine: Engine; definitionId: string } {
  const engine = createEngineInternal()
  const lesson: LessonJSON = {
    project: {
      metadata: {
        id: 'project-1',
        name: 'P',
        description: '',
        author: '',
        createdAt: '2026-08-11T00:00:00',
        updatedAt: '2026-08-11T00:00:00',
      },
      settings: {},
      slides: [
        {
          id: 'slide-1',
          name: 'S1',
          duration: 5,
          scene: {
            id: 'scene-1',
            nodes: [
              {
                id: 'root-1',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'camera-1',
                name: 'Camera',
                parentId: 'root-1',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
              {
                id: 'boy-1',
                name: 'Boy',
                parentId: 'root-1',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {
                  assetInstance: { kind: 'assetInstance', assetDefinitionId: LIBRARY_ID },
                },
              },
            ],
          },
        },
      ],
    },
    library: { assetDefinitions: [{ id: LIBRARY_ID, name: 'Boy' }] },
  }
  engine.restoreFromJSON(lesson)
  return { engine, definitionId: LIBRARY_ID }
}

describe('useAssetUsageGuard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAssetLibraryStore.setState({
      definitions: [],
      loading: false,
      error: null,
      unavailable: false,
      search: '',
      sort: 'import_date',
      order: 'desc',
      selectedId: null,
    })
    useNotificationStore.setState({ notifications: [] })
  })

  it('refuses deletion of an asset the open project references', async () => {
    const { engine, definitionId } = engineWithUsage()
    renderHook(() => useAssetUsageGuard(engine))
    let deleteCalls = 0
    vi.mocked(fetch).mockImplementation((_input, init) => {
      if (init?.method === 'DELETE') {
        deleteCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error('unexpected'))
    })

    await useAssetLibraryStore.getState().deleteAsset(definitionId)

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Used by 1 object',
    ])
    expect(deleteCalls).toBe(0)
  })

  it('reverts to unconditional deletion when unmounted', async () => {
    const { engine, definitionId } = engineWithUsage()
    const { unmount } = renderHook(() => useAssetUsageGuard(engine))
    vi.mocked(fetch).mockImplementation((_input, init) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error('unexpected'))
    })
    unmount()

    await useAssetLibraryStore.getState().deleteAsset(definitionId)

    expect(useNotificationStore.getState().notifications).toEqual([])
  })
})
