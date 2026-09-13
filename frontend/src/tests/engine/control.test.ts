import { describe, expect, it } from 'vitest'
import {
  createCommandSystem,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
  AddKeyframeCommand,
} from '../../engine/commands'
import { createControl, createControlSet } from '../../engine/control'
import { Keyframe } from '../../engine/keyframe'
import { validateReusableObject } from '../../engine/reusableObject'
import { createDefaultRectangleMesh } from '../../engine/mesh'

function ok<T>(result: { ok: true; inverse: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error
  return result.inverse
}

describe('parametric controls', () => {
  it('drives descendants after time clips and persists the definition and track', () => {
    const system = createCommandSystem()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Controls' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' })))
    const slide = system.engine.project!.slides[0]
    const host = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    )
    const child = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host.nodeId, name: 'Target' }),
      ),
    )
    const clip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Normalized X',
          duration: 1,
          category: 'control',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip.clipId, channel: 'positionX' },
          time: 0,
          value: 10,
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip.clipId, channel: 'positionX' },
          time: 1,
          value: 30,
        }),
      ),
    )

    const target = slide.scene.getNode(child.nodeId)!
    target.semanticName = 'target'
    const rig = slide.scene.getNode(host.nodeId)!
    rig.controlSet = createControlSet(rig.id, [
      createControl({ key: 'Mouth.Openness', bindings: { target: clip.clipId }, exposed: true }),
    ])
    const track = slide.animation.ensure(rig.id)
    track.addControl('Mouth.Openness', new Keyframe('control-start', 0, 0))
    const added = ok(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: rig.id, controlKey: 'Mouth.Openness' },
          time: slide.duration,
          value: 1,
        }),
      ),
    )
    expect(added.keyframe.keyframeId).toBeTruthy()

    expect(system.engine.evaluateNode(target.id, slide.duration / 2).transform.x).toBe(20)
    const json = slide.toJSON()
    const jsonNode = json.scene.nodes.find((node) => node.id === rig.id)!
    expect(jsonNode.controlSet?.controls[0].key).toBe('Mouth.Openness')
    expect(
      json.animation?.nodes.find((node) => node.nodeId === rig.id)?.controlTracks,
    ).toHaveLength(1)
  })

  it('enforces stable control keys', () => {
    expect(() => createControl({ key: '1invalid' })).toThrow()
    expect(() =>
      createControlSet('host', [createControl({ key: 'Open' }), createControl({ key: 'Open' })]),
    ).toThrow()
  })

  it('rejects non-normalized clips referenced by Controls', () => {
    const errors = validateReusableObject({
      version: 1,
      name: 'Rig',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          name: 'Root',
          parentId: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          components: {},
          controlSet: {
            id: 'set',
            hostNodeId: 'root',
            controls: [
              {
                id: 'control',
                key: 'Open',
                label: 'Open',
                min: 0,
                max: 1,
                default: 0,
                exposed: true,
                bindings: { target: 'clip' },
              },
            ],
          },
        },
      ],
      library: {
        clips: [
          {
            id: 'clip',
            name: 'Wrong duration',
            duration: 2,
            params: [],
            channels: [],
          },
        ],
      },
    })
    expect(errors).toContain('Control clip "clip" must have duration 1')
  })

  it('evaluates table and symmetry channels from a Control clip', () => {
    const system = createCommandSystem()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Controls' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' })))
    const slide = system.engine.project!.slides[0]
    const host = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    )
    const table = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: host.nodeId,
          name: 'Table',
          components: {
            table: {
              kind: 'table',
              columns: [],
              gap: 0,
              borderWidth: 0,
              borderColor: '#000000',
              borderRadius: 0,
              padding: 0,
            },
          },
        }),
      ),
    )
    const mesh = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: host.nodeId,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
        }),
      ),
    )
    slide.scene.getNode(table.nodeId)!.semanticName = 'table'
    slide.scene.getNode(mesh.nodeId)!.semanticName = 'mesh'
    const tableClip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Table Control',
          duration: 1,
          category: 'control',
          params: [],
          channels: [],
        }),
      ),
    )
    const tableDefinition = system.engine.getClip(tableClip.clipId)
    tableDefinition.addTableKeyframe('borderRadius', new Keyframe('table-0', 0, 0))
    tableDefinition.addTableKeyframe('borderRadius', new Keyframe('table-1', 1, 20))
    const symmetryClip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Symmetry Control',
          duration: 1,
          category: 'control',
          params: [],
          channels: [],
        }),
      ),
    )
    const symmetryDefinition = system.engine.getClip(symmetryClip.clipId)
    symmetryDefinition.addSymmetryKeyframe(
      new Keyframe('symmetry-0', 0, { axis: 'x', factor: 0 } as never),
    )
    symmetryDefinition.addSymmetryKeyframe(
      new Keyframe('symmetry-1', 1, { axis: 'x', factor: 1 } as never),
    )
    const rig = slide.scene.getNode(host.nodeId)!
    rig.controlSet = createControlSet(rig.id, [
      createControl({
        key: 'Shape.Open',
        bindings: { table: tableClip.clipId, mesh: symmetryClip.clipId },
      }),
    ])
    slide.animation.ensure(rig.id).addControl('Shape.Open', new Keyframe('open', 0, 1))

    expect(system.engine.evaluateTable(table.nodeId, 0)?.borderRadius).toBe(20)
    expect(system.engine.evaluateSymmetry(mesh.nodeId, 0)?.factor).toBe(1)
  })
})
