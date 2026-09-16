import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TimeSegmentToCollectionModal } from '../components/panels/TimeSegmentToCollectionModal'
import type { SegmentSourceEntry } from '../components/panels/TimeSegmentToCollectionModal'
import type { SegmentCollectionPlan } from '../engine/timeSegmentExtraction'
import type { SegmentSourceClip } from '../engine/timeSegmentExtraction'

function entry(
  nodeId: string,
  nodeName: string,
  semanticName: string | undefined,
  paramKey: string,
  paramLabel: string,
  time: number,
  keyframeId: string,
): SegmentSourceEntry {
  const [kind, key] = paramKey.split(':')
  const target =
    kind === 'property'
      ? ({ kind: 'node', nodeId, property: key } as const)
      : ({ kind: 'visible', nodeId } as const)
  return {
    nodeId,
    nodeName,
    semanticName,
    paramKey,
    paramLabel,
    target: target as unknown as SegmentSourceEntry['target'],
    time,
    value: 0 as unknown as SegmentSourceEntry['value'],
    interpolation: 'linear',
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
    keyframeId,
  }
}

const ENTRIES: SegmentSourceEntry[] = [
  entry('nA', 'LeftHand', 'left_hand', 'property:positionX', 'Position X', 1, 'a1'),
  entry('nA', 'LeftHand', 'left_hand', 'property:positionX', 'Position X', 2, 'a2'),
  entry('nA', 'LeftHand', 'left_hand', 'property:positionX', 'Position X', 3, 'a3'),
  entry('nB', 'RightHand', 'right_hand', 'property:positionX', 'Position X', 2, 'b1'),
  entry('nB', 'RightHand', 'right_hand', 'property:positionX', 'Position X', 4, 'b2'),
]

function setup(
  onConfirm?: (plan: SegmentCollectionPlan) => string | null,
  extra?: { entries?: SegmentSourceEntry[]; clips?: SegmentSourceClip[] },
) {
  const confirm = onConfirm ?? (() => null)
  const spy = vi.fn(confirm)
  render(
    <TimeSegmentToCollectionModal
      parentNodeId="parent"
      parentName="Rig"
      slideDuration={10}
      existingClipNames={[]}
      entries={extra?.entries ?? ENTRIES}
      clips={extra?.clips ?? []}
      bakingEvaluator={null}
      onClose={() => {}}
      onConfirm={spy}
    />,
  )
  return { spy }
}

const CLIPS: SegmentSourceClip[] = [
  {
    nodeId: 'nB',
    nodeName: 'RightHand',
    semanticName: 'right_hand',
    instanceId: 'inst1',
    clipId: 'clip1',
    clipName: 'Wave',
    start: 2,
    end: 3,
  },
  {
    nodeId: 'nB',
    nodeName: 'RightHand',
    semanticName: 'right_hand',
    instanceId: 'inst2',
    clipId: 'clip2',
    clipName: 'TooLong',
    start: 4,
    end: 7,
  },
]

