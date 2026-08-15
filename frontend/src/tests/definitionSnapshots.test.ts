import { beforeEach, describe, expect, it } from 'vitest'
import type { MaterialDefinition } from '../api'
import type { ShaderDefinition } from '../api'
import {
  captureMaterialSnapshot,
  captureShaderSnapshot,
  ensureReferencedMaterialAndShaderSnapshots,
} from '../app/definitionSnapshot'
import { createEngine } from '../engine/internal'
import { deserialize, serialize } from '../engine/lessonSerializer'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'

const MATERIAL: MaterialDefinition = {
  id: 'mat-1',
  name: 'Warm Tint',
  description: 'A warm material',
  tags: ['warm'],
  created_at: '2026-08-15T00:00:00',
  updated_at: '2026-08-15T00:00:00',
  shader_id: null,
  parameters: [
    { key: 'tint', kind: 'color', default: '#ff8800' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const SHADER: ShaderDefinition = {
  id: 'shader-1',
  name: 'Blur',
  description: 'Nine-tap blur',
  tags: ['blur'],
  created_at: '2026-08-15T00:00:00',
  updated_at: '2026-08-15T00:00:00',
  source: 'void main() { fragColor = texture(uTexture, vUv); }',
  default_uniforms: [{ key: 'strength', type: 'float', default: 0 }],
  is_builtin: false,
}

function engineWithMaterial() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
  engine.registerMaterialDefinition(MATERIAL.id, MATERIAL.name)
  engine.assignMaterial(node.id, MATERIAL.id)
  return { engine, slide, node }
}

function libraryJson(engine: ReturnType<typeof createEngine>) {
  return (
    JSON.parse(serialize(engine.project as never)) as {
      library?: { materials: unknown[]; shaders: unknown[] }
    }
  ).library
}

beforeEach(() => {
  useMaterialLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  useShaderLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
})

describe('captureMaterialSnapshot', () => {
  it('embeds the full material definition into the project snapshot', () => {
    const { engine, node } = engineWithMaterial()
    useMaterialLibraryStore.setState({ definitions: [MATERIAL], loaded: true, unavailable: false })

    const captured = captureMaterialSnapshot(engine, MATERIAL.id)

    expect(captured).toBe(true)
    expect(engine.getEmbeddedMaterial(MATERIAL.id)).toEqual({
      id: MATERIAL.id,
      name: MATERIAL.name,
      description: MATERIAL.description,
      tags: MATERIAL.tags,
      createdAt: MATERIAL.created_at,
      updatedAt: MATERIAL.updated_at,
      parameters: MATERIAL.parameters,
      shaderId: null,
    })
    expect(engine.project?.embeddedMaterials.map((material) => material.id)).toEqual([MATERIAL.id])
    expect(engine.getMaterialDefinition(MATERIAL.id).name).toBe(MATERIAL.name)
    void node
  })

  it('returns false without embedding when the library does not hold the definition', () => {
    const { engine } = engineWithMaterial()
    useMaterialLibraryStore.setState({ definitions: [], loaded: true, unavailable: false })

    expect(captureMaterialSnapshot(engine, MATERIAL.id)).toBe(false)
    expect(engine.getEmbeddedMaterial(MATERIAL.id)).toBeUndefined()
  })

  it('keeps the first snapshot when the definition changes later', () => {
    const { engine } = engineWithMaterial()
    useMaterialLibraryStore.setState({ definitions: [MATERIAL], loaded: true, unavailable: false })
    captureMaterialSnapshot(engine, MATERIAL.id)

    useMaterialLibraryStore.setState({
      definitions: [
        { ...MATERIAL, parameters: [{ key: 'tint', kind: 'color', default: '#000000' }] },
      ],
      loaded: true,
      unavailable: false,
    })
    captureMaterialSnapshot(engine, MATERIAL.id)

    expect(engine.getEmbeddedMaterial(MATERIAL.id)?.parameters[0]?.default).toBe('#ff8800')
  })
})

describe('captureShaderSnapshot', () => {
  it('embeds the full shader definition with its source', () => {
    const { engine, slide } = engineWithMaterial()
    slide.fullscreenShader = { shaderDefinitionId: SHADER.id, overrides: { strength: 0.5 } }
    useShaderLibraryStore.setState({ definitions: [SHADER], loaded: true, unavailable: false })

    const captured = captureShaderSnapshot(engine, SHADER.id)

    expect(captured).toBe(true)
    expect(engine.getEmbeddedShader(SHADER.id)).toEqual({
      id: SHADER.id,
      name: SHADER.name,
      description: SHADER.description,
      tags: SHADER.tags,
      createdAt: SHADER.created_at,
      updatedAt: SHADER.updated_at,
      source: SHADER.source,
      defaultUniforms: SHADER.default_uniforms,
      isBuiltin: SHADER.is_builtin,
    })
  })

  it('returns false when the library does not hold the definition', () => {
    const { engine, slide } = engineWithMaterial()
    slide.fullscreenShader = { shaderDefinitionId: SHADER.id, overrides: {} }
    useShaderLibraryStore.setState({ definitions: [], loaded: true, unavailable: false })

    expect(captureShaderSnapshot(engine, SHADER.id)).toBe(false)
    expect(engine.getEmbeddedShader(SHADER.id)).toBeUndefined()
  })
})

describe('ensureReferencedMaterialAndShaderSnapshots', () => {
  it('embeds every referenced material and fullscreen shader, skipping the default material', () => {
    const { engine, slide, node } = engineWithMaterial()
    useMaterialLibraryStore.setState({ definitions: [MATERIAL], loaded: true, unavailable: false })
    useShaderLibraryStore.setState({ definitions: [SHADER], loaded: true, unavailable: false })
    engine.registerMaterialDefinition(MATERIAL.id, MATERIAL.name)
    engine.registerShaderDefinition(SHADER.id, SHADER.name)
    slide.fullscreenShader = { shaderDefinitionId: SHADER.id, overrides: {} }
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Plain')
    void node

    ensureReferencedMaterialAndShaderSnapshots(engine)

    const library = libraryJson(engine)
    expect(library?.materials.map((material) => (material as { id: string }).id)).toEqual([
      MATERIAL.id,
    ])
    expect(library?.shaders.map((shader) => (shader as { id: string }).id)).toEqual([SHADER.id])
  })

  it('embeds nothing when nothing is referenced', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    useMaterialLibraryStore.setState({ definitions: [MATERIAL], loaded: true, unavailable: false })
    useShaderLibraryStore.setState({ definitions: [SHADER], loaded: true, unavailable: false })

    ensureReferencedMaterialAndShaderSnapshots(engine)

    expect(libraryJson(engine)).toBeUndefined()
  })

  it('embeds the shader referenced by a material alongside the material', () => {
    const { engine, node } = engineWithMaterial()
    const withShader = { ...MATERIAL, shader_id: SHADER.id }
    useMaterialLibraryStore.setState({
      definitions: [withShader],
      loaded: true,
      unavailable: false,
    })
    useShaderLibraryStore.setState({ definitions: [SHADER], loaded: true, unavailable: false })
    engine.registerMaterialDefinition(withShader.id, withShader.name)
    engine.registerShaderDefinition(SHADER.id, SHADER.name)
    engine.assignMaterial(node.id, withShader.id)

    ensureReferencedMaterialAndShaderSnapshots(engine)

    const library = libraryJson(engine)
    expect(library?.materials.map((material) => (material as { id: string }).id)).toEqual([
      MATERIAL.id,
    ])
    expect(library?.shaders.map((shader) => (shader as { id: string }).id)).toEqual([SHADER.id])
    expect(engine.getEmbeddedMaterial(MATERIAL.id)?.shaderId).toBe(SHADER.id)
  })

  it('round-trips the embedded snapshot through the file', () => {
    const { engine, slide, node } = engineWithMaterial()
    useMaterialLibraryStore.setState({ definitions: [MATERIAL], loaded: true, unavailable: false })
    useShaderLibraryStore.setState({ definitions: [SHADER], loaded: true, unavailable: false })
    engine.registerMaterialDefinition(MATERIAL.id, MATERIAL.name)
    engine.registerShaderDefinition(SHADER.id, SHADER.name)
    slide.fullscreenShader = { shaderDefinitionId: SHADER.id, overrides: { strength: 0.25 } }
    engine.overrideMaterialParameter(node.id, 'tint', '#00ff00')
    ensureReferencedMaterialAndShaderSnapshots(engine)

    const restored = deserialize(serialize(engine.project as never))

    expect(restored.embeddedMaterials.map((material) => material.id)).toEqual([MATERIAL.id])
    expect(restored.embeddedShaders.map((shader) => shader.id)).toEqual([SHADER.id])
    expect(restored.slides[0]?.fullscreenShader).toEqual({
      shaderDefinitionId: SHADER.id,
      overrides: { strength: 0.25 },
    })
    const restoredNode = restored.slides[0]?.scene.getNode(node.id)
    expect(restoredNode?.material).toEqual({
      materialDefinitionId: MATERIAL.id,
      overrides: { tint: '#00ff00' },
    })
  })
})
