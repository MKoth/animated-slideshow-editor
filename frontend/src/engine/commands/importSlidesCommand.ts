import { buildProjectFromJSON } from '../lessonSerializer'
import type { Engine } from '../internal'
import type { Command } from './command'
import type {
  ClipCollectionJSON,
  ClipJSON,
  EmbeddedAssetJSON,
  LessonJSON,
  SlideJSON,
} from '../json'
import { validate } from '../lessonSerializer'
import { reconcileMissingAssets } from '../missingAssets'
import {
  cloneJson,
  mergeSlidesIntoLesson,
  type IncomingLibraryJSON,
  type MergeSlidesOutput,
} from '../../ai/assembly'

export interface ImportSlidesParameters {
  readonly slides: readonly SlideJSON[]
  /** Source top-level clips/collections (scope-preserved into target top-level). */
  readonly clips?: readonly ClipJSON[] | null
  readonly clipCollections?: readonly ClipCollectionJSON[] | null
  readonly library?: IncomingLibraryJSON | null
  /** Insertion index in target slides; default append. */
  readonly targetIndex?: number
  /** Legacy slideIds carried for proposal traceability (validated, not executed from). */
  readonly slideIds?: readonly string[]
}

export interface ImportSlidesInverse {
  readonly preMerge: LessonJSON
  readonly postMerge: LessonJSON
  readonly insertedSlideIds: readonly string[]
}

export const IMPORT_SLIDES_FAILED_MESSAGE = 'Assembly merge failed.'

function missingAssetsMessage(
  missing: readonly { assetDefinitionId: string; nodeIds: readonly string[] }[],
  names: readonly string[],
): string {
  const ids = missing.map((entry) => entry.assetDefinitionId).join(', ')
  const who = names.length > 0 ? ` (nodes: ${names.join(', ')})` : ''
  return (
    `assembly merge blocked: ${missing.length} missing asset(s) [${ids}]${who} — ` +
    `embed the WAVs/assets first so the merge references embedded asset ids, then re-validate`
  )
}

/** Live Project shape for the missing-assets check, built without touching the engine. */
function projectForMissingCheck(lesson: LessonJSON): ReturnType<typeof buildProjectFromJSON> {
  return buildProjectFromJSON(cloneJson(lesson))
}

function previewMergeOrThrow(
  engine: Engine,
  input: {
    slides: readonly SlideJSON[]
    clips?: readonly ClipJSON[] | null
    clipCollections?: readonly ClipCollectionJSON[] | null
    library: IncomingLibraryJSON | null
    targetIndex?: number
  },
): MergeSlidesOutput {
  const merged = mergeSlidesIntoLesson({
    target: cloneJson(engine.toJSON()),
    slides: cloneJson([...input.slides]),
    ...(input.clips ? { clips: cloneJson([...input.clips]) } : {}),
    ...(input.clipCollections ? { clipCollections: cloneJson([...input.clipCollections]) } : {}),
    library: input.library ? cloneJson(input.library) : undefined,
    ...(input.targetIndex !== undefined ? { targetIndex: input.targetIndex } : {}),
  })
  const errors = validate(merged.lesson)
  if (errors.length > 0) {
    throw new Error(
      `${IMPORT_SLIDES_FAILED_MESSAGE} lesson validation failed: ${errors.join('; ')} — fix the source project and re-validate`,
    )
  }
  const embeddedIds = new Set(
    ((merged.lesson.library as { assets?: EmbeddedAssetJSON[] } | undefined)?.assets ?? []).map(
      (asset) => asset.id,
    ),
  )
  // Embedded-first: every assetInstance/texture ref must already be embedded
  // in the merged lesson (union-on-id carries them). Global-library-only
  // refs block with a fixable embed-first message.
  const report = reconcileMissingAssets(projectForMissingCheck(merged.lesson), embeddedIds)
  if (report.missing.length > 0) {
    throw new Error(missingAssetsMessage(report.missing, report.names))
  }
  return merged
}

/**
 * Spec 12 assembly merge (issue #428): cross-project slide import as one
 * undoable command. Sources never mutated (deep-cloned); target ordered by
 * targetIndex; collisions first-keeps with ordered numeric suffix (slide
 * names and incoming definition names; node Unique Names untouched
 * per-scene); embedded/material/shader/data-source union-on-id; full
 * id-domain remap; lesson validation plus embedded-first Missing Assets
 * Report gates the merge; no ProjectLoaded stack clear (snapshot apply
 * emits ProjectChanged only); dirty via the normal dispatch path. The
 * active slide is repointed through the engine API as an ambient side
 * effect (never undoable, per CONTEXT.md — one undo restores the project
 * content exactly and keeps a valid active slide).
 */
