import { isRecord } from './guards'
import type { LessonJSON } from './json'
import { newId } from './ids'
import { parseScenarioMarkdown } from './scenarioMarkdown'

/**
 * Scenario section seam (issue #460 prefactor, implemented in #461).
 *
 * Small owner for the portable `.lesson` scenario section. Scenario
 * markdown tickets land here plus new scenario modules, without edits
 * inside the current god owners beyond the thin delegation lines in
 * `lessonSerializer.ts` and `projectDuplication.ts`.
 *
 * Shape (per #458 decision, #461 implements doc + versions + bindings;
 * `lastHtml` / `generatedFromVersionId` are optional forward-compatible
 * slots owned by #464; `foreignWords` rides with them as the LLM-detected
 * narrator vocabulary backing HTML highlights):
 * `{ currentMarkdown, versions[] {id, summary, touchedSteps, timestamp, content},
 *    bindings {slug -> assetId}, lastHtml?, generatedFromVersionId?, foreignWords? }`
 * Unknown keys are preserved for forward reads.
 */

/** One append-only version record owning its summary, steps, time, and content. */
export interface ScenarioVersionJSON {
  readonly id: string
  readonly summary: string
  readonly touchedSteps: readonly number[]
  readonly timestamp: string
  readonly content: string
  readonly [key: string]: unknown
}

