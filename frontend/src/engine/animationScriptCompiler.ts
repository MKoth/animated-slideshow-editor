import type { Command } from './commands'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { ZERO_TANGENT } from './keyframe'
import type { AnimationProperty } from './animationProperties'
import type { InterpolationType, KeyframeTangent } from './keyframe'
import type { KeyframeTarget } from './keyframeTarget'
import type { CompiledFootprint } from './compiledFootprint'
import { lineColumnAt, parseAnimationScript } from './animationScriptParser'
import type {
  AtNode,
  BindNode,
  DefaultsNode,
  LetNode,
  MarkNode,
  ParallelNode,
  ScriptExpression,
  ScriptProgram,
  ScriptStatementNode,
  SourceSpan,
  StatementNode,
  WaitNode,
} from './animationScriptParser'
import { DEFAULT_SCRIPT_EASE, SCRIPT_EASE_NAMES, resolveScriptEase } from './animationScriptEase'
import type { ResolvedScriptEase } from './animationScriptEase'
import { nearMissSuggestion } from './animationScriptNearMiss'
import {
  SCRIPT_BUILTIN_NAMES,
  describeScriptValue,
  evaluateScriptExpression,
} from './animationScriptExpression'
import type { ScriptExpressionContext, ScriptValue } from './animationScriptExpression'

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
  /** The node's optional Semantic Name tag; `group("...")` collects carriers. */
  readonly semanticName?: string
}

/**
 * The slide state the compiler reads: node names and kinds plus pre-run
 * evaluated values. Pure and read-only — a Check against this context never
 * touches engine state. The compiler plans every write as a fresh keyframe:
 * the Run clears the previous and new footprints before emitting, so no
 * existing keyframe inside a written track's window survives to be updated.
 *
 * `nodes` must be in scene pre-order (`walkPreOrder`): group bindings collect
 * their members in that order, making broadcast writes reproducible.
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

interface ScriptMember {
  readonly nodeId: string
  readonly nodeName: string
}

interface BindingInfo {
  readonly alias: string
  readonly aliasSpan: SourceSpan
  readonly kind: 'node' | 'group'
  /**
   * The binding's targets in scene pre-order. A node binding has exactly one
   * member; a group binding has one per node carrying its Semantic Name, in
   * `walkPreOrder` order. Broadcast writes therefore touch members in a
   * deterministic, documented order and every write is per member.
   */
  readonly members: readonly ScriptMember[]
  used: boolean
}

interface ValidatedEntry {
  readonly property: ScriptProperty
  readonly value: number
  readonly keySpan: SourceSpan
  readonly valueSpan: SourceSpan
}

interface MemberWrite {
  readonly member: ScriptMember
  readonly entries: readonly ValidatedEntry[]
}

interface ResolvedDuration {
  readonly seconds: number
  readonly span: SourceSpan
}

/**
 * How a statement's duration resolved: from the statement, from the header
 * defaults, or not at all. `failed` means the expression already reported an
 * error, so callers must not pile a missing-duration diagnostic on top.
 */
type DurationResolution =
  | ({ readonly kind: 'resolved' } & ResolvedDuration)
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' }

