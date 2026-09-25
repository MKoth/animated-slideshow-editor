import type { Command } from './commands'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { ZERO_TANGENT } from './keyframe'
import type { AnimationProperty } from './animationProperties'
import type { InterpolationType, KeyframeTangent } from './keyframe'
import type { KeyframeTarget } from './keyframeTarget'
import type { CompiledFootprint } from './compiledFootprint'
import { lineColumnAt, parseAnimationScript } from './animationScriptParser'
import type {
  BindNode,
  PropertyEntry,
  ScriptProgram,
  SourceSpan,
  StatementNode,
} from './animationScriptParser'
import { DEFAULT_SCRIPT_EASE, SCRIPT_EASE_NAMES, resolveScriptEase } from './animationScriptEase'
import type { ResolvedScriptEase } from './animationScriptEase'
import { formatCandidates, nearMissCandidates } from './animationScriptNearMiss'

/** The property vocabulary a first-cut tween or set may write. */
export const SCRIPT_PROPERTY_NAMES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
  'zIndex',
] as const

export type ScriptProperty = (typeof SCRIPT_PROPERTY_NAMES)[number]

export interface AnimationScriptNodeInfo {
  readonly id: string
  readonly name: string
  readonly isBone: boolean
  readonly isCamera: boolean
}

/**
 * The slide state the compiler reads: node names and kinds plus pre-run
 * evaluated values. Pure and read-only — a Check against this context never
 * touches engine state. The compiler plans every write as a fresh keyframe:
 * the Run clears the previous and new footprints before emitting, so no
 * existing keyframe inside a written track's window survives to be updated.
 */
export interface AnimationScriptCompileContext {
  readonly slideDuration: number
  readonly nodes: readonly AnimationScriptNodeInfo[]
  evaluateProperty(nodeId: string, property: ScriptProperty, time: number): number
}

export interface AnimationScriptDiagnostic {
  readonly severity: 'error' | 'warning'
  readonly message: string
  /** 1-based line in the source. */
  readonly line: number
  /** 1-based column in the source. */
  readonly column: number
  readonly length: number
}

export interface AnimationScriptTrackSummary {
  readonly nodeId: string
  readonly nodeName: string
  readonly property: ScriptProperty
}

export interface AnimationScriptSummary {
  readonly from: number
  readonly to: number
  readonly tracks: readonly AnimationScriptTrackSummary[]
  readonly keyframeCount: number
  readonly instanceCount: number
}

export interface AnimationScriptCompileResult {
  readonly diagnostics: readonly AnimationScriptDiagnostic[]
  /** False when any error diagnostic blocks a prospective run. */
  readonly runnable: boolean
  readonly commands: readonly Command<unknown>[]
  readonly footprint: CompiledFootprint
  readonly summary: AnimationScriptSummary
}

interface BindingInfo {
  readonly alias: string
  readonly aliasSpan: SourceSpan
  readonly nodeId: string
  readonly nodeName: string
  used: boolean
}

interface ValidatedEntry {
  readonly property: ScriptProperty
  readonly value: number
  readonly valueSpan: SourceSpan
}

interface PlannedKeyframe {
  readonly target: KeyframeTarget
  readonly nodeId: string
  readonly nodeName: string
  readonly property: ScriptProperty
  readonly time: number
  readonly order: number
  value: number
  interpolation: InterpolationType
  tangentIn: KeyframeTangent
  tangentOut: KeyframeTangent
}

const TIME_EPSILON = 1e-6

const HOLD_EASE: ResolvedScriptEase = {
  interpolation: 'hold',
  tangentIn: ZERO_TANGENT,
  tangentOut: ZERO_TANGENT,
}

export function compileAnimationScript(
  source: string,
  context: AnimationScriptCompileContext,
): AnimationScriptCompileResult {
  return new Compiler(source, context).compile()
}

class Compiler {
  readonly #source: string
  readonly #context: AnimationScriptCompileContext
  readonly #diagnostics: AnimationScriptDiagnostic[] = []
  readonly #bindings = new Map<string, BindingInfo>()
  readonly #planned = new Map<string, PlannedKeyframe>()
  readonly #trackOrder: AnimationScriptTrackSummary[] = []
  #order = 0
  #cursor = 0
  #from = 0

  constructor(source: string, context: AnimationScriptCompileContext) {
    this.#source = source
    this.#context = context
  }

