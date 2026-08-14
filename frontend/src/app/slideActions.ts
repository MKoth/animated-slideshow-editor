import type { EnginePublic } from '../engine'
import type { Command, CommandResult, DispatchCommand } from '../engine/commands'
import { MoveSlideCommand, RenameSlideCommand, SetSlideDurationCommand } from '../engine/commands'

export type SlideNotifier = (message: string) => void

export function dispatchSlideCommand<Inverse>(
  dispatch: DispatchCommand,
  command: Command<Inverse>,
  notify: SlideNotifier,
): CommandResult<Inverse> | null {
  const result = dispatch(command)
  if (result && !result.ok) {
    notify(result.error.message)
  }
  return result
}

export function renameSlide(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  name: string,
  notify: SlideNotifier,
): CommandResult<unknown> | null {
  const slide = engine.project?.slides.find((entry) => entry.id === slideId)
  if (!slide || slide.name === name) {
    return null
  }
  return dispatchSlideCommand(dispatch, new RenameSlideCommand({ slideId, name }), notify)
}

export function setSlideDuration(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  duration: number,
  notify: SlideNotifier,
): CommandResult<unknown> | null {
  const slide = engine.project?.slides.find((entry) => entry.id === slideId)
  if (!slide || slide.duration === duration) {
    return null
  }
  return dispatchSlideCommand(dispatch, new SetSlideDurationCommand({ slideId, duration }), notify)
}

export function moveSlide(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  index: number,
  notify: SlideNotifier,
): CommandResult<unknown> | null {
  const exists = engine.project?.slides.some((entry) => entry.id === slideId) ?? false
  if (!exists) {
    return null
  }
  return dispatchSlideCommand(dispatch, new MoveSlideCommand({ slideId, index }), notify)
}