/** Portable scenario section. Unknown keys are preserved for forward reads. */
export interface ScenarioSectionJSON {
  readonly currentMarkdown: string
  readonly versions: readonly ScenarioVersionJSON[]
  readonly bindings: Readonly<Record<string, string>>
  readonly lastHtml?: string
  readonly generatedFromVersionId?: string | null
  /**
   * LLM-detected foreign words/phrases backing narrator `<strong>` highlights.
   * Stored beside the render so View/Download reuse the same list without
   * another model call; dropped together with the HTML.
   */
  readonly foreignWords?: string[]
  /** Accepted downstream snapshot (issue #466): explicit accept only, never auto-moved by drafts. */
  readonly acceptedVersionId?: string | null
  readonly [key: string]: unknown
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Read the scenario section from a lesson blob, if present. */
export function getScenarioSection(json: LessonJSON): ScenarioSectionJSON | undefined {
  const raw = (json as unknown as Record<string, unknown>).scenario
  if (raw === undefined) return undefined
  if (!isRecord(raw)) return undefined
  return raw as unknown as ScenarioSectionJSON
}

/** Return a lesson blob with the scenario section set or cleared. */
export function setScenarioSection(
  json: LessonJSON,
  section: ScenarioSectionJSON | undefined,
): LessonJSON {
  if (section === undefined) {
    if (!('scenario' in (json as unknown as Record<string, unknown>))) return json
    const clone = { ...(json as unknown as Record<string, unknown>) } as unknown as LessonJSON
    delete (clone as unknown as Record<string, unknown>).scenario
    return clone
  }
  return { ...(json as unknown as Record<string, unknown>), scenario: section } as LessonJSON
}

/**
 * Additive-tolerant validation for the scenario section.
 * Old files without the section pass. Structural shape errors block;
 * markdown content warnings never block (see `parseScenarioMarkdown`).
 */
export function validateScenarioSection(json: unknown, errors: string[]): void {
  if (!isRecord(json)) return
  const raw = (json as Record<string, unknown>).scenario
  if (raw === undefined) return
  if (!isRecord(raw)) {
    errors.push('Lesson scenario must be an object when present')
    return
  }
  if (raw.currentMarkdown !== undefined && typeof raw.currentMarkdown !== 'string') {
    errors.push('Lesson scenario currentMarkdown must be a string')
  }
  if (raw.versions !== undefined) {
    if (!Array.isArray(raw.versions)) {
      errors.push('Lesson scenario versions must be an array')
    } else {
      raw.versions.forEach((entry: unknown, index: number) => {
        if (!isRecord(entry)) {
          errors.push(`Lesson scenario versions[${index}] must be an object`)
          return
        }
        if (typeof entry.id !== 'string' || entry.id === '') {
          errors.push(`Lesson scenario versions[${index}].id must be a non-empty string`)
        }
        if (typeof entry.summary !== 'string') {
          errors.push(`Lesson scenario versions[${index}].summary must be a string`)
        }
        if (
          !Array.isArray(entry.touchedSteps) ||
          !entry.touchedSteps.every((n) => typeof n === 'number' && Number.isFinite(n))
        ) {
          errors.push(`Lesson scenario versions[${index}].touchedSteps must be a number array`)
        }
        if (typeof entry.timestamp !== 'string' || entry.timestamp === '') {
          errors.push(`Lesson scenario versions[${index}].timestamp must be a non-empty string`)
        }
        if (typeof entry.content !== 'string') {
          errors.push(`Lesson scenario versions[${index}].content must be a string`)
        }
      })
    }
  }
  if (raw.bindings !== undefined) {
    if (!isRecord(raw.bindings)) {
      errors.push('Lesson scenario bindings must be an object')
    } else {
      for (const [key, value] of Object.entries(raw.bindings)) {
        if (typeof value !== 'string') {
          errors.push(`Lesson scenario bindings["${key}"] must be a string`)
        }
      }
    }
  }
  if (raw.lastHtml !== undefined && typeof raw.lastHtml !== 'string') {
    errors.push('Lesson scenario lastHtml must be a string when present')
  }
  if (
    raw.generatedFromVersionId !== undefined &&
    raw.generatedFromVersionId !== null &&
    typeof raw.generatedFromVersionId !== 'string'
  ) {
    errors.push('Lesson scenario generatedFromVersionId must be a string or null when present')
  }
  if (raw.foreignWords !== undefined) {
    if (
      !Array.isArray(raw.foreignWords) ||
      !raw.foreignWords.every((entry) => typeof entry === 'string')
    ) {
      errors.push('Lesson scenario foreignWords must be a string array when present')
    }
  }
  if (
    raw.acceptedVersionId !== undefined &&
    raw.acceptedVersionId !== null &&
    typeof raw.acceptedVersionId !== 'string'
  ) {
    errors.push('Lesson scenario acceptedVersionId must be a string or null when present')
  }
}

/** Extract the scenario section for serialization (deep clone, absence preserved). */
export function scenarioSectionToJSON(
  scenario: ScenarioSectionJSON | undefined,
): ScenarioSectionJSON | undefined {
  if (scenario === undefined) return undefined
  return deepClone(scenario)
}

/**
 * Extract the scenario section on import with additive-tolerant defaults.
 * Old files without the section yield undefined; present sections gain
 * defaults for missing fields while preserving unknown keys verbatim.
 */
export function scenarioSectionFromJSON(json: LessonJSON): ScenarioSectionJSON | undefined {
  const raw = getScenarioSection(json)
  if (raw === undefined) return undefined
  const record = raw as unknown as Record<string, unknown>
  const versions = Array.isArray(record.versions)
    ? (deepClone(record.versions) as ScenarioVersionJSON[])
    : []
  const bindings = isRecord(record.bindings)
    ? (deepClone(record.bindings) as Record<string, string>)
    : {}
  return {
    ...deepClone(record),
    currentMarkdown: typeof record.currentMarkdown === 'string' ? record.currentMarkdown : '',
    versions,
    bindings,
  } as ScenarioSectionJSON
}

/** Duplicate the scenario section verbatim (no id remap — history is immutable). */
export function duplicateScenarioSection(
  section: ScenarioSectionJSON | undefined,
): ScenarioSectionJSON | undefined {
  if (section === undefined) return undefined
  return deepClone(section)
}

/** Create an empty project-attached doc, optionally seeded with markdown. */
export function createEmptyScenarioSection(markdown = ''): ScenarioSectionJSON {
  return { currentMarkdown: markdown, versions: [], bindings: {} }
}

/** Mint a new version record (id + timestamp generated, caller supplies content). */
export function createScenarioVersion(
  content: string,
  summary: string,
  touchedSteps: readonly number[],
): ScenarioVersionJSON {
  return {
    id: newId('scenario-version'),
    summary,
    touchedSteps: [...touchedSteps],
    timestamp: new Date().toISOString(),
    content,
  }
}

/** Append a version (never rewrites history); current tracks the new content. */
export function appendScenarioVersion(
  section: ScenarioSectionJSON,
  version: ScenarioVersionJSON,
): ScenarioSectionJSON {
  return {
    ...deepClone(section),
    currentMarkdown: version.content,
    versions: [...section.versions, deepClone(version)],
  } as ScenarioSectionJSON
}

/** Replace the working markdown, preserving versions and bindings. */
export function withScenarioMarkdown(
  section: ScenarioSectionJSON,
  markdown: string,
): ScenarioSectionJSON {
  return { ...deepClone(section), currentMarkdown: markdown } as ScenarioSectionJSON
}

/** Replace the key-to-asset bindings, preserving doc and history. */
export function withScenarioBindings(
  section: ScenarioSectionJSON,
  bindings: Readonly<Record<string, string>>,
): ScenarioSectionJSON {
  return {
    ...deepClone(section),
    bindings: { ...bindings },
  } as ScenarioSectionJSON
}

/**
 * Store the last deterministic chalk render plus its generating-version
 * pointer (issue #464). Manual Generate only; doc edits after generation
 * mark the stored HTML stale via `getScenarioHtmlState` while View still
 * opens the old render. `foreignWords` carries the LLM-detected narrator
 * vocabulary backing the highlight spans; omit it (or pass []) and the
 * render highlights author `**marks**` only.
 */
export function withScenarioHtml(
  section: ScenarioSectionJSON,
  html: string,
  generatedFromVersionId: string | null,
  foreignWords?: readonly string[],
): ScenarioSectionJSON {
  const next: Record<string, unknown> = {
    ...deepClone(section),
    lastHtml: html,
    generatedFromVersionId,
  }
  if (foreignWords !== undefined) next.foreignWords = [...foreignWords]
  return next as unknown as ScenarioSectionJSON
}

/**
 * Granular delete: drop the stored HTML render plus its generating-version
 * pointer while preserving the doc, portable versions, and bindings.
 * The modal keeps this client-only (no server call) — HTML lives purely
 * in the portable section, so doc/history survive untouched.
 */
export function withoutScenarioHtml(section: ScenarioSectionJSON): ScenarioSectionJSON {
  const clone = deepClone(section) as unknown as Record<string, unknown>
  delete clone.lastHtml
  delete clone.foreignWords
  return {
    ...(clone as unknown as ScenarioSectionJSON),
    generatedFromVersionId: null,
  } as ScenarioSectionJSON
}

/**
 * Granular delete: clear the working doc, portable versions, and accepted
 * snapshot while preserving the stored HTML render. The generating version
 * is retained (converted from the server copy when needed) plus the
 * bindings, so the orphaned Preview still re-renders the old content with
 * its images instead of an empty doc — View reads the generating version,
 * never `lastHtml` directly. Extra bindings for absent keys are ignored by
 * the live checklist scan and simply re-apply if a future doc reuses the
 * same key. Pass the pre-clear combined server + portable versions plus the
 * pointer; unknown keys survive verbatim.
 */
export function clearScenarioDocKeepHtml(
  section: ScenarioSectionJSON,
  versions: readonly {
    id: string
    summary?: string
    touchedSteps?: readonly number[]
    timestamp?: string
    content: string
  }[],
  generatedFromVersionId: string | null,
): ScenarioSectionJSON {
  const clone = deepClone(section) as unknown as Record<string, unknown>
  const preserved = generatedFromVersionId
    ? (versions.find((v) => v.id === generatedFromVersionId) ?? null)
    : null
  const keptVersions =
    preserved && preserved.content !== ''
      ? [
          {
            id: preserved.id,
            summary:
              typeof preserved.summary === 'string' && preserved.summary !== ''
                ? preserved.summary
                : 'Preserved HTML source',
            touchedSteps: Array.isArray(preserved.touchedSteps) ? [...preserved.touchedSteps] : [],
            timestamp:
              typeof preserved.timestamp === 'string' && preserved.timestamp !== ''
                ? preserved.timestamp
                : new Date().toISOString(),
            content: preserved.content,
          },
        ]
      : []
  return {
    ...(clone as unknown as ScenarioSectionJSON),
    currentMarkdown: '',
    versions: keptVersions,
    acceptedVersionId: null,
    generatedFromVersionId: preserved && preserved.content !== '' ? preserved.id : null,
  } as ScenarioSectionJSON
}

/**
 * Accepted downstream snapshot (issue #466): explicit accept only.
 * Draft writes (append/withMarkdown) never move it; downstream
 * reconciliation reads this id via `getAcceptedScenarioVersion` or the
 * canonical endpoint, never the active draft — so newer drafts are never
 * silently ignored and unreviewed edits are never consumed.
 */
export function withScenarioAcceptedVersion(
  section: ScenarioSectionJSON,
  acceptedVersionId: string | null,
): ScenarioSectionJSON {
  return {
    ...deepClone(section),
    acceptedVersionId,
  } as ScenarioSectionJSON
}

/** Accepted version record, or undefined when nothing is accepted yet. */
export function getAcceptedScenarioVersion(
  section: ScenarioSectionJSON | undefined,
): ScenarioVersionJSON | undefined {
  if (!section) return undefined
  const acceptedId =
    typeof section.acceptedVersionId === 'string' ? section.acceptedVersionId : null
  if (!acceptedId) return undefined
  return section.versions.find((v) => v.id === acceptedId)
}

/**
 * Downstream gate: resolve the accepted snapshot or throw.
 * Callers block (rather than reading the active draft) when nothing is
 * accepted — mirroring the backend `require_accepted_markdown_version`.
 */
export function requireAcceptedScenarioVersion(
  section: ScenarioSectionJSON | undefined,
): ScenarioVersionJSON {
  const accepted = getAcceptedScenarioVersion(section)
  if (!accepted) {
    throw new Error(
      'No accepted scenario version — accept a version before downstream reconciliation',
    )
  }
  return accepted
}

/** Live scan of normalized asset keys in markdown order (checklist source of truth). */
export function scanScenarioAssetKeys(markdown: string): string[] {
  const parsed = parseScenarioMarkdown(markdown)
  const keys: string[] = []
  for (const step of parsed.steps) {
    for (const visual of step.visuals) {
      if (visual.key === '') continue
      if (!keys.includes(visual.key)) keys.push(visual.key)
    }
  }
  return keys
}

/** Bindings whose asset id resolves to nothing in the available set. */
export function getUnresolvableScenarioBindings(
  section: ScenarioSectionJSON | undefined,
  availableDefinitionIds: ReadonlySet<string>,
): Array<{ readonly key: string; readonly assetId: string }> {
  if (!section) return []
  const out: Array<{ key: string; assetId: string }> = []
  for (const [key, assetId] of Object.entries(section.bindings)) {
    if (typeof assetId !== 'string' || assetId === '') continue
    if (!availableDefinitionIds.has(assetId)) out.push({ key, assetId })
  }
  return out
}
