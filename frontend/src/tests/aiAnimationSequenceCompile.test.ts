import { describe, expect, it } from 'vitest'
import {
  CreateClipCollectionCommand,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSemanticNameCommand,
  SetSlideAnimationScriptCommand,
  SetSlideDurationCommand,
  createCommandSystem,
} from '../engine/commands'
import { checkAnimationScript } from '../engine/animationScriptCheck'
import { runAnimationScript } from '../engine/animationScriptRun'
import { composeSequence } from '../ai/animationSequence'
import type { BeatAnalysis } from '../ai/animationAnalysis'

describe('animation sequence retained script compiles to ordinary timeline data (issue #442)', () => {
  function setup() {
    const system = createCommandSystem(() => {})
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Cat performance' }) as never)
    const slideResult = system.dispatcher.dispatch(
      new CreateSlideCommand({ name: 'Room' }) as never,
    )
    if (!slideResult.ok) throw new Error('slide failed')
    const slide = system.engine.getActiveSlide()
    if (!slide) throw new Error('expected an active slide')
    system.dispatcher.dispatch(
      new SetSlideDurationCommand({ slideId: slide.id, duration: 12 }) as never,
    )
    // Character rig: Cat parent with a semantic part child.
    const catId = (
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Cat',
        }) as never,
      ) as unknown as { ok: true; inverse: { nodeId: string } }
    ).inverse.nodeId
    const pawId = (
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: catId,
          name: 'Paw',
        }) as never,
      ) as unknown as { ok: true; inverse: { nodeId: string } }
    ).inverse.nodeId
    system.dispatcher.dispatch(
      new SetSemanticNameCommand({ nodeId: catId, semanticName: 'cat' }) as never,
    )
    system.dispatcher.dispatch(
      new SetSemanticNameCommand({ nodeId: pawId, semanticName: 'paw' }) as never,
    )
    const clipId = (
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Paw Wave',
          duration: 2,
          category: 'test',
          channels: [{ property: 'positionX' }],
        }) as never,
      ) as unknown as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    system.dispatcher.dispatch(
      new CreateClipCollectionCommand({ name: 'Walk Cycle', bindings: { paw: clipId } }) as never,
    )
    return { system, slideId: slide.id, catId }
  }

  function readyBeat(): BeatAnalysis {
    return {
      beatId: 'b-walk',
      label: 'Walk across the room',
      status: 'ready',
      resolvedNodeIds: [],
      reusable: [
        {
          collectionId: 'col-walk',
          collectionName: 'Walk Cycle',
          matchedSemantics: ['paw'],
          clipIds: ['clip-walk'],
        },
      ],
      nameOnly: { collections: [], clips: [] },
      geometry: { state: 'available', matchedShapes: [], closestFit: null, note: '' },
      prerequisites: [],
      warnings: [],
      question: null,
      actions: [],
      candidates: [],
    }
  }

  it('checks runnable and runs to ordinary clip placements with one undo entry', () => {
    const { system, slideId, catId } = setup()
    const cat = system.engine.getNode(catId)
    const draft = composeSequence({
      beats: [{ ...readyBeat(), resolvedNodeIds: [catId] }],
      views: [],
      snapshot: {
        slideId,
        slideName: 'Room',
        duration: 12,
        nodes: [{ id: catId, name: cat.name }],
      },
    })
    expect(draft.summary.draftable).toBe(1)
    const checked = checkAnimationScript(system.engine, slideId, draft.scriptSource)
    expect(checked.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(checked.runnable).toBe(true)

    const beforePlacements = system.engine.getNode(catId).collectionPlacements.length
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId, source: draft.scriptSource }) as never,
    )
    const boundDispatch = (command: never) => system.dispatcher.dispatch(command as never)
    const result = runAnimationScript(
      system.engine,
      boundDispatch as never,
      slideId,
      draft.scriptSource,
    )
    expect(result.ran).toBe(true)
    // Ordinary timeline data: a collection placement on the Cat rig.
    expect(system.engine.getNode(catId).collectionPlacements.length).toBeGreaterThan(
      beforePlacements,
    )
    // Rerun replaces by footprint instead of duplicating.
    const firstCount = system.engine.getNode(catId).collectionPlacements.length
    const rerun = runAnimationScript(
      system.engine,
      boundDispatch as never,
      slideId,
      draft.scriptSource,
    )
    expect(rerun.ran).toBe(true)
    expect(system.engine.getNode(catId).collectionPlacements.length).toBe(firstCount)
    // One undo restores the prior Run output as one coherent Transaction.
    expect(system.dispatcher.undo()).toBe(true)
  })

  it('omits blocked beats from the runnable script', () => {
    const { system, slideId, catId } = setup()
    const cat = system.engine.getNode(catId)
    const draft = composeSequence({
      beats: [
        { ...readyBeat(), resolvedNodeIds: [catId] },
        {
          beatId: 'b-sleep',
          label: 'Sleep on the sofa',
          status: 'missing-motion',
          resolvedNodeIds: [catId],
          reusable: [],
          nameOnly: { collections: [], clips: [] },
          geometry: { state: 'no-shapes', matchedShapes: [], closestFit: null, note: 'missing' },
          prerequisites: [],
          warnings: [],
          question: null,
          actions: ['Author new motion.'],
          candidates: [],
        },
      ],
      views: [],
      snapshot: {
        slideId,
        slideName: 'Room',
        duration: 12,
        nodes: [{ id: catId, name: cat.name }],
      },
    })
    expect(draft.summary.draftable).toBe(1)
    expect(draft.scriptSource).toMatch(/Sleep on the sofa.*omitted [-—] blocked/s)
    const checked = checkAnimationScript(system.engine, slideId, draft.scriptSource)
    expect(checked.runnable).toBe(true)
  })
})
