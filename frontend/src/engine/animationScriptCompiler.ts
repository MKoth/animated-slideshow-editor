import type { Command } from './commands'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { SetTextContentCommand } from './commands/setTextContentCommand'
import { ZERO_TANGENT } from './keyframe'
import { isDiscreteMaterialKind, isParametricInterpolation } from './keyframe'
import type { AnimationProperty } from './animationProperties'
import type { InterpolationType, KeyframeTangent } from './keyframe'
import type { KeyframeTarget } from './keyframeTarget'
import type { CompiledFootprint } from './compiledFootprint'
import { requireMaterialKeyframeValue } from './materialKeyframes'
import { requireSymmetryKeyframeValue } from './symmetry'
import type { SymmetryKeyframeValue } from './symmetry'
import { requireMorphKeyframeValue } from './shape'
import type { MorphKeyframeValue } from './shape'
import { SHADOW_ALL_PROPERTIES, requireShadowKeyframeValue } from './shadowEffect'
import type { ShadowProperty } from './shadowEffect'
import {
  SCRIPT_METHOD_NAMES,
  SCRIPT_TABLE_SELECTOR_NAMES,
  lineColumnAt,
  parseAnimationScript,
} from './animationScriptParser'
import type {
  AtNode,
  BindNode,
  DefaultsNode,
  LetNode,
  MarkNode,
  MemberExpression,
  ParallelNode,
  PropertyEntry,
  ScriptExpression,
  ScriptProgram,
  ScriptStatementNode,
  SelectorNode,
  SetTextNode,
  SourceSpan,
  StatementNode,
  WaitNode,
} from './animationScriptParser'
import {
  buildScriptTableGrid,
  scriptTableCellAt,
  scriptTableColumnCells,
  scriptTableRowCells,
} from './animationScriptTable'
import type { ScriptTableGrid, ScriptTableGridCell } from './animationScriptTable'
import { DEFAULT_SCRIPT_EASE, SCRIPT_EASE_NAMES, resolveScriptEase } from './animationScriptEase'
import type { ResolvedScriptEase } from './animationScriptEase'
import { nearMissSuggestion } from './animationScriptNearMiss'
import {
  SCRIPT_BUILTIN_NAMES,
  describeScriptValue,
  evaluateScriptExpression,
  isScriptReadBuiltin,
} from './animationScriptExpression'
import type { ScriptExpressionContext, ScriptValue } from './animationScriptExpression'
import { mergeBounds } from './animationScriptReads'
import type { AnimationScriptBoundsRead, AnimationScriptReadSource } from './animationScriptReads'

/** Table styles travel the engine's existing table tracks, not node tracks. */
export const SCRIPT_TABLE_PROPERTY_NAMES = ['borderRadius', 'padding'] as const

export type ScriptTableProperty = (typeof SCRIPT_TABLE_PROPERTY_NAMES)[number]

/** The node-property vocabulary a tween or set may write on any node. */
export const SCRIPT_NODE_PROPERTY_NAMES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
  'zIndex',
] as const

/** Circle properties the write surface exposes; `segments` stays excluded. */
export const SCRIPT_CIRCLE_PROPERTY_NAMES = ['radius', 'startAngle', 'endAngle'] as const

export type ScriptCircleProperty = (typeof SCRIPT_CIRCLE_PROPERTY_NAMES)[number]

/** The base node-property names plus table styles, for legacy diagnostics. */
export const SCRIPT_PROPERTY_NAMES = [
  ...SCRIPT_NODE_PROPERTY_NAMES,
  ...SCRIPT_TABLE_PROPERTY_NAMES,
] as const

export type ScriptProperty = (typeof SCRIPT_PROPERTY_NAMES)[number]

export type ScriptNodeProperty = (typeof SCRIPT_NODE_PROPERTY_NAMES)[number]

/** Names the language reserves for statements rather than bindings. */
export const SCRIPT_RESERVED_NAMES = ['setText'] as const

/**
 * The engine track a script write lands on, resolved by node kind. The
 * compiler never invents a track: every variant lowers to an existing
 * `KeyframeTarget` kind and evaluates through the existing evaluator.
 */
export type ScriptTrack =
  | { readonly kind: 'node'; readonly property: ScriptNodeProperty }
  | { readonly kind: 'parameter'; readonly parameter: string; readonly kindOf: string }
  | { readonly kind: 'circle'; readonly property: ScriptCircleProperty }
  | { readonly kind: 'table'; readonly property: ScriptTableProperty }
  | { readonly kind: 'morph' }
  | { readonly kind: 'symmetry' }
  | { readonly kind: 'shadow'; readonly property: ShadowProperty }
  | { readonly kind: 'dataLabel'; readonly label: string }
  | { readonly kind: 'control'; readonly controlKey: string }

/** A track value in the shape its engine kind stores (Spec 07 / Shadow 04). */
export type ScriptTrackValue =
  number | string | readonly number[] | SymmetryKeyframeValue | MorphKeyframeValue

/**
 * The properties `alias.property` reads at the cursor. `zIndex` and the table
 * styles are write-only in v1, so they stay out of the read vocabulary.
 */
export const SCRIPT_READABLE_PROPERTY_NAMES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
] as const

export type ScriptReadableProperty = (typeof SCRIPT_READABLE_PROPERTY_NAMES)[number]

export function isScriptTableProperty(property: ScriptProperty): property is ScriptTableProperty {
  return (SCRIPT_TABLE_PROPERTY_NAMES as readonly string[]).includes(property)
}

export interface AnimationScriptMaterialParameterInfo {
  readonly key: string
  readonly kind: string
}

export interface AnimationScriptNodeInfo {
  readonly id: string
  readonly name: string
  readonly isBone: boolean
  readonly isCamera: boolean
  /** The node's optional Semantic Name tag; `group("...")` collects carriers. */
  readonly semanticName?: string
  /** The node's parent; absent on the scene root. Table grids walk these links. */
  readonly parentId?: string
  /** The node carries a table component and can be bound with table("..."). */
  readonly isTable?: boolean
  /** The node carries a tableCell component. */
  readonly isTableCell?: boolean
  /** The owning table's declared column count; only meaningful when `isTable`. */
  readonly tableColumnCount?: number
  /** Cell span; only meaningful when `isTableCell`. */
  readonly colSpan?: number
  readonly rowSpan?: number
  /**
   * The node's Controls, for read validation: only exposed Controls are
   * readable, by their stable key.
   */
  readonly controls?: readonly AnimationScriptControlInfo[]
  /**
   * The material parameters a write may address by name: the node's material
   * definition parameters plus the built-ins (tint, opacityMultiplier) the
   * engine always resolves. `sampler2D` never appears.
   */
  readonly materialParameters?: readonly AnimationScriptMaterialParameterInfo[]
  /** The node carries a circle component; `radius`/`startAngle`/`endAngle` write to it. */
  readonly isCircle?: boolean
  /** The node carries a mesh component; `morph` and `symmetry` write to meshes. */
  readonly isMesh?: boolean
  /** The node carries a text component; `setText` writes to text nodes. */
  readonly isText?: boolean
  /** The node is a group host (`isGroupNode`). */
  readonly isGroup?: boolean
  /** The node carries a Shadow Effect; `shadow(...)` writes to its tracks. */
  readonly hasShadowEffect?: boolean
  /** The node's Morph Binding; `morph` writes against its shape pair. */
  readonly morphBinding?: {
    readonly fromShapeId: string | null
    readonly toShapeId: string | null
  } | null
  /** The node's chart data-label names; `dataLabel(...)` resolves against them. */
  readonly dataLabels?: readonly string[]
}

export interface AnimationScriptControlInfo {
  readonly key: string
  readonly exposed: boolean
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
  /**
   * The pre-clear value of any written track at `time`, used for boundary and
   * tween start pins. Evaluates the current scene state and never writes, so
   * Check and Run read identically.
   */
  evaluateTrackValue(nodeId: string, track: ScriptTrack, time: number): ScriptTrackValue
  /**
   * The compile-time read seam. Reads evaluate the current scene state at a
   * time and never write engine state, so Check and Run read identically.
   */
  readonly reads: AnimationScriptReadSource
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
  /**
   * The author-facing track name: a base property (`x`, `zIndex`), a material
   * parameter key, a circle or table property, `morphCoefficient`,
   * `symmetry`, `shadow.<property>` or `dataLabel:<label>`.
   */
  readonly property: string
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
  readonly kind: 'node' | 'group' | 'table'
  /**
   * The binding's targets in scene pre-order. A node or table binding has
   * exactly one member; a group binding has one per node carrying its Semantic
   * Name, in `walkPreOrder` order. Selector-resolved table members follow the
   * grid's engine layout order. Broadcast writes therefore touch members in a
   * deterministic, documented order and every write is per member.
   */
  readonly members: readonly ScriptMember[]
  /** Present only on table bindings: the Grid Slot map selectors resolve against. */
  readonly grid?: ScriptTableGrid
  used: boolean
}

