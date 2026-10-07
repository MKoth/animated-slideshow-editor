/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { Keyframe } from '../engine/keyframe'
import {
  CommandDispatcher,
  CreateClipCommand,
  CreateClipCollectionCommand,
  PlaceCollectionCommand,
  UndoStack,
} from '../engine/commands'
import { noopPersistence } from './contextHarness'

describe('Animation Manager collection content removal', () => {
  it('opens from a collection-lane context menu and removes checked keyframes in the chosen range', () => {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    engine.createProject({ name: 'Project' })
    const slide = engine.createSlide('Slide')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Hand')
    engine.setSemanticName(child.id, 'hand')
    const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
    const clipId = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Hand movement',
          duration: 4,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as any
    ).inverse.clipId as string
    const clip = engine.getClip(clipId)
    clip.addChannelKeyframe('positionX', new Keyframe('at-one', 0.25, 1))
    clip.addChannelKeyframe('positionX', new Keyframe('at-two', 0.5, 2))
    clip.addChannelKeyframe('positionX', new Keyframe('at-three', 0.75, 3))
    const collectionId = (
      dispatcher.dispatch(
        new CreateClipCollectionCommand({ name: 'Rig', bindings: { hand: clipId } }),
      ) as any
    ).inverse.collectionId as string
    const placementId = (
      dispatcher.dispatch(
        new PlaceCollectionCommand({
          collectionId,
          parentNodeId: parent.id,
          startTime: 0,
        }),
      ) as any
    ).inverse.placementId as string
    const contextValue: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    }
    render(
      <EngineContext.Provider value={contextValue}>
        <AnimationManagerModal open parentNodeId={parent.id} onClose={() => undefined} />
      </EngineContext.Provider>,
    )

    const lane = screen.getByTestId(`collection-lane-${placementId}`)
    fireEvent.contextMenu(lane)
    fireEvent.click(screen.getByTestId('collection-lane-remove-content'))
    const modal = screen.getByTestId('remove-collection-content-modal')
    expect(screen.getByTestId('remove-collection-member-hand')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('remove-collection-expand-hand'))
    fireEvent.click(screen.getByTestId('remove-collection-track-hand-channelAnimations:positionX'))
    fireEvent.change(screen.getByTestId('remove-collection-from-input'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('remove-collection-to-input'), { target: { value: '2' } })
    expect(within(modal).getByTestId('remove-collection-summary')).toHaveTextContent('2 keyframes')
    fireEvent.click(screen.getByTestId('remove-collection-confirm'))

    expect(
      engine
        .getClip(clipId)
        .getChannelKeyframes('positionX')
        .map((keyframe) => keyframe.id),
    ).toEqual(['at-three'])
    expect(engine.getClipCollection(collectionId).getBinding('hand')).toBe(clipId)
    expect(screen.queryByTestId('remove-collection-content-modal')).not.toBeInTheDocument()
  })
})
