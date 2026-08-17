import { beforeEach, describe, expect, it } from 'vitest'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
  type KeyframeSelectionItem,
} from '../stores/timelineSelectionStore'

beforeEach(() => {
  useTimelineSelectionStore.setState({
    editingContext: 'slide',
    selections: { slide: [], 'clip-edit': [] },
    anchorKeyframeId: { slide: null, 'clip-edit': null },
    marqueeAnchor: null,
  })
})

describe('timelineSelectionStore', () => {
  describe('single selection', () => {
    it('selects a single keyframe, replacing any previous selection', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['k1'])
      expect(useTimelineSelectionStore.getState().anchorKeyframeId.slide).toBe('k1')
    })

    it('selects a keyframe with its temporal position metadata', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1', { time: 1.5, rowIndex: 2 })

      const items = useTimelineSelectionStore.getState().selections.slide
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ keyframeId: 'k1', time: 1.5, rowIndex: 2 })
    })

    it('clears the selection', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().clearSelection()

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])
      expect(useTimelineSelectionStore.getState().anchorKeyframeId.slide).toBeNull()
    })
  })

  describe('Ctrl-click toggle', () => {
    it('adds a keyframe to the selection with Ctrl-click', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().toggleKeyframe('k2')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['k1', 'k2'])
    })

    it('removes a keyframe from the selection with Ctrl-click when already selected', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().toggleKeyframe('k2')
      useTimelineSelectionStore.getState().toggleKeyframe('k1')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['k2'])
    })

    it('toggles the last keyframe off, leaving an empty selection', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().toggleKeyframe('k1')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])
    })
  })

  describe('Shift-click range selection', () => {
    it('selects a range of keyframes between the anchor and the clicked keyframe', () => {
      const items: KeyframeSelectionItem[] = [
        { keyframeId: 'k1', time: 0, rowIndex: 0 },
        { keyframeId: 'k2', time: 1, rowIndex: 1 },
        { keyframeId: 'k3', time: 2, rowIndex: 2 },
        { keyframeId: 'k4', time: 3, rowIndex: 3 },
        { keyframeId: 'k5', time: 4, rowIndex: 4 },
      ]
      useTimelineSelectionStore.getState().selectKeyframe('k1', items[0])

      useTimelineSelectionStore.getState().selectKeyframeRange('k3', items[2], items)

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([
        'k1',
        'k2',
        'k3',
      ])
    })

    it('selects a range in reverse order when clicking before the anchor', () => {
      const items: KeyframeSelectionItem[] = [
        { keyframeId: 'k1', time: 0, rowIndex: 0 },
        { keyframeId: 'k2', time: 1, rowIndex: 1 },
        { keyframeId: 'k3', time: 2, rowIndex: 2 },
        { keyframeId: 'k4', time: 3, rowIndex: 3 },
        { keyframeId: 'k5', time: 4, rowIndex: 4 },
      ]
      useTimelineSelectionStore.getState().selectKeyframe('k4', items[3])

      useTimelineSelectionStore.getState().selectKeyframeRange('k2', items[1], items)

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([
        'k2',
        'k3',
        'k4',
      ])
    })

    it('selects a single keyframe when the anchor and target are the same', () => {
      const items: KeyframeSelectionItem[] = [
        { keyframeId: 'k1', time: 0, rowIndex: 0 },
        { keyframeId: 'k2', time: 1, rowIndex: 1 },
      ]
      useTimelineSelectionStore.getState().selectKeyframe('k1', items[0])

      useTimelineSelectionStore.getState().selectKeyframeRange('k1', items[0], items)

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['k1'])
    })
  })

  describe('editing context scoping', () => {
    it('switches context, preserving each context selection', () => {
      useTimelineSelectionStore.getState().selectKeyframe('slide-k1')
      useTimelineSelectionStore.getState().setEditingContext('clip-edit')
      useTimelineSelectionStore.getState().selectKeyframe('clip-k1')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['clip-k1'])

      useTimelineSelectionStore.getState().setEditingContext('slide')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['slide-k1'])
    })

    it('clears selection in one context without affecting the other', () => {
      useTimelineSelectionStore.getState().selectKeyframe('slide-k1')
      useTimelineSelectionStore.getState().setEditingContext('clip-edit')
      useTimelineSelectionStore.getState().selectKeyframe('clip-k1')

      useTimelineSelectionStore.getState().clearSelection()
      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])

      useTimelineSelectionStore.getState().setEditingContext('slide')
      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['slide-k1'])
    })
  })

  describe('marquee selection', () => {
    it('records the marquee anchor on start', () => {
      useTimelineSelectionStore.getState().marqueeStart(100, 200)

      expect(useTimelineSelectionStore.getState().marqueeAnchor).toEqual({ x: 100, y: 200 })
    })

    it('clears the marquee anchor on end', () => {
      useTimelineSelectionStore.getState().marqueeStart(100, 200)
      useTimelineSelectionStore.getState().marqueeEnd([], [])

      expect(useTimelineSelectionStore.getState().marqueeAnchor).toBeNull()
    })

    it('sets selected keyframe IDs from marquee intersection with real metadata', () => {
      const allItems: KeyframeSelectionItem[] = [
        { keyframeId: 'k1', time: 0, rowIndex: 0 },
        { keyframeId: 'k2', time: 1, rowIndex: 1 },
        { keyframeId: 'k5', time: 4, rowIndex: 4 },
      ]
      useTimelineSelectionStore.getState().marqueeStart(100, 200)
      useTimelineSelectionStore.getState().marqueeEnd(['k2', 'k5'], allItems)

      const items = useTimelineSelectionStore.getState().selections.slide
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ keyframeId: 'k2', time: 1, rowIndex: 1 })
      expect(items[1]).toMatchObject({ keyframeId: 'k5', time: 4, rowIndex: 4 })
      expect(useTimelineSelectionStore.getState().marqueeAnchor).toBeNull()
    })

    it('replaces selection on marquee end (not additive)', () => {
      const allItems: KeyframeSelectionItem[] = [
        { keyframeId: 'k1', time: 0, rowIndex: 0 },
        { keyframeId: 'k3', time: 2, rowIndex: 2 },
        { keyframeId: 'k4', time: 3, rowIndex: 3 },
      ]
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().marqueeStart(100, 200)
      useTimelineSelectionStore.getState().marqueeEnd(['k3', 'k4'], allItems)

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['k3', 'k4'])
    })
  })

  describe('pruning', () => {
    it('removes deleted keyframes from the selection', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().toggleKeyframe('k2')
      useTimelineSelectionStore.getState().toggleKeyframe('k3')

      useTimelineSelectionStore.getState().pruneSelection(new Set(['k1', 'k3']))

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual(['k1', 'k3'])
    })

    it('clears the anchor when the anchor is pruned', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k1')
      useTimelineSelectionStore.getState().pruneSelection(new Set(['k2']))

      expect(useTimelineSelectionStore.getState().anchorKeyframeId.slide).toBeNull()
      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])
    })
  })

  describe('derived state', () => {
    it('selectedKeyframeIds returns the ordered list for the current context', () => {
      useTimelineSelectionStore.getState().selectKeyframe('k3')
      useTimelineSelectionStore.getState().toggleKeyframe('k1')
      useTimelineSelectionStore.getState().toggleKeyframe('k2')

      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([
        'k3',
        'k1',
        'k2',
      ])
    })

    it('selectedKeyframeIds returns empty when no keyframes are selected', () => {
      expect(selectedKeyframeIdsOf(useTimelineSelectionStore.getState())).toEqual([])
    })
  })
})