describe('TimeSegmentToCollectionModal', () => {
  it('defaults the range to the orphan span and lists both objects', async () => {
    setup()
    expect((screen.getByTestId('segment-from-input') as HTMLInputElement).value).toBe('1')
    expect((screen.getByTestId('segment-to-input') as HTMLInputElement).value).toBe('4')
    expect((screen.getByTestId('segment-length-input') as HTMLInputElement).value).toBe('3')
    expect(await screen.findByTestId('segment-object-nA')).toBeInTheDocument()
    expect(screen.getByTestId('segment-object-nB')).toBeInTheDocument()
    expect((screen.getByTestId('segment-collection-name') as HTMLInputElement).value).toBe(
      'Rig 1.00-4.00s',
    )
    expect(screen.getByTestId('segment-summary').textContent).toMatch(
      /5 keyframe\(s\) · 0 clip\(s\) · 2 object\(s\)/,
    )
  })

  it('keeps From/To/Length in sync', async () => {
    setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.change(screen.getByTestId('segment-length-input'), { target: { value: '1' } })
    expect((screen.getByTestId('segment-to-input') as HTMLInputElement).value).toBe('2')
    fireEvent.change(screen.getByTestId('segment-to-input'), { target: { value: '3' } })
    expect((screen.getByTestId('segment-length-input') as HTMLInputElement).value).toBe('2')
  })

  it('narrows objects when the range shrinks', async () => {
    setup()
    await screen.findByTestId('segment-object-nA')
    // [3,4]: LeftHand keeps t=3, RightHand keeps t=4
    fireEvent.change(screen.getByTestId('segment-from-input'), { target: { value: '3' } })
    expect(screen.getByTestId('segment-object-nA')).toBeInTheDocument()
    expect(screen.getByTestId('segment-object-nB')).toBeInTheDocument()
    // (4,5]: only RightHand's t=4... 4 is below from=4.5 → empty
    fireEvent.change(screen.getByTestId('segment-from-input'), { target: { value: '4.5' } })
    expect(screen.queryByTestId('segment-object-nA')).toBeNull()
    expect(screen.queryByTestId('segment-object-nB')).toBeNull()
    expect(screen.getByTestId('segment-confirm') as HTMLButtonElement).toBeDisabled()
  })

  it('builds one clip per selected object on confirm', async () => {
    const { spy } = setup()
    await screen.findByTestId('segment-object-nA')
    // drop RightHand entirely
    fireEvent.click(screen.getByTestId('segment-object-toggle-nB'))
    fireEvent.click(screen.getByTestId('segment-confirm'))
    expect(spy).toHaveBeenCalledTimes(1)
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.from).toBe(1)
    expect(plan.to).toBe(4)
    expect(plan.parentNodeId).toBe('parent')
    expect(plan.collectionName).toBe('Rig 1.00-4.00s')
    expect(plan.objects).toHaveLength(1)
    expect(plan.objects[0]!.nodeId).toBe('nA')
    expect(plan.objects[0]!.semanticName).toBe('left_hand')
    expect(plan.objects[0]!.clipName).toBe('LeftHand Clip 1')
    expect(plan.objects[0]!.category).toBe('left_hand')
    expect(plan.objects[0]!.keyframes.map((k) => k.keyframeId)).toEqual(['a1', 'a2', 'a3'])
    expect(plan.deleteOrphans).toBe(true)
    expect(plan.keepFirst).toBe(false)
    expect(plan.keepLast).toBe(false)
  })

  it('unchecking a param excludes those keyframes', async () => {
    const { spy } = setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.click(screen.getByTestId('segment-param-nA-property:positionX'))
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.objects.map((o) => o.nodeId)).toEqual(['nB'])
  })

  it('passes delete + keep-first/last options through', async () => {
    const { spy } = setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.click(screen.getByTestId('segment-keep-first'))
    fireEvent.click(screen.getByTestId('segment-keep-last'))
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.deleteOrphans).toBe(true)
    expect(plan.keepFirst).toBe(true)
    expect(plan.keepLast).toBe(true)
  })

  it('disables confirm and warns when an in-range object lacks a semantic name', async () => {
    const bad = ENTRIES.map((e) => (e.nodeId === 'nB' ? { ...e, semanticName: undefined } : e))
    render(
      <TimeSegmentToCollectionModal
        parentNodeId="parent"
        parentName="Rig"
        slideDuration={10}
        existingClipNames={[]}
        entries={bad}
        clips={[]}
        bakingEvaluator={null}
        onClose={() => {}}
        onConfirm={() => null}
      />,
    )
    await screen.findByTestId('segment-object-nB')
    expect(screen.getByTestId('segment-missing-semantic')).toBeInTheDocument()
    expect(screen.getByTestId('segment-confirm') as HTMLButtonElement).toBeDisabled()
  })

  it('surfaces executor errors inline', async () => {
    setup(() => 'Boom: duplicate time')
    await screen.findByTestId('segment-object-nA')
    fireEvent.click(screen.getByTestId('segment-confirm'))
    expect(await screen.findByTestId('segment-error')).toHaveTextContent('Boom: duplicate time')
  })

  it('lists fully-contained clips among checkboxes, hides exceeding ones', async () => {
    setup(undefined, { clips: CLIPS })
    await screen.findByTestId('segment-object-nB')
    // [2,3] fits in default [1,4]; [4,7] ends past To and is hidden
    expect(screen.getByTestId('segment-clip-inst1')).toBeInTheDocument()
    expect(screen.queryByTestId('segment-clip-inst2')).toBeNull()
    expect(screen.getByTestId('segment-summary').textContent).toMatch(/1 clip\(s\)/)
    // widening To to 7 reveals the second clip
    fireEvent.change(screen.getByTestId('segment-to-input'), { target: { value: '7' } })
    expect(await screen.findByTestId('segment-clip-inst2')).toBeInTheDocument()
  })

  it('includes checked clips in the plan instead of minting a clip', async () => {
    const { spy } = setup(undefined, { clips: CLIPS })
    await screen.findByTestId('segment-object-nB')
    // RightHand: drop orphan params, keep the contained clip
    fireEvent.click(screen.getByTestId('segment-param-nB-property:positionX'))
    fireEvent.click(screen.getByTestId('segment-confirm'))
    expect(spy).toHaveBeenCalledTimes(1)
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    const byId = new Map(plan.objects.map((o) => [o.nodeId, o]))
    expect(byId.get('nA')!.keyframes).toHaveLength(3)
    expect(byId.get('nA')!.clips ?? []).toHaveLength(0)
    expect(byId.get('nB')!.keyframes).toHaveLength(0)
    expect(byId.get('nB')!.clips).toHaveLength(1)
    expect(byId.get('nB')!.clips![0]).toMatchObject({
      instanceId: 'inst1',
      clipId: 'clip1',
      start: 2,
      end: 3,
    })
    expect(plan.removeClipInstances).toBe(false)
  })

  it('blocks keyframes + clip on the same object with a conflict message', async () => {
    setup(undefined, { clips: CLIPS })
    await screen.findByTestId('segment-object-nB')
    // defaults: nB params AND clip both checked → conflict
    expect(screen.getByTestId('segment-conflict')).toBeInTheDocument()
    expect(screen.getByTestId('segment-confirm') as HTMLButtonElement).toBeDisabled()
    // resolving one side re-enables
    fireEvent.click(screen.getByTestId('segment-param-nB-property:positionX'))
    expect(screen.queryByTestId('segment-conflict')).toBeNull()
    expect(screen.getByTestId('segment-confirm') as HTMLButtonElement).not.toBeDisabled()
  })

  it('passes removeClipInstances through', async () => {
    const { spy } = setup(undefined, { clips: CLIPS })
    await screen.findByTestId('segment-object-nB')
    fireEvent.click(screen.getByTestId('segment-param-nB-property:positionX'))
    fireEvent.click(screen.getByTestId('segment-remove-instances'))
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.removeClipInstances).toBe(true)
  })

  it('shows clip-only objects with no orphan params', async () => {
    const onlyA = ENTRIES.filter((e) => e.nodeId === 'nA')
    const soloClip: SegmentSourceClip[] = [
      {
        nodeId: 'nC',
        nodeName: 'Head',
        semanticName: 'head',
        instanceId: 'inst9',
        clipId: 'clip9',
        clipName: 'Nod',
        start: 1,
        end: 2,
      },
    ]
    const { spy } = setup(undefined, { entries: onlyA, clips: soloClip })
    await screen.findByTestId('segment-object-nC')
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.objects.map((o) => o.nodeId).sort()).toEqual(['nA', 'nC'])
  })
})