interface ValidatedEntry {
  readonly track: ScriptTrack
  /** The author-facing name this entry resolved from, for diagnostics. */
  readonly property: string
  readonly value: ScriptTrackValue
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
  readonly track: ScriptTrack
  readonly property: string
  readonly time: number
  readonly order: number
  value: ScriptTrackValue
  interpolation: InterpolationType
  tangentIn: KeyframeTangent
  tangentOut: KeyframeTangent
}

interface TrackOrderEntry {
  readonly nodeId: string
  readonly nodeName: string
  readonly property: string
  readonly track: ScriptTrack
}

const HOLD_EASE: ResolvedScriptEase = {
  interpolation: 'hold',
  tangentIn: ZERO_TANGENT,
  tangentOut: ZERO_TANGENT,
}

interface ScriptReadSpec {
  /** The call shape shown in arity diagnostics. */
  readonly shape: string
  readonly minArgs: number
  readonly maxArgs: number
  /** The argument position that is a time, where a duration suffix is legal. */
  readonly timeArgument: number
}

/**
 * The compile-time read vocabulary. One table holds each read's call shape,
 * arity and time-argument position, so arity diagnostics, the duration-suffix
 * rule and the read names cannot drift apart.
 */
const SCRIPT_READ_SPECS: Readonly<Record<string, ScriptReadSpec>> = {
  worldAt: { shape: 'worldAt(target, t?)', minArgs: 1, maxArgs: 2, timeArgument: 1 },
  bounds: { shape: 'bounds(target, t?)', minArgs: 1, maxArgs: 2, timeArgument: 1 },
  cellRect: { shape: 'cellRect(table, row, column, t?)', minArgs: 3, maxArgs: 4, timeArgument: 3 },
  controlValue: { shape: 'controlValue(host, "Key", t?)', minArgs: 2, maxArgs: 3, timeArgument: 2 },
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
  readonly #trackOrder: TrackOrderEntry[] = []
  /** Static `setText` commands with their source order, dispatched inside the run Transaction. */
  readonly #textCommands: { readonly order: number; readonly command: Command<unknown> }[] = []
  /**
   * Values validated once per track shape and value expression, so a group
   * broadcast reports a bad value (or a cached good one) once, not per member.
   */
  readonly #entryValueCache = new Map<string, ScriptTrackValue | null>()
  #order = 0
  #cursor = 0
  /** The statement's own start frame; reads evaluate at this cursor. */
  #readCursor = 0
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
    const summary: AnimationScriptSummary = {
      from: this.#from,
      to: this.#cursor,
      tracks: this.#trackOrder.map((track) => ({
        nodeId: track.nodeId,
        nodeName: track.nodeName,
        property: track.property,
      })),
      keyframeCount: this.#planned.size,
      instanceCount: 0,
    }
    const footprint: CompiledFootprint = {
      from: this.#from,
      to: this.#cursor,
      tracks: this.#trackOrder.map((track) => ({
        nodeId: track.nodeId,
        target: this.#targetFor(track.nodeId, track.track),
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
    if ((SCRIPT_RESERVED_NAMES as readonly string[]).includes(statement.alias)) {
      this.#error(
        `Name "${statement.alias}" is reserved by the Animation Script language`,
        statement.aliasSpan,
      )
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
    if (statement.resourceKind === 'table') {
      this.#declareTableBinding(statement)
      return
    }
    this.#error(
      `Binding kind "${statement.resourceKind}" is not available yet — use node("Unique Name"), group("Semantic Name") or table("Unique Name")`,
      statement.resourceKindSpan,
    )
  }

  /**
   * `table("Unique Name")` binds a table node structurally: the alias itself
   * writes the table node like an ordinary node, while `.cell`, `.row` and
   * `.col` selectors resolve against its Grid Slots.
   */
  #declareTableBinding(statement: BindNode): void {
    const table = this.#resolveUniqueNode(statement)
    if (table === null) return
    if (table.isTable !== true) {
      this.#error(
        `Node "${statement.resourceName}" is not a table — table("...") needs a node with a table component`,
        statement.resourceNameSpan,
      )
      return
    }
    this.#bindings.set(statement.alias, {
      alias: statement.alias,
      aliasSpan: statement.aliasSpan,
      kind: 'table',
      members: [{ nodeId: table.id, nodeName: table.name }],
      grid: buildScriptTableGrid(table, this.#context.nodes),
      used: false,
    })
  }

  #declareNodeBinding(statement: BindNode): void {
    const node = this.#resolveUniqueNode(statement)
    if (node === null) return
    this.#bindings.set(statement.alias, {
      alias: statement.alias,
      aliasSpan: statement.aliasSpan,
      kind: 'node',
      members: [{ nodeId: node.id, nodeName: node.name }],
      used: false,
    })
  }

  /** The one node with the binding's exact Unique Name, or null after reporting. */
  #resolveUniqueNode(statement: BindNode): AnimationScriptNodeInfo | null {
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
      return null
    }
    if (matches.length > 1) {
      this.#error(
        `Node name "${statement.resourceName}" is ambiguous — ${matches.length} nodes share it`,
        statement.resourceNameSpan,
      )
      return null
    }
    return matches[0]
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
    this.#readCursor = cursor
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
      case 'setText':
        return this.#lowerSetText(statement, cursor)
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
    const target = this.#resolveTarget(statement, binding)
    if (!target) {
      return this.#advanceCursorByResolvedDuration(statement, cursor)
    }
    switch (statement.method) {
      case 'tween':
        return this.#lowerTween(statement, target, cursor)
      case 'set':
        return this.#lowerSet(statement, target, cursor)
      case 'shadow':
        return this.#lowerShadow(statement, target, cursor)
      case 'symmetry':
        return this.#lowerSymmetry(statement, target, cursor)
      case 'morph':
        return this.#lowerMorph(statement, target, cursor)
      case 'dataLabel':
        return this.#lowerDataLabel(statement, target, cursor)
      case 'control':
        return this.#lowerControl(statement, target, cursor)
    }
    const suggestion = nearMissSuggestion(statement.method, SCRIPT_METHOD_NAMES)
    this.#error(
      `Unknown method "${statement.method}". Available methods: ${SCRIPT_METHOD_NAMES.join(', ')}.${suggestion}`,
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

  /**
   * Resolve the binding plus any structural table selectors into the target the
   * statement writes. A bare binding writes its own members (the table node for
   * a table binding); `.cell(r, c)` resolves one cell node, while `.row(i)` and
   * `.col(j)` resolve a group of cells in engine layout order.
   */
  #resolveTarget(statement: StatementNode, binding: BindingInfo): BindingInfo | null {
    return this.#resolveSelectors(statement.selectors, binding)
  }

  #resolveSelectors(selectors: readonly SelectorNode[], binding: BindingInfo): BindingInfo | null {
    if (selectors.length === 0) return binding
    if (selectors.length > 1) {
      this.#error('Only one table selector is allowed per statement', selectors[1].span)
      return null
    }
    const selector = selectors[0]
    if (binding.kind !== 'table' || binding.grid === undefined) {
      this.#error(
        `Binding "${binding.alias}" is a ${binding.kind} binding — .cell, .row and .col selectors need a table("...") binding`,
        selector.span,
      )
      return null
    }
    if (selector.name === 'cell') return this.#resolveCellSelector(selector, binding.grid)
    if (selector.name === 'row') return this.#resolveRowSelector(selector, binding.grid)
    if (selector.name === 'col') return this.#resolveColumnSelector(selector, binding.grid)
    const suggestion = nearMissSuggestion(selector.name, SCRIPT_TABLE_SELECTOR_NAMES)
    this.#error(
      `Unknown table selector "${selector.name}". Available selectors: cell, row and col.${suggestion}`,
      selector.nameSpan,
    )
    return null
  }

  #resolveCellSelector(selector: SelectorNode, grid: ScriptTableGrid): BindingInfo | null {
    if (selector.args.length !== 2) {
      this.#error(
        `cell needs a row and a column, like cell(0, 1) — got ${selector.args.length} argument${selector.args.length === 1 ? '' : 's'}`,
        selector.span,
      )
      return null
    }
    const row = this.#resolveSlotIndex(selector.args[0], 'Grid Slot row')
    const column = this.#resolveSlotIndex(selector.args[1], 'Grid Slot column')
    if (row === null || column === null) return null
    const cell = this.#resolveGridSlot(grid, row, column, selector.span)
    if (!cell) return null
    return this.#singleMemberTarget(selector, cell.nodeId, cell.nodeName)
  }

  /** The cell owning a Grid Slot (origin or spanned), or null after reporting. */
  #resolveGridSlot(
    grid: ScriptTableGrid,
    row: number,
    column: number,
    span: SourceSpan,
  ): ScriptTableGridCell | null {
    const cell = scriptTableCellAt(grid, row, column)
    if (cell) return cell
    if (row >= grid.rowCount || column >= grid.columnCount) {
      this.#error(
        `Grid Slot (${row}, ${column}) is out of range for table "${grid.tableName}" — it has ${formatCount(grid.rowCount, 'row')} and ${formatCount(grid.columnCount, 'column')}`,
        span,
      )
    } else {
      this.#error(`Grid Slot (${row}, ${column}) of table "${grid.tableName}" holds no cell`, span)
    }
    return null
  }

  #resolveRowSelector(selector: SelectorNode, grid: ScriptTableGrid): BindingInfo | null {
    return this.#resolveCellGroupSelector(selector, grid, 'row')
  }

  #resolveColumnSelector(selector: SelectorNode, grid: ScriptTableGrid): BindingInfo | null {
    return this.#resolveCellGroupSelector(selector, grid, 'column')
  }

  /**
   * Resolve `row(i)` / `col(j)` into the cells whose origin slot sits in that
   * row/column, in engine layout order. A spanned cell belongs only to its
   * top-left corner's groups, so it is never written twice by a broadcast.
   */
  #resolveCellGroupSelector(
    selector: SelectorNode,
    grid: ScriptTableGrid,
    axis: 'row' | 'column',
  ): BindingInfo | null {
    const label = axis === 'row' ? 'Row' : 'Column'
    const selectorName = axis === 'row' ? 'row' : 'col'
    if (selector.args.length !== 1) {
      this.#error(
        `${selectorName} needs a ${axis} index, like ${selectorName}(0) — got ${selector.args.length} argument${selector.args.length === 1 ? '' : 's'}`,
        selector.span,
      )
      return null
    }
    const index = this.#resolveSlotIndex(selector.args[0], `${label} index`)
    if (index === null) return null
    const cells =
      axis === 'row' ? scriptTableRowCells(grid, index) : scriptTableColumnCells(grid, index)
    if (cells.length === 0) {
      const bound = axis === 'row' ? grid.rowCount : grid.columnCount
      this.#error(
        index >= bound
          ? `${label} ${index} is out of range for table "${grid.tableName}" — it has ${formatCount(bound, axis)}`
          : `${label} ${index} of table "${grid.tableName}" has no cells`,
        selector.span,
      )
      return null
    }
    return {
      alias: selector.name,
      aliasSpan: selector.nameSpan,
      kind: 'group',
      members: cells.map((cell) => ({ nodeId: cell.nodeId, nodeName: cell.nodeName })),
      used: false,
    }
  }

  #singleMemberTarget(selector: SelectorNode, nodeId: string, nodeName: string): BindingInfo {
    return {
      alias: selector.name,
      aliasSpan: selector.nameSpan,
      kind: 'node',
      members: [{ nodeId, nodeName }],
      used: false,
    }
  }

  /** A 0-based Grid Slot coordinate: a whole, non-negative compile-time number. */
  #resolveSlotIndex(expression: ScriptExpression, what: string): number | null {
    const value = this.#evaluateNumber(expression, 'a whole number')
    if (value === null) return null
    if (!Number.isInteger(value) || value < 0) {
      this.#error(`${what} must be a whole number, zero or greater`, expression.span)
      return null
    }
    return value
  }

  #lowerTween(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateWriteEntries(statement, binding),
    )
  }

  /**
   * The shared timed-statement lowering: resolve the duration (statement then
   * header defaults), resolve the ease, validate the member writes, and plan a
   * start pin plus an end keyframe per written track. The cursor advances by
   * the duration even when the writes failed, so later statements keep times.
   */
  #lowerTweenLike(
    statement: StatementNode,
    cursor: number,
    resolveWrites: () => MemberWrite[],
  ): number {
    const duration = this.#resolveDuration(statement)
    if (duration.kind === 'missing') {
      const example =
        statement.args.length > 0
          ? `${statement.method}(..., 0.4)`
          : `${statement.method}({ ... }, 0.4)`
      this.#error(
        `${statement.method} needs a duration — pass one after its values, like ${example}, or set defaults { duration }`,
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
    const ease = this.#resolveEase(statement)
    const writes = resolveWrites()
    const endTime = roundTime(cursor + duration.seconds)
    if (writes.length === 0 || ease === null) {
      return endTime
    }
    if (endTime > this.#context.slideDuration) {
      this.#error(
        `Statement ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        duration.span,
      )
      return endTime
    }
    for (const write of writes) {
      for (const entry of write.entries) {
        const entryEase = this.#resolveEntryEase(entry, ease.ease, ease.name)
        if (entryEase === null) continue
        this.#plan(write.member, entry.track, cursor, entryEase, null)
        this.#plan(write.member, entry.track, endTime, entryEase, { value: entry.value })
      }
    }
    return endTime
  }

  /**
   * Per-track ease: zIndex holds whatever the tween declares, and a discrete
   * material kind rejects parametric eases exactly as the engine's
   * interpolation setter does (its evaluation holds by kind either way).
   */
  #resolveEntryEase(
    entry: ValidatedEntry,
    ease: ResolvedScriptEase,
    easeName: string,
  ): ResolvedScriptEase | null {
    if (entry.track.kind === 'node' && entry.track.property === 'zIndex') {
      return HOLD_EASE
    }
    if (entry.track.kind === 'parameter' && isDiscreteMaterialKind(entry.track.kindOf)) {
      if (isParametricInterpolation(ease.interpolation)) {
        this.#error(
          `Parametric interpolation "${easeName}" is not supported on discrete material kind "${entry.track.kindOf}"`,
          entry.keySpan,
        )
        return null
      }
    }
    if (entry.track.kind === 'control' && isParametricInterpolation(ease.interpolation)) {
      this.#error(
        `Parametric interpolation "${easeName}" is not supported on Control Tracks — use hold, linear or a bezier ease`,
        entry.keySpan,
      )
      return null
    }
    return ease
  }

  #lowerShadow(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateShadowEntries(statement, binding),
    )
  }

  #lowerSymmetry(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateSymmetryEntries(statement, binding),
    )
  }

  #lowerMorph(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateMorphEntries(statement, binding),
    )
  }

  #lowerDataLabel(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateDataLabelEntries(statement, binding),
    )
  }

  /**
   * `alias.control("Key", value, duration?, ease?)`: a Control Track tween on
   * an exposed Control of the host. The value is a 0…1 scalar and the ease is
   * limited to hold/linear/bezier (ADR 0012); a hidden or missing Control is a
   * compile error naming the key. Group targets broadcast per member, each
   * pinned from its own pre-clear value.
   */
  #lowerControl(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateControlEntries(statement, binding),
    )
  }

  /**
   * `setText(alias, "content")`: a static text-content change in the run
   * Transaction. Group targets broadcast to every member; each must be a text
   * node. Never emits a keyframe and never advances the cursor.
   */
  #lowerSetText(statement: SetTextNode, cursor: number): number {
    const target = this.#resolveReadTarget(statement.target, true, 'setText')
    if (!target) return cursor
    const content = this.#evaluateString(statement.content, 'the new text content')
    if (content === null) return cursor
    for (const member of target.members) {
      const node = this.#nodeOf(member)
      if (node?.isText !== true) {
        this.#error(
          target.members.length === 1
            ? `setText needs a text node — "${member.nodeName}" has no text component`
            : `Member "${member.nodeName}" has no text component`,
          statement.span,
        )
        continue
      }
      this.#textCommands.push({
        order: this.#order++,
        command: new SetTextContentCommand({ nodeId: member.nodeId, content }),
      })
    }
    return cursor
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
    const writes = this.#validateWriteEntries(statement, binding)
    if (writes.length === 0) {
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
    for (const write of writes) {
      for (const entry of write.entries) {
        this.#plan(write.member, entry.track, time, HOLD_EASE, { value: entry.value })
      }
    }
    return cursor
  }

  /**
   * Resolve and validate a tween/set record per binding member: each key
   * resolves to exactly one track on that node kind, and each value validates
   * against that track's engine kind.
   */
  #validateWriteEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    if (statement.entries.length === 0) {
      this.#error(`${statement.method} needs at least one property`, statement.methodSpan)
      return []
    }
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      const entries: ValidatedEntry[] = []
      for (const entry of statement.entries) {
        const validated = this.#resolveWriteEntry(entry, node, memberName)
        if (validated) entries.push(validated)
      }
      if (entries.length > 0) writes.push({ member, entries })
    }
    return writes
  }

  /**
   * One record entry on one member: resolve the key to its single track, then
   * coerce the expression to that track's value shape. The value is checked
   * once per (track shape, expression) so a broadcast reports it once.
   */
  #resolveWriteEntry(
    entry: PropertyEntry,
    node: AnimationScriptNodeInfo,
    memberName: string | null,
  ): ValidatedEntry | null {
    if (containsDurationUnit(entry.value)) {
      this.#error(
        `Expected ${entry.key} without a duration suffix, found "${this.#source.slice(entry.value.span.start, entry.value.span.end)}"`,
        entry.value.span,
      )
      return null
    }
    const material = node.materialParameters?.find((parameter) => parameter.key === entry.key)
    const reserved = reservedTrackForKey(entry.key)
    if (reserved !== null && 'error' in reserved) {
      this.#error(reserved.error, entry.keySpan)
      return null
    }
    if (reserved !== null) {
      if (material) {
        return this.#ambiguousKey(entry, node, reserved.track)
      }
      if (reserved.track.kind === 'morph') {
        return this.#resolveMorphPropertyEntry(entry, node, memberName)
      }
      const value = this.#cachedTrackValue(entry.value, reserved.track, memberName)
      if (value === null) return null
      if (
        !this.#validateTrackCapability(reserved.track, node, entry.key, memberName, entry.keySpan)
      ) {
        return null
      }
      return {
        track: reserved.track,
        property: this.#trackLabel(reserved.track),
        value,
        keySpan: entry.keySpan,
        valueSpan: entry.value.span,
      }
    }
    if (!material) {
      const available = this.#availableKeyNames(node)
      const suggestion = nearMissSuggestion(entry.key, available)
      this.#error(
        `Unknown property "${entry.key}". Available properties: ${available.join(', ')}.${suggestion}`,
        entry.keySpan,
      )
      return null
    }
    if (material.kind === 'bool') {
      this.#error(
        `"${entry.key}" is a boolean material parameter and the Animation Script language has no boolean values`,
        entry.keySpan,
      )
      return null
    }
    if (material.kind === 'sampler2D') {
      this.#error(`"${entry.key}" is a texture parameter and cannot be animated`, entry.keySpan)
      return null
    }
    const track: ScriptTrack = { kind: 'parameter', parameter: entry.key, kindOf: material.kind }
    const value = this.#cachedTrackValue(entry.value, track, memberName)
    if (value === null) return null
    return {
      track,
      property: this.#trackLabel(track),
      value,
      keySpan: entry.keySpan,
      valueSpan: entry.value.span,
    }
  }

  /**
   * A key that is both reserved vocabulary and a material parameter has two
   * meanings; the write is rejected by name so every write has one target.
   */
  #ambiguousKey(entry: PropertyEntry, node: AnimationScriptNodeInfo, reserved: ScriptTrack): null {
    this.#error(
      `Property "${entry.key}" is ambiguous on "${node.name}" — it could mean ${describeReservedTrack(reserved)} and the material parameter. Rename one of them so the write has one meaning.`,
      entry.keySpan,
    )
    return null
  }

  /** `{ x: 1, morphCoefficient: 0.5 }`: the coefficient against the node's binding. */
  #resolveMorphPropertyEntry(
    entry: PropertyEntry,
    node: AnimationScriptNodeInfo,
    memberName: string | null,
  ): ValidatedEntry | null {
    const cacheKey = `morphCoefficient|${entry.value.span.start}-${entry.value.span.end}`
    let coefficient = this.#entryValueCache.get(cacheKey)
    if (coefficient === undefined) {
      coefficient = this.#evaluateNumberTrack(
        entry.value,
        'morphCoefficient',
        memberName,
        (value) => (value < 0 || value > 1 ? 'morphCoefficient must be between 0 and 1' : null),
      )
      this.#entryValueCache.set(cacheKey, coefficient)
    }
    if (coefficient === null || coefficient === undefined) return null
    if (node.isMesh !== true) {
      this.#error(
        memberName === null
          ? 'Only mesh nodes can animate morphCoefficient'
          : `Member "${memberName}" is not a mesh and cannot animate morphCoefficient`,
        entry.keySpan,
      )
      return null
    }
    const pair = node.morphBinding
    if (!hasMorphShapePair(pair)) {
      this.#error(
        memberName === null
          ? 'morphCoefficient needs a Morph Binding with both shapes selected'
          : `Member "${memberName}" has no Morph Binding with both shapes selected`,
        entry.keySpan,
      )
      return null
    }
    return {
      track: { kind: 'morph' },
      property: 'morphCoefficient',
      value: {
        fromShapeId: pair.fromShapeId,
        toShapeId: pair.toShapeId,
        coefficient: coefficient as number,
      },
      keySpan: entry.keySpan,
      valueSpan: entry.value.span,
    }
  }

  #cachedTrackValue(
    expression: ScriptExpression,
    track: ScriptTrack,
    memberName: string | null,
  ): ScriptTrackValue | null {
    const cacheKey = `${trackKey(track)}|${expression.span.start}-${expression.span.end}`
    const cached = this.#entryValueCache.get(cacheKey)
    if (cached !== undefined) return cached
    const value = this.#evaluateTrackExpression(expression, track, memberName)
    this.#entryValueCache.set(cacheKey, value)
    return value
  }

  /** Node-kind capability for a resolved track, with member-qualified wording. */
  #validateTrackCapability(
    track: ScriptTrack,
    node: AnimationScriptNodeInfo,
    key: string,
    memberName: string | null,
    keySpan: SourceSpan,
  ): boolean {
    if (track.kind === 'node') {
      if (track.property === 'rotation' && node.isCamera) {
        this.#error(
          memberName === null
            ? 'Camera nodes cannot animate rotation'
            : `Member "${memberName}" is a Camera node and cannot animate rotation`,
          keySpan,
        )
        return false
      }
      if (track.property === 'opacity' && node.isBone) {
        this.#error(
          memberName === null
            ? 'Bone nodes cannot animate opacity'
            : `Member "${memberName}" is a Bone node and cannot animate opacity`,
          keySpan,
        )
        return false
      }
      return true
    }
    if (track.kind === 'circle') {
      if (node.isCircle === true) return true
      this.#error(
        memberName === null
          ? `Only circle nodes can animate ${key}`
          : `Member "${memberName}" is not a circle and cannot animate ${key}`,
        keySpan,
      )
      return false
    }
    if (track.kind === 'table') {
      if (node.isTable === true || node.isTableCell === true) return true
      this.#error(
        memberName === null
          ? `Only table and table cell nodes can animate ${key}`
          : `Member "${memberName}" is not a table or table cell and cannot animate ${key}`,
        keySpan,
      )
      return false
    }
    return true
  }

  /** Every property name this node kind accepts, for near-miss suggestions. */
  #availableKeyNames(node: AnimationScriptNodeInfo): string[] {
    const names: string[] = [...SCRIPT_NODE_PROPERTY_NAMES]
    if (node.isCircle) names.push(...SCRIPT_CIRCLE_PROPERTY_NAMES)
    if (node.isTable === true || node.isTableCell === true) {
      names.push(...SCRIPT_TABLE_PROPERTY_NAMES)
    }
    if (node.isMesh === true && hasMorphShapePair(node.morphBinding)) names.push('morphCoefficient')
    for (const parameter of node.materialParameters ?? []) {
      if (!names.includes(parameter.key)) names.push(parameter.key)
    }
    return names
  }

  /** Coerce an expression to the value shape the resolved track stores. */
  #evaluateTrackExpression(
    expression: ScriptExpression,
    track: ScriptTrack,
    memberName: string | null,
  ): ScriptTrackValue | null {
    if (track.kind === 'node') {
      return this.#evaluateNumberTrack(expression, track.property, memberName, (value) => {
        if (track.property === 'opacity' && (value < 0 || value > 1)) {
          return 'opacity must be between 0 and 1'
        }
        if (track.property === 'zIndex' && !Number.isInteger(value)) {
          return 'zIndex must be a whole number'
        }
        return null
      })
    }
    if (track.kind === 'circle' || track.kind === 'table') {
      return this.#evaluateNumberTrack(expression, track.property, memberName, (value) =>
        value < 0 ? `${track.property} must be a non-negative number` : null,
      )
    }
    if (track.kind === 'parameter') {
      return this.#evaluateParameterValue(expression, track.parameter, track.kindOf, memberName)
    }
    return null
  }

  #evaluateNumberTrack(
    expression: ScriptExpression,
    property: string,
    memberName: string | null,
    check: (value: number) => string | null,
  ): number | null {
    const value = this.#evaluateNumber(expression, this.#valuePhrase(property, memberName))
    if (value === null) return null
    if (!Number.isFinite(value)) {
      this.#error(`${property} must be a finite number`, expression.span)
      return null
    }
    const problem = check(value)
    if (problem !== null) {
      this.#error(memberName === null ? problem : `${problem} on "${memberName}"`, expression.span)
      return null
    }
    return value
  }

  /** Material parameters are kind-shaped: continuous interpolate, discrete hold. */
  #evaluateParameterValue(
    expression: ScriptExpression,
    parameter: string,
    kindOf: string,
    memberName: string | null,
  ): ScriptTrackValue | null {
    const what = this.#valuePhrase(parameter, memberName)
    if (kindOf === 'color') {
      const raw = this.#evaluateString(expression, what)
      if (raw === null) return null
      return this.#requireEngineValue(
        () => requireMaterialKeyframeValue(kindOf, raw) as ScriptTrackValue,
        parameter,
        memberName,
        expression.span,
      )
    }
    if (kindOf === 'vec2' || kindOf === 'vec3' || kindOf === 'vec4') {
      const value = this.#evaluateValue(expression)
      if (value === null || value.kind === 'invalid') return null
      if (value.kind !== 'list') {
        this.#error(`Expected ${what}, found ${describeScriptValue(value)}`, expression.span)
        return null
      }
      const numbers: number[] = []
      for (const element of value.values) {
        if (element.kind !== 'number') {
          this.#error(`Expected ${what} as a list of numbers`, expression.span)
          return null
        }
        numbers.push(element.value)
      }
      return this.#requireEngineValue(
        () => requireMaterialKeyframeValue(kindOf, numbers) as ScriptTrackValue,
        parameter,
        memberName,
        expression.span,
      )
    }
    const raw = this.#evaluateNumber(expression, what)
    if (raw === null) return null
    return this.#requireEngineValue(
      () => requireMaterialKeyframeValue(kindOf, raw) as ScriptTrackValue,
      parameter,
      memberName,
      expression.span,
    )
  }

  /** Shadow parameters, each on its existing shadow track kind. */
  #validateShadowEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    if (statement.entries.length === 0) {
      this.#error('shadow needs at least one parameter', statement.methodSpan)
      return []
    }
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      if (node.hasShadowEffect !== true || node.isGroup !== true) {
        this.#error(
          memberName === null
            ? 'shadow needs a group node carrying a Shadow Effect'
            : `Member "${memberName}" is not a group carrying a Shadow Effect`,
          statement.methodSpan,
        )
        continue
      }
      const entries: ValidatedEntry[] = []
      for (const entry of statement.entries) {
        const validated = this.#resolveShadowEntry(entry, memberName)
        if (validated) entries.push(validated)
      }
      if (entries.length > 0) writes.push({ member, entries })
    }
    return writes
  }

  #resolveShadowEntry(entry: PropertyEntry, memberName: string | null): ValidatedEntry | null {
    if (!(SHADOW_ALL_PROPERTIES as readonly string[]).includes(entry.key)) {
      const suggestion = nearMissSuggestion(entry.key, SHADOW_ALL_PROPERTIES)
      this.#error(
        `Unknown shadow parameter "${entry.key}". Available parameters: ${SHADOW_ALL_PROPERTIES.join(', ')}.${suggestion}`,
        entry.keySpan,
      )
      return null
    }
    if (containsDurationUnit(entry.value)) {
      this.#error(
        `Expected ${entry.key} without a duration suffix, found "${this.#source.slice(entry.value.span.start, entry.value.span.end)}"`,
        entry.value.span,
      )
      return null
    }
    const property = entry.key as ShadowProperty
    const cacheKey = `shadow:${property}|${entry.value.span.start}-${entry.value.span.end}`
    let value = this.#entryValueCache.get(cacheKey)
    if (value === undefined) {
      const what = this.#valuePhrase(property, memberName)
      const raw =
        property === 'color'
          ? this.#evaluateString(entry.value, what)
          : this.#evaluateNumber(entry.value, what)
      value =
        raw === null
          ? null
          : this.#requireEngineValue(
              () => requireShadowKeyframeValue(property, raw),
              property,
              memberName,
              entry.value.span,
            )
      this.#entryValueCache.set(cacheKey, value)
    }
    if (value === null || value === undefined) return null
    return {
      track: { kind: 'shadow', property },
      property,
      value,
      keySpan: entry.keySpan,
      valueSpan: entry.value.span,
    }
  }

  /** `symmetry({ axis, factor }, ...)` on mesh nodes. */
  #validateSymmetryEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    const value = this.#evaluateSymmetryRecord(statement)
    if (value === null) return []
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      if (node.isMesh !== true) {
        this.#error(
          memberName === null
            ? 'symmetry can only be written on mesh nodes'
            : `Member "${memberName}" is not a mesh and cannot animate symmetry`,
          statement.methodSpan,
        )
        continue
      }
      writes.push({
        member,
        entries: [
          {
            track: { kind: 'symmetry' },
            property: 'symmetry',
            value,
            keySpan: statement.entries[0]?.keySpan ?? statement.methodSpan,
            valueSpan: statement.methodSpan,
          },
        ],
      })
    }
    return writes
  }

  #evaluateSymmetryRecord(statement: StatementNode): SymmetryKeyframeValue | null {
    let axis: 'x' | 'y' | null = null
    let factor: number | null = null
    let failed = false
    for (const entry of statement.entries) {
      if (containsDurationUnit(entry.value)) {
        this.#error(
          `Expected ${entry.key} without a duration suffix, found "${this.#source.slice(entry.value.span.start, entry.value.span.end)}"`,
          entry.value.span,
        )
        failed = true
        continue
      }
      if (entry.key === 'axis') {
        const value = this.#evaluateString(entry.value, 'the symmetry axis ("x" or "y")')
        if (value === null) {
          failed = true
          continue
        }
        if (value !== 'x' && value !== 'y') {
          this.#error(`Symmetry axis must be "x" or "y", found "${value}"`, entry.value.span)
          failed = true
          continue
        }
        axis = value
      } else if (entry.key === 'factor') {
        const value = this.#evaluateNumber(entry.value, 'the symmetry factor')
        if (value === null) {
          failed = true
          continue
        }
        factor = value
      } else {
        this.#error(
          `Unknown symmetry parameter "${entry.key}". Available parameters: axis, factor.`,
          entry.keySpan,
        )
        failed = true
      }
    }
    if (failed) return null
    if (axis === null || factor === null) {
      this.#error(
        'symmetry needs { axis, factor }, like symmetry({ axis: "x", factor: 1 }, 0.5)',
        statement.methodSpan,
      )
      return null
    }
    return this.#requireEngineValue(
      () => requireSymmetryKeyframeValue({ axis, factor }),
      'symmetry',
      null,
      statement.methodSpan,
    )
  }

  /** `morph(coefficient, ...)` against each mesh's Morph Binding shape pair. */
  #validateMorphEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    const coefficientExpression = statement.args[0]
    if (statement.args.length !== 1 || coefficientExpression === undefined) {
      this.#error('morph takes one coefficient, like morph(1, 0.5)', statement.methodSpan)
      return []
    }
    if (containsDurationUnit(coefficientExpression)) {
      this.#error(
        `Expected the morph coefficient without a duration suffix, found "${this.#source.slice(coefficientExpression.span.start, coefficientExpression.span.end)}"`,
        coefficientExpression.span,
      )
      return []
    }
    const coefficient = this.#evaluateNumber(coefficientExpression, 'the morph coefficient')
    if (coefficient === null) return []
    const coefficientValue = this.#requireEngineValue(
      () =>
        requireMorphKeyframeValue({
          fromShapeId: null,
          toShapeId: null,
          coefficient,
        }).coefficient,
      'morphCoefficient',
      null,
      coefficientExpression.span,
    )
    if (coefficientValue === null) return []
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      if (node.isMesh !== true) {
        this.#error(
          memberName === null
            ? 'morph can only be written on mesh nodes'
            : `Member "${memberName}" is not a mesh and cannot animate morphCoefficient`,
          statement.methodSpan,
        )
        continue
      }
      const pair = node.morphBinding
      if (!hasMorphShapePair(pair)) {
        this.#error(
          memberName === null
            ? 'morph needs a Morph Binding with both shapes selected'
            : `Member "${memberName}" has no Morph Binding with both shapes selected`,
          statement.methodSpan,
        )
        continue
      }
      writes.push({
        member,
        entries: [
          {
            track: { kind: 'morph' },
            property: 'morphCoefficient',
            value: {
              fromShapeId: pair.fromShapeId,
              toShapeId: pair.toShapeId,
              coefficient: coefficientValue,
            },
            keySpan: coefficientExpression.span,
            valueSpan: coefficientExpression.span,
          },
        ],
      })
    }
    return writes
  }

  /** `dataLabel("label", value, ...)` on a chart's named data labels. */
  #validateDataLabelEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    const labelExpression = statement.args[0]
    const valueExpression = statement.args[1]
    if (
      statement.args.length !== 2 ||
      labelExpression === undefined ||
      valueExpression === undefined
    ) {
      this.#error(
        'dataLabel takes a label and a value, like dataLabel("value", 42, 0.5)',
        statement.methodSpan,
      )
      return []
    }
    if (containsDurationUnit(valueExpression)) {
      this.#error(
        `Expected the data label value without a duration suffix, found "${this.#source.slice(valueExpression.span.start, valueExpression.span.end)}"`,
        valueExpression.span,
      )
      return []
    }
    const label = this.#evaluateString(labelExpression, 'a data label name in quotes')
    if (label === null) return []
    const value = this.#evaluateNumber(valueExpression, `a value for data label "${label}"`)
    if (value === null) return []
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      const labels = node.dataLabels ?? []
      if (!labels.includes(label)) {
        const suggestion = nearMissSuggestion(label, labels)
        this.#error(
          memberName === null
            ? `No data label "${label}" on "${member.nodeName}".${suggestion}`
            : `Member "${member.nodeName}" has no data label "${label}".${suggestion}`,
          labelExpression.span,
        )
        continue
      }
      writes.push({
        member,
        entries: [
          {
            track: { kind: 'dataLabel', label },
            property: `dataLabel:${label}`,
            value,
            keySpan: labelExpression.span,
            valueSpan: valueExpression.span,
          },
        ],
      })
    }
    return writes
  }

  /** `control("Key", value, ...)` on each member's exposed Control. */
  #validateControlEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    const keyExpression = statement.args[0]
    const valueExpression = statement.args[1]
    if (
      statement.args.length !== 2 ||
      keyExpression === undefined ||
      valueExpression === undefined
    ) {
      this.#error(
        'control takes a Control key and a value, like control("Mouth.Openness", 1, 0.5)',
        statement.methodSpan,
      )
      return []
    }
    if (containsDurationUnit(valueExpression)) {
      this.#error(
        `Expected the Control value without a duration suffix, found "${this.#source.slice(valueExpression.span.start, valueExpression.span.end)}"`,
        valueExpression.span,
      )
      return []
    }
    const key = this.#evaluateString(keyExpression, 'a Control key in quotes')
    if (key === null) return []
    const value = this.#evaluateNumber(valueExpression, `a value for Control "${key}"`)
    if (value === null) return []
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      this.#error(`Control "${key}" value must be between 0 and 1`, valueExpression.span)
      return []
    }
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      const controls = node.controls ?? []
      const control = controls.find((entry) => entry.key === key)
      if (!control) {
        const suggestion = nearMissSuggestion(
          key,
          controls.map((entry) => entry.key),
        )
        this.#error(
          memberName === null
            ? `No Control "${key}" on "${member.nodeName}".${suggestion}`
            : `Member "${member.nodeName}" has no Control "${key}".${suggestion}`,
          keyExpression.span,
        )
        continue
      }
      if (!control.exposed) {
        this.#error(
          memberName === null
            ? `Control "${key}" on "${member.nodeName}" is hidden — only exposed Controls are part of the rig's public API`
            : `Member "${member.nodeName}" has hidden Control "${key}" — only exposed Controls are part of the rig's public API`,
          keyExpression.span,
        )
        continue
      }
      writes.push({
        member,
        entries: [
          {
            track: { kind: 'control', controlKey: key },
            property: `control:${key}`,
            value,
            keySpan: keyExpression.span,
            valueSpan: valueExpression.span,
          },
        ],
      })
    }
    return writes
  }

  #resolveEase(statement: StatementNode): { name: string; ease: ResolvedScriptEase } | null {
    const name = statement.ease ?? this.#defaults.ease ?? DEFAULT_SCRIPT_EASE
    const ease = resolveScriptEase(name)
    if (ease) return { name, ease }
    const suggestion = nearMissSuggestion(name, SCRIPT_EASE_NAMES)
    this.#error(`Unknown ease "${name}".${suggestion}`, statement.easeSpan ?? statement.methodSpan)
    return null
  }

  #nodeOf(member: ScriptMember): AnimationScriptNodeInfo | undefined {
    return this.#context.nodes.find((candidate) => candidate.id === member.nodeId)
  }

  /** `"opacity"` for a node binding, `"opacity" on "Cell"` inside a broadcast. */
  #valuePhrase(property: string, memberName: string | null): string {
    return memberName === null
      ? `a value for ${property}`
      : `a value for ${property} on "${memberName}"`
  }

  #requireEngineValue<T extends ScriptTrackValue>(
    validate: () => T,
    property: string,
    memberName: string | null,
    span: SourceSpan,
  ): T | null {
    try {
      return validate()
    } catch (error) {
      const suffix = memberName === null ? '' : ` on "${memberName}"`
      this.#error(
        `Invalid value for "${property}"${suffix}: ${error instanceof Error ? error.message : String(error)}`,
        span,
      )
      return null
    }
  }

  #trackLabel(track: ScriptTrack): string {
    switch (track.kind) {
      case 'node':
        return track.property
      case 'parameter':
        return track.parameter
      case 'circle':
        return track.property
      case 'table':
        return track.property
      case 'morph':
        return 'morphCoefficient'
      case 'symmetry':
        return 'symmetry'
      case 'shadow':
        return `shadow.${track.property}`
      case 'dataLabel':
        return `dataLabel:${track.label}`
      case 'control':
        return `control:${track.controlKey}`
    }
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
    track: ScriptTrack,
    time: number,
    ease: ResolvedScriptEase,
    write: { readonly value: ScriptTrackValue } | null,
  ): void {
    const slotKey = slotKeyFor(member.nodeId, track, time)
    const planned = this.#planned.get(slotKey)
    if (planned) {
      if (write) planned.value = write.value
      planned.interpolation = ease.interpolation
      planned.tangentIn = ease.tangentIn
      planned.tangentOut = ease.tangentOut
      return
    }
    const value = write?.value ?? this.#context.evaluateTrackValue(member.nodeId, track, time)
    this.#addPlanned({ nodeId: member.nodeId, nodeName: member.nodeName, track, time, value, ease })
  }

  #addPlanned(input: {
    nodeId: string
    nodeName: string
    track: ScriptTrack
    time: number
    value: ScriptTrackValue
    ease: ResolvedScriptEase
  }): void {
    const { nodeId, nodeName, track, time, value, ease } = input
    const property = this.#trackLabel(track)
    this.#planned.set(slotKeyFor(nodeId, track, time), {
      target: this.#targetFor(nodeId, track),
      nodeId,
      nodeName,
      track,
      property,
      time,
      order: this.#order++,
      value,
      interpolation: ease.interpolation,
      tangentIn: ease.tangentIn,
      tangentOut: ease.tangentOut,
    })
    if (
      !this.#trackOrder.some(
        (entry) => entry.nodeId === nodeId && trackKey(entry.track) === trackKey(track),
      )
    ) {
      this.#trackOrder.push({ nodeId, nodeName, property, track })
    }
  }

  #planBoundaryPins(): void {
    for (const entry of this.#trackOrder) {
      if (this.#planned.has(slotKeyFor(entry.nodeId, entry.track, this.#from))) continue
      this.#plan(entry, entry.track, this.#from, HOLD_EASE, null)
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
   * The cursor a timed statement would have reached had it lowered cleanly.
   * Recovery paths use it so later statements keep sensible times without
   * re-reporting the failure; `set` and `setText` never advance.
   */
  #advanceCursorByResolvedDuration(statement: StatementNode, cursor: number): number {
    if (!isTimedStatementMethod(statement.method)) return cursor
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
    } else if (
      SCRIPT_BUILTIN_NAMES.includes(statement.name) ||
      (SCRIPT_RESERVED_NAMES as readonly string[]).includes(statement.name)
    ) {
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
   * A `.` access: a property read on a binding or table selector
   * (`stem.x`, `conj.cell(0, 1).opacity`), a record field read
   * (`worldAt(a, t).rotation`), or a structural selector in a value position.
   * Reads evaluate at the cursor and never write anything.
   */
  #evaluateMember(expression: MemberExpression): ScriptValue | null | undefined {
    if (expression.args !== undefined) {
      this.#error(
        `"${expression.name}(...)" is a structural selector and not a value — use it as a read target, like bounds(alias.row(0))`,
        expression.nameSpan,
      )
      return null
    }
    if (expression.object.kind === 'identifier') {
      const binding = this.#bindings.get(expression.object.name)
      if (binding) {
        binding.used = true
        if (binding.kind === 'group') {
          this.#errorGroupRead(binding.alias, expression.nameSpan)
          return null
        }
        return this.#readMemberProperty(binding.members[0], expression)
      }
    }
    if (expression.object.kind === 'member' && expression.object.args !== undefined) {
      const target = this.#resolveReadTarget(
        expression.object,
        false,
        `reading "${expression.name}"`,
      )
      if (!target || target.members.length !== 1) return null
      return this.#readMemberProperty(target.members[0], expression)
    }
    const object = this.#evaluateValue(expression.object)
    if (object === null || object.kind === 'invalid') {
      return object === null ? null : { kind: 'invalid' }
    }
    if (object.kind === 'record') {
      const field = object.fields.get(expression.name)
      if (field !== undefined) return field
      const suggestion = nearMissSuggestion(expression.name, [...object.fields.keys()])
      this.#error(
        `"${expression.name}" is not a field of ${object.label} — available fields: ${[...object.fields.keys()].join(', ')}.${suggestion}`,
        expression.nameSpan,
      )
      return null
    }
    this.#error(
      `"${expression.name}" cannot be read from ${describeScriptValue(object)} — only bindings and records have readable members`,
      expression.nameSpan,
    )
    return null
  }

  #errorGroupRead(alias: string, span: SourceSpan): void {
    this.#error(
      `Binding "${alias}" is a group — group reads are limited to bounds(...). Bind individual nodes to read a member value.`,
      span,
    )
  }

  /** `binding.x` and `conj.cell(...).x`: the evaluated value at the cursor. */
  #readMemberProperty(member: ScriptMember, expression: MemberExpression): ScriptValue | null {
    if (!isReadableProperty(expression.name)) {
      if (isScriptProperty(expression.name)) {
        this.#error(
          `"${expression.name}" cannot be read — reads cover ${SCRIPT_READABLE_PROPERTY_NAMES.join(', ')}`,
          expression.nameSpan,
        )
      } else {
        const suggestion = nearMissSuggestion(expression.name, SCRIPT_READABLE_PROPERTY_NAMES)
        this.#error(
          `Unknown read "${expression.name}" on "${member.nodeName}". Readable properties: ${SCRIPT_READABLE_PROPERTY_NAMES.join(', ')}.${suggestion}`,
          expression.nameSpan,
        )
      }
      return null
    }
    const time = this.#validateReadTime(this.#readCursor, expression.nameSpan)
    if (time === null) return null
    return {
      kind: 'number',
      value: this.#context.evaluateProperty(member.nodeId, expression.name, time),
    }
  }

  #evaluateReadCall(
    expression: Extract<ScriptExpression, { kind: 'call' }>,
  ): ScriptValue | null | undefined {
    switch (expression.callee) {
      case 'worldAt':
        return this.#evaluateWorldAt(expression)
      case 'bounds':
        return this.#evaluateBounds(expression)
      case 'cellRect':
        return this.#evaluateCellRect(expression)
      case 'controlValue':
        return this.#evaluateControlValue(expression)
    }
  }

  /** `worldAt(node, t?)` — the node's world x, y and rotation at `t`. */
  #evaluateWorldAt(expression: Extract<ScriptExpression, { kind: 'call' }>): ScriptValue | null {
    if (!this.#checkReadArity(expression)) return null
    const target = this.#resolveReadTarget(expression.args[0], false, 'worldAt')
    if (!target) return null
    const time = this.#resolveReadTime(expression.args[1], expression)
    if (time === null) return null
    const world = this.#context.reads.world(target.members[0].nodeId, time)
    return numberRecord('the world transform', {
      x: world.x,
      y: world.y,
      rotation: world.rotation,
    })
  }

  /**
   * `bounds(nodeOrGroup, t?)` — the subtree-union world AABB at `t`. The box
   * ignores rotation and uses renderer-measured sizes; a group unions each
   * member's own subtree bounds.
   */
  #evaluateBounds(expression: Extract<ScriptExpression, { kind: 'call' }>): ScriptValue | null {
    if (!this.#checkReadArity(expression)) return null
    const target = this.#resolveReadTarget(expression.args[0], true, 'bounds')
    if (!target) return null
    // A zero-member group already failed to resolve; do not pile a second
    // unmeasurable-geometry error onto the resolution error.
    if (target.members.length === 0) return null
    const time = this.#resolveReadTime(expression.args[1], expression)
    if (time === null) return null
    let union: AnimationScriptBoundsRead | null = null
    for (const member of target.members) {
      const memberBounds = this.#context.reads.bounds(member.nodeId, time)
      if (memberBounds) {
        union = union === null ? memberBounds : mergeBounds(union, memberBounds)
      }
    }
    if (union === null) {
      const names = target.members.map((member) => `"${member.nodeName}"`).join(', ')
      this.#error(
        `bounds could not measure any geometry for ${names} at ${formatSeconds(time)}s — bounds use renderer-measured node sizes`,
        expression.span,
      )
      return null
    }
    return numberRecord('the world bounds', { ...union })
  }

  #evaluateCellRect(expression: Extract<ScriptExpression, { kind: 'call' }>): ScriptValue | null {
    if (!this.#checkReadArity(expression)) return null
    const tableExpression = expression.args[0]
    if (tableExpression.kind !== 'identifier') {
      this.#error(
        'cellRect needs a table("...") binding as its first argument, like cellRect(conj, 0, 1)',
        tableExpression.span,
      )
      return null
    }
    const binding = this.#bindings.get(tableExpression.name)
    if (!binding) {
      if (this.#lookupValue(tableExpression.name) !== undefined) {
        this.#error(
          `cellRect needs a table("...") binding — "${tableExpression.name}" is a value`,
          tableExpression.span,
        )
        return null
      }
      const suggestion = nearMissSuggestion(tableExpression.name, [...this.#bindings.keys()])
      this.#error(`Unknown binding "${tableExpression.name}".${suggestion}`, tableExpression.span)
      return null
    }
    binding.used = true
    if (binding.kind !== 'table' || binding.grid === undefined) {
      this.#error(
        `cellRect needs a table("...") binding — "${binding.alias}" is a ${binding.kind} binding`,
        tableExpression.span,
      )
      return null
    }
    const row = this.#resolveSlotIndex(expression.args[1], 'Grid Slot row')
    const column = this.#resolveSlotIndex(expression.args[2], 'Grid Slot column')
    if (row === null || column === null) return null
    const cell = this.#resolveGridSlot(binding.grid, row, column, expression.span)
    if (!cell) return null
    const time = this.#resolveReadTime(expression.args[3], expression)
    if (time === null) return null
    const rect = this.#context.reads.cellRect(binding.members[0].nodeId, cell.nodeId, time)
    if (!rect) {
      this.#error(
        `Could not measure the rectangle of Grid Slot (${row}, ${column}) of table "${binding.grid.tableName}"`,
        expression.span,
      )
      return null
    }
    return numberRecord('the cell rectangle', {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      rotation: rect.rotation,
    })
  }

  #evaluateControlValue(
    expression: Extract<ScriptExpression, { kind: 'call' }>,
  ): ScriptValue | null {
    if (!this.#checkReadArity(expression)) return null
    const target = this.#resolveReadTarget(expression.args[0], false, 'controlValue')
    if (!target) return null
    const key = this.#evaluateString(expression.args[1], 'the Control key')
    if (key === null) return null
    const member = target.members[0]
    const node = this.#context.nodes.find((candidate) => candidate.id === member.nodeId)
    const controls = node?.controls ?? []
    const control = controls.find((entry) => entry.key === key)
    if (!control) {
      const suggestion = nearMissSuggestion(
        key,
        controls.map((entry) => entry.key),
      )
      this.#error(
        `No Control "${key}" on "${member.nodeName}".${suggestion}`,
        expression.args[1].span,
      )
      return null
    }
    if (!control.exposed) {
      this.#error(
        `Control "${key}" on "${member.nodeName}" is hidden — only exposed Controls are part of the rig's public API`,
        expression.args[1].span,
      )
      return null
    }
    const time = this.#resolveReadTime(expression.args[2], expression)
    if (time === null) return null
    return { kind: 'number', value: this.#context.reads.controlValue(member.nodeId, key, time) }
  }

  /**
   * The target of a read: a node or table binding, or a table selector
   * (`conj.cell(0, 1)`, `conj.row(2)`). Groups are legal only for reads that
   * accept a broadcast target (`bounds`); everything else needs one node.
   */
  #resolveReadTarget(
    expression: ScriptExpression,
    allowGroup: boolean,
    what: string,
  ): { readonly members: readonly ScriptMember[] } | null {
    if (expression.kind === 'identifier') {
      const binding = this.#bindings.get(expression.name)
      if (binding) {
        binding.used = true
        if (binding.kind === 'group' && !allowGroup) {
          this.#error(
            `${what} needs a single node — binding "${binding.alias}" is a group. Bind an individual node, or use bounds(...) for a group.`,
            expression.span,
          )
          return null
        }
        return { members: binding.members }
      }
      if (this.#lookupValue(expression.name) !== undefined) {
        this.#error(
          `${what} targets a binding — "${expression.name}" is a value, not a node or group`,
          expression.span,
        )
        return null
      }
      const suggestion = nearMissSuggestion(expression.name, [...this.#bindings.keys()])
      this.#error(`Unknown binding "${expression.name}".${suggestion}`, expression.span)
      return null
    }
    if (expression.kind === 'member' && expression.args !== undefined) {
      if (expression.object.kind !== 'identifier') {
        this.#error(
          `${what} targets a binding — a table selector starts from a table("...") alias`,
          expression.span,
        )
        return null
      }
      const binding = this.#bindings.get(expression.object.name)
      if (!binding) {
        const suggestion = nearMissSuggestion(expression.object.name, [...this.#bindings.keys()])
        this.#error(`Unknown binding "${expression.object.name}".${suggestion}`, expression.span)
        return null
      }
      binding.used = true
      const selector: SelectorNode = {
        kind: 'selector',
        name: expression.name,
        nameSpan: expression.nameSpan,
        args: expression.args,
        span: expression.span,
      }
      const resolved = this.#resolveSelectors([selector], binding)
      if (!resolved) return null
      if (resolved.kind === 'group' && !allowGroup) {
        this.#error(
          `${what} needs a single node — "${expression.name}(...)" selects a group. Use bounds(...) for a group.`,
          expression.span,
        )
        return null
      }
      return { members: resolved.members }
    }
    this.#error(
      `${what} needs a node or group binding as its target, like ${what}(alias)`,
      expression.span,
    )
    return null
  }

  #checkReadArity(expression: Extract<ScriptExpression, { kind: 'call' }>): boolean {
    const spec = SCRIPT_READ_SPECS[expression.callee]
    const count = expression.args.length
    if (count >= spec.minArgs && count <= spec.maxArgs) return true
    this.#error(
      `${expression.callee} is called like ${spec.shape} — got ${count} argument${count === 1 ? '' : 's'}`,
      expression.span,
    )
    return false
  }

  /**
   * A read time: explicit when given, the cursor otherwise. Reads never guess:
   * a time outside `[0, slide.duration]` is a compile error, explicit or not.
   */
  #resolveReadTime(
    expression: ScriptExpression | undefined,
    call: Extract<ScriptExpression, { kind: 'call' }>,
  ): number | null {
    let time: number
    let span: SourceSpan
    if (expression === undefined) {
      time = this.#readCursor
      span = call.span
    } else {
      const seconds = this.#evaluateNumber(expression, 'a read time in seconds')
      if (seconds === null) return null
      time = roundTime(seconds)
      span = expression.span
    }
    return this.#validateReadTime(time, span)
  }

  #validateReadTime(time: number, span: SourceSpan): number | null {
    if (time < 0 || time > this.#context.slideDuration) {
      this.#error(
        `Read time ${formatSeconds(time)}s is outside the slide [0, ${formatSeconds(this.#context.slideDuration)}s]`,
        span,
      )
      return null
    }
    return time
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

  #evaluateString(expression: ScriptExpression, what: string): string | null {
    const value = this.#evaluateValue(expression)
    if (value === null || value.kind === 'invalid') return null
    if (value.kind !== 'string') {
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
      call: (expression) => {
        if (!isScriptReadBuiltin(expression.callee)) return undefined
        return this.#evaluateReadCall(expression)
      },
      member: (expression) => this.#evaluateMember(expression),
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

  #targetFor(nodeId: string, track: ScriptTrack): KeyframeTarget {
    switch (track.kind) {
      case 'node':
        if (track.property === 'zIndex') return { kind: 'zIndex', nodeId }
        return { kind: 'node', nodeId, property: enginePropertyForScriptProperty(track.property) }
      case 'parameter':
        return { kind: 'node', nodeId, parameter: track.parameter }
      case 'circle':
        return { kind: 'circle', nodeId, property: track.property }
      case 'table':
        return { kind: 'table', nodeId, property: track.property }
      case 'morph':
        return { kind: 'morph', nodeId }
      case 'symmetry':
        return { kind: 'symmetry', nodeId }
      case 'shadow':
        return { kind: 'shadow', nodeId, property: track.property }
      case 'dataLabel':
        return { kind: 'dataLabel', nodeId, label: track.label }
      case 'control':
        return { kind: 'control', nodeId, controlKey: track.controlKey }
    }
  }

  #materializeCommands(): Command<unknown>[] {
    const planned = [...this.#planned.values()].map((entry) => ({
      order: entry.order,
      command: new AddKeyframeCommand({
        target: entry.target,
        time: entry.time,
        value: entry.value,
        interpolation: entry.interpolation,
        ...(entry.interpolation === 'bezier'
          ? { tangentIn: entry.tangentIn, tangentOut: entry.tangentOut }
          : {}),
      }) as Command<unknown>,
    }))
    // Static text changes share the Transaction and the source order but are
    // not keyframes, so they stay out of the footprint and the keyframe count.
    return [...planned, ...this.#textCommands]
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.command)
  }

  #error(message: string, span: SourceSpan): void {
    this.#pushDiagnostic('error', message, span)
  }

  #warning(message: string, span: SourceSpan): void {
    this.#pushDiagnostic('warning', message, span)
  }

  /** One diagnostic per message and source span, so broadcasts stay readable. */
  #pushDiagnostic(severity: 'error' | 'warning', message: string, span: SourceSpan): void {
    const position = lineColumnAt(this.#source, span.start)
    const duplicate = this.#diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === severity &&
        diagnostic.message === message &&
        diagnostic.line === position.line &&
        diagnostic.column === position.column,
    )
    if (!duplicate) {
      this.#diagnostics.push({
        severity,
        message,
        line: position.line,
        column: position.column,
        length: Math.max(1, span.end - span.start),
      })
    }
  }
}

