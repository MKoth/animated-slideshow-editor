import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollectionSilhouettePreview } from '../components/panels/CollectionSilhouettePreview'
import { refreshCollectionSilhouettePreviews } from '../components/panels/collectionSilhouetteCache'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { EvaluatedWorldTransformSource } from '../engine/worldTransform'
import { deformedMeshWorldVertices } from '../pixi/renderer/deformedMeshWorld'

afterEach(() => vi.unstubAllGlobals())

describe('CollectionSilhouettePreview', () => {
  it('does not calculate a collection preview before its row enters the viewport', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Lazy preview' })
    const slide = engine.createSlide('Slide')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    const node = engine.createNode(slide.scene.id, parent.id, 'Object', {
      semanticName: 'object',
      components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(20, 12) } },
    })
    const clip = engine.createClip('Move', 1, '', [], [{ property: 'positionX' }])
    const collection = engine.createClipCollection('Move object', { object: clip.id })
    const publicEngine = toReadOnly(engine)
    const serialize = vi.spyOn(publicEngine, 'toJSON')
    const observerHarness: {
      callback?: IntersectionObserverCallback
      target?: Element
    } = {}
    class DeferredIntersectionObserver {
      constructor(observerCallback: IntersectionObserverCallback) {
        observerHarness.callback = observerCallback
      }
      observe(element: Element) {
        observerHarness.target = element
      }
      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
      root = null
      rootMargin = '0px'
      thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', DeferredIntersectionObserver)

    const mounted = render(
      <CollectionSilhouettePreview
        engine={publicEngine}
        collectionId={collection.id}
        parentNodeId={parent.id}
        revision={0}
      />,
    )

    expect(node.semanticName).toBe('object')
    expect(serialize).not.toHaveBeenCalled()
    observerHarness.callback?.(
      [{ isIntersecting: true, target: observerHarness.target! } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    await waitFor(() => expect(serialize).toHaveBeenCalledTimes(1))
    mounted.unmount()
  })

  it('shows sampled combined silhouettes and opens a selected pose for inspection', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Preview' })
    const slide = engine.createSlide('Slide')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    const object = engine.createNode(slide.scene.id, parent.id, 'Object', {
      semanticName: 'object',
      components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(20, 12) } },
    })
    const clip = engine.createClip('Move', 2, '', [], [{ property: 'positionX' }])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 1, 800)
    const collection = engine.createClipCollection('Move object', { object: clip.id })
    const publicEngine = toReadOnly(engine)
    const serialize = vi.spyOn(publicEngine, 'toJSON')

    const firstRender = render(
      <CollectionSilhouettePreview
        engine={publicEngine}
        collectionId={collection.id}
        parentNodeId={parent.id}
        revision={0}
      />,
    )

    await screen.findByTestId(`collection-silhouette-step-${collection.id}-0`)
    const steps = [0, 1, 2, 3, 4].map((index) =>
      screen.getByTestId(`collection-silhouette-step-${collection.id}-${index}`),
    )
    expect(steps).toHaveLength(5)
    const firstPath = steps[0]!.querySelector('path')
    const lastPath = steps[4]!.querySelector('path')
    expect(firstPath).not.toBeNull()
    expect(lastPath).not.toBeNull()
    expect(firstPath?.getAttribute('d')).not.toBe(lastPath?.getAttribute('d'))
    const firstViewBoxWidth = Number(
      steps[0]!.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2],
    )
    const lastViewBoxWidth = Number(
      steps[4]!.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2],
    )
    expect(firstViewBoxWidth).toBeLessThan(30)
    expect(lastViewBoxWidth).toBe(firstViewBoxWidth)
    fireEvent.click(steps[2]!)
    expect(screen.getByTestId(`collection-silhouette-detail-${collection.id}`)).toHaveTextContent(
      '1.00s',
    )
    expect(engine.getNode(object.id).clipInstances).toHaveLength(0)
    await waitFor(() => expect(serialize).toHaveBeenCalledTimes(1))

    firstRender.unmount()
    const secondRender = render(
      <CollectionSilhouettePreview
        engine={publicEngine}
        collectionId={collection.id}
        parentNodeId={parent.id}
        revision={0}
      />,
    )
    await waitFor(() => expect(serialize).toHaveBeenCalledTimes(1))
    secondRender.unmount()

    engine.addClipChannelKeyframe(clip.id, 'positionX', 0.5, 400)
    render(
      <CollectionSilhouettePreview
        engine={publicEngine}
        collectionId={collection.id}
        parentNodeId={parent.id}
        revision={1}
      />,
    )
    await waitFor(() => expect(serialize).toHaveBeenCalledTimes(2))

    refreshCollectionSilhouettePreviews(publicEngine)
    render(
      <CollectionSilhouettePreview
        engine={publicEngine}
        collectionId={collection.id}
        parentNodeId={parent.id}
        revision={2}
      />,
    )
    await waitFor(() => expect(serialize).toHaveBeenCalledTimes(3))
  })

  it('matches canvas geometry for hierarchical rotation and a non-centered pivot', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Pivot preview' })
    const slide = engine.createSlide('Slide')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group', {
      transform: { x: 12, y: -8, rotation: Math.PI / 2, scaleX: 1.4, scaleY: 0.8 },
    })
    const mesh = createDefaultRectangleMesh(24, 12)
    const object = engine.createNode(slide.scene.id, parent.id, 'Object', {
      semanticName: 'object',
      transform: {
        x: 30,
        y: 14,
        rotation: 0.25,
        scaleX: 1,
        scaleY: 1,
        localPivot: { x: 0.5, y: -0.5 },
      },
      components: { mesh: { kind: 'mesh', mesh } },
    })
    const clip = engine.createClip('Hold', 1, '', [], [{ property: 'positionX' }])
    engine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip.id, 'positionX', 1, 0)
    const collection = engine.createClipCollection('Hold pose', { object: clip.id })

    const previewEngine = createEngineInternal()
    previewEngine.restoreFromJSON(toReadOnly(engine).toJSON())
    previewEngine.applyClipCollection(collection.id, parent.id)
    const previewSlide = previewEngine.getActiveSlide()!
    const transformSource = new EvaluatedWorldTransformSource(
      toReadOnly(previewEngine),
      () => 0,
      new Map(),
      previewEngine.getIKManager(),
      previewEngine.getConstraintManager(),
    )
    transformSource.updateIKOverrides(previewSlide.id, 0)
    const world = transformSource.transformOf(object.id)!
    const worldVertices = deformedMeshWorldVertices(
      mesh,
      previewSlide.scene,
      world,
      (id) => transformSource.transformOf(id),
      toReadOnly(previewEngine),
      object.id,
      0,
    )
    const firstFace = mesh.faces[0]!
    const expectedPath = `M ${[firstFace.v0, firstFace.v1, firstFace.v2]
      .map((index) => `${worldVertices[index]!.x} ${worldVertices[index]!.y}`)
      .join(' L ')} Z`

    render(
      <CollectionSilhouettePreview
        engine={toReadOnly(engine)}
        collectionId={collection.id}
        parentNodeId={parent.id}
        revision={0}
      />,
    )

    await screen.findByTestId(`collection-silhouette-step-${collection.id}-0`)
    expect(
      screen.getByTestId(`collection-silhouette-step-${collection.id}-0`).querySelector('path'),
    ).toHaveAttribute('d', expectedPath)
  })
})