  compile(): AnimationScriptCompileResult {
    const program = parseAnimationScript(this.#source)
    for (const diagnostic of program.diagnostics) {
      this.#error(diagnostic.message, diagnostic.span)
    }
    this.#applyHeader(program)
    for (const statement of program.statements) {
      if (statement.kind === 'bind') {
        this.#declareBinding(statement)
      } else {
        this.#lowerStatement(statement)
      }
    }
    this.#warnUnusedBindings()
    this.#planBoundaryPins()

    const diagnostics = [...this.#diagnostics].sort(
      (a, b) => a.line - b.line || a.column - b.column,
    )
    const errors = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    const tracks = this.#trackOrder
    const summary: AnimationScriptSummary = {
      from: this.#from,
      to: this.#cursor,
      tracks,
      keyframeCount: this.#planned.size,
      instanceCount: 0,
    }
    const footprint: CompiledFootprint = {
      from: this.#from,
      to: this.#cursor,
      tracks: tracks.map((track) => ({
        nodeId: track.nodeId,
        target: this.#targetFor(track.nodeId, track.property),
      })),
      placementParents: [],
      instanceNodes: [],
      entryVersions: {},
    }
    return {
      diagnostics,
      runnable: !errors,
      commands: errors ? [] : this.#materializeCommands(),
      footprint,
      summary,
    }
  }

  #applyHeader(program: ScriptProgram): void {
    const header = program.header
    if (!header) {
      this.#from = 0
      this.#cursor = 0
      return
    }
    this.#from = roundTime(header.from)
    if (header.from < 0 || header.from >= this.#context.slideDuration) {
      this.#error(
        `"from" must be between 0 and the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        header.fromSpan,
      )
    }
    this.#cursor = this.#from
  }

  #declareBinding(statement: BindNode): void {
    if (this.#bindings.has(statement.alias)) {
      this.#error(`Binding "${statement.alias}" is already declared`, statement.aliasSpan)
      return
    }
    if (statement.resourceKind !== 'node') {
      this.#error(
        `Binding kind "${statement.resourceKind}" is not available yet — use node("Unique Name")`,
        statement.resourceKindSpan,
      )
      return
    }
    const matches = this.#context.nodes.filter((node) => node.name === statement.resourceName)
    if (matches.length === 0) {
      const candidates = nearMissCandidates(
        statement.resourceName,
        this.#context.nodes.map((node) => node.name),
      )
      const suggestion =
        candidates.length > 0 ? ` Did you mean ${formatCandidates(candidates)}?` : ''
      this.#error(
        `No node named "${statement.resourceName}".${suggestion}`,
        statement.resourceNameSpan,
      )
      return
    }
    if (matches.length > 1) {
      this.#error(
        `Node name "${statement.resourceName}" is ambiguous — ${matches.length} nodes share it`,
        statement.resourceNameSpan,
      )
      return
    }
    this.#bindings.set(statement.alias, {
      alias: statement.alias,
      aliasSpan: statement.aliasSpan,
      nodeId: matches[0].id,
      nodeName: matches[0].name,
      used: false,
    })
  }

  #lowerStatement(statement: StatementNode): void {
    const binding = this.#resolveAlias(statement)
    if (!binding) {
      this.#advanceCursorByDeclaredExtent(statement)
      return
    }
    if (statement.method === 'tween') {
      this.#lowerTween(statement, binding)
      return
    }
    if (statement.method === 'set') {
      this.#lowerSet(statement, binding)
      return
    }
    const candidates = nearMissCandidates(statement.method, ['tween', 'set'])
    const suggestion = candidates.length > 0 ? ` Did you mean ${formatCandidates(candidates)}?` : ''
    this.#error(
      `Unknown method "${statement.method}". Available methods: tween and set.${suggestion}`,
      statement.methodSpan,
    )
    this.#advanceCursorByDeclaredExtent(statement)
  }

  #resolveAlias(statement: StatementNode): BindingInfo | null {
    const binding = this.#bindings.get(statement.alias)
    if (binding) {
      binding.used = true
      return binding
    }
    const candidates = nearMissCandidates(statement.alias, [...this.#bindings.keys()])
    const suggestion = candidates.length > 0 ? ` Did you mean ${formatCandidates(candidates)}?` : ''
    this.#error(`Unknown binding "${statement.alias}".${suggestion}`, statement.aliasSpan)
    return null
  }

  #lowerTween(statement: StatementNode, binding: BindingInfo): void {
    const entries = this.#validateEntries(statement, binding)
    const ease = this.#resolveEase(statement)
    if (statement.duration === undefined) {
      this.#error(
        'tween needs a duration — pass one after the property map, like tween({ x: 4 }, 0.4)',
        statement.methodSpan,
      )
      return
    }
    if (entries.length === 0 || ease === null) {
      this.#advanceCursorByDeclaredExtent(statement)
      return
    }
    const duration = statement.duration
    const startTime = this.#cursor
    const endTime = roundTime(startTime + duration)
    if (endTime > this.#context.slideDuration + TIME_EPSILON) {
      this.#error(
        `Statement ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        statement.durationSpan ?? statement.span,
      )
      this.#cursor = endTime
      return
    }
    for (const entry of entries) {
      const entryEase = entry.property === 'zIndex' ? HOLD_EASE : ease
      this.#plan(binding, entry.property, startTime, entryEase, null)
      this.#plan(binding, entry.property, endTime, entryEase, { value: entry.value })
    }
    this.#cursor = endTime
  }

  #lowerSet(statement: StatementNode, binding: BindingInfo): void {
    if (statement.duration !== undefined) {
      this.#error(
        'set does not take a duration — it writes an instant keyframe',
        statement.durationSpan ?? statement.span,
      )
    }
    if (statement.ease !== undefined) {
      this.#error(
        'set does not take an ease — it writes a hold keyframe',
        statement.easeSpan ?? statement.span,
      )
    }
    const entries = this.#validateEntries(statement, binding)
    if (entries.length === 0) {
      return
    }
    const time = this.#cursor
    if (time > this.#context.slideDuration + TIME_EPSILON) {
      this.#error(
        `Statement starts at ${formatSeconds(time)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        statement.span,
      )
      return
    }
    for (const entry of entries) {
      this.#plan(binding, entry.property, time, HOLD_EASE, { value: entry.value })
    }
  }

  #validateEntries(statement: StatementNode, binding: BindingInfo): ValidatedEntry[] {
    const node = this.#context.nodes.find((candidate) => candidate.id === binding.nodeId)
    if (!node) return []
    const entries: ValidatedEntry[] = []
    for (const entry of statement.entries) {
      if (!isScriptProperty(entry.key)) {
        const candidates = nearMissCandidates(entry.key, SCRIPT_PROPERTY_NAMES)
        const suggestion =
          candidates.length > 0 ? ` Did you mean ${formatCandidates(candidates)}?` : ''
        this.#error(
          `Unknown property "${entry.key}". Available properties: ${SCRIPT_PROPERTY_NAMES.join(', ')}.${suggestion}`,
          entry.keySpan,
        )
        continue
      }
      if (!this.#validateValue(entry, node)) continue
      entries.push({ property: entry.key, value: entry.value, valueSpan: entry.valueSpan })
    }
    if (statement.entries.length === 0) {
      this.#error(`${statement.method} needs at least one property`, statement.methodSpan)
    }
    return entries
  }

  #validateValue(entry: PropertyEntry, node: AnimationScriptNodeInfo): boolean {
    if (!Number.isFinite(entry.value)) {
      this.#error(`${entry.key} must be a finite number`, entry.valueSpan)
      return false
    }
    if (entry.key === 'opacity' && (entry.value < 0 || entry.value > 1)) {
      this.#error('opacity must be between 0 and 1', entry.valueSpan)
      return false
    }
    if (entry.key === 'zIndex' && !Number.isInteger(entry.value)) {
      this.#error('zIndex must be a whole number', entry.valueSpan)
      return false
    }
    if (entry.key === 'rotation' && node.isCamera) {
      this.#error('Camera nodes cannot animate rotation', entry.keySpan)
      return false
    }
    if (entry.key === 'opacity' && node.isBone) {
      this.#error('Bone nodes cannot animate opacity', entry.keySpan)
      return false
    }
    return true
  }

  #resolveEase(statement: StatementNode): ResolvedScriptEase | null {
    const name = statement.ease ?? DEFAULT_SCRIPT_EASE
    const ease = resolveScriptEase(name)
    if (ease) return ease
    const candidates = nearMissCandidates(name, SCRIPT_EASE_NAMES)
    const suggestion = candidates.length > 0 ? ` Did you mean ${formatCandidates(candidates)}?` : ''
    this.#error(`Unknown ease "${name}".${suggestion}`, statement.easeSpan ?? statement.methodSpan)
    return null
  }

  #plan(
    binding: ScriptPlanTarget,
    property: ScriptProperty,
    time: number,
    ease: ResolvedScriptEase,
    write: { readonly value: number } | null,
  ): void {
    const slotKey = slotKeyFor(binding.nodeId, property, time)
    const planned = this.#planned.get(slotKey)
    if (planned) {
      if (write) planned.value = write.value
      planned.interpolation = ease.interpolation
      planned.tangentIn = ease.tangentIn
      planned.tangentOut = ease.tangentOut
      return
    }
    const value = write?.value ?? this.#context.evaluateProperty(binding.nodeId, property, time)
    this.#addPlanned({
      nodeId: binding.nodeId,
      nodeName: binding.nodeName,
      property,
      time,
      value,
      ease,
    })
  }

  #addPlanned(input: {
    nodeId: string
    nodeName: string
    property: ScriptProperty
    time: number
    value: number
    ease: ResolvedScriptEase
  }): void {
    const { nodeId, nodeName, property, time, value, ease } = input
    this.#planned.set(slotKeyFor(nodeId, property, time), {
      target: this.#targetFor(nodeId, property),
      nodeId,
      nodeName,
      property,
      time,
      order: this.#order++,
      value,
      interpolation: ease.interpolation,
      tangentIn: ease.tangentIn,
      tangentOut: ease.tangentOut,
    })
    if (!this.#trackOrder.some((track) => track.nodeId === nodeId && track.property === property)) {
      this.#trackOrder.push({ nodeId, nodeName, property })
    }
  }

  #planBoundaryPins(): void {
    for (const track of this.#trackOrder) {
      if (this.#planned.has(slotKeyFor(track.nodeId, track.property, this.#from))) continue
      this.#plan(track, track.property, this.#from, HOLD_EASE, null)
    }
  }

  #warnUnusedBindings(): void {
    for (const binding of this.#bindings.values()) {
      if (!binding.used) {
        this.#warning(`Binding "${binding.alias}" is never used`, binding.aliasSpan)
      }
    }
  }

  #advanceCursorByDeclaredExtent(statement: StatementNode): void {
    if (statement.method === 'tween' && statement.duration !== undefined) {
      this.#cursor = roundTime(this.#cursor + statement.duration)
    }
  }

  #targetFor(nodeId: string, property: ScriptProperty): KeyframeTarget {
    if (property === 'zIndex') {
      return { kind: 'zIndex', nodeId }
    }
    return { kind: 'node', nodeId, property: enginePropertyForScriptProperty(property) }
  }

  #materializeCommands(): Command<unknown>[] {
    const commands: Command<unknown>[] = []
    const entries = [...this.#planned.values()].sort((a, b) => a.order - b.order)
    for (const entry of entries) {
      commands.push(
        new AddKeyframeCommand({
          target: entry.target,
          time: entry.time,
          value: entry.value,
          interpolation: entry.interpolation,
          ...(entry.interpolation === 'bezier'
            ? { tangentIn: entry.tangentIn, tangentOut: entry.tangentOut }
            : {}),
        }),
      )
    }
    return commands
  }

  #error(message: string, span: SourceSpan): void {
    this.#diagnostics.push(this.#diagnostic('error', message, span))
  }

  #warning(message: string, span: SourceSpan): void {
    this.#diagnostics.push(this.#diagnostic('warning', message, span))
  }

  #diagnostic(
    severity: 'error' | 'warning',
    message: string,
    span: SourceSpan,
  ): AnimationScriptDiagnostic {
    const position = lineColumnAt(this.#source, span.start)
    return {
      severity,
      message,
      line: position.line,
      column: position.column,
      length: Math.max(1, span.end - span.start),
    }
  }
}

interface ScriptPlanTarget {
  readonly nodeId: string
  readonly nodeName: string
}

/** Map an author-facing property to the engine property track it animates. */
export function enginePropertyForScriptProperty(
  property: Exclude<ScriptProperty, 'zIndex'>,
): AnimationProperty {
  if (property === 'x') return 'positionX'
  if (property === 'y') return 'positionY'
  return property
}

function isScriptProperty(value: string): value is ScriptProperty {
  return (SCRIPT_PROPERTY_NAMES as readonly string[]).includes(value)
}

function slotKeyFor(nodeId: string, property: ScriptProperty, time: number): string {
  return `${nodeId}|${property}|${roundTime(time).toFixed(6)}`
}

function roundTime(time: number): number {
  return Math.round(time * 1e6) / 1e6
}

function formatSeconds(seconds: number): string {
  return String(roundTime(seconds))
}
