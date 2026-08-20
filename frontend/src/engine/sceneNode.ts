import type { NodeComponents, TextAlignment } from './components'
import { meshDataFromJSON, cloneMeshData } from './mesh'
import type { Transform } from './transform'
import { IDENTITY_PIVOT } from './transform'
import type { NodeJSON } from './json'
import { requireOpacity, requireString } from './guards'
import {
  defaultMaterial,
  materialFromJSON,
  materialToJSON,
  type MaterialInstance,
} from './materialInstance'
import type { ClipInstance } from './clipInstance'
import { clipInstanceFromJSON, clipInstanceToJSON } from './clipInstance'

const TEXT_ALIGNMENTS: readonly TextAlignment[] = ['left', 'center', 'right']

export interface CachedWorldTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export class SceneNode {
  readonly id: string
  name: string
  parent: SceneNode | null
  readonly children: SceneNode[]
  transform: Transform
  visible: boolean
  opacity: number
  material: MaterialInstance
  readonly components: NodeComponents
  readonly clipInstances: ClipInstance[]
  _worldTransformDirty = true
  _cachedWorldTransform: CachedWorldTransform | null = null

  constructor(id: string, name: string, transform: Transform, components: NodeComponents = {}) {
    this.id = id
    this.name = name
    this.transform = transform
    this.components = freezeComponents(components)
    this.parent = null
    this.children = []
    this.visible = true
    this.opacity = 1
    this.material = defaultMaterial()
    this.clipInstances = []
  }

  markDirty(): void {
    if (!this._worldTransformDirty) {
      this._worldTransformDirty = true
      this._cachedWorldTransform = null
      for (const child of this.children) {
        child.markDirty()
      }
    }
  }

  toJSON(): NodeJSON {
    const material = materialToJSON(this.material)
    const pivot = this.transform.localPivot ?? IDENTITY_PIVOT
    const hasPivot = pivot.x !== IDENTITY_PIVOT.x || pivot.y !== IDENTITY_PIVOT.y
    return {
      id: this.id,
      name: this.name,
      parentId: this.parent ? this.parent.id : null,
      transform: {
        x: this.transform.x,
        y: this.transform.y,
        rotation: this.transform.rotation,
        scaleX: this.transform.scaleX,
        scaleY: this.transform.scaleY,
      },
      localPivot: hasPivot ? { ...pivot } : undefined,
      visible: this.visible,
      opacity: this.opacity,
      ...(material !== undefined ? { material } : {}),
      components: { ...this.components },
      ...(this.clipInstances.length > 0
        ? { clipInstances: this.clipInstances.map(clipInstanceToJSON) }
        : {}),
    }
  }

  static fromJSON(json: NodeJSON): SceneNode {
    const id = requireString(json.id, 'Node id')
    const name = requireString(json.name, 'Node name')
    const transform = requireTransform(json.transform, id)
    const localPivot = json.localPivot ? { x: json.localPivot.x, y: json.localPivot.y } : undefined
    const node = new SceneNode(
      id,
      name,
      localPivot ? { ...transform, localPivot } : transform,
      componentsFromJSON(json.components, id),
    )
    node.visible = typeof json.visible === 'boolean' ? json.visible : true
    node.opacity =
      typeof json.opacity === 'number' ? requireOpacity(json.opacity, `Node "${id}" opacity`) : 1
    node.material = materialFromJSON(json.material, id)
    if (Array.isArray(json.clipInstances)) {
      for (const clipJson of json.clipInstances) {
        node.clipInstances.push(clipInstanceFromJSON(clipJson))
      }
    }
    return node
  }
}

