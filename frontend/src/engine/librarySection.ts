import type { EmbeddedAsset } from './embeddedAsset'
import type { EmbeddedMaterialDefinition } from './embeddedMaterial'
import type { EmbeddedShaderDefinition } from './embeddedShader'
import type {
  EmbeddedDataSourceDefinition,
  EmbeddedFlowchartDataSourceDefinition,
} from './embeddedDataSource'
import type { LessonLibraryJSON } from './json'
import { isRecord } from './guards'
import { ClipDefinition } from './clipDefinition'

export function embeddedLibraryJSON(
  assets: readonly EmbeddedAsset[],
  materials: readonly EmbeddedMaterialDefinition[],
  shaders: readonly EmbeddedShaderDefinition[],
  dataSources: readonly (
    EmbeddedDataSourceDefinition | EmbeddedFlowchartDataSourceDefinition
  )[] = [],
  clips: readonly ClipDefinition[] = [],
): LessonLibraryJSON {
  const library: LessonLibraryJSON = {
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      data: asset.data,
      mimeType: asset.mimeType,
      ...(asset.metadata !== undefined ? { metadata: asset.metadata } : {}),
    })),
    materials: materials.map((material) => ({
      id: material.id,
      name: material.name,
      description: material.description,
      tags: [...material.tags],
      created_at: material.createdAt,
      updated_at: material.updatedAt,
      parameters: material.parameters.map((parameter) => ({
        key: parameter.key,
        kind: parameter.kind,
        default: parameter.default,
      })),
      ...(material.shaderId !== null ? { shader_id: material.shaderId } : {}),
    })),
    shaders: shaders.map((shader) => ({
      id: shader.id,
      name: shader.name,
      description: shader.description,
      tags: [...shader.tags],
      created_at: shader.createdAt,
      updated_at: shader.updatedAt,
      source: shader.source,
      default_uniforms: shader.defaultUniforms.map((uniform) => ({ ...uniform })),
      is_builtin: shader.isBuiltin,
    })),
    ...(dataSources.length > 0
      ? {
          data_sources: dataSources.map((ds) => {
            if ('nodes' in ds) {
              return {
                id: ds.id,
                name: ds.name,
                flowchart: {
                  nodes: ds.nodes.map((n) => ({ id: n.id, label: n.label })),
                  edges: ds.edges.map((e) => ({ from: e.from, to: e.to })),
                },
              }
            }
            return {
              id: ds.id,
              name: ds.name,
              data_points: ds.dataPoints.map((p) => ({
                label: p.label,
                value: p.value,
                ...(p.series !== undefined ? { series: p.series } : {}),
                ...(p.tooltip !== undefined ? { tooltip: p.tooltip } : {}),
                ...(p.color !== undefined ? { color: p.color } : {}),
              })),
            }
          }),
        }
      : {}),
    ...(clips.length > 0 ? { clips: clips.map((clip) => clip.toJSON()) } : {}),
  }
  return library
}

export function validateLibrary(errors: string[], library: unknown): void {
  if (library === undefined) {
    return
  }
  if (!isRecord(library)) {
    errors.push('Invalid lesson JSON: library must be an object')
    return
  }
  for (const reserved of ['assets', 'materials', 'shaders', 'data_sources', 'clips'] as const) {
    if (library[reserved] !== undefined && !Array.isArray(library[reserved])) {
      errors.push(`Invalid lesson JSON: library.${reserved} must be an array`)
    }
  }
  validateLibraryAssets(errors, library.assets)
  validateLibraryMaterials(errors, library.materials)
  validateLibraryShaders(errors, library.shaders)
  validateLibraryDataSources(errors, library.data_sources)
  validateLibraryClips(errors, library.clips)
}

