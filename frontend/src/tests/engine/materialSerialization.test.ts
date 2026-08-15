import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import {
  DEFAULT_MATERIAL_DEFINITION_ID,
  DEFAULT_MATERIAL_NAME,
  defaultMaterial,
} from '../../engine/materialInstance'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'
import type { LessonJSON, LessonLibraryJSON } from '../../engine/json'

const MATERIAL_A = {
  id: 'mat-a',
  name: 'Warm Tint',
  description: 'A warm material',
  tags: ['warm'],
  createdAt: '2026-08-15T00:00:00',
  updatedAt: '2026-08-15T00:00:00',
  parameters: [
    { key: 'tint', kind: 'color', default: '#ff8800' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const MATERIAL_B = {
  id: 'mat-b',
  name: 'Cool Tint',
  description: '',
  tags: [],
  createdAt: '2026-08-15T00:00:00',
  updatedAt: '2026-08-15T00:00:00',
  parameters: [],
}

const SHADER_A = {
  id: 'shader-a',
  name: 'Grayscale',
  description: 'Shades of gray',
  tags: ['built-in'],
  createdAt: '2026-08-15T00:00:00',
  updatedAt: '2026-08-15T00:00:00',
  source: 'void main() { fragColor = vec4(0.5); }',
  defaultUniforms: [],
  isBuiltin: true,
}

function engineWithProject() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
  return { engine, slide, node }
}

function nodeJson(engine: ReturnType<typeof createEngine>): LessonJSON {
  return JSON.parse(serialize(engine.project as never)) as LessonJSON
}

function firstSlide(json: LessonJSON) {
  const slide = json.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return slide
}

function renderableNode(json: LessonJSON) {
  const slide = firstSlide(json)
  const node = slide.scene.nodes.find(
    (entry) => entry.parentId !== null && entry.components.camera === undefined,
  )
  if (!node) {
    throw new Error('expected a non-camera child node')
  }
  return node
}

function embeddedLibrary(json: LessonJSON): LessonLibraryJSON {
  const library = json.library
  if (!library) {
    throw new Error('expected a library section')
  }
  return library
}

describe('node material serialization', () => {
  it('round-trips the material id and sparse overrides exactly', () => {
    const { engine, slide, node } = engineWithProject()
    engine.registerMaterialDefinition(MATERIAL_A.id, MATERIAL_A.name)
    engine.assignMaterial(node.id, MATERIAL_A.id)
    engine.overrideMaterialParameter(node.id, 'tint', '#ff0000')
    engine.overrideMaterialParameter(node.id, 'opacityMultiplier', 0.5)

    const json = nodeJson(engine)
    expect(renderableNode(json).material).toEqual({
      definitionId: 'mat-a',
      overrides: { tint: '#ff0000', opacityMultiplier: 0.5 },
    })

    const restored = deserialize(serialize(engine.project as never))
    const restoredSlide = restored.slides.find((entry) => entry.id === slide.id)
    const restoredNode = restoredSlide?.scene.getNode(node.id)
    expect(restoredNode?.material).toEqual({
      materialDefinitionId: 'mat-a',
      overrides: { tint: '#ff0000', opacityMultiplier: 0.5 },
    })
  })

  it('omits the material field for the default material with no overrides', () => {
    const { engine } = engineWithProject()

    const json = nodeJson(engine)
    expect(renderableNode(json).material).toBeUndefined()

    const restored = deserialize(serialize(engine.project as never))
    const restoredNode = restored.slides[0]?.scene.root.children[0]
    expect(restoredNode?.material).toEqual(defaultMaterial())
  })

  it('serializes a non-default material even with empty overrides', () => {
    const { engine, node } = engineWithProject()
    engine.registerMaterialDefinition(MATERIAL_B.id, MATERIAL_B.name)
    engine.assignMaterial(node.id, MATERIAL_B.id)

    expect(renderableNode(nodeJson(engine)).material).toEqual({
      definitionId: 'mat-b',
      overrides: {},
    })
  })

  it('serializes overrides applied to the default material definition', () => {
    const { engine, node } = engineWithProject()
    engine.overrideMaterialParameter(node.id, 'tint', '#00ff00')

    expect(renderableNode(nodeJson(engine)).material).toEqual({
      definitionId: DEFAULT_MATERIAL_DEFINITION_ID,
      overrides: { tint: '#00ff00' },
    })

    const restored = deserialize(serialize(engine.project as never))
    const restoredNode = restored.slides[0]?.scene.getNode(renderableNode(nodeJson(engine)).id)
    expect(restoredNode?.material).toEqual({
      materialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID,
      overrides: { tint: '#00ff00' },
    })
  })

  it('round-trips overrides without inventing entries (sparse map preserved)', () => {
    const { engine, node } = engineWithProject()
    engine.registerMaterialDefinition(MATERIAL_B.id, MATERIAL_B.name)
    engine.assignMaterial(node.id, MATERIAL_B.id)
    engine.overrideMaterialParameter(node.id, 'tint', '#112233')
    engine.overrideMaterialParameter(node.id, 'glow', 0.75)

    const json = nodeJson(engine)
    expect(renderableNode(json).material?.overrides).toEqual({
      tint: '#112233',
      glow: 0.75,
    })
    expect(Object.keys(renderableNode(json).material?.overrides ?? {})).toHaveLength(2)
  })

  it('restores the default material for nodes without a material field', () => {
    const { engine, slide } = engineWithProject()
    const json = nodeJson(engine)
    const node = renderableNode(json)
    if (node.material !== undefined) {
      delete (node as { material?: unknown }).material
    }

    const restored = deserialize(JSON.stringify(json))

    expect(restored.slides[0]?.scene.getNode(renderableNode(json).id)?.material).toEqual(
      defaultMaterial(),
    )
    expect(restored.slides[0]?.scene.getNode(slide.scene.camera.id)?.material).toEqual(
      defaultMaterial(),
    )
  })
})

describe('slide fullscreenShader serialization', () => {
  it('round-trips the shader id and overrides exactly', () => {
    const { engine, slide } = engineWithProject()
    engine.getSlide(slide.id).fullscreenShader = {
      shaderDefinitionId: 'shader-a',
      overrides: { strength: 0.8 },
    }

    const json = nodeJson(engine)
    expect(firstSlide(json).fullscreenShader).toEqual({
      shaderDefinitionId: 'shader-a',
      overrides: { strength: 0.8 },
    })

    const restored = deserialize(serialize(engine.project as never))
    expect(restored.slides[0]?.fullscreenShader).toEqual({
      shaderDefinitionId: 'shader-a',
      overrides: { strength: 0.8 },
    })
  })

  it('omits fullscreenShader when the slide has none', () => {
    const { engine } = engineWithProject()

    expect(firstSlide(nodeJson(engine)).fullscreenShader).toBeUndefined()

    const restored = deserialize(serialize(engine.project as never))
    expect(restored.slides[0]?.fullscreenShader).toBeNull()
  })

  it('round-trips a slide without fullscreenShader and a slide with one', () => {
    const { engine, slide } = engineWithProject()
    engine.createSlide('S2')
    engine.getSlide(slide.id).fullscreenShader = {
      shaderDefinitionId: 'shader-a',
      overrides: {},
    }

    const restored = deserialize(serialize(engine.project as never))

    expect(restored.slides[0]?.fullscreenShader).toEqual({
      shaderDefinitionId: 'shader-a',
      overrides: {},
    })
    expect(restored.slides[1]?.fullscreenShader).toBeNull()
  })
})

describe('validation of material and fullscreenShader fields', () => {
  const base = {
    version: 1 as const,
    project: {
      id: 'p1',
      name: 'P',
      description: '',
      author: '',
      createdAt: 't',
      modifiedAt: 't',
    },
    slides: [] as unknown[],
  }
  const node = {
    id: 'root',
    name: 'Root',
    parentId: null,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    visible: true,
    components: {},
  }
  const camera = {
    id: 'cam',
    name: 'Camera',
    parentId: 'root',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    visible: true,
    components: { camera: { kind: 'camera' } },
  }
  const scene = { id: 'sc', nodes: [node, camera] }
  const slide = { id: 's1', name: 'S', duration: 10, scene }

  it('rejects a material that is not an object', () => {
    expect(
      validate({
        ...base,
        slides: [{ ...slide, scene: { ...scene, nodes: [{ ...node, material: 'nope' }, camera] } }],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/material must be an object/i)]))
  })

  it('rejects a material without a definition id', () => {
    expect(
      validate({
        ...base,
        slides: [
          {
            ...slide,
            scene: { ...scene, nodes: [{ ...node, material: { overrides: {} } }, camera] },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/material definition id must be a non-empty string/i),
      ]),
    )
  })

  it('rejects malformed overrides values', () => {
    expect(
      validate({
        ...base,
        slides: [
          {
            ...slide,
            scene: {
              ...scene,
              nodes: [
                {
                  ...node,
                  material: { definitionId: 'm1', overrides: { tint: [1, 2] } },
                },
                camera,
              ],
            },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/overrides value for "tint" must be a non-empty string or a finite/i),
      ]),
    )

    expect(
      validate({
        ...base,
        slides: [
          {
            ...slide,
            scene: {
              ...scene,
              nodes: [{ ...node, material: { definitionId: 'm1', overrides: 'tint' } }, camera],
            },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/overrides must be an object/i)]))
  })

  it('rejects a fullscreenShader that is not an object or has no shaderDefinitionId', () => {
    expect(validate({ ...base, slides: [{ ...slide, fullscreenShader: 'blur' }] })).toEqual(
      expect.arrayContaining([expect.stringMatching(/fullscreenShader must be an object/i)]),
    )

    expect(
      validate({ ...base, slides: [{ ...slide, fullscreenShader: { overrides: {} } }] }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/shaderDefinitionId must be a non-empty string/i),
      ]),
    )

    expect(
      validate({
        ...base,
        slides: [
          { ...slide, fullscreenShader: { shaderDefinitionId: 's1', overrides: { x: {} } } },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/overrides value for "x" must be a non-empty string or a finite/i),
      ]),
    )
  })

  it('accepts valid material and fullscreenShader fields', () => {
    expect(
      validate({
        ...base,
        slides: [
          {
            ...slide,
            scene: {
              ...scene,
              nodes: [
                {
                  ...node,
                  material: { definitionId: 'm1', overrides: { tint: '#ff0000', gain: 0.5 } },
                },
                camera,
              ],
            },
            fullscreenShader: { shaderDefinitionId: 's1', overrides: { strength: 1 } },
          },
        ],
      }),
    ).toEqual([])
  })
})

describe('embedded material and shader definitions', () => {
  it('embeds referenced material definitions into the library section', () => {
    const { engine } = engineWithProject()
    engine.embedMaterial(MATERIAL_A)

    const library = embeddedLibrary(nodeJson(engine))
    const { createdAt, updatedAt, ...expected } = MATERIAL_A
    expect(library.materials).toEqual([
      { ...expected, created_at: createdAt, updated_at: updatedAt },
    ])
    expect(library.shaders).toEqual([])
    expect(library.assets).toEqual([])
  })

  it('embeds shader definitions with their source', () => {
    const { engine } = engineWithProject()
    engine.embedShader(SHADER_A)

    const library = embeddedLibrary(nodeJson(engine))
    const { defaultUniforms, isBuiltin, createdAt, updatedAt, ...expected } = SHADER_A
    expect(library.shaders).toEqual([
      {
        ...expected,
        created_at: createdAt,
        updated_at: updatedAt,
        default_uniforms: defaultUniforms,
        is_builtin: isBuiltin,
      },
    ])
  })

  it('restores embedded materials and shaders on deserialize', () => {
    const { engine } = engineWithProject()
    engine.embedMaterial(MATERIAL_A)
    engine.embedShader(SHADER_A)

    const restored = deserialize(serialize(engine.project as never))

    expect(restored.embeddedMaterials).toEqual([MATERIAL_A])
    expect(restored.embeddedShaders).toEqual([SHADER_A])
  })

  it('omits the library section when nothing is embedded', () => {
    const { engine } = engineWithProject()

    expect(nodeJson(engine).library).toBeUndefined()
  })

  it('validates malformed library materials and shaders', () => {
    const { engine } = engineWithProject()
    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON

    expect(
      validate({
        ...json,
        library: {
          assets: [],
          materials: [
            { id: 'm1', name: 'A', description: '', tags: [], parameters: [] },
            { id: 'm1', name: 'B', description: '', tags: [], parameters: [] },
          ],
          shaders: [],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/library material with id "m1" already exists/i),
      ]),
    )

    expect(
      validate({
        ...json,
        library: {
          assets: [],
          materials: [{ id: 'm1', name: '', description: '', tags: [], parameters: [] }],
          shaders: [],
        },
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/library material name/i)]))

    expect(
      validate({
        ...json,
        library: {
          assets: [],
          materials: [
            {
              id: 'm1',
              name: 'A',
              description: '',
              tags: [],
              parameters: [{ key: '', kind: 'color', default: '#fff' }],
            },
          ],
          shaders: [],
        },
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/material parameter key/i)]))

    expect(
      validate({
        ...json,
        library: {
          assets: [],
          materials: [],
          shaders: [
            { id: 's1', name: 'A', description: '', tags: [], source: '', default_uniforms: [] },
          ],
        },
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/library shader "s1" source/i)]))
  })

  it('keeps slim v1 files without a library readable', () => {
    const { engine } = engineWithProject()
    const slim = JSON.parse(serialize(engine.project as never)) as LessonJSON
    delete (slim as { library?: unknown }).library

    const restored = deserialize(JSON.stringify(slim))

    expect(restored.embeddedMaterials).toEqual([])
    expect(restored.embeddedShaders).toEqual([])
  })
})