function requireTransform(value: unknown, nodeId: string): Transform {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Node "${nodeId}" must have a transform`)
  }
  const transform = value as Record<string, unknown>
  for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const) {
    if (typeof transform[key] !== 'number') {
      throw new Error(`Node "${nodeId}" transform.${key} must be a number`)
    }
  }
  return transform as unknown as Transform
}

function componentsFromJSON(json: unknown, nodeId: string): NodeComponents {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`Node "${nodeId}" must have a components object`)
  }
  const record = json as Record<string, unknown>
  const components: {
    camera?: NodeComponents['camera']
    assetInstance?: NodeComponents['assetInstance']
    text?: NodeComponents['text']
    bone?: NodeComponents['bone']
    mesh?: NodeComponents['mesh']
  } = {}
  if (record.camera !== undefined) {
    if (!isKind(record.camera, 'camera')) {
      throw new Error(`Node "${nodeId}" has an invalid camera component`)
    }
    components.camera = { kind: 'camera' }
  }
  if (record.assetInstance !== undefined) {
    const component = record.assetInstance as Record<string, unknown>
    if (
      !isKind(component, 'assetInstance') ||
      typeof component.assetDefinitionId !== 'string' ||
      component.assetDefinitionId === ''
    ) {
      throw new Error(`Node "${nodeId}" has an invalid asset instance component`)
    }
    components.assetInstance = {
      kind: 'assetInstance',
      assetDefinitionId: component.assetDefinitionId,
    }
  }
  if (record.text !== undefined) {
    const component = record.text as Record<string, unknown>
    if (
      !isKind(component, 'text') ||
      typeof component.content !== 'string' ||
      typeof component.fontSize !== 'number'
    ) {
      throw new Error(`Node "${nodeId}" has an invalid text component`)
    }
    if (
      typeof component.alignment !== 'string' ||
      !(TEXT_ALIGNMENTS as readonly string[]).includes(component.alignment)
    ) {
      throw new Error(`Node "${nodeId}" has an invalid text alignment: "${component.alignment}"`)
    }
    components.text = {
      kind: 'text',
      content: component.content,
      fontSize: component.fontSize,
      alignment: component.alignment as TextAlignment,
    }
  }
  if (record.bone !== undefined) {
    if (!isKind(record.bone, 'bone')) {
      throw new Error(`Node "${nodeId}" has an invalid bone component`)
    }
    const boneRecord = record.bone as Record<string, unknown>
    const length = typeof boneRecord.length === 'number' ? boneRecord.length : 100
    components.bone = { kind: 'bone', length }
  }
  if (record.mesh !== undefined) {
    if (!isKind(record.mesh, 'mesh')) {
      throw new Error(`Node "${nodeId}" has an invalid mesh component`)
    }
    components.mesh = {
      kind: 'mesh',
      mesh: meshDataFromJSON((record.mesh as Record<string, unknown>).mesh),
    }
  }
  return components
}

export function* walkPreOrder(root: SceneNode): IterableIterator<SceneNode> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    stack.push(...[...current.children].reverse())
    yield current
  }
}

export function detachFromParent(node: SceneNode): void {
  if (node.parent) {
    node.parent.children.splice(node.parent.children.indexOf(node), 1)
  }
}

export function wouldFormCycle(node: SceneNode, newParent: SceneNode): boolean {
  for (let cursor: SceneNode | null = newParent; cursor !== null; cursor = cursor.parent) {
    if (cursor === node) {
      return true
    }
  }
  return false
}

function isKind(value: unknown, kind: string): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind
}

function freezeComponents(components: NodeComponents): NodeComponents {
  const frozen: NodeComponents = {
    camera: components.camera ? Object.freeze({ ...components.camera }) : undefined,
    assetInstance: components.assetInstance
      ? Object.freeze({ ...components.assetInstance })
      : undefined,
    text: components.text ? Object.freeze({ ...components.text }) : undefined,
    bone: components.bone ? Object.freeze({ ...components.bone }) : undefined,
    mesh: components.mesh
      ? Object.freeze({ kind: 'mesh' as const, mesh: cloneMeshData(components.mesh.mesh) })
      : undefined,
  }
  return Object.freeze(frozen)
}
