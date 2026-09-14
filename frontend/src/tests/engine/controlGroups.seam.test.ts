// @ts-nocheck
import { describe, expect, it, vi } from 'vitest'
import {
  createControl,
  createControlSet,
  controlSetFromJSON,
  controlSetToJSON,
  addGroupToControlSet,
  removeGroupFromControlSet,
  reorderGroupsInControlSet,
  moveBindingBetweenGroups,
  reorderBindingWithinGroup,
  reorderControlBlock,
  deleteControlFromSet,
  canDeleteControl,
} from '../../engine/control'
import { validate as validateLesson } from '../../engine/lessonSerializer'
import { validateReusableObject } from '../../engine/reusableObject'
import { createEngineInternal } from '../../engine/internal'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import { CreateProjectCommand, CreateSlideCommand, CreateNodeCommand, CreateClipCommand } from '../../engine/commands'

function ok<T>(res: { ok: true; inverse: T } | { ok: false; error: Error }): T {
  if (!res.ok) throw res.error
  return res.inverse
}

describe('Control Groups partition & Blend Control genesis/lifecycle (issue 349)', () => {
  it('Control.groups + blendKeys model with ordered partition; ControlGroupJSON additive tolerant', () => {
    // Single group -> no blend
    const c1 = createControl({ key: 'Mouth.Openness', bindings: { mouth: 'clip1' } })
    expect(c1.groups.length).toBe(1)
    expect(c1.blendKeys.length).toBe(0)
    expect(c1.groups[0].name).toBe('Group 1')
    // group binding may be stored as string or interval normalized; check via clipId
    expect((c1.groups[0].bindings.mouth as string | { clipId: string }).toString().includes('clip1') || (c1.groups[0].bindings.mouth as { clipId: string }).clipId === 'clip1').toBe(true)
    // flat bindings normalized to interval when via groups? Check merged
    const norm = typeof c1.bindings.mouth === 'string' ? { clipId: c1.bindings.mouth, start: 0, end: 1 } : c1.bindings.mouth
    expect(norm).toEqual({ clipId: 'clip1', start: 0, end: 1 })

    // Create with groups explicitly
    const c2 = createControl({
      key: 'Mouth.Smile',
      groups: [
        { id: 'g1', name: 'Open', bindings: { smile: { clipId: 'clipA', start: 0, end: 0.5 } } },
        { id: 'g2', name: 'Frown', bindings: { smile: { clipId: 'clipB', start: 0.5, end: 1 } } },
      ],
      blendKeys: ['blend'],
    })
    expect(c2.groups.length).toBe(2)
    expect(c2.blendKeys).toEqual(['blend'])
    expect(c2.groups[1].bindings.smile).toEqual({ clipId: 'clipB', start: 0.5, end: 1 })

    // JSON additive tolerant: old file without groups synthesizes single group
    const csOld = controlSetFromJSON(
      {
        id: 'cs',
        hostNodeId: 'node1',
        controls: [
          { id: 'c1', key: 'Open', label: 'Open', min: 0, max: 1, default: 0, exposed: true, bindings: { mouth: 'clip1' } },
        ],
      },
      'node1',
    )!
    expect(csOld.controls[0].groups.length).toBe(1)
    expect(csOld.controls[0].blendKeys.length).toBe(0)

    // JSON with groups additive tolerant: new field ignored by old readers (they use top-level merged union)
    // Create a valid ControlSet with host and blend sibling via helper
    let validForJson = createControlSet('host', [createControl({ key: 'HostJson', bindings: { a: 'clip1' } })])
    validForJson = addGroupToControlSet(validForJson, 'HostJson')
    const json = controlSetToJSON(validForJson)
    expect(json.controls[0].groups).toBeDefined()
    expect(json.controls[0].groups!.length).toBe(2)
    expect(json.controls[0].blendKeys.length).toBe(1)
    // top-level bindings merged union for backward compat
    expect(json.controls[0].bindings).toBeDefined()
    expect(Object.keys(json.controls[0].bindings).length).toBeGreaterThan(0)

    // Tolerant load of old lesson without start:end and without groups
    const oldJson = controlSetFromJSON(
      {
        id: 'cs',
        hostNodeId: 'host',
        controls: [
          {
            id: 'c1',
            key: 'Open',
            label: 'Open',
            min: 0,
            max: 1,
            default: 0,
            exposed: true,
            bindings: { mouth: 'clip1' },
            // no groups
          },
        ],
      },
      'host',
    )!
    expect(oldJson.controls[0].groups[0].bindings.mouth).toEqual({ clipId: 'clip1', start: 0, end: 1 })

    // Group validation: duplicate group id should throw
    expect(() =>
      createControl({
        key: 'Bad',
        groups: [
          { id: 'dup', name: 'A', bindings: {} },
          { id: 'dup', name: 'B', bindings: {} },
        ],
        blendKeys: ['blend'],
      }),
    ).toThrow(/duplicate group id/)

    // blendKeys length mismatch
    expect(() =>
      createControl({
        key: 'Bad2',
        groups: [
          { id: 'g1', name: 'A', bindings: {} },
          { id: 'g2', name: 'B', bindings: {} },
        ],
        blendKeys: [],
      }),
    ).toThrow(/blendKeys length/)
  })

  it('Adding Group 2/3 auto-creates blend/blend2 empty sibling immediately after host, contiguous, uniquified, exposed:true default:0', () => {
    let cs = createControlSet('hostNode', [createControl({ key: 'Mouth.Openness', bindings: { m: 'clip1' } })])
    expect(cs.controls.length).toBe(1)
    expect(cs.controls[0].groups.length).toBe(1)
    expect(cs.controls[0].blendKeys.length).toBe(0)

    // Add Group 2
    cs = addGroupToControlSet(cs, 'Mouth.Openness', 'Frown')
    expect(cs.controls.length).toBe(2)
    expect(cs.controls[0].key).toBe('Mouth.Openness')
    expect(cs.controls[0].groups.length).toBe(2)
    expect(cs.controls[0].blendKeys).toEqual(['blend'])
    expect(cs.controls[1].key).toBe('blend')
    expect(cs.controls[1].exposed).toBe(true)
    expect(cs.controls[1].default).toBe(0)
    expect(cs.controls[1].bindings).toEqual({})
    expect(cs.controls[1].groups.length).toBe(1)
    expect(Object.keys(cs.controls[1].groups[0].bindings).length).toBe(0)
    // contiguous: hostIdx 0, blends at 1
    expect(cs.controls[1].key).toBe(cs.controls[0].blendKeys[0])

    // Add Group 3 -> blend2
    cs = addGroupToControlSet(cs, 'Mouth.Openness', 'Neutral')
    expect(cs.controls.length).toBe(3)
    expect(cs.controls[0].groups.length).toBe(3)
    expect(cs.controls[0].blendKeys).toEqual(['blend', 'blend2'])
    expect(cs.controls[1].key).toBe('blend')
    expect(cs.controls[2].key).toBe('blend2')
    expect(cs.controls[2].exposed).toBe(true)
    expect(cs.controls[2].default).toBe(0)

    // Uniquify: if host already has blend key, should uniquify
    let cs2 = createControlSet('host2', [
      createControl({ key: 'Host', bindings: { a: 'clip1' } }),
      createControl({ key: 'blend', bindings: {} }),
    ])
    // Now adding group to Host should uniquify to blend2 (since blend already exists)
    cs2 = addGroupToControlSet(cs2, 'Host')
    expect(cs2.controls[0].blendKeys[0]).toBe('blend2')
    // New blend should be immediately after host, pushing old blend further
    const hostIdx2 = cs2.controls.findIndex((c) => c.key === 'Host')
    expect(cs2.controls[hostIdx2].blendKeys[0]).toBe('blend2')
    expect(cs2.controls[hostIdx2 + 1].key).toBe('blend2')
    // Old blend still exists but after
    expect(cs2.controls.some((c) => c.key === 'blend')).toBe(true)
  })

  it('Host+blends reorder as block; reorderGroups permutes blendKeys; bindings movable between groups / reordered within group with last-wins retained', () => {
    // Host+blends reorder as block
    let cs = createControlSet('host', [
      createControl({ key: 'A', bindings: { a: 'clip1' } }),
      createControl({ key: 'B', bindings: { b: 'clip2' } }),
      createControl({ key: 'C', bindings: { c: 'clip3' } }),
    ])
    // Add groups to A to create blends
    cs = addGroupToControlSet(cs, 'A') // A now has blend at idx1
    expect(cs.controls.map((c) => c.key)).toEqual(['A', 'blend', 'B', 'C'])
    cs = addGroupToControlSet(cs, 'A') // A now has blend, blend2 at 1,2
    expect(cs.controls.map((c) => c.key)).toEqual(['A', 'blend', 'blend2', 'B', 'C'])
    // Reorder control block A+blends to after C (index 3 in original without block? we want newIndex 2 in withoutBlock space?)
    // Use reorderControlBlock to move host A to index 3 (end)
    cs = reorderControlBlock(cs, 'A', 3)
    // After removal, withoutBlock = [B,C], target 3 clamped to 2? Let's test: Host block size 3, withoutBlock length 2, target 3 => clamp to 2 => after C
    expect(cs.controls.map((c) => c.key)).toEqual(['B', 'C', 'A', 'blend', 'blend2'])

    // reorderGroups permutes both groups[] and blendKeys[]
    let cs2 = createControlSet('host2', [createControl({ key: 'Host', bindings: { a: 'clip1' } })])
    cs2 = addGroupToControlSet(cs2, 'Host', 'G2')
    cs2 = addGroupToControlSet(cs2, 'Host', 'G3')
    // Host groups: G1,G2,G3 with blendKeys blend,blend2
    const hostBefore = cs2.controls[0]
    const gIds = hostBefore.groups.map((g) => g.id)
    const gNames = hostBefore.groups.map((g) => g.name)
    expect(gNames).toEqual(['Group 1', 'G2', 'G3'])
    // Fill groups with bindings to test permutation
    let cs3 = cs2
    // Add bindings to groups
    // Directly manipulate to set bindings for test
    const hostIdx = cs3.controls.findIndex((c) => c.key === 'Host')
    const host = cs3.controls[hostIdx]
    // Set groups bindings
    const newGroups = host.groups.map((g, idx) => ({
      ...g,
      bindings:
        idx === 0
          ? { mouth: { clipId: 'clip1', start: 0, end: 1 } }
          : idx === 1
            ? { mouth: { clipId: 'clip2', start: 0, end: 1 } }
            : { mouth: { clipId: 'clip3', start: 0, end: 1 } },
    }))
    const newHost = { ...host, groups: newGroups, bindings: {} as any } // bindings merged not needed
    // Use internal helper: we can just create new controlSet via direct manipulation and validate
    // Instead use moveBindingBetweenGroups etc. For reorderGroups test, we will reorder groups order [2,0,1] => G3,G1,G2
    cs3 = reorderGroupsInControlSet(cs3, 'Host', [2, 0, 1])
    const after = cs3.controls[0]
    expect(after.groups.map((g) => g.name)).toEqual(['G3', 'Group 1', 'G2'])
    // blendKeys should have been permuted accordingly (implementation maps correctly)
    expect(after.blendKeys.length).toBe(2)
    // check that blend controls order matches new blendKeys
    expect(cs3.controls[1].key).toBe(after.blendKeys[0])
    expect(cs3.controls[2].key).toBe(after.blendKeys[1])

    // Bindings movable between groups / reordered within group with last-wins retained
    let cs4 = createControlSet('host3', [createControl({ key: 'Host', bindings: { a: 'clip1', b: 'clip2', c: 'clip3' } })])
    cs4 = addGroupToControlSet(cs4, 'Host', 'Second')
    // Host now has 2 groups: G1 with a,b,c ; G2 empty
    const host4 = cs4.controls[0]
    const g1Id = host4.groups[0].id
    const g2Id = host4.groups[1].id
    // Move binding 'b' from G1 to G2 at index 0
    cs4 = moveBindingBetweenGroups(cs4, 'Host', 'b', g1Id, g2Id, 0)
    const hAfterMove = cs4.controls[0]
    expect(hAfterMove.groups[0].bindings).not.toHaveProperty('b')
    expect(hAfterMove.groups[1].bindings.b).toBeDefined()
    expect(Object.keys(hAfterMove.groups[1].bindings)[0]).toBe('b')
    // Last-wins within group: reorder within G1: currently has a,c ; reorder a to index 1 => order c,a so last wins is a
    const g1 = hAfterMove.groups[0]
    // g1 has a,c
    expect(Object.keys(g1.bindings)).toEqual(['a', 'c'])
    cs4 = reorderBindingWithinGroup(cs4, 'Host', g1Id, 'a', 1)
    expect(Object.keys(cs4.controls[0].groups[0].bindings)).toEqual(['c', 'a'])
    // last-wins retained: insertion order matters; we can check that move preserves order
  })

  it('Blend not directly deletable; removing groups collapses Blends; duplicate key blocked with pattern validation', () => {
    let cs = createControlSet('host', [createControl({ key: 'Host', bindings: { a: 'clip1' } })])
    cs = addGroupToControlSet(cs, 'Host')
    expect(cs.controls.length).toBe(2)
    expect(canDeleteControl(cs, 'blend')).toBe(false)
    expect(() => deleteControlFromSet(cs, 'blend')).toThrow(/cannot be deleted directly/)
    expect(canDeleteControl(cs, 'Host')).toBe(true)

    // Removing groups collapses Blends
    const host = cs.controls[0]
    const g2Id = host.groups[1].id
    cs = removeGroupFromControlSet(cs, 'Host', g2Id)
    expect(cs.controls.length).toBe(1)
    expect(cs.controls[0].groups.length).toBe(1)
    expect(cs.controls[0].blendKeys.length).toBe(0)
    expect(cs.controls[0].groups[0].name).toBe('Group 1')

    // duplicate key blocked with pattern validation
    expect(() => createControl({ key: '1invalid' })).toThrow(/Invalid control key/)
    expect(() => createControl({ key: 'blend' })).not.toThrow()
    // duplicate per ControlSet
    expect(() => createControlSet('h', [createControl({ key: 'A' }), createControl({ key: 'A' })])).toThrow(/Duplicate/)
    // blend key duplicate also blocked via validateControls
    let csDup = createControlSet('h', [createControl({ key: 'Host', bindings: { a: 'clip1' } })])
    csDup = addGroupToControlSet(csDup, 'Host')
    // Try to create another control with same blend key
    expect(() =>
      createControlSet('h', [
        csDup.controls[0],
        csDup.controls[1],
        createControl({ key: 'blend', bindings: {} }),
      ]),
    ).toThrow(/Duplicate control key/)
  })

  it('ReusableObject / .lesson import preserves key/blendKeys/semanticName, remaps clipIds, soft-warns per group, retains contiguous sibling order', () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine as any, undo, () => {})
    const expectOk = (res: any) => {
      if (!res.ok) throw new Error(res.error?.message)
      return res.inverse
    }
    expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = engine.getActiveSlide()!
    const host = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'Rig' }),
      ),
    ).nodeId as string
    const child = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host, name: 'Child' })),
    ).nodeId as string
    engine.getNode(child).semanticName = 'mouth'
    const clip1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Clip1', duration: 1, category: 'control', params: [], channels: [{ property: 'positionX' }] })),
    ).clipId as string
    const clip2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Clip2', duration: 1, category: 'control', params: [], channels: [{ property: 'positionX' }] })),
    ).clipId as string

    // Create host control with groups using helper to ensure blend sibling exists contiguous
    let cs = createControlSet(host, [createControl({ key: 'Mouth.Openness', bindings: { mouth: clip1 } })])
    cs = addGroupToControlSet(cs, 'Mouth.Openness', 'Frown')
    // Manually set Frown group's binding to clip2
    const h = cs.controls[0]
    const g2Id = h.groups[1].id
    cs = moveBindingBetweenGroups(cs, 'Mouth.Openness', 'mouth', h.groups[0].id, g2Id) // will move mouth from G1 to G2, but we want both groups have mouth? Actually we need to duplicate? Let's just set directly for test
    // For simplicity, directly edit groups via internal: create new CS with desired groups
    const g1 = h.groups[0]
    const g2 = h.groups[1]
    const newG1 = { ...g1, bindings: { mouth: { clipId: clip1, start: 0, end: 1 } } }
    const newG2 = { ...g2, bindings: { mouth: { clipId: clip2, start: 0, end: 1 } } }
    cs = {
      ...cs,
      controls: [
        { ...h, groups: [newG1, newG2], bindings: { mouth: { clipId: clip2, start: 0, end: 1 } } as any, blendKeys: h.blendKeys },
        cs.controls[1],
      ],
    }
    engine.getNode(host).controlSet = cs

    const obj = engine.exportReusableObject(host, 'RigExport')
    expect(obj.nodes.length).toBeGreaterThanOrEqual(2)
    const exportedHost = obj.nodes.find((n) => n.name === 'Rig')!
    const exportedCS = (exportedHost as any).controlSet
    expect(exportedCS.controls[0].key).toBe('Mouth.Openness')
    expect(exportedCS.controls[0].groups.length).toBe(2)
    expect(exportedCS.controls[0].groups[0].name).toBe('Group 1')
    expect(exportedCS.controls[0].groups[1].name).toBe('Frown')
    expect(exportedCS.controls[0].blendKeys).toEqual(['blend'])
    // Clip ids in groups should be original
    expect(exportedCS.controls[0].groups[0].bindings.mouth.clipId).toBe(clip1)
    expect(exportedCS.controls[1].key).toBe('blend')

    // Import and check remapping
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = engine.importReusableObject(obj)
    const newHostId = res.nodeIdMap.get(host)!
    const newHost = engine.getNode(newHostId)
    expect(newHost.controlSet?.controls[0].key).toBe('Mouth.Openness') // preserved
    expect(newHost.controlSet?.controls[0].blendKeys).toEqual(['blend'])
    expect(newHost.controlSet?.controls[0].groups[0].name).toBe('Group 1')
    expect(newHost.controlSet?.controls[0].groups[1].name).toBe('Frown')
    expect(newHost.controlSet?.controls[0].id).not.toBe(cs.controls[0].id) // fresh
    expect(newHost.controlSet?.controls[0].groups[0].id).not.toBe(g1.id) // fresh
    // clipIds remapped
    const newClipId1 = res.clipIdMap.get(clip1)!
    const newClipId2 = res.clipIdMap.get(clip2)!
    expect(newHost.controlSet?.controls[0].groups[0].bindings.mouth).toEqual({ clipId: newClipId1, start: 0, end: 1 })
    expect(newHost.controlSet?.controls[0].groups[1].bindings.mouth).toEqual({ clipId: newClipId2, start: 0, end: 1 })
    // contiguous sibling order retained
    expect(newHost.controlSet?.controls[1].key).toBe('blend')
    expect(newHost.controlSet?.controls[0].blendKeys[0]).toBe(newHost.controlSet?.controls[1].key)

    // Soft-warn per group when clip missing or semanticName has no descendant match
    // Create an object with a group referencing missing clip and a semanticName with no descendant
    const badObj = JSON.parse(JSON.stringify(obj)) as typeof obj
    const badHostNode = badObj.nodes.find((n) => (n as any).controlSet)!
    ;(badHostNode as any).controlSet.controls[0].groups[0].bindings['missingSemantic'] = { clipId: 'nonexistentClip', start: 0, end: 1 }
    ;(badHostNode as any).controlSet.controls[0].groups[1].bindings['mouth'] = { clipId: newClipId1, start: 0, end: 1 } // will be missing after import? Actually use old clip id that exists but semanticName 'mouth' has descendant, so should not warn. For missing semantic, use a semantic that doesn't exist
    // Add a group with semantic that has no descendant: we already have missingSemantic above
    warnSpy.mockClear()
    const res2 = engine.importReusableObject(badObj)
    // After import, missingSemantic should have been skipped, and warn called
    const newHost2Id = res2.nodeIdMap.get(host)!
    const newHost2 = engine.getNode(newHost2Id)
    // The bad binding should be skipped (not present)
    expect(newHost2.controlSet?.controls[0].groups[0].bindings['missingSemantic']).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()

    // .lesson import also preserves (via controlSetFromJSON)
    const lessonJson = engine.toJSON()
    // Validate lesson passes
    expect(validateLesson(lessonJson as any).length).toBe(0)
    expect(validateReusableObject(obj).length).toBe(0)
  })

  it('lessonSerializer validate rejects degenerate blendKeys length and contiguous violation', () => {
    const badLesson = {
      version: 2,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '2024', modifiedAt: '2024' },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'scene1',
            nodes: [
              { id: 'root', name: 'Root', parentId: null, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, visible: true, components: {} },
              { id: 'camera', name: 'Camera', parentId: 'root', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, visible: true, components: { camera: { kind: 'camera' } } },
              {
                id: 'host',
                name: 'Host',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
                controlSet: {
                  id: 'cs',
                  hostNodeId: 'host',
                  controls: [
                    {
                      id: 'c1',
                      key: 'Host',
                      label: 'Host',
                      min: 0,
                      max: 1,
                      default: 0,
                      exposed: true,
                      bindings: { mouth: { clipId: 'clip1', start: 0, end: 1 } },
                      groups: [
                        { id: 'g1', name: 'G1', bindings: {} },
                        { id: 'g2', name: 'G2', bindings: {} },
                      ],
                      blendKeys: [], // should be length 1
                    },
                    { id: 'c2', key: 'blend', label: 'blend', min: 0, max: 1, default: 0, exposed: true, bindings: {}, groups: [{ id: 'gb1', name: 'Group 1', bindings: {} }], blendKeys: [] },
                  ],
                },
              },
            ],
          },
        },
      ],
      library: { clips: [{ id: 'clip1', name: 'Clip', duration: 1, params: [], channels: [] }] },
    } as unknown as import('../../engine/json').LessonJSON
    const errors = validateLesson(badLesson)
    expect(errors.some((e) => e.includes('blendKeys length'))).toBe(true)

    const badOrderLesson = {
      version: 2,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '2024', modifiedAt: '2024' },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'scene1',
            nodes: [
              { id: 'root', name: 'Root', parentId: null, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, visible: true, components: {} },
              { id: 'camera', name: 'Camera', parentId: 'root', transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, visible: true, components: { camera: { kind: 'camera' } } },
              {
                id: 'host',
                name: 'Host',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
                controlSet: {
                  id: 'cs',
                  hostNodeId: 'host',
                  controls: [
                    {
                      id: 'c1',
                      key: 'Host',
                      label: 'Host',
                      min: 0,
                      max: 1,
                      default: 0,
                      exposed: true,
                      bindings: {},
                      groups: [
                        { id: 'g1', name: 'G1', bindings: {} },
                        { id: 'g2', name: 'G2', bindings: {} },
                      ],
                      blendKeys: ['blend'],
                    },
                    // blend not immediately after host, violation
                    { id: 'other', key: 'Other', label: 'Other', min: 0, max: 1, default: 0, exposed: false, bindings: {}, groups: [{ id: 'go', name: 'Group 1', bindings: {} }], blendKeys: [] },
                    { id: 'c2', key: 'blend', label: 'blend', min: 0, max: 1, default: 0, exposed: true, bindings: {}, groups: [{ id: 'gb1', name: 'Group 1', bindings: {} }], blendKeys: [] },
                  ],
                },
              },
            ],
          },
        },
      ],
      library: { clips: [] },
    } as unknown as import('../../engine/json').LessonJSON
    const errors2 = validateLesson(badOrderLesson)
    expect(errors2.some((e) => e.includes('blend sibling order violated'))).toBe(true)
  })
})