/** Map an author-facing property to the engine property track it animates. */
export function enginePropertyForScriptProperty(
  property: Exclude<ScriptNodeProperty, 'zIndex'>,
): AnimationProperty {
  if (property === 'x') return 'positionX'
  if (property === 'y') return 'positionY'
  return property
}

function isScriptProperty(value: string): value is ScriptProperty {
  return (SCRIPT_PROPERTY_NAMES as readonly string[]).includes(value)
}

function hasMorphShapePair(
  binding:
    { readonly fromShapeId: string | null; readonly toShapeId: string | null } | null | undefined,
): binding is { readonly fromShapeId: string; readonly toShapeId: string } {
  return (
    binding !== null &&
    binding !== undefined &&
    binding.fromShapeId !== null &&
    binding.toShapeId !== null
  )
}

function isTimedStatementMethod(method: string): boolean {
  return (
    method === 'tween' ||
    method === 'shadow' ||
    method === 'symmetry' ||
    method === 'morph' ||
    method === 'dataLabel' ||
    method === 'control'
  )
}

/**
 * The fixed vocabulary a property key names, before any node-kind capability
 * check. A key outside it is either a material parameter or unknown; `visible`
 * and `segments` are deliberately excluded from the write surface.
 */
function reservedTrackForKey(
  key: string,
): { readonly track: ScriptTrack } | { readonly error: string } | null {
  if (key === 'visible') {
    return {
      error:
        'The visible lane is not part of the Animation Script surface — lower show/hide to opacity keyframes instead.',
    }
  }
  if (key === 'segments') {
    return {
      error:
        'circle segments are not part of the Animation Script surface — animate radius, startAngle and endAngle instead.',
    }
  }
  if ((SCRIPT_NODE_PROPERTY_NAMES as readonly string[]).includes(key)) {
    return { track: { kind: 'node', property: key as ScriptNodeProperty } }
  }
  if ((SCRIPT_CIRCLE_PROPERTY_NAMES as readonly string[]).includes(key)) {
    return { track: { kind: 'circle', property: key as ScriptCircleProperty } }
  }
  if ((SCRIPT_TABLE_PROPERTY_NAMES as readonly string[]).includes(key)) {
    return { track: { kind: 'table', property: key as ScriptTableProperty } }
  }
  if (key === 'morphCoefficient') {
    return { track: { kind: 'morph' } }
  }
  return null
}

