import type { Engine } from '../internal'
import type { Command } from './command'
import { copyMaterialInstance } from '../materialInstance'
import type { Transform } from '../transform'

const DEFAULT_CHAR_SPACING = 0.6

export interface SplitIntoMorphemesParameters {
  readonly nodeId: string
  readonly segments: readonly string[]
}

export interface SplitIntoMorphemesInverse {
  readonly originalNodeId: string
  readonly containerNodeId: string
  readonly containerName: string
  readonly parentId: string
  readonly sceneId: string
  readonly originalTransform: Transform
  readonly originalTextContent: string
  readonly originalFontSize: number
  readonly originalAlignment: string
  readonly originalMaterialDefinitionId: string
  readonly originalMaterialOverrides: Readonly<Record<string, unknown>>
}

export class SplitIntoMorphemesCommand implements Command<SplitIntoMorphemesInverse> {
  readonly type = 'SplitIntoMorphemes'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #segments: readonly string[]
  readonly #charSpacing: number

  constructor(input: SplitIntoMorphemesParameters & { readonly charSpacing?: number }) {
    this.#nodeId = input.nodeId
    this.#segments = input.segments
    this.#charSpacing = input.charSpacing ?? DEFAULT_CHAR_SPACING
    this.parameters = { nodeId: input.nodeId, segments: [...input.segments] }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (node.parent === null) {
      throw new Error('The root node cannot be split')
    }
    if (!node.components.text) {
      throw new Error(`Node "${this.#nodeId}" does not have a text component`)
    }
    if (this.#segments.length === 0) {
      throw new Error('At least one segment is required')
    }
    for (let i = 0; i < this.#segments.length; i++) {
      if (this.#segments[i].trim() === '') {
        throw new Error(`Segment ${i + 1} must not be empty`)
      }
    }
  }

  execute(engine: Engine): SplitIntoMorphemesInverse {
    const node = engine.getNode(this.#nodeId)
    const scene = engine.getNodeScene(this.#nodeId)
    const text = node.components.text!
    const parent = node.parent!
    const materialCopy = copyMaterialInstance(node.material)

    // Create container node at the original node's position
    const containerName = `${text.content} Morphemes`
    const container = engine.createNode(scene.id, parent.id, containerName, {
      transform: { ...node.transform },
    })
    container.material = materialCopy

    // Create child text nodes for each segment, positioned side-by-side
    let xOffset = 0
    for (let i = 0; i < this.#segments.length; i++) {
      const segment = this.#segments[i]
      const segmentNode = engine.createNode(scene.id, container.id, `Segment ${i + 1}`, {
        transform: {
          x: xOffset,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        },
        components: {
          text: {
            kind: 'text',
            content: segment,
            fontSize: text.fontSize,
            alignment: text.alignment,
          },
        },
      })
      segmentNode.material = materialCopy
      xOffset += segment.length * text.fontSize * this.#charSpacing
    }

    // Remove the original node
    engine.removeNode(this.#nodeId)

    return {
      originalNodeId: this.#nodeId,
      containerNodeId: container.id,
      containerName,
      parentId: parent.id,
      sceneId: scene.id,
      originalTransform: { ...node.transform },
      originalTextContent: text.content,
      originalFontSize: text.fontSize,
      originalAlignment: text.alignment,
      originalMaterialDefinitionId: node.material.materialDefinitionId,
      originalMaterialOverrides: { ...node.material.overrides },
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
