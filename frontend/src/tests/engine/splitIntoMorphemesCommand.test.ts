import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideMaterialParameterCommand,
  SplitIntoMorphemesCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithTextNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'T',
        transform: { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        components: {
          text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
        },
      }),
    ),
  )
  return { system, nodeId, sceneId: slide.scene.id, rootId: slide.scene.root.id }
}

function setupWithPlainNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'N',
      }),
    ),
  )
  return { system, nodeId }
}

describe('SplitIntoMorphemesCommand', () => {
  it('creates a container with child text nodes for each segment', () => {
    const { system, nodeId, rootId } = setupWithTextNode()

    const inverse = expectOk(
      system.dispatcher.dispatch(
        new SplitIntoMorphemesCommand({ nodeId, segments: ['hel', 'lo'] }),
      ),
    )

    const rootNode = system.engine.getNode(rootId)
    const container = rootNode.children.find((c) => c.name === 'Hello Morphemes')
    expect(container).toBeDefined()
    expect(container!.children).toHaveLength(2)
    expect(container!.children[0].components.text?.content).toBe('hel')
    expect(container!.children[1].components.text?.content).toBe('lo')
    expect(inverse).toBeDefined()
  })

  it('positions segments side-by-side at fixed offsets', () => {
    const { system, nodeId } = setupWithTextNode()

    expectOk(
      system.dispatcher.dispatch(
        new SplitIntoMorphemesCommand({ nodeId, segments: ['hel', 'lo'] }),
      ),
    )

    const rootNode = system.engine.getNode(system.engine.project!.slides[0].scene.root.id)
    const container = rootNode.children.find((c) => c.name === 'Hello Morphemes')!
    const child0 = container.children[0]
    const child1 = container.children[1]

    expect(child0.transform.x).toBe(0)
    expect(child0.transform.y).toBe(0)
    expect(child1.transform.x).toBeGreaterThan(0)
    expect(child1.transform.y).toBe(0)
  })

  it('copies the parent material to each segment', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'T',
          components: {
            text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
          },
        }),
      ),
    )
    // Set material override via the command system
    system.dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#FF0000' }),
    )

    expectOk(
      system.dispatcher.dispatch(
        new SplitIntoMorphemesCommand({ nodeId, segments: ['hel', 'lo'] }),
      ),
    )

    const rootNode = system.engine.getNode(slide.scene.root.id)
    const container = rootNode.children.find((c) => c.name === 'Hello Morphemes')!
    for (const child of container.children) {
      expect(child.material.overrides['tint']).toBe('#FF0000')
    }
  })

  it('replaces the original text node with the morph group container', () => {
    const { system, nodeId, rootId } = setupWithTextNode()

    expectOk(
      system.dispatcher.dispatch(new SplitIntoMorphemesCommand({ nodeId, segments: ['a', 'b'] })),
    )

    expect(() => system.engine.getNode(nodeId)).toThrow()
    const rootNode = system.engine.getNode(rootId)
    expect(rootNode.children.find((c) => c.name === 'Hello Morphemes')).toBeDefined()
  })

  it('preserves the original text fontSize and alignment on segments', () => {
    const { system, nodeId } = setupWithTextNode()

    expectOk(
      system.dispatcher.dispatch(new SplitIntoMorphemesCommand({ nodeId, segments: ['a', 'b'] })),
    )

    const rootNode = system.engine.getNode(system.engine.project!.slides[0].scene.root.id)
    const container = rootNode.children.find((c) => c.name === 'Hello Morphemes')!
    for (const child of container.children) {
      expect(child.components.text?.fontSize).toBe(24)
      expect(child.components.text?.alignment).toBe('left')
    }
  })

  it('captures inverse data that enables undo', () => {
    const { system, nodeId } = setupWithTextNode()

    const inverse = expectOk(
      system.dispatcher.dispatch(
        new SplitIntoMorphemesCommand({ nodeId, segments: ['hel', 'lo'] }),
      ),
    )

    // Verify inverse contains all data needed to undo
    expect(inverse.originalNodeId).toBe(nodeId)
    expect(inverse.originalTextContent).toBe('Hello')
    expect(inverse.originalFontSize).toBe(24)
    expect(inverse.originalAlignment).toBe('left')
    expect(inverse.originalTransform).toEqual({ x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 })
    expect(inverse.containerNodeId).toBeTruthy()
    expect(inverse.parentId).toBeTruthy()
    expect(inverse.sceneId).toBeTruthy()
  })

  it('rejects a node without a text component', () => {
    const { system, nodeId } = setupWithPlainNode()

    const result = system.dispatcher.dispatch(
      new SplitIntoMorphemesCommand({ nodeId, segments: ['a'] }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/text component/i)
    }
  })

  it('rejects a nonexistent node', () => {
    const { system } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SplitIntoMorphemesCommand({ nodeId: 'ghost', segments: ['a'] }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
  })

  it('rejects empty segments array', () => {
    const { system, nodeId } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SplitIntoMorphemesCommand({ nodeId, segments: [] }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one segment/i)
    }
  })

  it('rejects segments containing empty strings', () => {
    const { system, nodeId } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SplitIntoMorphemesCommand({ nodeId, segments: ['a', '', 'b'] }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/segment.*empty/i)
    }
  })

  it('rejects segments containing only whitespace', () => {
    const { system, nodeId } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SplitIntoMorphemesCommand({ nodeId, segments: ['a', '  ', 'b'] }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/segment.*empty/i)
    }
  })

  it('rejects a node without a parent (root node)', () => {
    const { system } = setupWithTextNode()

    // The root node has no parent; split should fail
    const result = system.dispatcher.dispatch(
      new SplitIntoMorphemesCommand({
        nodeId: system.engine.project!.slides[0].scene.root.id,
        segments: ['a'],
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/root node/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    const cmd = new SplitIntoMorphemesCommand({ nodeId: 'n1', segments: ['hel', 'lo'] })
    expect(cmd.toJSON()).toEqual({
      type: 'SplitIntoMorphemes',
      nodeId: 'n1',
      segments: ['hel', 'lo'],
    })
  })
})