export class ImportSlidesCommand implements Command<ImportSlidesInverse> {
  readonly type = 'AiImportSlides'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slides: readonly SlideJSON[]
  readonly #clips: readonly ClipJSON[] | null
  readonly #clipCollections: readonly ClipCollectionJSON[] | null
  readonly #library: IncomingLibraryJSON | null
  readonly #targetIndex?: number
  readonly #slideIds?: readonly string[]

  constructor(input: ImportSlidesParameters) {
    if (!Array.isArray(input.slides) || input.slides.length === 0) {
      throw new Error(
        'AiImportSlides needs at least one incoming slide — open the named intro/outro project first',
      )
    }
    this.#slides = input.slides
    this.#clips = input.clips ?? null
    this.#clipCollections = input.clipCollections ?? null
    this.#library = input.library ?? null
    this.#targetIndex = input.targetIndex
    this.#slideIds = input.slideIds
    this.parameters = {
      slides: input.slides,
      ...(input.clips ? { clips: input.clips } : {}),
      ...(input.clipCollections ? { clipCollections: input.clipCollections } : {}),
      ...(input.library ? { library: input.library } : {}),
      ...(typeof input.targetIndex === 'number' ? { targetIndex: input.targetIndex } : {}),
      ...(input.slideIds ? { slideIds: [...input.slideIds] } : {}),
    }
  }

  validate(engine: Engine): void {
    const project = engine.project
    if (!project) throw new Error('No project exists in memory')
    if (this.#slides.length === 0) {
      throw new Error(
        'AiImportSlides needs at least one incoming slide — open the named intro/outro project first',
      )
    }
    const count = project.slides.length
    if (this.#targetIndex !== undefined) {
      if (
        !Number.isInteger(this.#targetIndex) ||
        this.#targetIndex < 0 ||
        this.#targetIndex > count
      ) {
        throw new Error(
          `AiImportSlides targetIndex ${String(this.#targetIndex)} is outside [0, ${count}] — re-validate the proposal`,
        )
      }
    }
    if (this.#slideIds && this.#slideIds.length > 0) {
      const listed = new Set(this.#slideIds)
      for (const [index, slide] of this.#slides.entries()) {
        if (!listed.has(slide.id)) {
          throw new Error(
            `AiImportSlides slide #${index} (${slide.id}) is missing from 'slideIds' — keep the payload and its traceability ids in sync, then re-validate`,
          )
        }
      }
    }
    for (const [index, slide] of this.#slides.entries()) {
      if (!slide || typeof slide !== 'object') {
        throw new Error(`AiImportSlides slide #${index} must be a SlideJSON object`)
      }
      if (typeof slide.id !== 'string' || !slide.id.trim()) {
        throw new Error(`AiImportSlides slide #${index} is missing its id`)
      }
      if (typeof slide.name !== 'string' || !slide.name.trim()) {
        throw new Error(`AiImportSlides slide #${index} is missing its name`)
      }
      const scene = (slide as { scene?: unknown }).scene
      if (
        !scene ||
        typeof scene !== 'object' ||
        !Array.isArray((scene as { nodes?: unknown }).nodes)
      ) {
        throw new Error(
          `AiImportSlides slide #${index} (${slide.id}) has no scene nodes — re-export the source project`,
        )
      }
    }
    // Full lesson + embedded-first missing-assets gate runs against the
    // merged preview so broken merges block before anything executes.
    previewMergeOrThrow(engine, {
      slides: this.#slides,
      clips: this.#clips,
      clipCollections: this.#clipCollections,
      library: this.#library,
      targetIndex: this.#targetIndex,
    })
  }

  execute(engine: Engine): ImportSlidesInverse {
    const preMerge = cloneJson(engine.toJSON())
    // Sources never mutated: merge works on deep clones only.
    const merged = previewMergeOrThrow(engine, {
      slides: this.#slides,
      clips: this.#clips,
      clipCollections: this.#clipCollections,
      library: this.#library,
      targetIndex: this.#targetIndex,
    })
    // Active slide repointed (ambient engine-API side effect, not undoable):
    // first inserted slide when present, else keep current when still valid
    // (the snapshot helper falls back to the first slide).
    const postActiveSlideId = merged.insertedSlideIds[0] ?? engine.activeSlideId
    try {
      engine.applyLessonSnapshot(merged.lesson, postActiveSlideId)
    } catch (error) {
      // Validation failure rolls back fully: snapshot apply either lands the
      // whole merged lesson or throws before mutating (validate-first), and
      // on partial failure restore the exact pre-merge snapshot.
      try {
        engine.applyLessonSnapshot(preMerge, engine.activeSlideId)
      } catch {
        void 0
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
    const postMerge = cloneJson(engine.toJSON())
    return {
      preMerge,
      postMerge,
      insertedSlideIds: [...merged.insertedSlideIds],
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

export type { ClipCollectionJSON, ClipJSON, SlideJSON }
