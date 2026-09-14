import { describe, expect, it, vi } from 'vitest'
import {
  createControl,
  createControlSet,
  validateControls,
  controlSetFromJSON,
  controlSetToJSON,
  CONTROL_INTERVAL_MIN_SPAN,
} from '../../engine/control'
import { validateReusableObject } from '../../engine/reusableObject'
import { validate as validateLesson, buildProjectFromJSON } from '../../engine/lessonSerializer'
import { Keyframe } from '../../engine/keyframe'
import {
  createCommandSystem,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
} from '../../engine/commands'

function ok<T>(result: { ok: true; inverse: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error
  return result.inverse
}

describe('Control Interval binding — additive type, tolerant JSON & validator', () => {
  it('Control type supports bindings Record<string, string | {clipId,start,end}>', () => {
    const c = createControl({
      key: 'Mouth.Openness',
      bindings: { mouth: 'clip1', smile: { clipId: 'clip2', start: 0, end: 0.5 } },
    })
    expect(c.bindings.mouth).toBe('clip1')
    expect(c.bindings.smile).toEqual({ clipId: 'clip2', start: 0, end: 0.5 })
  })

  it('legacy string normalizes to {0,1} on load', () => {
    const cs = controlSetFromJSON(
      {
        id: 'cs1',
        hostNodeId: 'node1',
        controls: [
          {
            id: 'c1',
            key: 'Open',
            label: 'Open',
            min: 0,
            max: 1,
            default: 0,
            exposed: true,
            bindings: { target: 'clip1' },
          },
        ],
      },
      'node1',
    )!
    expect(cs.controls[0].bindings.target).toEqual({ clipId: 'clip1', start: 0, end: 1 })
  })

  it('object interval preserved through round-trip', () => {
    const original = createControlSet('host', [
      createControl({
        key: 'Open',
        bindings: {
          a: { clipId: 'clip1', start: 0.2, end: 0.8 },
          b: { clipId: 'clip2', start: 0, end: 1 },
        },
      }),
    ])
    const json = controlSetToJSON(original)
    // ToJSON emits object form even for full-range
    expect(json.controls[0].bindings.a).toEqual({ clipId: 'clip1', start: 0.2, end: 0.8 })
    expect(json.controls[0].bindings.b).toEqual({ clipId: 'clip2', start: 0, end: 1 })
    // string form still accepted on read (legacy file without groups)
    const fromString = controlSetFromJSON(
      {
        id: json.id,
        hostNodeId: json.hostNodeId,
        controls: [
          {
            id: json.controls[0].id,
            key: json.controls[0].key,
            label: json.controls[0].label,
            min: 0,
            max: 1,
            default: 0,
            exposed: true,
            bindings: { a: 'clip1' },
          },
        ],
      },
      'host',
    )!
    expect(fromString.controls[0].bindings.a).toEqual({ clipId: 'clip1', start: 0, end: 1 })
    const roundTripped = controlSetFromJSON(json, 'host')!
    expect(roundTripped.controls[0].bindings.a).toEqual({ clipId: 'clip1', start: 0.2, end: 0.8 })
  })

  it('tolerantly synthesizes [0,1] for old files without start:end', () => {
    const oldJson = {
      version: 2,
      project: {
        id: 'p',
        name: 'P',
        description: '',
        author: '',
        createdAt: '2024',
        modifiedAt: '2024',
      },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'scene1',
            nodes: [
              {
                id: 'root',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'camera',
                name: 'Camera',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
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
                      key: 'Open',
                      label: 'Open',
                      min: 0,
                      max: 1,
                      default: 0,
                      exposed: true,
                      bindings: { mouth: 'clip1' },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      library: {
        clips: [
          {
            id: 'clip1',
            name: 'Clip',
            duration: 1,
            params: [],
            channels: [{ property: 'positionX' }],
            channelAnimations: {
              positionX: {
                keyframes: [
                  { id: 'k1', time: 0, value: 0 },
                  { id: 'k2', time: 1, value: 10 },
                ],
              },
            },
          },
        ],
      },
    }
    const errors = validateLesson(oldJson as unknown as import('../../engine/json').LessonJSON)
    expect(errors).toEqual([])
    const project = buildProjectFromJSON(
      oldJson as unknown as import('../../engine/json').LessonJSON,
    )
    const hostNode = project.slides[0]!.scene.getNode('host')!
    expect(hostNode.controlSet?.controls[0]!.bindings.mouth).toEqual({
      clipId: 'clip1',
      start: 0,
      end: 1,
    })
  })

  it('validator rejects start>=end, span<1e-6, start<0, end>1 with clear error; overlapping allowed', () => {
    expect(() =>
      createControl({ key: 'Open', bindings: { a: { clipId: 'clip1', start: 0.5, end: 0.5 } } }),
    ).toThrow(/start must be < end/)
    expect(() =>
      createControl({ key: 'Open', bindings: { a: { clipId: 'clip1', start: 0.8, end: 0.2 } } }),
    ).toThrow(/start must be < end/)
    expect(() =>
      createControl({ key: 'Open', bindings: { a: { clipId: 'clip1', start: -0.1, end: 0.5 } } }),
    ).toThrow(/start must be >= 0/)
    expect(() =>
      createControl({ key: 'Open', bindings: { a: { clipId: 'clip1', start: 0, end: 1.1 } } }),
    ).toThrow(/end must be <= 1/)
    // span <1e-6
    expect(() =>
      createControl({ key: 'Open', bindings: { a: { clipId: 'clip1', start: 0, end: 5e-7 } } }),
    ).toThrow(/span must be >=/)
    expect(() =>
      createControl({
        key: 'Open',
        bindings: { a: { clipId: 'clip1', start: 0, end: CONTROL_INTERVAL_MIN_SPAN / 2 } },
      }),
    ).toThrow(/span must be >=/)
    // exactly min span allowed
    expect(() =>
      createControl({
        key: 'Open',
        bindings: { a: { clipId: 'clip1', start: 0, end: CONTROL_INTERVAL_MIN_SPAN } },
      }),
    ).not.toThrow()
    // overlapping intervals allowed - two bindings with overlapping [0,0.6] and [0.4,1]
    expect(() =>
      createControl({
        key: 'Open',
        bindings: {
          a: { clipId: 'clip1', start: 0, end: 0.6 },
          b: { clipId: 'clip2', start: 0.4, end: 1 },
        },
      }),
    ).not.toThrow()
    // also validateControls direct
    expect(() =>
      validateControls([
        createControl({ key: 'Open', bindings: { a: { clipId: 'clip1', start: 0, end: 0.6 } } }),
        createControl({ key: 'Other', bindings: { b: { clipId: 'clip2', start: 0.4, end: 1 } } }),
      ]),
    ).not.toThrow()
  })

  it('validateReusableObject rejects degenerate intervals', () => {
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
            id: 'cs',
            hostNodeId: 'root',
            controls: [
              {
                id: 'c1',
                key: 'Open',
                label: 'Open',
                min: 0,
                max: 1,
                default: 0,
                exposed: true,
                bindings: { a: { clipId: 'clip1', start: 0.5, end: 0.5 } },
              },
            ],
          },
        },
      ],
      library: { clips: [{ id: 'clip1', name: 'Clip', duration: 1, params: [], channels: [] }] },
    })
    expect(errors.some((e) => e.includes('start must be < end') || e.includes('span'))).toBe(true)
  })

  it('visible/zIndex bindings rejected in validator and load path as warn-and-skip', () => {
    // validator should reject control clip that animates visible
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
            id: 'cs',
            hostNodeId: 'root',
            controls: [
              {
                id: 'c1',
                key: 'Open',
                label: 'Open',
                min: 0,
                max: 1,
                default: 0,
                exposed: true,
                bindings: { mouth: { clipId: 'clip1', start: 0, end: 1 } },
              },
            ],
          },
        },
      ],
      library: {
        clips: [
          {
            id: 'clip1',
            name: 'Clip',
            duration: 1,
            params: [],
            channels: [],
            visibleAnimation: { keyframes: [{ id: 'k1', time: 0, value: true }] },
          },
        ],
      },
    })
    expect(errors.some((e) => e.includes('cannot animate visible'))).toBe(true)
    // also string binding form
    const errors2 = validateReusableObject({
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
            id: 'cs',
            hostNodeId: 'root',
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
              },
            ],
          },
        },
      ],
      library: {
        clips: [
          {
            id: 'clip1',
            name: 'Clip',
            duration: 1,
            params: [],
            channels: [],
            visibleAnimation: { keyframes: [{ id: 'k1', time: 0, value: true }] },
          },
        ],
      },
    })
    expect(errors2.some((e) => e.includes('cannot animate visible'))).toBe(true)

    // load path warn-and-skip: degenerate interval should not make file unreadable
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cs = controlSetFromJSON(
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
            bindings: {
              good: { clipId: 'clip1', start: 0, end: 1 },
              bad: { clipId: 'clip2', start: 0.5, end: 0.5 },
            },
          },
        ],
      },
      'host',
    )!
    expect(cs.controls[0].bindings.good).toBeDefined()
    expect(cs.controls[0].bindings.bad).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()

    // interval with string normalizes, degenerate string? string with empty clipId is skipped but file stays readable
    const cs2 = controlSetFromJSON(
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
            bindings: { a: 'clip1', b: '' },
          },
        ],
      },
      'host',
    )!
    expect(cs2.controls[0].bindings.a).toEqual({ clipId: 'clip1', start: 0, end: 1 })
    expect(cs2.controls[0].bindings.b).toBeUndefined()
  })

  it('engine seam: tolerant load of old lesson without start:end and strict rejection of degenerate intervals', () => {
    const system = createCommandSystem()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]
    const host = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Host',
        }),
      ),
    )
    const child = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host.nodeId, name: 'Child' }),
      ),
    )
    slide.scene.getNode(child.nodeId)!.semanticName = 'mouth'
    const clip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Clip',
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
          value: 0,
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip.clipId, channel: 'positionX' },
          time: 1,
          value: 100,
        }),
      ),
    )
    // old-style binding via JSON string
    const oldControlSetJson = {
      id: 'cs',
      hostNodeId: host.nodeId,
      controls: [
        {
          id: 'c1',
          key: 'Open',
          label: 'Open',
          min: 0,
          max: 1,
          default: 0,
          exposed: true,
          bindings: { mouth: clip.clipId },
        },
      ],
    }
    const loaded = controlSetFromJSON(oldControlSetJson, host.nodeId)!
    expect(loaded.controls[0].bindings.mouth).toEqual({ clipId: clip.clipId, start: 0, end: 1 })
    // assign to host and evaluate – should drive full range
    slide.scene.getNode(host.nodeId)!.controlSet = loaded
    const anim = slide.animation.ensure(host.nodeId)
    anim.addControl('Open', new Keyframe('k1', 0, 0))
    anim.addControl('Open', new Keyframe('k2', 10, 1))
    // at time 5, control value 0.5 => u 0.5 => position 50
    expect(system.engine.evaluateNode(child.nodeId, 5).transform.x).toBe(50)

    // strict rejection: degenerate interval via createControl should throw
    expect(() =>
      createControl({
        key: 'Bad',
        bindings: { mouth: { clipId: clip.clipId, start: 0.5, end: 0.5 } },
      }),
    ).toThrow()
    // tolerant load: degenerate interval in JSON is skipped, not file fatal
    const degenerateJson = {
      id: 'cs',
      hostNodeId: host.nodeId,
      controls: [
        {
          id: 'c1',
          key: 'Open',
          label: 'Open',
          min: 0,
          max: 1,
          default: 0,
          exposed: true,
          bindings: { mouth: { clipId: clip.clipId, start: 0.5, end: 0.5 } },
        },
      ],
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cs2 = controlSetFromJSON(degenerateJson, host.nodeId)!
    expect(Object.keys(cs2.controls[0].bindings).length).toBe(0)
    warnSpy.mockRestore()
  })

  it('lessonSerializer validate rejects degenerate intervals and still allows file with good bindings', () => {
    const goodLesson = {
      version: 2,
      project: {
        id: 'p',
        name: 'P',
        description: '',
        author: '',
        createdAt: '2024',
        modifiedAt: '2024',
      },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'scene1',
            nodes: [
              {
                id: 'root',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'camera',
                name: 'Camera',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
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
                      key: 'Open',
                      label: 'Open',
                      min: 0,
                      max: 1,
                      default: 0,
                      exposed: true,
                      bindings: { mouth: { clipId: 'clip1', start: 0, end: 0.5 } },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      library: { clips: [{ id: 'clip1', name: 'Clip', duration: 1, params: [], channels: [] }] },
    } as unknown as import('../../engine/json').LessonJSON
    expect(validateLesson(goodLesson)).toEqual([])

    const badLesson = {
      ...goodLesson,
      slides: [
        {
          ...goodLesson.slides[0],
          scene: {
            ...goodLesson.slides[0].scene,
            nodes: [
              goodLesson.slides[0].scene.nodes[0],
              goodLesson.slides[0].scene.nodes[1],
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
                      key: 'Open',
                      label: 'Open',
                      min: 0,
                      max: 1,
                      default: 0,
                      exposed: true,
                      bindings: { mouth: { clipId: 'clip1', start: 0.5, end: 0.5 } },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    } as unknown as import('../../engine/json').LessonJSON
    const errors = validateLesson(badLesson)
    expect(errors.some((e) => e.includes('span') || e.includes('start must be < end'))).toBe(true)
  })
})