function validateLibraryAssets(errors: string[], assets: unknown): void {
  if (assets === undefined) {
    return
  }
  if (!Array.isArray(assets)) {
    return
  }
  const assetIds = new Set<string>()
  for (const asset of assets) {
    if (!isRecord(asset)) {
      errors.push('Library asset must be an object')
      continue
    }
    requireNonEmptyString(errors, asset.id, 'Library asset id')
    requireNonEmptyString(errors, asset.name, 'Library asset name')
    if (typeof asset.data !== 'string' || asset.data === '') {
      errors.push(`Library asset "${String(asset.id)}" data must be a non-empty base64 string`)
    }
    if (typeof asset.mimeType !== 'string' || asset.mimeType === '') {
      errors.push(`Library asset "${String(asset.id)}" mimeType must be a non-empty string`)
    }
    if (asset.metadata !== undefined && !isRecord(asset.metadata)) {
      errors.push(`Library asset "${String(asset.id)}" metadata must be an object`)
    }
    if (typeof asset.id === 'string' && asset.id !== '') {
      if (assetIds.has(asset.id)) {
        errors.push(`A library asset with id "${asset.id}" already exists`)
      } else {
        assetIds.add(asset.id)
      }
    }
  }
}

function validateLibraryMaterials(errors: string[], materials: unknown): void {
  if (materials === undefined) {
    return
  }
  if (!Array.isArray(materials)) {
    return
  }
  const materialIds = new Set<string>()
  for (const material of materials) {
    if (!isRecord(material)) {
      errors.push('Library material must be an object')
      continue
    }
    requireNonEmptyString(errors, material.id, 'Library material id')
    requireNonEmptyString(errors, material.name, 'Library material name')
    if (typeof material.description !== 'string') {
      errors.push(`Library material "${String(material.id)}" description must be a string`)
    }
    if (!Array.isArray(material.tags)) {
      errors.push(`Library material "${String(material.id)}" tags must be an array`)
    } else {
      for (const tag of material.tags) {
        if (typeof tag !== 'string') {
          errors.push(`Library material "${String(material.id)}" tags must be strings`)
          break
        }
      }
    }
    if (!Array.isArray(material.parameters)) {
      errors.push(`Library material "${String(material.id)}" parameters must be an array`)
    } else {
      for (const parameter of material.parameters) {
        if (!isRecord(parameter)) {
          errors.push(`Library material "${String(material.id)}" parameter must be an object`)
          continue
        }
        requireNonEmptyString(errors, parameter.key, `Library material parameter key`)
        if (typeof parameter.kind !== 'string' || parameter.kind === '') {
          errors.push(`Library material parameter kind must be a non-empty string`)
        }
        if (!isParameterDefaultValue(parameter.default)) {
          errors.push(
            `Library material parameter default must be a string, number, boolean, or array`,
          )
        }
      }
    }
    if (
      material.shader_id !== undefined &&
      (typeof material.shader_id !== 'string' || material.shader_id === '')
    ) {
      errors.push(`Library material "${String(material.id)}" shader_id must be a non-empty string`)
    }
    if (typeof material.id === 'string' && material.id !== '') {
      if (materialIds.has(material.id)) {
        errors.push(`A library material with id "${material.id}" already exists`)
      } else {
        materialIds.add(material.id)
      }
    }
  }
}

function validateLibraryShaders(errors: string[], shaders: unknown): void {
  if (shaders === undefined) {
    return
  }
  if (!Array.isArray(shaders)) {
    return
  }
  const shaderIds = new Set<string>()
  for (const shader of shaders) {
    if (!isRecord(shader)) {
      errors.push('Library shader must be an object')
      continue
    }
    requireNonEmptyString(errors, shader.id, 'Library shader id')
    requireNonEmptyString(errors, shader.name, 'Library shader name')
    if (typeof shader.description !== 'string') {
      errors.push(`Library shader "${String(shader.id)}" description must be a string`)
    }
    if (!Array.isArray(shader.tags)) {
      errors.push(`Library shader "${String(shader.id)}" tags must be an array`)
    }
    if (typeof shader.source !== 'string' || shader.source === '') {
      errors.push(`Library shader "${String(shader.id)}" source must be a non-empty string`)
    }
    if (!Array.isArray(shader.default_uniforms)) {
      errors.push(`Library shader "${String(shader.id)}" default_uniforms must be an array`)
    }
    if (typeof shader.id === 'string' && shader.id !== '') {
      if (shaderIds.has(shader.id)) {
        errors.push(`A library shader with id "${shader.id}" already exists`)
      } else {
        shaderIds.add(shader.id)
      }
    }
  }
}

