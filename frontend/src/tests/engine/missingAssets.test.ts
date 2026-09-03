import { describe, expect, it } from 'vitest'
import {
  collectReferencedMaterialIds,
  collectReferencedShaderIds,
  reconcileMissingAssets,
} from '../../engine/missingAssets'
import { createEngine } from '../../engine/internal'
import { makeProjectWithAssets } from './helpers'

describe('reconcileMissingAssets', () => {
  it('reports nothing when every definition reference is available', () => {
    const { project } = makeProjectWithAssets('Demo', [
      { name: 'Boy', definitionId: 'def-boy' },
      { name: 'Cat', definitionId: 'def-cat' },
    ])

    const report = reconcileMissingAssets(project, new Set(['def-boy', 'def-cat']))

    expect(report.missing).toEqual([])
    expect(report.affectedNodeIds).toEqual([])
    expect(report.names).toEqual([])
  })

  it('groups missing references by definition id with their nodes, in encounter order', () => {
    const { project, placed } = makeProjectWithAssets('Demo', [
      { name: 'Boy', definitionId: 'def-boy' },
      { name: 'Cat', definitionId: 'def-cat' },
      { name: 'Dog', definitionId: 'def-boy' },
      { name: 'Fox', definitionId: 'def-fox' },
    ])
    const [boy, , dog, fox] = placed

    const report = reconcileMissingAssets(project, new Set(['def-cat']))

    expect(report.missing).toEqual([
      { assetDefinitionId: 'def-boy', nodeIds: [boy.nodeId, dog.nodeId] },
      { assetDefinitionId: 'def-fox', nodeIds: [fox.nodeId] },
    ])
  })

  it('reports the deduplicated names of the affected nodes for the friendly message', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project!.slides[0]
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-boy' } },
    })
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Girl', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-girl' } },
    })
    const boy2 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy2', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-other' } },
    })
    // Force duplicate name to test deduplication (unique enforcement would suffix otherwise)
    boy2.name = 'Boy'
    const project = engine.project!

    const report = reconcileMissingAssets(project, new Set([]))

    expect(report.names).toEqual(['Boy', 'Girl'])
  })

  it('collects affected node ids across every slide of the project', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    engine.createSlide('Slide 2')
    const slides = engine.project?.slides ?? []
    const first = engine.createNode(slides[0].scene.id, slides[0].scene.root.id, 'On One', {
      components: {
        assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-one' },
      },
    })
    const second = engine.createNode(slides[1].scene.id, slides[1].scene.root.id, 'On Two', {
      components: {
        assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-two' },
      },
    })
    if (!engine.project) {
      throw new Error('Project was not created')
    }

    const report = reconcileMissingAssets(engine.project, new Set([]))

    expect(report.affectedNodeIds).toEqual([first.id, second.id])
  })

  it('ignores nodes without asset instances, including text and camera nodes', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Label', {
      components: { text: { kind: 'text', content: 'Hi', fontSize: 20, alignment: 'left' } },
    })
    const folder = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    engine.createNode(slide.scene.id, folder.id, 'Nested Image', {
      components: {
        assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-missing' },
      },
    })
    if (!engine.project) {
      throw new Error('Project was not created')
    }

    const report = reconcileMissingAssets(engine.project, new Set([]))

    expect(report.names).toEqual(['Nested Image'])
    expect(report.missing).toEqual([
      { assetDefinitionId: 'def-missing', nodeIds: [expect.any(String)] },
    ])
  })
})

describe('collectReferencedMaterialIds and collectReferencedShaderIds', () => {
  it('collects every node material id, including the default, across slides', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    engine.createSlide('Slide 2')
    const slides = engine.project?.slides ?? []
    const onOne = engine.createNode(slides[0].scene.id, slides[0].scene.root.id, 'On One')
    const onTwo = engine.createNode(slides[1].scene.id, slides[1].scene.root.id, 'On Two')
    engine.registerMaterialDefinition('mat-one', 'One')
    engine.registerMaterialDefinition('mat-two', 'Two')
    engine.assignMaterial(onOne.id, 'mat-one')
    engine.assignMaterial(onTwo.id, 'mat-two')
    if (!engine.project) {
      throw new Error('Project was not created')
    }

    expect(collectReferencedMaterialIds(engine.project)).toEqual(
      new Set(['mat-one', 'mat-two', '0d3f4464-8300-5b6d-ae14-45246fefbeae']),
    )
  })

  it('collects the fullscreen shader id of every slide, only when set', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    const first = engine.createSlide('Slide 1')
    engine.createSlide('Slide 2')
    engine.getSlide(first.id).fullscreenShader = {
      shaderDefinitionId: 'shader-one',
      overrides: {},
    }
    if (!engine.project) {
      throw new Error('Project was not created')
    }

    expect(collectReferencedShaderIds(engine.project)).toEqual(new Set(['shader-one']))
  })

  it('collects the shaders referenced by node materials via the resolver', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.registerMaterialDefinition('mat-one', 'One', [], 'shader-material')
    engine.registerMaterialDefinition('mat-two', 'Two', [], null)
    engine.assignMaterial(node.id, 'mat-one')
    if (!engine.project) {
      throw new Error('Project was not created')
    }
    const shaderIdOfMaterial = (materialDefinitionId: string) =>
      engine.getMaterialDefinition(materialDefinitionId).shaderId

    expect(collectReferencedShaderIds(engine.project, shaderIdOfMaterial)).toEqual(
      new Set(['shader-material']),
    )
  })
})
