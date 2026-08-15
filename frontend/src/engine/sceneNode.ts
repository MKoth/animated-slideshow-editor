import type { NodeComponents, TextAlignment } from './components'
import type { Transform } from './transform'
import type { NodeJSON } from './json'
import { requireOpacity, requireString } from './guards'
import {
  defaultMaterial,
  materialFromJSON,
  materialToJSON,
  type MaterialInstance,
} from './materialInstance'

const TEXT_ALIGNMENTS: readonly TextAlignment[] = ['left', 'center', 'right']

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
  }

  toJSON(): NodeJSON {
    const material = materialToJSON(this.material)
    return {
      id: this.id,
      name: this.name,
      parentId: this.parent ? this.parent.id : null,
      transform: { ...this.transform },
      visible: this.visible,
      opacity: this.opacity,
      ...(material !== undefined ? { material } : {}),
      components: { ...this.components },
    }
  }

  static fromJSON(json: NodeJSON): SceneNode {
    const id = requireString(json.id, 'Node id')
    const name = requireString(json.name, 'Node name')
    const transform = requireTransform(json.transform, id)
    const node = new SceneNode(id, name, transform, componentsFromJSON(json.components, id))
    node.visible = typeof json.visible === 'boolean' ? json.visible : true
    node.opacity =
      typeof json.opacity === 'number' ? requireOpacity(json.opacity, `Node "${id}" opacity`) : 1
    node.material = materialFromJSON(json.material, id)
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
  }
  return Object.freeze(frozen)
}