function validateLibraryDataSources(errors: string[], dataSources: unknown): void {
  if (dataSources === undefined) {
    return
  }
  if (!Array.isArray(dataSources)) {
    return
  }
  const dsIds = new Set<string>()
  for (const ds of dataSources) {
    if (!isRecord(ds)) {
      errors.push('Library data source must be an object')
      continue
    }
    requireNonEmptyString(errors, ds.id, 'Library data source id')
    requireNonEmptyString(errors, ds.name, 'Library data source name')
    if (typeof ds.id === 'string' && ds.id !== '') {
      if (dsIds.has(ds.id)) {
        errors.push(`A library data source with id "${ds.id}" already exists`)
      } else {
        dsIds.add(ds.id)
      }
    }
    if (isRecord(ds) && isRecord(ds.flowchart)) {
      validateFlowchartDataSource(errors, ds)
    } else if (Array.isArray(ds.data_points)) {
      validateFlatDataSource(errors, ds)
    } else {
      errors.push(
        `Library data source "${String(ds.id)}" must have either data_points or a flowchart object`,
      )
    }
  }
}

function validateFlatDataSource(errors: string[], ds: Record<string, unknown>): void {
  const labels = new Set<string>()
  for (const point of ds.data_points as unknown[]) {
    if (!isRecord(point)) {
      errors.push(`Library data source "${String(ds.id)}" data point must be an object`)
      continue
    }
    requireNonEmptyString(
      errors,
      point.label,
      `Library data source "${String(ds.id)}" data point label`,
    )
    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
      errors.push(
        `Library data source "${String(ds.id)}" data point "${String(point.label)}" value must be a finite number`,
      )
    }
    if (typeof point.series !== 'string' && point.series !== undefined) {
      errors.push(
        `Library data source "${String(ds.id)}" data point "${String(point.label)}" series must be a string`,
      )
    }
    if (typeof point.tooltip !== 'string' && point.tooltip !== undefined) {
      errors.push(
        `Library data source "${String(ds.id)}" data point "${String(point.label)}" tooltip must be a string`,
      )
    }
    if (typeof point.color !== 'string' && point.color !== undefined) {
      errors.push(
        `Library data source "${String(ds.id)}" data point "${String(point.label)}" color must be a string`,
      )
    }
    if (typeof point.label === 'string' && point.label !== '') {
      if (labels.has(point.label)) {
        errors.push(
          `Library data source "${String(ds.id)}" has duplicate data point label: "${point.label}"`,
        )
      } else {
        labels.add(point.label)
      }
    }
  }
}

function validateFlowchartDataSource(errors: string[], ds: Record<string, unknown>): void {
  const flowchart = ds.flowchart as Record<string, unknown>
  if (!Array.isArray(flowchart.nodes)) {
    errors.push(`Library data source "${String(ds.id)}" flowchart nodes must be an array`)
    return
  }
  if (!Array.isArray(flowchart.edges)) {
    errors.push(`Library data source "${String(ds.id)}" flowchart edges must be an array`)
    return
  }
  const nodeIds = new Set<string>()
  for (const node of flowchart.nodes) {
    if (!isRecord(node)) {
      errors.push(`Library data source "${String(ds.id)}" flowchart node must be an object`)
      continue
    }
    requireNonEmptyString(
      errors,
      node.id,
      `Library data source "${String(ds.id)}" flowchart node id`,
    )
    requireNonEmptyString(
      errors,
      node.label,
      `Library data source "${String(ds.id)}" flowchart node label`,
    )
    if (typeof node.id === 'string' && node.id !== '') {
      if (nodeIds.has(node.id)) {
        errors.push(
          `Library data source "${String(ds.id)}" has duplicate flowchart node id: "${node.id}"`,
        )
      } else {
        nodeIds.add(node.id)
      }
    }
  }
  for (const edge of flowchart.edges) {
    if (!isRecord(edge)) {
      errors.push(`Library data source "${String(ds.id)}" flowchart edge must be an object`)
      continue
    }
    requireNonEmptyString(
      errors,
      edge.from,
      `Library data source "${String(ds.id)}" flowchart edge from`,
    )
    requireNonEmptyString(
      errors,
      edge.to,
      `Library data source "${String(ds.id)}" flowchart edge to`,
    )
    if (typeof edge.from === 'string' && edge.from !== '' && !nodeIds.has(edge.from)) {
      errors.push(
        `Library data source "${String(ds.id)}" flowchart edge references unknown node: "${edge.from}"`,
      )
    }
    if (typeof edge.to === 'string' && edge.to !== '' && !nodeIds.has(edge.to)) {
      errors.push(
        `Library data source "${String(ds.id)}" flowchart edge references unknown node: "${edge.to}"`,
      )
    }
  }
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    adjacency.set(id, [])
  }
  for (const edge of flowchart.edges) {
    if (
      isRecord(edge) &&
      typeof edge.from === 'string' &&
      typeof edge.to === 'string' &&
      edge.from !== edge.to
    ) {
      adjacency.get(edge.from)?.push(edge.to)
    }
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()
  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visited.add(nodeId)
    inStack.add(nodeId)
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true
    }
    inStack.delete(nodeId)
    return false
  }
  for (const nodeId of nodeIds) {
    if (dfs(nodeId)) {
      errors.push(`Library data source "${String(ds.id)}" flowchart contains a cycle`)
      break
    }
  }
}

