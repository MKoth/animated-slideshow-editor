import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TimeSegmentToCollectionModal } from '../components/panels/TimeSegmentToCollectionModal'
import type { SegmentSourceEntry } from '../components/panels/TimeSegmentToCollectionModal'
import type { SegmentCollectionPlan } from '../engine/timeSegmentExtraction'

function entry(
  nodeId: string,
  nodeName: string,
  semanticName: string | undefined,
  time: number,
  keyframeId: string,
): SegmentSourceEntry {
  return {
    nodeId,
    nodeName,
    semanticName,
    paramKey: 'property:positionX',
    paramLabel: 'Position X',
    target: {
      kind: 'node',
      nodeId,
      property: 'positionX',
    } as unknown as SegmentSourceEntry['target'],
    time,
    value: 0 as unknown as SegmentSourceEntry['value'],
    interpolation: 'linear',
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
    keyframeId,
  }
}

const ENTRIES: SegmentSourceEntry[] = [
  entry('nA', 'LeftHand', 'left_hand', 1, 'a1'),
  entry('nA', 'LeftHand', 'left_hand', 2, 'a2'),
  entry('nB', 'RightHand', 'right_hand', 2, 'b1'),
  entry('nB', 'RightHand', 'right_hand', 3, 'b2'),
]

function setupReplace(onConfirm?: (plan: SegmentCollectionPlan) => string | null) {
  const spy = vi.fn(onConfirm ?? (() => null))
  render(
    <TimeSegmentToCollectionModal
      parentNodeId="parent"
      parentName="Rig"
      slideDuration={10}
      existingClipNames={[]}
      entries={ENTRIES}
      clips={[]}
      bakingEvaluator={null}
      onClose={() => {}}
      onConfirm={spy}
      mode="replace"
      replaceCollectionId="col-1"
      replaceCollectionName="Walk"
      initialClipNamesByNode={{ nA: 'Left Clip', nB: 'Right Clip' }}
    />,
  )
  return { spy }
}

describe('TimeSegmentToCollectionModal replace mode', () => {
  it('locks the collection name and pre-fills bound clip names', async () => {
    setupReplace()
    expect(await screen.findByTestId('segment-to-collection-modal')).toHaveAttribute(
      'aria-label',
      'Replace collection from time segment',
    )
    expect(screen.getByTestId('segment-collection-name-fixed').textContent).toMatch(/Walk/)
    expect(screen.getByTestId('segment-collection-name-fixed').textContent).toMatch(/locked/)
    // Bound names pre-filled as "update these clips"
    expect((screen.getByTestId('segment-clipname-nA') as HTMLInputElement).value).toBe('Left Clip')
    expect((screen.getByTestId('segment-clipname-nB') as HTMLInputElement).value).toBe('Right Clip')
    expect(screen.getByTestId('segment-confirm').textContent).toMatch(/Replace/)
  })

  it('passes replaceCollectionId through and shows executor errors inline', async () => {
    const { spy } = setupReplace(() => 'Rebind failed: boom')
    await screen.findByTestId('segment-object-nA')
    fireEvent.click(screen.getByTestId('segment-confirm'))
    expect(spy).toHaveBeenCalledOnce()
    const plan = spy.mock.calls[0]![0] as SegmentCollectionPlan
    expect(plan.replaceCollectionId).toBe('col-1')
    expect(await screen.findByTestId('segment-error')).toHaveTextContent(/boom/)
  })

  it('blocks confirm with a clear message when a semantic name is missing', async () => {
    render(
      <TimeSegmentToCollectionModal
        parentNodeId="parent"
        parentName="Rig"
        slideDuration={10}
        existingClipNames={[]}
        entries={[entry('nA', 'NoSem', undefined, 1, 'a1')]}
        clips={[]}
        bakingEvaluator={null}
        onClose={() => {}}
        onConfirm={() => null}
        mode="replace"
        replaceCollectionId="col-1"
        replaceCollectionName="Walk"
      />,
    )
    await screen.findByTestId('segment-object-nA')
    expect(screen.getByTestId('segment-confirm')).toBeDisabled()
    expect(screen.getByTestId('segment-missing-semantic').textContent).toMatch(
      /Cannot replace.*NoSem/,
    )
  })

  it('seeds the initial range when provided', async () => {
    render(
      <TimeSegmentToCollectionModal
        parentNodeId="parent"
        parentName="Rig"
        slideDuration={10}
        existingClipNames={[]}
        entries={ENTRIES}
        clips={[]}
        bakingEvaluator={null}
        onClose={() => {}}
        onConfirm={() => null}
        mode="replace"
        replaceCollectionId="col-1"
        replaceCollectionName="Walk"
        initialRange={{ from: 1.5, to: 2.5 }}
      />,
    )
    expect((screen.getByTestId('segment-from-input') as HTMLInputElement).value).toBe('1.5')
    expect((screen.getByTestId('segment-to-input') as HTMLInputElement).value).toBe('2.5')
  })
})