describe('material and shader resolution', () => {
  it('resolves embedded definitions first, then the library', () => {
    const { engine } = engineWithProject()
    engine.embedMaterial(MATERIAL_A)
    engine.registerMaterialDefinition(MATERIAL_A.id, 'Library Copy')

    expect(engine.getMaterialDefinition(MATERIAL_A.id).name).toBe(MATERIAL_A.name)
    expect(engine.getEmbeddedMaterial(MATERIAL_A.id)).toEqual(MATERIAL_A)

    engine.embedShader(SHADER_A)
    engine.registerShaderDefinition(SHADER_A.id, 'Library Copy')
    expect(engine.getShaderDefinition(SHADER_A.id).name).toBe(SHADER_A.name)
    expect(engine.getEmbeddedShader(SHADER_A.id)).toEqual(SHADER_A)
  })

  it('keeps resolving the embedded snapshot after the library definition is deleted', () => {
    const { engine, node } = engineWithProject()
    engine.embedMaterial(MATERIAL_A)
    engine.registerMaterialDefinition(MATERIAL_A.id, 'Library Copy')
    engine.assignMaterial(node.id, MATERIAL_A.id)

    expect(engine.getMaterialDefinition(MATERIAL_A.id).name).toBe(MATERIAL_A.name)
  })

  it('rejects unknown material and shader definition ids', () => {
    const { engine } = engineWithProject()
    const nodeId = engine.project?.slides[0]?.scene.root.children[0]?.id ?? ''

    expect(() => engine.getMaterialDefinition('ghost')).toThrow(/material definition not found/i)
    expect(() => engine.getShaderDefinition('ghost')).toThrow(/shader definition not found/i)
    expect(() => engine.assignMaterial(nodeId, 'ghost')).toThrow(/material definition not found/i)
  })

  it('assigns materials from the embedded snapshot even without a library definition', () => {
    const { engine, node } = engineWithProject()
    engine.embedMaterial(MATERIAL_B)

    engine.assignMaterial(node.id, MATERIAL_B.id)

    expect(engine.getNode(node.id).material.materialDefinitionId).toBe(MATERIAL_B.id)
    expect(engine.getMaterialDefinition(MATERIAL_B.id).name).toBe(MATERIAL_B.name)
  })
})