export function buildEmbeddedAssetsFromJSON(library: unknown): EmbeddedAsset[] {
  if (!isRecord(library) || !Array.isArray(library.assets)) {
    return []
  }
  const assets: EmbeddedAsset[] = []
  for (const asset of library.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.id !== 'string' ||
      asset.id === '' ||
      typeof asset.name !== 'string' ||
      asset.name === '' ||
      typeof asset.data !== 'string' ||
      typeof asset.mimeType !== 'string'
    ) {
      continue
    }
    assets.push({
      id: asset.id,
      name: asset.name,
      data: asset.data,
      mimeType: asset.mimeType,
      ...(isRecord(asset.metadata) ? { metadata: asset.metadata } : {}),
    })
  }
  return assets
}

export function buildEmbeddedMaterialsFromJSON(library: unknown): EmbeddedMaterialDefinition[] {
  if (!isRecord(library) || !Array.isArray(library.materials)) {
    return []
  }
  const materials: EmbeddedMaterialDefinition[] = []
  for (const material of library.materials) {
    if (
      !isRecord(material) ||
      typeof material.id !== 'string' ||
      material.id === '' ||
      typeof material.name !== 'string' ||
      material.name === '' ||
      typeof material.description !== 'string' ||
      !Array.isArray(material.tags) ||
      !Array.isArray(material.parameters)
    ) {
      continue
    }
    materials.push({
      id: material.id,
      name: material.name,
      description: material.description,
      tags: material.tags.filter((tag): tag is string => typeof tag === 'string'),
      createdAt: typeof material.created_at === 'string' ? material.created_at : '',
      updatedAt: typeof material.updated_at === 'string' ? material.updated_at : '',
      parameters: material.parameters.flatMap((parameter) => {
        if (
          !isRecord(parameter) ||
          typeof parameter.key !== 'string' ||
          parameter.key === '' ||
          typeof parameter.kind !== 'string'
        ) {
          return []
        }
        const value = parameter.default
        if (!isParameterDefaultValue(value)) {
          return []
        }
        return [
          {
            key: parameter.key,
            kind: parameter.kind,
            default: value,
          },
        ]
      }),
      shaderId: typeof material.shader_id === 'string' ? material.shader_id : null,
    })
  }
  return materials
}

export function buildEmbeddedShadersFromJSON(library: unknown): EmbeddedShaderDefinition[] {
  if (!isRecord(library) || !Array.isArray(library.shaders)) {
    return []
  }
  const shaders: EmbeddedShaderDefinition[] = []
  for (const shader of library.shaders) {
    if (
      !isRecord(shader) ||
      typeof shader.id !== 'string' ||
      shader.id === '' ||
      typeof shader.name !== 'string' ||
      shader.name === '' ||
      typeof shader.description !== 'string' ||
      !Array.isArray(shader.tags) ||
      typeof shader.source !== 'string' ||
      !Array.isArray(shader.default_uniforms)
    ) {
      continue
    }
    shaders.push({
      id: shader.id,
      name: shader.name,
      description: shader.description,
      tags: shader.tags.filter((tag): tag is string => typeof tag === 'string'),
      createdAt: typeof shader.created_at === 'string' ? shader.created_at : '',
      updatedAt: typeof shader.updated_at === 'string' ? shader.updated_at : '',
      source: shader.source,
      defaultUniforms: shader.default_uniforms.flatMap((uniform) =>
        isRecord(uniform) ? [{ ...uniform }] : [],
      ),
      isBuiltin: typeof shader.is_builtin === 'boolean' ? shader.is_builtin : false,
    })
  }
  return shaders
}