describe('TimeSegmentToCollectionModal baking', () => {
  it('pre-checks bake at the beginning, leaves bake at the end unchecked', async () => {
    setup()
    await screen.findByTestId('segment-object-nA')
    expect(screen.getByTestId('segment-bake-start') as HTMLInputElement).toBeChecked()
    expect(screen.getByTestId('segment-bake-end') as HTMLInputElement).not.toBeChecked()
  })

  it('passes bake flags through to the plan', async () => {
    const { spy } = setup()
    await screen.findByTestId('segment-object-nA')
    // defaults: start on, end off
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.bakeStart).toBe(true)
    expect(plan.bakeEnd).toBe(false)
  })

  it('passes a disabled start and enabled end through', async () => {
    const { spy } = setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.click(screen.getByTestId('segment-bake-start'))
    fireEvent.click(screen.getByTestId('segment-bake-end'))
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.bakeStart).toBe(false)
    expect(plan.bakeEnd).toBe(true)
  })
})

describe('TimeSegmentToCollectionModal master name', () => {
  it('pushes one name to every clip and the collection', async () => {
    const { spy } = setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.change(screen.getByTestId('segment-master-name'), { target: { value: 'Walk' } })
    expect((screen.getByTestId('segment-clipname-nA') as HTMLInputElement).value).toBe('Walk')
    expect((screen.getByTestId('segment-clipname-nB') as HTMLInputElement).value).toBe('Walk')
    expect((screen.getByTestId('segment-collection-name') as HTMLInputElement).value).toBe('Walk')
    fireEvent.click(screen.getByTestId('segment-confirm'))
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.objects.map((o) => o.clipName)).toEqual(['Walk', 'Walk'])
    expect(plan.collectionName).toBe('Walk')
    expect(plan.dedupeClipNames).toBe(false)
  })

  it('individual edits after a master push stick', async () => {
    setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.change(screen.getByTestId('segment-master-name'), { target: { value: 'Walk' } })
    fireEvent.change(screen.getByTestId('segment-clipname-nA'), { target: { value: 'Walk fast' } })
    expect((screen.getByTestId('segment-clipname-nA') as HTMLInputElement).value).toBe('Walk fast')
    expect((screen.getByTestId('segment-clipname-nB') as HTMLInputElement).value).toBe('Walk')
  })

  it('clearing the master field does not blank existing names', async () => {
    setup()
    await screen.findByTestId('segment-object-nA')
    fireEvent.change(screen.getByTestId('segment-master-name'), { target: { value: 'Walk' } })
    fireEvent.change(screen.getByTestId('segment-master-name'), { target: { value: '   ' } })
    expect((screen.getByTestId('segment-clipname-nA') as HTMLInputElement).value).toBe('Walk')
    expect((screen.getByTestId('segment-collection-name') as HTMLInputElement).value).toBe('Walk')
  })
})