/** Only the reserved vocabulary ever collides with a material parameter. */
function describeReservedTrack(track: ScriptTrack): string {
  if (track.kind === 'circle') return 'the circle property'
  if (track.kind === 'table') return 'the table style'
  if (track.kind === 'morph') return 'morphCoefficient'
  return 'the node property'
}

/** The key a track occupies in planning and caching; never a display name. */
function trackKey(track: ScriptTrack): string {
  switch (track.kind) {
    case 'node':
      return `node:${track.property}`
    case 'parameter':
      return `parameter:${track.parameter}:${track.kindOf}`
    case 'circle':
      return `circle:${track.property}`
    case 'table':
      return `table:${track.property}`
    case 'morph':
      return 'morph'
    case 'symmetry':
      return 'symmetry'
    case 'shadow':
      return `shadow:${track.property}`
    case 'dataLabel':
      return `dataLabel:${track.label}`
    case 'control':
      return `control:${track.controlKey}`
  }
}

function isReadableProperty(value: string): value is ScriptReadableProperty {
  return (SCRIPT_READABLE_PROPERTY_NAMES as readonly string[]).includes(value)
}

/** A compile-time record read (`worldAt`, `bounds`, `cellRect`) as a value. */
function numberRecord(label: string, fields: Readonly<Record<string, number>>): ScriptValue {
  return {
    kind: 'record',
    label,
    fields: new Map(
      Object.entries(fields).map(([name, value]) => [
        name,
        { kind: 'number', value } as ScriptValue,
      ]),
    ),
  }
}

/**
 * Duration suffixes are a duration-position convenience; a property value that
 * carries one is rejected wherever it sits in the expression — except inside a
 * read call's time argument, which is a time position like any duration slot.
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
    case 'member':
      return (
        containsDurationUnit(expression.object) ||
        (expression.args?.some(containsDurationUnit) ?? false)
      )
    case 'unary':
      return containsDurationUnit(expression.operand)
    case 'binary':
      return containsDurationUnit(expression.left) || containsDurationUnit(expression.right)
    case 'call': {
      const timeArgument = SCRIPT_READ_SPECS[expression.callee]?.timeArgument
      return expression.args.some(
        (argument, index) => index !== timeArgument && containsDurationUnit(argument),
      )
    }
  }
}

function isValidDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0
}

function slotKeyFor(nodeId: string, track: ScriptTrack, time: number): string {
  return `${nodeId}|${trackKey(track)}|${roundTime(time).toFixed(6)}`
}

function roundTime(time: number): number {
  return Math.round(time * 1e6) / 1e6
}

function formatSeconds(seconds: number): string {
  return String(roundTime(seconds))
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
