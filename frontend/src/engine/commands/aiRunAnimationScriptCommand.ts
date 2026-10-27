import type { LessonJSON } from '../json'
import type { Engine } from '../internal'
import { createEngineInternal, toReadOnly } from '../internal'
import { CommandDispatcher } from './dispatcher'
import type { DispatchCommand } from './dispatcher'
import { TransactionCommand } from './transactionCommand'
import { UndoStack } from './undoStack'
import { SetSlideAnimationScriptCommand } from './setSlideAnimationScriptCommand'
import { runAnimationScript } from '../animationScriptRun'
import type { Command } from './command'
import { animationScriptClearCommands } from '../animationScriptClear'
import { measuredNodeSize } from '../../pixi/renderer/nodeMeasurement'
import { collectGlobalAudioAssets } from '../../stores/assetLibraryStore'

export interface AiRunAnimationScriptParameters {
  readonly slideId: string
  readonly source: string
}

export interface AiRunAnimationScriptInverse {
  readonly before: LessonJSON
  readonly after: LessonJSON
  readonly activeSlideId: string | null
}

/** Validated, replace-by-footprint application of a reviewed Animation Script. */
export class AiRunAnimationScriptCommand implements Command<AiRunAnimationScriptInverse> {
  readonly type = 'AiRunAnimationScript'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #source: string

  constructor(input: AiRunAnimationScriptParameters) {
    this.#slideId = input.slideId
    this.#source = input.source
    this.parameters = { slideId: input.slideId, source: input.source }
  }

  validate(engine: Engine): void {
    this.#buildCandidate(engine.toJSON())
  }

  execute(engine: Engine): AiRunAnimationScriptInverse {
    const before = structuredClone(engine.toJSON())
    const activeSlideId = engine.activeSlideId
    const after = this.#buildCandidate(before)
    engine.applyLessonSnapshot(after, activeSlideId)
    return { before, after, activeSlideId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }

  #buildCandidate(source: LessonJSON): LessonJSON {
    const preview = createEngineInternal()
    preview.restoreFromJSON(structuredClone(source))
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(preview, undoStack, () => undefined)
    const dispatchRun = ((command: Command<unknown>) =>
      dispatcher.dispatch(
        new TransactionCommand([
          new SetSlideAnimationScriptCommand({ slideId: this.#slideId, source: this.#source }),
          command,
        ]),
        'ai',
      )) as DispatchCommand
    // Same seams as the Script panel Check: renderer-measured bounds plus
    // global library audio. Without them, reveal/wipe/mark on pre-existing
    // nodes (e.g. marking a carried image from the previous run) report
    // "no visible, measurable renderable content" and block reviewable
    // scripts that Run would accept. Headless callers simply measure null.
    const result = runAnimationScript(
      toReadOnly(preview),
      dispatchRun,
      this.#slideId,
      this.#source,
      {
        measure: measuredNodeSize,
        globalAudioAssets: collectGlobalAudioAssets(),
      },
    )
    if (!result.ran) {
      throw new Error(
        result.error ??
          result.diagnostics.find((entry) => entry.severity === 'error')?.message ??
          'Animation Script is not runnable.',
      )
    }
    return preview.toJSON()
  }
}

/** Deletes a slide's retained Animation Script and the output owned by its footprint. */
export class AiDeleteAnimationScriptCommand implements Command<AiRunAnimationScriptInverse> {
  readonly type = 'AiDeleteAnimationScript'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string

  constructor(input: { readonly slideId: string }) {
    this.#slideId = input.slideId
    this.parameters = { slideId: input.slideId }
  }

  validate(engine: Engine): void {
    this.#buildCandidate(engine.toJSON())
  }

  execute(engine: Engine): AiRunAnimationScriptInverse {
    const before = structuredClone(engine.toJSON())
    const activeSlideId = engine.activeSlideId
    const after = this.#buildCandidate(before)
    engine.applyLessonSnapshot(after, activeSlideId)
    return { before, after, activeSlideId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }

  #buildCandidate(source: LessonJSON): LessonJSON {
    const preview = createEngineInternal()
    preview.restoreFromJSON(structuredClone(source))
    const slide = preview.getSlide(this.#slideId)
    if (!slide.animationScript) throw new Error('This Slide has no Animation Script to delete')
    const emptyFootprint = {
      from: 0,
      to: 0,
      tracks: [],
      placementParents: [],
      instanceNodes: [],
      entryVersions: {},
      createdNodes: [],
      createdDataSources: [],
    }
    const clear = animationScriptClearCommands(
      toReadOnly(preview),
      slide.animationScript.lastCompiled ?? null,
      emptyFootprint,
    )
    const dispatcher = new CommandDispatcher(preview, new UndoStack(), () => undefined)
    const result = dispatcher.dispatch(
      new TransactionCommand([
        ...clear,
        new SetSlideAnimationScriptCommand({ slideId: this.#slideId, source: '' }),
      ]),
      'ai',
    )
    if (!result.ok) throw result.error
    preview.setSlideAnimationScriptFootprint(this.#slideId, null)
    const candidate = preview.toJSON() as LessonJSON
    const slideJson = candidate.slides.find((entry) => entry.id === this.#slideId) as
      (LessonJSON['slides'][number] & { animationScript?: unknown }) | undefined
    if (slideJson) delete slideJson.animationScript
    return candidate
  }
}
