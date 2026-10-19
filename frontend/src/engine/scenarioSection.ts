import { isRecord } from './guards'
import type { LessonJSON } from './json'

/**
 * Scenario section seam (issue #460 prefactor).
 *
 * Small owner for the portable `.lesson` scenario section. Later scenario
 * markdown tickets (notably #461) land here plus new scenario modules,
 * without edits inside the current god owners (`json.ts`,
 * `lessonSerializer.ts`, `internal.ts`, `projectDuplication.ts`).
 *
 * No author-visible behaviour change in this ticket: all helpers are
 * additive-tolerant and pass through unknown shapes. The project model
 * carries no scenario field yet, so serialization currently preserves
 * absence (or verbatim presence on import/duplicate).
 */

/** Portable scenario section. Unknown keys are preserved for forward reads. */
export type ScenarioSectionJSON = Record<string, unknown>

/** Read the scenario section from a lesson blob, if present. */
export function getScenarioSection(json: LessonJSON): ScenarioSectionJSON | undefined {
  const raw = (json as unknown as Record<string, unknown>).scenario
  if (raw === undefined) return undefined
  if (!isRecord(raw)) return undefined
  return raw as ScenarioSectionJSON
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
 * Old files without the section pass; files with a non-object section fail.
 * Present-but-object sections pass through (detailed shape checks land in #461).
 */
export function validateScenarioSection(json: unknown, errors: string[]): void {
  if (!isRecord(json)) return
  const raw = (json as Record<string, unknown>).scenario
  if (raw === undefined) return
  if (!isRecord(raw)) {
    errors.push('Lesson scenario must be an object when present')
  }
}

/** Extract the scenario section for serialization (currently always undefined). */
export function scenarioSectionToJSON(): ScenarioSectionJSON | undefined {
  return undefined
}

/**
 * Extract the scenario section on import. Currently a verbatim passthrough:
 * preserved for duplication, ignored by the project model until #461.
 */
export function scenarioSectionFromJSON(json: LessonJSON): ScenarioSectionJSON | undefined {
  return getScenarioSection(json)
}

/** Duplicate the scenario section verbatim (no id remap — history is immutable). */
export function duplicateScenarioSection(
  section: ScenarioSectionJSON | undefined,
): ScenarioSectionJSON | undefined {
  if (section === undefined) return undefined
  return JSON.parse(JSON.stringify(section)) as ScenarioSectionJSON
}