export function buildEmbeddedDataSourcesFromJSON(
  library: unknown,
): (EmbeddedDataSourceDefinition | EmbeddedFlowchartDataSourceDefinition)[] {
  if (!isRecord(library) || !Array.isArray(library.data_sources)) {
    return []
  }
  const dataSources: (EmbeddedDataSourceDefinition | EmbeddedFlowchartDataSourceDefinition)[] = []
  for (const ds of library.data_sources) {
    if (
      !isRecord(ds) ||
      typeof ds.id !== 'string' ||
      ds.id === '' ||
      typeof ds.name !== 'string' ||
      ds.name === ''
    ) {
      continue
    }
    if (isRecord(ds.flowchart)) {
      const flowchart = ds.flowchart
      if (!Array.isArray(flowchart.nodes) || !Array.isArray(flowchart.edges)) {
        continue
      }
      dataSources.push({
        id: ds.id,
        name: ds.name,
        nodes: flowchart.nodes
          .filter(
            (node): node is { id: string; label: string } =>
              isRecord(node) &&
              typeof node.id === 'string' &&
              node.id !== '' &&
              typeof node.label === 'string',
          )
          .map((node) => ({ id: node.id, label: node.label })),
        edges: flowchart.edges
          .filter(
            (edge): edge is { from: string; to: string } =>
              isRecord(edge) &&
              typeof edge.from === 'string' &&
              edge.from !== '' &&
              typeof edge.to === 'string' &&
              edge.to !== '',
          )
          .map((edge) => ({ from: edge.from, to: edge.to })),
      })
    } else if (Array.isArray(ds.data_points)) {
      dataSources.push({
        id: ds.id,
        name: ds.name,
        dataPoints: ds.data_points
          .filter(
            (
              point,
            ): point is {
              label: string
              value: number
              series?: string
              tooltip?: string
              color?: string
            } =>
              isRecord(point) &&
              typeof point.label === 'string' &&
              point.label !== '' &&
              typeof point.value === 'number' &&
              Number.isFinite(point.value),
          )
          .map((point) => ({
            label: point.label,
            value: point.value,
            ...(typeof point.series === 'string' ? { series: point.series } : {}),
            ...(typeof point.tooltip === 'string' ? { tooltip: point.tooltip } : {}),
            ...(typeof point.color === 'string' ? { color: point.color } : {}),
          })),
      })
    }
  }
  return dataSources
}

export function validateLibraryClips(errors: string[], clips: unknown): void {
  if (clips === undefined) {
    return
  }
  if (!Array.isArray(clips)) {
    return
  }
  const clipIds = new Set<string>()
  for (const clip of clips) {
    if (!isRecord(clip)) {
      errors.push('Library clip must be an object')
      continue
    }
    requireNonEmptyString(errors, clip.id, 'Library clip id')
    requireNonEmptyString(errors, clip.name, 'Library clip name')
    if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration < 0) {
      errors.push('Library clip duration must be a non-negative finite number')
    }
    if (clip.category !== undefined && typeof clip.category !== 'string') {
      errors.push('Library clip category must be a string')
    }
    if (!Array.isArray(clip.params)) {
      errors.push('Library clip params must be an array')
    }
    if (!Array.isArray(clip.channels)) {
      errors.push('Library clip channels must be an array')
    }
    if (typeof clip.id === 'string' && clip.id !== '') {
      if (clipIds.has(clip.id)) {
        errors.push(`A library clip with id "${clip.id}" already exists`)
      } else {
        clipIds.add(clip.id)
      }
    }
  }
}

function requireNonEmptyString(errors: string[], value: unknown, what: string): void {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${what} must be a non-empty string`)
  }
}

function isNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

function isParameterDefaultValue(
  value: unknown,
): value is string | number | boolean | readonly number[] {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isNumberArray(value)
  )
}

export function buildClipsFromJSON(library: unknown): ClipDefinition[] {
  if (!isRecord(library) || !Array.isArray(library.clips)) {
    return []
  }
  const clips: ClipDefinition[] = []
  for (const clipJson of library.clips) {
    try {
      clips.push(ClipDefinition.fromJSON(clipJson))
    } catch {
      // Skip invalid clips
    }
  }
  return clips
}