describe('migration', () => {
  it('loads pre-material v1 files with the default material auto-assigned', () => {
    const { engine } = engineWithProject()
    const json = nodeJson(engine)
    delete (renderableNode(json) as { material?: unknown }).material
    delete (json as { library?: unknown }).library

    const restored = deserialize(JSON.stringify(json))

    const restoredNode = restored.slides[0]?.scene.root.children[0]
    expect(restoredNode?.material).toEqual(defaultMaterial())
  })

  it('keeps version 1 and never rewrites the file when definitions change', () => {
    const { engine } = engineWithProject()
    engine.registerMaterialDefinition(MATERIAL_A.id, MATERIAL_A.name)
    engine.registerShaderDefinition(SHADER_A.id, SHADER_A.name)
    const before = nodeJson(engine)

    engine.getMaterialDefinition(MATERIAL_A.id)
    engine.getShaderDefinition(SHADER_A.id)

    const after = nodeJson(engine)
    expect(after.version).toBe(1)
    expect(after).toEqual(before)
    expect(after.library).toBeUndefined()
  })

  it('re-serializing a migrated slim file adds no material or shader content', () => {
    const { engine } = engineWithProject()
    const json = nodeJson(engine)
    delete (json as { library?: unknown }).library

    const migrated = deserialize(JSON.stringify(json))
    const text = serialize(migrated)
    const saved = JSON.parse(text) as LessonJSON

    expect(saved.version).toBe(1)
    expect(saved.library).toBeUndefined()
    for (const slideJson of saved.slides) {
      for (const nodeJsonEntry of slideJson.scene.nodes) {
        expect((nodeJsonEntry as { material?: unknown }).material).toBeUndefined()
      }
      expect((slideJson as { fullscreenShader?: unknown }).fullscreenShader).toBeUndefined()
    }
  })
})

describe('DEFAULT_MATERIAL_DEFINITION_ID', () => {
  it('matches the backend built-in default material id', () => {
    expect(DEFAULT_MATERIAL_DEFINITION_ID).toBe('0d3f4464-8300-5b6d-ae14-45246fefbeae')
    expect(DEFAULT_MATERIAL_NAME).toBe('Default Material')
  })
})