interface ScriptDefaults {
  readonly duration?: ResolvedDuration
  readonly ease?: string
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
  /**
   * `let` values, innermost block last. The top-level scope is always present;
   * `parallel` bodies (and, later, function and loop bodies) push their own.
   */
  readonly #scopes: Map<string, ScriptValue>[] = [new Map()]
  /** Compile-time-only marker labels; never persisted, never a timeline marker. */
  readonly #markers = new Map<string, number>()
  readonly #planned = new Map<string, PlannedKeyframe>()
  readonly #trackOrder: AnimationScriptTrackSummary[] = []
  #order = 0
  #cursor = 0
  #from = 0
  #defaults: ScriptDefaults = {}

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
    this.#applyDefaults(program.defaults)
    for (const statement of program.statements) {
      this.#cursor = this.#lowerStatement(statement, this.#cursor)
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
    const from = this.#evaluateNumber(header.from, 'a start time in seconds')
    if (from === null) {
      this.#from = 0
      this.#cursor = 0
      return
    }
    this.#from = roundTime(from)
    if (this.#from < 0 || this.#from >= this.#context.slideDuration) {
      this.#error(
        `"from" must be between 0 and the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        header.from.span,
      )
    }
    this.#cursor = this.#from
  }

  /**
   * Resolve the header's `defaults { duration, ease }` once, so statements see
   * a clean fallback. An invalid default is reported here and then ignored; a
   * tween left without any duration falls back to its own missing-duration
   * error rather than the invalid default being re-reported per statement.
   */
  #applyDefaults(defaults: DefaultsNode | null): void {
    if (!defaults) return
    let duration: ResolvedDuration | undefined
    if (defaults.duration !== undefined) {
      const seconds = this.#evaluateNumber(defaults.duration, 'a duration in seconds')
      if (seconds !== null && this.#validateDuration(seconds, defaults.duration.span)) {
        duration = { seconds, span: defaults.duration.span }
      }
    }
    let ease: string | undefined
    if (defaults.ease !== undefined && defaults.easeSpan !== undefined) {
      if (resolveScriptEase(defaults.ease)) {
        ease = defaults.ease
      } else {
        const suggestion = nearMissSuggestion(defaults.ease, SCRIPT_EASE_NAMES)
        this.#error(`Unknown ease "${defaults.ease}".${suggestion}`, defaults.easeSpan)
      }
    }
    this.#defaults = { duration, ease }
  }

  #declareBinding(statement: BindNode): void {
    if (this.#bindings.has(statement.alias)) {
      this.#error(`Binding "${statement.alias}" is already declared`, statement.aliasSpan)
      return
    }
    if (this.#lookupValue(statement.alias) !== undefined) {
      this.#error(`Name "${statement.alias}" is already used by a variable`, statement.aliasSpan)
      return
    }
    if (statement.resourceKind === 'node') {
      this.#declareNodeBinding(statement)
      return
    }
    if (statement.resourceKind === 'group') {
      this.#declareGroupBinding(statement)
      return
    }
    this.#error(
      `Binding kind "${statement.resourceKind}" is not available yet — use node("Unique Name") or group("Semantic Name")`,
      statement.resourceKindSpan,
    )
  }

  #declareNodeBinding(statement: BindNode): void {
    const matches = this.#context.nodes.filter((node) => node.name === statement.resourceName)
    if (matches.length === 0) {
      const suggestion = nearMissSuggestion(
        statement.resourceName,
        this.#context.nodes.map((node) => node.name),
      )
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
      kind: 'node',
      members: [{ nodeId: matches[0].id, nodeName: matches[0].name }],
      used: false,
    })
  }

  #declareGroupBinding(statement: BindNode): void {
    const semanticName = statement.resourceName.trim()
    const members = this.#context.nodes
      .filter((node) => node.semanticName?.trim() === semanticName)
      .map((node) => ({ nodeId: node.id, nodeName: node.name }))
    if (members.length === 0) {
      const suggestion = nearMissSuggestion(semanticName, this.#semanticNames())
      this.#error(
        `Group "${semanticName}" resolves to no nodes — no node on this slide carries that Semantic Name.${suggestion}`,
        statement.resourceNameSpan,
      )
      // Register the failed alias so later uses do not cascade a second,
      // redundant "Unknown binding" error onto the resolution error.
      this.#bindings.set(statement.alias, {
        alias: statement.alias,
        aliasSpan: statement.aliasSpan,
        kind: 'group',
        members,
        used: false,
      })
      return
    }
    this.#bindings.set(statement.alias, {
      alias: statement.alias,
      aliasSpan: statement.aliasSpan,
      kind: 'group',
      members,
      used: false,
    })
  }

  /** Distinct Semantic Names on the slide, in scene pre-order. */
  #semanticNames(): string[] {
    const names: string[] = []
    for (const node of this.#context.nodes) {
      const semanticName = node.semanticName?.trim()
      if (semanticName !== undefined && semanticName !== '' && !names.includes(semanticName)) {
        names.push(semanticName)
      }
    }
    return names
  }

  /**
   * Lower one statement starting at `cursor` and return the cursor after it.
   * Every timed operator is expressed this way, so sequential composition is
   * just a fold and `parallel` / `at` can give children their own cursor frame.
   */
  #lowerStatement(statement: ScriptStatementNode, cursor: number): number {
    switch (statement.kind) {
      case 'bind':
        this.#declareBinding(statement)
        return cursor
      case 'let':
        this.#declareLet(statement)
        return cursor
      case 'wait':
        return this.#lowerWait(statement, cursor)
      case 'mark':
        return this.#lowerMark(statement, cursor)
      case 'at':
        return this.#lowerAt(statement, cursor)
      case 'parallel':
        return this.#lowerParallel(statement, cursor)
      case 'statement':
        return this.#lowerCall(statement, cursor)
    }
  }

  #lowerWait(statement: WaitNode, cursor: number): number {
    const duration = this.#evaluateNumber(statement.duration, 'a duration in seconds')
    if (duration === null) return cursor
    if (!this.#validateDuration(duration, statement.duration.span)) return cursor
    const endTime = roundTime(cursor + duration)
    if (endTime > this.#context.slideDuration) {
      this.#error(
        `wait ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        statement.duration.span,
      )
    }
    return endTime
  }

  #lowerMark(statement: MarkNode, cursor: number): number {
    if (this.#markers.has(statement.name)) {
      this.#error(`Marker "${statement.name}" is already declared`, statement.nameSpan)
      return cursor
    }
    this.#markers.set(statement.name, roundTime(cursor))
    return cursor
  }

  #lowerAt(statement: AtNode, cursor: number): number {
    let target: number | null = null
    if (statement.time !== undefined) {
      const seconds = this.#evaluateNumber(statement.time, 'a time in seconds')
      if (seconds === null) return cursor
      target = roundTime(seconds)
      if (target < this.#from) {
        this.#error(
          `"at" cannot be before the segment start (from = ${formatSeconds(this.#from)}s)`,
          statement.time.span,
        )
      } else if (target > this.#context.slideDuration) {
        this.#error(
          `"at" is past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
          statement.time.span,
        )
      }
    } else if (statement.marker !== undefined && statement.markerSpan !== undefined) {
      const marked = this.#markers.get(statement.marker)
      if (marked === undefined) {
        const suggestion = nearMissSuggestion(statement.marker, [...this.#markers.keys()])
        this.#error(
          `Unknown marker "${statement.marker}" — define it with mark("${statement.marker}") before use.${suggestion}`,
          statement.markerSpan,
        )
        // No valid target exists; leave the cursor alone so the summary and
        // footprint do not report keyframes at a time the author never wrote.
        return cursor
      }
      target = marked
    }
    const end = this.#lowerStatement(statement.statement, target ?? cursor)
    return Math.max(cursor, end)
  }

  /**
   * Every child starts at the cursor the group found, in its own frame; the
   * group advances by the latest child end (absolute placements count).
   */
  #lowerParallel(statement: ParallelNode, cursor: number): number {
    this.#scopes.push(new Map())
    let latest = cursor
    try {
      for (const child of statement.body) {
        const end = this.#lowerStatement(child, cursor)
        if (end > latest) latest = end
      }
    } finally {
      this.#scopes.pop()
    }
    return latest
  }

  #lowerCall(statement: StatementNode, cursor: number): number {
    const binding = this.#resolveAlias(statement)
    if (!binding) {
      return this.#advanceCursorByResolvedDuration(statement, cursor)
    }
    if (statement.method === 'tween') {
      return this.#lowerTween(statement, binding, cursor)
    }
    if (statement.method === 'set') {
      return this.#lowerSet(statement, binding, cursor)
    }
    const suggestion = nearMissSuggestion(statement.method, ['tween', 'set'])
    this.#error(
      `Unknown method "${statement.method}". Available methods: tween and set.${suggestion}`,
      statement.methodSpan,
    )
    return this.#advanceCursorByResolvedDuration(statement, cursor)
  }

  #resolveAlias(statement: StatementNode): BindingInfo | null {
    const binding = this.#bindings.get(statement.alias)
    if (binding) {
      binding.used = true
      return binding
    }
    const suggestion = nearMissSuggestion(statement.alias, [...this.#bindings.keys()])
    this.#error(`Unknown binding "${statement.alias}".${suggestion}`, statement.aliasSpan)
    return null
  }

  #lowerTween(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    const duration = this.#resolveDuration(statement)
    if (duration.kind === 'missing') {
      this.#error(
        'tween needs a duration — pass one after the property map, like tween({ x: 4 }, 0.4), or set defaults { duration }',
        statement.methodSpan,
      )
      return cursor
    }
    if (duration.kind === 'failed') {
      return cursor
    }
    if (!this.#validateDuration(duration.seconds, duration.span)) {
      return cursor
    }
    const entries = this.#validateEntries(statement)
    const ease = this.#resolveEase(statement)
    if (entries.length === 0 || ease === null) {
      return roundTime(cursor + duration.seconds)
    }
    const writes = this.#validateMemberWrites(binding, entries)
    if (writes.length === 0) {
      return roundTime(cursor + duration.seconds)
    }
    const startTime = cursor
    const endTime = roundTime(startTime + duration.seconds)
    if (endTime > this.#context.slideDuration) {
      this.#error(
        `Statement ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        duration.span,
      )
      return endTime
    }
    for (const write of writes) {
      for (const entry of write.entries) {
        const entryEase = entry.property === 'zIndex' ? HOLD_EASE : ease
        this.#plan(write.member, entry.property, startTime, entryEase, null)
        this.#plan(write.member, entry.property, endTime, entryEase, { value: entry.value })
      }
    }
    return endTime
  }

  #lowerSet(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    if (statement.duration !== undefined) {
      this.#error(
        'set does not take a duration — it writes an instant keyframe',
        statement.duration.span,
      )
    }
    if (statement.ease !== undefined) {
      this.#error(
        'set does not take an ease — it writes a hold keyframe',
        statement.easeSpan ?? statement.span,
      )
    }
    const entries = this.#validateEntries(statement)
    if (entries.length === 0) {
      return cursor
    }
    const time = cursor
    if (time > this.#context.slideDuration) {
      this.#error(
        `Statement starts at ${formatSeconds(time)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        statement.span,
      )
      return cursor
    }
    for (const write of this.#validateMemberWrites(binding, entries)) {
      for (const entry of write.entries) {
        this.#plan(write.member, entry.property, time, HOLD_EASE, { value: entry.value })
      }
    }
    return cursor
  }

  #validateEntries(statement: StatementNode): ValidatedEntry[] {
    const entries: ValidatedEntry[] = []
    for (const entry of statement.entries) {
      if (!isScriptProperty(entry.key)) {
        const suggestion = nearMissSuggestion(entry.key, SCRIPT_PROPERTY_NAMES)
        this.#error(
          `Unknown property "${entry.key}". Available properties: ${SCRIPT_PROPERTY_NAMES.join(', ')}.${suggestion}`,
          entry.keySpan,
        )
        continue
      }
      if (containsDurationUnit(entry.value)) {
        this.#error(
          `Expected ${entry.key} without a duration suffix, found "${this.#source.slice(entry.value.span.start, entry.value.span.end)}"`,
          entry.value.span,
        )
        continue
      }
      const value = this.#evaluateNumber(entry.value, `a value for ${entry.key}`)
      if (value === null) continue
      const validated: ValidatedEntry = {
        property: entry.key,
        value,
        keySpan: entry.keySpan,
        valueSpan: entry.value.span,
      }
      if (!this.#validateValue(validated)) continue
      entries.push(validated)
    }
    if (statement.entries.length === 0) {
      this.#error(`${statement.method} needs at least one property`, statement.methodSpan)
    }
    return entries
  }

  #validateValue(entry: ValidatedEntry): boolean {
    if (!Number.isFinite(entry.value)) {
      this.#error(`${entry.property} must be a finite number`, entry.valueSpan)
      return false
    }
    if (entry.property === 'opacity' && (entry.value < 0 || entry.value > 1)) {
      this.#error('opacity must be between 0 and 1', entry.valueSpan)
      return false
    }
    if (entry.property === 'zIndex' && !Number.isInteger(entry.value)) {
      this.#error('zIndex must be a whole number', entry.valueSpan)
      return false
    }
    return true
  }

  /**
   * Keep the entries each binding member can take: a group broadcast validates
   * every member independently and names the offending member in capability
   * errors, while a node binding keeps the unqualified wording.
   */
  #validateMemberWrites(binding: BindingInfo, entries: readonly ValidatedEntry[]): MemberWrite[] {
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#context.nodes.find((candidate) => candidate.id === member.nodeId)
      if (!node) continue
      const memberEntries = entries.filter((entry) =>
        this.#validateCapability(entry, node, binding.kind === 'group' ? member.nodeName : null),
      )
      if (memberEntries.length > 0) writes.push({ member, entries: memberEntries })
    }
    return writes
  }

  #validateCapability(
    entry: ValidatedEntry,
    node: AnimationScriptNodeInfo,
    memberName: string | null,
  ): boolean {
    if (entry.property === 'rotation' && node.isCamera) {
      this.#error(
        memberName === null
          ? 'Camera nodes cannot animate rotation'
          : `Member "${memberName}" is a Camera node and cannot animate rotation`,
        entry.keySpan,
      )
      return false
    }
    if (entry.property === 'opacity' && node.isBone) {
      this.#error(
        memberName === null
          ? 'Bone nodes cannot animate opacity'
          : `Member "${memberName}" is a Bone node and cannot animate opacity`,
        entry.keySpan,
      )
      return false
    }
    return true
  }

  #resolveEase(statement: StatementNode): ResolvedScriptEase | null {
    const name = statement.ease ?? this.#defaults.ease ?? DEFAULT_SCRIPT_EASE
    const ease = resolveScriptEase(name)
    if (ease) return ease
    const suggestion = nearMissSuggestion(name, SCRIPT_EASE_NAMES)
    this.#error(`Unknown ease "${name}".${suggestion}`, statement.easeSpan ?? statement.methodSpan)
    return null
  }

  /** A tween's duration: its own argument first, the header defaults second. */
  #resolveDuration(statement: StatementNode): DurationResolution {
    if (statement.duration !== undefined) {
      const seconds = this.#evaluateNumber(statement.duration, 'a duration in seconds')
      if (seconds === null) return { kind: 'failed' }
      return { kind: 'resolved', seconds, span: statement.duration.span }
    }
    if (this.#defaults.duration !== undefined) {
      return { kind: 'resolved', ...this.#defaults.duration }
    }
    return { kind: 'missing' }
  }

  #validateDuration(seconds: number, span: SourceSpan): boolean {
    if (!isValidDuration(seconds)) {
      this.#error('duration must be a non-negative number of seconds', span)
      return false
    }
    return true
  }

  #plan(
    member: ScriptMember,
    property: ScriptProperty,
    time: number,
    ease: ResolvedScriptEase,
    write: { readonly value: number } | null,
  ): void {
    const slotKey = slotKeyFor(member.nodeId, property, time)
    const planned = this.#planned.get(slotKey)
    if (planned) {
      if (write) planned.value = write.value
      planned.interpolation = ease.interpolation
      planned.tangentIn = ease.tangentIn
      planned.tangentOut = ease.tangentOut
      return
    }
    const value = write?.value ?? this.#context.evaluateProperty(member.nodeId, property, time)
    this.#addPlanned({
      nodeId: member.nodeId,
      nodeName: member.nodeName,
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
      // A zero-member group already failed to resolve; do not pile an unused
      // warning on top of the resolution error.
      if (!binding.used && binding.members.length > 0) {
        this.#warning(`Binding "${binding.alias}" is never used`, binding.aliasSpan)
      }
    }
  }

  /**
   * The cursor a tween would have reached had it lowered cleanly. Recovery
   * paths use it so later statements keep sensible times without re-reporting
   * the failure; `set` never advances.
   */
  #advanceCursorByResolvedDuration(statement: StatementNode, cursor: number): number {
    if (statement.method !== 'tween') return cursor
    const duration = this.#resolveDuration(statement)
    if (duration.kind !== 'resolved' || !isValidDuration(duration.seconds)) {
      return cursor
    }
    return roundTime(cursor + duration.seconds)
  }

  /**
   * Declare an immutable `let`. The initializer is evaluated even when the name
   * itself is rejected, so expression errors surface once at their source; a
   * failed initializer binds `invalid` so later uses stay silent.
   */
  #declareLet(statement: LetNode): void {
    let declared = true
    if (this.#bindings.has(statement.name)) {
      this.#error(`Name "${statement.name}" is already used by a binding`, statement.nameSpan)
      declared = false
    } else if (SCRIPT_BUILTIN_NAMES.includes(statement.name)) {
      this.#error(`Name "${statement.name}" is reserved by a built-in`, statement.nameSpan)
      declared = false
    } else if (this.#scopes[this.#scopes.length - 1].has(statement.name)) {
      this.#error(
        `Variable "${statement.name}" is already declared in this block`,
        statement.nameSpan,
      )
      declared = false
    }
    const value = this.#evaluateValue(statement.value)
    if (declared) {
      this.#scopes[this.#scopes.length - 1].set(statement.name, value ?? { kind: 'invalid' })
    }
  }

  #evaluateValue(expression: ScriptExpression): ScriptValue | null {
    return evaluateScriptExpression(expression, this.#expressionContext())
  }

  /**
   * Evaluate an expression in a number position. `null` means the value failed
   * or is not a number; the diagnostic is already reported (or deliberately
   * suppressed for an `invalid` value).
   */
  #evaluateNumber(expression: ScriptExpression, what: string): number | null {
    const value = this.#evaluateValue(expression)
    if (value === null || value.kind === 'invalid') return null
    if (value.kind !== 'number') {
      this.#error(`Expected ${what}, found ${describeScriptValue(value)}`, expression.span)
      return null
    }
    return value.value
  }

  #expressionContext(): ScriptExpressionContext {
    return {
      lookup: (name) => this.#lookupValue(name),
      explain: (name) => {
        if (SCRIPT_BUILTIN_NAMES.includes(name)) {
          return `Built-in "${name}" is a function — call it like ${name}(...)`
        }
        const binding = this.#bindings.get(name)
        if (binding) {
          return `Binding "${name}" is a ${binding.kind} and cannot be used as a value — declare a number with let first`
        }
        return undefined
      },
      suggest: (name) => nearMissSuggestion(name, this.#valueNames()),
      report: (message, span) => this.#error(message, span),
    }
  }

  #lookupValue(name: string): ScriptValue | undefined {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      const value = this.#scopes[index].get(name)
      if (value !== undefined) return value
    }
    return undefined
  }

  /**
   * Declared `let` names, innermost block first, for near-miss suggestions.
   * Ease names join the candidates because a misspelled ease in a positional
   * argument slot arrives here as an unknown name.
   */
  #valueNames(): string[] {
    const names: string[] = []
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      for (const name of this.#scopes[index].keys()) {
        if (!names.includes(name)) names.push(name)
      }
    }
    for (const ease of SCRIPT_EASE_NAMES) {
      if (!names.includes(ease)) names.push(ease)
    }
    return names
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

/**
 * Duration suffixes are a duration-position convenience; a property value that
 * carries one is rejected wherever it sits in the expression.
 */
function containsDurationUnit(expression: ScriptExpression): boolean {
  switch (expression.kind) {
    case 'number':
      return expression.unit !== undefined
    case 'string':
    case 'identifier':
      return false
    case 'list':
      return expression.elements.some(containsDurationUnit)
    case 'unary':
      return containsDurationUnit(expression.operand)
    case 'binary':
      return containsDurationUnit(expression.left) || containsDurationUnit(expression.right)
    case 'call':
      return expression.args.some(containsDurationUnit)
  }
}

function isValidDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0
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
