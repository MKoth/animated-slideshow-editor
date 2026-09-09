/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createEngine } from '../engine/internal'
import { duplicateLessonJSON, getUniqueDuplicateName } from '../app/projectDuplication'
import { validate, serialize } from '../engine/lessonSerializer'
import { Keyframe } from '../engine/keyframe'
import { ClipDefinition, newClipId } from '../engine/clipDefinition'
import { duplicateLibraryProject } from '../app/projectBrowser'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'
import { useNotificationStore } from '../stores/notificationStore'

describe('duplicateLessonJSON', () => {
  it('creates immutable copy with fresh ids', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Lesson A', description: 'desc', author: 'auth' })
    engine.createSlide('Slide 1')
    const slide = engine.project!.slides[0]!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'ShapeNode', {
      components: {
        mesh: {
          kind: 'mesh',
          mesh: {
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ],
            faces: [{ v0: 0, v1: 1, v2: 2 }],
            uvs: [
              { u: 0, v: 0 },
              { u: 1, v: 0 },
              { u: 0, v: 1 },
            ],
          },
          shapes: [
            {
              id: 'shape-1-old',
              name: 'Base',
              categoryId: null,
              vertices: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
              ],
            },
          ],
        },
      },
    })
    const animNode = slide.animation.ensure(node.id)
    animNode.add('positionX', new Keyframe('kf-old-1', 1, 100, 'linear'))

    const audioIdOld = 'audio-old-1'
    slide.audio.clips.push({
      id: audioIdOld,
      assetId: 'asset-1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
      volume: 1,
      muted: false,
      playbackRate: 1,
      pitchSemitones: 0,
      noiseReduction: 0,
    } as any)
    slide.prompter = {
      parts: [
        {
          id: 'part-old-1',
          text: 'Hello world',
          startTime: 0,
          endTime: 1,
          duration: 1,
          audioClipId: audioIdOld,
          segments: [{ id: 'seg-old-1', text: 'Hello', audioClipId: audioIdOld, order: 0 }],
        },
      ],
    }

    const clip = new ClipDefinition(newClipId(), 'MyClip', 1, '', [], [{ property: 'positionX' }])
    engine.importClip(clip)
    node.clipInstances.push({
      id: 'ci-old-1',
      clipId: clip.id,
      startTime: 0,
      speed: 1,
      enabled: true,
      paramOverrides: {},
    } as any)

    const originalJson = engine.toJSON()
    const originalText = JSON.stringify(originalJson)

    const duplicated = duplicateLessonJSON(originalJson, ['Lesson A'])
    expect(duplicated.project.id).not.toBe(originalJson.project.id)
    expect(duplicated.project.name).toBe('Lesson A (copy)')
    expect(duplicated.slides[0].id).not.toBe(originalJson.slides[0].id)
    expect(duplicated.slides[0].scene.id).not.toBe(originalJson.slides[0].scene.id)
    const origNodeId = originalJson.slides[0].scene.nodes.find((n) => n.name === 'ShapeNode')!.id
    const dupNodeId = duplicated.slides[0].scene.nodes.find((n) => n.name === 'ShapeNode')!.id
    expect(dupNodeId).not.toBe(origNodeId)
    const dupNode = duplicated.slides[0].scene.nodes.find((n) => n.id === dupNodeId)!
    const dupRootId = duplicated.slides[0].scene.nodes.find((n) => n.parentId === null)!.id
    expect(dupNode.parentId).toBe(dupRootId)
    const dupAudioId = duplicated.slides[0].audio!.clips[0].id
    expect(dupAudioId).not.toBe(audioIdOld)
    expect(duplicated.slides[0].prompter!.parts[0].audioClipId).toBe(dupAudioId)
    expect(duplicated.slides[0].prompter!.parts[0].segments![0].audioClipId).toBe(dupAudioId)
    const dupKfId = duplicated.slides[0].animation!.nodes.find((n) => n.nodeId === dupNodeId)!
      .tracks[0].keyframes[0].id
    expect(dupKfId).not.toBe('kf-old-1')
    const dupClipId = (duplicated.clips ??
      (duplicated as unknown as { library?: { clips?: { id: string }[] } }).library?.clips)?.[0]?.id
    expect(dupClipId).not.toBe(clip.id)
    const dupCi = duplicated.slides[0].scene.nodes.find((n) => n.id === dupNodeId)!
      .clipInstances![0]!
    expect(dupCi.id).not.toBe('ci-old-1')
    expect(dupCi.clipId).toBe(dupClipId)

    const errors = validate(duplicated)
    expect(errors).toEqual([])

    ;(duplicated.project as any).name = 'Hacked'
    ;(duplicated.slides[0] as any).name = 'Hacked Slide'
    ;(duplicated.slides[0].scene.nodes.find((n) => n.name === 'ShapeNode') as any).name =
      'Hacked Node'
    expect(originalJson.project.name).toBe('Lesson A')
    expect(JSON.stringify(originalJson)).toBe(originalText)
    ;(duplicated.project.settings as Record<string, unknown>).foo = 'bar'
    expect((originalJson.project.settings as Record<string, unknown>).foo).toBeUndefined()
  })

  it('unique name increments', () => {
    expect(getUniqueDuplicateName('Lesson', ['Lesson', 'Lesson (copy)'])).toBe('Lesson (copy 2)')
    expect(getUniqueDuplicateName('Lesson', ['Lesson', 'Lesson (copy)', 'Lesson (copy 2)'])).toBe(
      'Lesson (copy 3)',
    )
  })

  it('validate duplicated still passes even with shapes', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const json = engine.toJSON()
    const dup = duplicateLessonJSON(json, [])
    expect(validate(dup)).toEqual([])
  })

  it('remaps boneWeights, bindPose, and IK chains', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'RigTest' })
    engine.createSlide('S1')
    const slide = engine.project!.slides[0]!
    const root = engine.createNode(slide.scene.id, slide.scene.root.id, 'RootBone', {
      components: { bone: { kind: 'bone', length: 100 } },
    })
    const child = engine.createNode(slide.scene.id, root.id, 'ChildBone', {
      components: { bone: { kind: 'bone', length: 100 } },
    })
    // mesh with boneWeights referencing both bones
    const meshNode = engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh', {
      components: {
        mesh: {
          kind: 'mesh',
          mesh: {
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ],
            faces: [{ v0: 0, v1: 1, v2: 2 }],
            uvs: [
              { u: 0, v: 0 },
              { u: 1, v: 0 },
              { u: 0, v: 1 },
            ],
            boneWeights: [
              [
                { boneId: root.id, weight: 0.5 },
                { boneId: child.id, weight: 0.5 },
              ],
              [{ boneId: root.id, weight: 1 }],
              [{ boneId: child.id, weight: 1 }],
            ],
            bindPose: {
              [root.id]: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
              [child.id]: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            },
          },
        },
      },
    })
    // IK chain
    const chain = engine.createIKChain(slide.id, [root.id, child.id], {
      position: { x: 100, y: 0 },
    })
    // constraint
    engine.addConstraint(child.id, 'rotationLimit', 0, { minRotation: -45, maxRotation: 45 })

    const originalJson = engine.toJSON()
    const origRootId = root.id
    const origChildId = child.id
    const origMeshId = meshNode.id
    const origChainId = chain.id

    const dup = duplicateLessonJSON(originalJson, [])
    expect(validate(dup)).toEqual([])

    // find remapped ids
    const dupRoot = dup.slides[0].scene.nodes.find((n) => n.name === 'RootBone')!
    const dupChild = dup.slides[0].scene.nodes.find((n) => n.name === 'ChildBone')!
    const dupMesh = dup.slides[0].scene.nodes.find((n) => n.name === 'Mesh')!
    expect(dupRoot.id).not.toBe(origRootId)
    expect(dupChild.id).not.toBe(origChildId)
    expect(dupMesh.id).not.toBe(origMeshId)
    // boneWeights remapped
    const meshComp = dupMesh.components.mesh as unknown as {
      mesh: { boneWeights: { boneId: string }[][]; bindPose: Record<string, unknown> }
    }
    expect(meshComp.mesh.boneWeights[0][0].boneId).toBe(dupRoot.id)
    expect(meshComp.mesh.boneWeights[0][1].boneId).toBe(dupChild.id)
    expect(meshComp.mesh.bindPose[dupRoot.id]).toBeDefined()
    expect(meshComp.mesh.bindPose[dupChild.id]).toBeDefined()
    expect(meshComp.mesh.bindPose[origRootId]).toBeUndefined()
    // IK chain remapped
    expect(dup.ikChains).toBeDefined()
    const dupChain = dup.ikChains!.chains.find((c) => c.boneIds.includes(dupRoot.id))!
    expect(dupChain).toBeDefined()
    expect(dupChain.id).not.toBe(origChainId)
    expect(dupChain.slideId).not.toBe(slide.id)
    expect(dupChain.boneIds).toEqual([dupRoot.id, dupChild.id])
    // constraint remapped
    const dupConstraints = (
      dup.constraints!.nodeConstraints as unknown as Record<string, { id: string }[]>
    )[dupChild.id]
    expect(dupConstraints).toBeDefined()
    expect(dupConstraints.length).toBe(1)
    expect(dupConstraints[0].id).toBeDefined()
    // ensure original still has old ids after mutation of dup
    ;(dupRoot as any).name = 'Hacked'
    expect(originalJson.slides[0].scene.nodes.find((n) => n.name === 'RootBone')).toBeDefined()
  })

  it('deep clones settings so modifying duplicate settings does not affect original', () => {
    const engine = createEngine()
    engine.createProject({ name: 'SettingsTest' })
    engine.createSlide('S1')
    // set nested settings via direct assignment to project (simulate user having settings with nested prompter object)
    ;(engine.project as unknown as { settings: Record<string, unknown> }).settings = {
      prompter: { secondsPerCharacter: 0.2, splitChars: ['.', ','] },
      nested: { a: 1, b: [1, 2] },
    } as unknown as Record<string, unknown>
    const json = engine.toJSON()
    const dup = duplicateLessonJSON(json, [])
    // mutate dup settings nested
    const dupSettings = dup.project.settings as Record<string, Record<string, unknown>>
    ;(dupSettings.prompter as Record<string, unknown>).secondsPerCharacter = 999
    ;(dupSettings.nested as Record<string, unknown>).a = 999
    ;((dupSettings.nested as Record<string, unknown>).b as unknown[]).push(3)
    expect(
      (json.project.settings as Record<string, Record<string, unknown>>).prompter
        .secondsPerCharacter,
    ).toBe(0.2)
    expect(
      (
        (json.project.settings as Record<string, Record<string, unknown>>).nested as Record<
          string,
          unknown
        >
      ).a,
    ).toBe(1)
  })

  it('remaps clipCollections and collectionPlacements', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'CollTest' })
    engine.createSlide('S1')
    const slide = engine.project!.slides[0]!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'NodeA', { components: {} })
    node.semanticName = 'hand'
    const clip = new ClipDefinition(newClipId(), 'ClipA', 1, '', [], [{ property: 'positionX' }])
    engine.importClip(clip)
    const { ClipCollection, newClipCollectionId } = await import('../engine/clipCollection')
    const collection = new ClipCollection(newClipCollectionId(), 'MyCollection', { hand: clip.id })
    ;(engine as unknown as { importClipCollection: (c: unknown) => void }).importClipCollection(
      collection,
    )
    node.collectionPlacements.push({
      id: 'place-old',
      collectionId: collection.id,
      parentNodeId: node.id,
      startTime: 0,
    } as any)

    const originalJson = engine.toJSON()
    const dup = duplicateLessonJSON(originalJson, [])
    expect(validate(dup)).toEqual([])
    const dupClipId = (dup.clips ??
      (dup as unknown as { library?: { clips?: { id: string }[] } }).library?.clips)?.[0]?.id
    const dupCollection = (dup.clipCollections ??
      (
        dup as unknown as {
          library?: { clipCollections?: { id: string; bindings: Record<string, string> }[] }
        }
      ).library?.clipCollections)?.[0]
    expect(dupCollection).toBeDefined()
    expect(dupCollection!.id).not.toBe(collection.id)
    expect(dupCollection!.bindings['hand']).toBe(dupClipId)
    const dupNode = dup.slides[0].scene.nodes.find((n) => n.name === 'NodeA')!
    expect(dupNode.collectionPlacements![0].collectionId).toBe(dupCollection!.id)
    expect(dupNode.collectionPlacements![0].parentNodeId).toBe(dupNode.id)
    expect(dupNode.collectionPlacements![0].id).not.toBe('place-old')
  })

  describe('duplicateLibraryProject', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
      useProjectBrowserStore.setState({ projects: [], loading: false, error: null })
      useNotificationStore.setState({ notifications: [] })
    })
    afterEach(() => vi.unstubAllGlobals())

    it('fetches the original blob, posts a renamed deep clone with fresh ids, and refreshes the list', async () => {
      const engine = createEngine()
      engine.createProject({ name: 'My Lesson' })
      engine.createSlide('Slide 1')
      const originalBlob = serialize(engine.project!)
      const originalJson = JSON.parse(originalBlob) as ReturnType<typeof engine.toJSON>

      const posted: string[] = []
      let list = [
        { id: originalJson.project.id, name: 'My Lesson', lastModified: '2026-01-01T00:00:00' },
      ]

      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url === '/api/projects' && method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify(list), { status: 200 }))
        }
        if (url === `/api/projects/${originalJson.project.id}` && method === 'GET') {
          return Promise.resolve(new Response(originalBlob, { status: 200 }))
        }
        if (url === '/api/projects' && method === 'POST') {
          const body = init?.body as string
          posted.push(body)
          const parsed = JSON.parse(body)
          // simulate backend adding to list
          list = [
            ...list,
            {
              id: parsed.project.id,
              name: parsed.project.name,
              lastModified: new Date().toISOString(),
            },
          ]
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: parsed.project.id, name: parsed.project.name, version: 2 }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error(`unexpected ${method} ${url}`))
      })

      // seed store so getUniqueDuplicateName sees existing name
      useProjectBrowserStore.setState({
        projects: [
          { id: originalJson.project.id, name: 'My Lesson', lastModified: '2026-01-01T00:00:00' },
        ],
      })

      const result = await duplicateLibraryProject(originalJson.project.id)

      expect(result).toBe(true)
      expect(posted).toHaveLength(1)
      const duplicateJson = JSON.parse(posted[0]!) as typeof originalJson
      expect(duplicateJson.project.id).not.toBe(originalJson.project.id)
      expect(duplicateJson.project.name).toBe('My Lesson (copy)')
      expect(duplicateJson.slides[0].id).not.toBe(originalJson.slides[0].id)
      expect(duplicateJson.slides[0].scene.id).not.toBe(originalJson.slides[0].scene.id)
      // original blob not mutated
      expect(JSON.parse(originalBlob).project.id).toBe(originalJson.project.id)
      // store refreshed to include the new project
      expect(useProjectBrowserStore.getState().projects).toHaveLength(2)
      expect(
        useProjectBrowserStore.getState().projects.some((p) => p.name === 'My Lesson (copy)'),
      ).toBe(true)
    })

    it('increments (copy 2) when (copy) already exists', async () => {
      const engine = createEngine()
      engine.createProject({ name: 'Lesson' })
      engine.createSlide('S1')
      const blob = serialize(engine.project!)
      const json = JSON.parse(blob)

      useProjectBrowserStore.setState({
        projects: [
          { id: 'a', name: 'Lesson', lastModified: '' },
          { id: 'b', name: 'Lesson (copy)', lastModified: '' },
        ],
      })

      let postedName = ''
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url === '/api/projects' && method === 'GET')
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        if (String(input).startsWith('/api/projects/') && method === 'GET')
          return Promise.resolve(new Response(blob, { status: 200 }))
        if (url === '/api/projects' && method === 'POST') {
          postedName = JSON.parse(init?.body as string).project.name
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'x', name: postedName, version: 2 }), {
              status: 200,
            }),
          )
        }
        return Promise.reject(new Error('unexpected'))
      })

      await duplicateLibraryProject(json.project.id)
      expect(postedName).toBe('Lesson (copy 2)')
    })

    it('notifies and returns false when fetch fails', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('network down'))
      useProjectBrowserStore.setState({ projects: [] })
      const result = await duplicateLibraryProject('nonexistent')
      expect(result).toBe(false)
      expect(useNotificationStore.getState().notifications.length).toBeGreaterThan(0)
      expect(useNotificationStore.getState().notifications[0].message).toContain(
        'Could not duplicate',
      )
    })
  })
})
