/**
 * Scenario art-pipeline bridge pure seam (issue #466).
 *
 * Client mirror of `backend/app/ai/scenario_art_bridge.py`: scenario visual
 * briefs flow into the existing Generation Workflow Prompt Variant shape,
 * reuse references resolve against Asset Definition names by exact
 * (trimmed, case-insensitive) match. Generation Workflow, Style Profile,
 * Prompt Variant, and Metadata Assistant flows are otherwise unchanged —
 * this module mints no images, makes no model calls, and writes no library
 * rows.
 *
 * No I/O, no engine access — tested at the pure seam.
 */

export interface ScenarioBridgeVisual {
  readonly key: string
  readonly alt: string
  readonly brief?: string
  readonly reuse?: string
  readonly step?: number
}

export interface ScenarioReuseMatch {
  readonly key: string
  readonly alt: string
  readonly reuse: string
  readonly definitionId: string
  readonly definitionName: string
}

export interface ScenarioReuseMiss {
  readonly key: string
  readonly alt: string
  readonly reuse: string
  readonly reason: string
}

export interface ScenarioPromptVariantBrief {
  readonly id: string
  readonly stepId: string
  readonly hint: string
  readonly name: string
  readonly note: string
  readonly styleProfile: { name: string; description: string; promptSuffix: string }
  readonly productionConstraints: string
  readonly providerNote: string
  readonly variants: { detailed: string; concise: string; stylized: string }
  readonly prompt: string
  readonly editable: boolean
  readonly wizardEntry: {
    readonly assetName: string
    readonly note: string
    readonly styleProfile: { name: string; description: string; promptSuffix: string }
    readonly productionConstraints: string
    readonly providerNote: string
  }
}

export const SCENARIO_BRIDGE_STYLE_PROFILE = {
  name: 'Educational Illustration',
  description: 'Clear flat educational art for language lessons',
  promptSuffix: 'flat educational illustration, bold shapes, high contrast',
} as const

export const SCENARIO_BRIDGE_PRODUCTION_CONSTRAINTS =
  'Production constraints: transparent background preferred, centered, ' +
  'single object, no text, no watermark, high resolution, no perspective.'

const CHARACTER_CONSTRAINT_HINT = 'Characters: front-facing, full body.'

export const SCENARIO_BRIDGE_PROVIDER_NOTE =
  'Provider-agnostic: use any general image generation tool ' +
  '(character illustration / icon generation). The editor never generates ' +
  'images itself — copy the prompt to an external tool, import the artwork ' +
  'through the standard upload, then prepare it in the Asset Playground.'

/** Trim, collapse whitespace, lowercase, spaces to hyphens. */
export function normalizeBridgeKey(alt: string): string {
  return (alt || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ /g, '-')
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

/**
 * Resolve each visual's `reuse` against Asset Definition names by exact
 * trimmed case-insensitive match. Visuals without reuse are skipped.
 */
export function resolveScenarioReuse(
  visuals: readonly ScenarioBridgeVisual[],
  definitions: readonly { id: string; name: string }[],
): { matched: ScenarioReuseMatch[]; missing: ScenarioReuseMiss[] } {
  const byName = new Map<string, { id: string; name: string }>()
  for (const def of definitions) {
    const name = clean(def.name)
    if (!name) continue
    const lowered = name.toLowerCase()
    if (!byName.has(lowered)) byName.set(lowered, { id: def.id, name })
  }
  const matched: ScenarioReuseMatch[] = []
  const missing: ScenarioReuseMiss[] = []
  for (const visual of visuals) {
    const reuse = clean(visual.reuse ?? '')
    if (!reuse) continue
    const key = clean(visual.key) || normalizeBridgeKey(clean(visual.alt))
    const alt = clean(visual.alt)
    const hit = byName.get(reuse.toLowerCase())
    if (hit) {
      matched.push({
        key,
        alt,
        reuse,
        definitionId: hit.id,
        definitionName: hit.name,
      })
    } else {
      missing.push({ key, alt, reuse, reason: 'no asset definition with that name' })
    }
  }
  return { matched, missing }
}

/**
 * Seed Generation Workflow Prompt Variants from scenario visual briefs.
 * Only visuals with a non-empty brief and no reuse produce a brief.
 */
export function briefsFromScenarioVisuals(
  visuals: readonly ScenarioBridgeVisual[],
  styleProfile?: { name: string; description: string; promptSuffix: string },
): ScenarioPromptVariantBrief[] {
  const style = styleProfile ? { ...styleProfile } : { ...SCENARIO_BRIDGE_STYLE_PROFILE }
  const out: ScenarioPromptVariantBrief[] = []
  for (const visual of visuals) {
    if (clean(visual.reuse ?? '')) continue
    const brief = clean(visual.brief ?? '')
    if (!brief) continue
    const alt = clean(visual.alt)
    const key = clean(visual.key) || normalizeBridgeKey(alt)
    const stepNum =
      typeof visual.step === 'number' && Number.isFinite(visual.step) ? visual.step : 0
    const stepLabel = stepNum > 0 ? `Step ${stepNum}` : 'Step ?'
    const subject = alt || key
    let constraints = SCENARIO_BRIDGE_PRODUCTION_CONSTRAINTS
    if (/cat|character/i.test(subject)) constraints += ` ${CHARACTER_CONSTRAINT_HINT}`
    const detailed =
      `Create a single ${subject} for a children's language lesson ` +
      `(${style.name}: ${style.promptSuffix}). Visual brief: ${brief}. ${stepLabel}. ` +
      `${constraints}`
    const concise = `${subject}, ${style.name} style, ${brief}`
    const stylized = `${subject} in ${style.name} (${style.promptSuffix}), centered single object, no text`
    const note = `${stepLabel}: ${subject} — ${brief}`
    out.push({
      id: `scenario-brief-${key}`,
      stepId: stepNum > 0 ? `step-${stepNum}` : 'step-?',
      hint: key,
      name: subject,
      note,
      styleProfile: { ...style },
      productionConstraints: constraints,
      providerNote: SCENARIO_BRIDGE_PROVIDER_NOTE,
      variants: { detailed, concise, stylized },
      prompt: detailed,
      editable: true,
      wizardEntry: {
        assetName: subject,
        note,
        styleProfile: { ...style },
        productionConstraints: constraints,
        providerNote: SCENARIO_BRIDGE_PROVIDER_NOTE,
      },
    })
  }
  return out
}
