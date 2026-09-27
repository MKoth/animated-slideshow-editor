import type { Command } from './commands'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { SetTextContentCommand } from './commands/setTextContentCommand'
import { AssignClipCommand } from './commands/assignClipCommand'
import { PlaceCollectionCommand } from './commands/placeCollectionCommand'
import { MIN_CLIP_SPEED, MIN_VISUAL_DURATION } from './animationManagerModel'
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
  ForNode,
  FunctionCallNode,
  FunctionDefNode,
  FunctionParamNode,
  LetNode,
  MarkNode,
  MemberExpression,
  ParallelNode,
  PropertyEntry,
  RepeatNode,
  ScriptExpression,
  ScriptParamType,
  ScriptProgram,
  ScriptStatementNode,
  SelectorNode,
  SetTextNode,
  SourceSpan,
  StaggerNode,
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

/** A project clip a script may play; the compiler never mints definitions. */
export interface AnimationScriptClipInfo {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly params: readonly string[]
}

/** A project Clip Collection a script may apply; broadcast by Semantic Name. */
export interface AnimationScriptCollectionInfo {
  readonly id: string
  readonly name: string
  /** Semantic Name → clip id, as the collection stores it. */
  readonly bindings: Readonly<Record<string, string>>
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
  /** Project clips, for `clip("...")` bindings; never minted, only referenced. */
  readonly clips: readonly AnimationScriptClipInfo[]
  /** Project collections, for `collection("...")` bindings; never minted. */
  readonly collections: readonly AnimationScriptCollectionInfo[]
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
  readonly kind: 'node' | 'group' | 'table' | 'cellRef' | 'clip' | 'collection'
  /**
   * The binding's targets in scene pre-order. A node, table or cellRef binding
   * has exactly one member; a group binding has one per node carrying its
   * Semantic Name, in `walkPreOrder` order. Selector-resolved table members
   * follow the grid's engine layout order. Broadcast writes therefore touch
   * members in a deterministic, documented order and every write is per member.
   * Clip and collection bindings address project resources and carry no node
   * members.
   */
  readonly members: readonly ScriptMember[]
  /** Present only on table bindings: the Grid Slot map selectors resolve against. */
  readonly grid?: ScriptTableGrid
  /** Present only on clip bindings: the referenced Clip Definition. */
  readonly clip?: AnimationScriptClipInfo
  /** Present only on collection bindings: the referenced Clip Collection. */
  readonly collection?: AnimationScriptCollectionInfo
  used: boolean
}

type ForElement =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'binding'; readonly binding: BindingInfo }
  | { readonly kind: 'record'; readonly value: ScriptValue }
  | { readonly kind: 'list'; readonly value: ScriptValue }
  | { readonly kind: 'string'; readonly value: string }

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

/**
 * Compile budgets for unrolled loops: a single loop iterates at most this
 * many times, and a whole compile unrolls at most this many statements. Both
 * produce diagnostics instead of hangs, matching the range-list budget.
 */
export const SCRIPT_MAX_LOOP_ITERATIONS = 10000
export const SCRIPT_MAX_UNROLLED_STATEMENTS = 10000
/**
 * Maximum inlining depth for local function calls. Recursion is a compile
 * error, so depth is bounded by the acyclic call graph; this budget turns a
 * pathological chain into a diagnostic instead of a stack overflow.
 */
export const SCRIPT_MAX_CALL_DEPTH = 32

/**
 * Names a `function` definition may not take: the expression built-ins, the
 * shipped `pointArrowAt` built-in (owned by #388), the `setText` free call,
 * and the statement keywords. Collisions are compile errors.
 */
const SCRIPT_FUNCTION_RESERVED_NAMES: readonly string[] = [
  ...SCRIPT_BUILTIN_NAMES,
  'pointArrowAt',
  'setText',
  'bind',
  'let',
  'function',
  'wait',
  'mark',
  'at',
  'parallel',
  'repeat',
  'for',
  'stagger',
  'defaults',
  'script',
  'from',
  'in',
]

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
  #bindings = new Map<string, BindingInfo>()
  /**
   * `let` values, innermost block last. The top-level scope is always present;
   * `parallel` bodies (and, later, function and loop bodies) push their own.
   */
  #scopes: Map<string, ScriptValue>[] = [new Map()]
  /**
   * Loop-local binding proxies, innermost loop last. A `for` variable bound to
   * a node or group shadows by name for its iteration; a `stagger` target alias
   * rebinds to its current member. Checked before `#bindings`.
   */
  #aliasOverrides: Map<string, BindingInfo>[] = []
  /** Compile-time-only marker labels; never persisted, never a timeline marker. */
  #markers = new Map<string, number>()
  /**
   * Local functions declared so far, in source order (define-before-use). The
   * map holds only successfully declared functions; `#allFunctionDefs` holds
   * every definition in the source for forward-reference diagnostics.
   */
  readonly #functions = new Map<string, FunctionDefNode>()
  /** Every `function` definition in the source, first wins, for diagnostics. */
  readonly #allFunctionDefs = new Map<string, FunctionDefNode>()
  /** Inlining stack for recursion detection and the call-depth budget. */
  readonly #callStack: string[] = []
  readonly #planned = new Map<string, PlannedKeyframe>()
  readonly #trackOrder: TrackOrderEntry[] = []
  /** Static `setText` commands with their source order, dispatched inside the run Transaction. */
  readonly #textCommands: { readonly order: number; readonly command: Command<unknown> }[] = []
  /** `play` Clip Instances and `apply` placements in source order. */
  readonly #clipCommands: { readonly order: number; readonly command: Command<unknown> }[] = []
  /**
   * Prospective Clip Instances the run will create: one per `play` member
   * plus one per `apply` member matched under each addressed parent. A
   * placement record itself is not an instance, so the summary counts what
   * the timeline gains, matching the Check "emitted instance counts" promise.
   */
  #instanceCount = 0
  /** Nodes carrying `play` instances, in first-addressed order (footprint). */
  readonly #instanceNodes: string[] = []
  /** Nodes carrying `apply` placements, in first-addressed order (footprint). */
  readonly #placementParents: string[] = []
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
  /** Nesting depth inside repeat/for/stagger bodies; markers error when > 0. */
  #loopDepth = 0
  /** Total unrolled body statements this compile; the budget stops hangs. */
  #unrolledStatements = 0

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
    this.#collectFunctionDefs(program.statements)
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
      instanceCount: this.#instanceCount,
    }
    const footprint: CompiledFootprint = {
      from: this.#from,
      to: this.#cursor,
      tracks: this.#trackOrder.map((track) => ({
        nodeId: track.nodeId,
        target: this.#targetFor(track.nodeId, track.track),
      })),
      placementParents: [...this.#placementParents],
      instanceNodes: [...this.#instanceNodes],
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

  /**
   * Pre-collect every top-level `function` definition for define-before-use
   * diagnostics (a call before its definition names the definition, not just
   * "unknown"). First wins; duplicates are reported when declared in order.
   */
  #collectFunctionDefs(statements: readonly ScriptStatementNode[]): void {
    for (const statement of statements) {
      if (statement.kind !== 'function') continue
      if (!this.#allFunctionDefs.has(statement.name)) {
        this.#allFunctionDefs.set(statement.name, statement)
      }
    }
  }

  #declareFunction(statement: FunctionDefNode): void {
    if (this.#loopDepth > 0 || this.#scopes.length > 1 || this.#callStack.length > 0) {
      this.#error(
        `Function "${statement.name}" must appear at the top level, not inside a block`,
        statement.nameSpan,
      )
      return
    }
    if (this.#functions.has(statement.name)) {
      this.#error(`Function "${statement.name}" is already defined`, statement.nameSpan)
      return
    }
    if (
      SCRIPT_FUNCTION_RESERVED_NAMES.includes(statement.name) ||
      (SCRIPT_RESERVED_NAMES as readonly string[]).includes(statement.name)
    ) {
      const suggestion = nearMissSuggestion(statement.name, [...this.#allFunctionDefs.keys()])
      const builtin =
        SCRIPT_BUILTIN_NAMES.includes(statement.name) || statement.name === 'pointArrowAt'
          ? ` — "${statement.name}" is a built-in`
          : ''
      this.#error(
        `Function name "${statement.name}" is reserved by the Animation Script language${builtin}.${suggestion}`,
        statement.nameSpan,
      )
      return
    }
    if (this.#bindings.has(statement.name)) {
      this.#error(
        `Function name "${statement.name}" is already used by a binding`,
        statement.nameSpan,
      )
      return
    }
    if (this.#lookupValue(statement.name) !== undefined) {
      this.#error(
        `Function name "${statement.name}" is already used by a variable`,
        statement.nameSpan,
      )
      return
    }
    if (this.#lookupOverride(statement.name) !== undefined) {
      this.#error(
        `Function name "${statement.name}" is already used by a loop variable`,
        statement.nameSpan,
      )
      return
    }
    const seen = new Set<string>()
    for (const param of statement.params) {
      if (seen.has(param.name)) {
        this.#error(
          `Parameter "${param.name}" is declared twice in function "${statement.name}"`,
          param.nameSpan,
        )
        continue
      }
      seen.add(param.name)
    }
    this.#functions.set(statement.name, statement)
  }

  /**
   * `name(args)` as a statement: type-check the arguments against the typed
   * parameters, then inline the body with a closed scope. The call advances by
   * the body's extent, so `parallel`/`at`/`stagger` compose like any statement.
   */
  #lowerFunctionCall(statement: FunctionCallNode, cursor: number): number {
    const known = this.#allFunctionDefs.get(statement.name)
    const declared = this.#functions.get(statement.name)
    if (!known) {
      const suggestion = nearMissSuggestion(statement.name, [
        ...this.#allFunctionDefs.keys(),
        ...this.#functions.keys(),
      ])
      this.#error(`Unknown function "${statement.name}".${suggestion}`, statement.nameSpan)
      return cursor
    }
    if (known.span.start > statement.span.start || !declared) {
      this.#error(
        `Function "${statement.name}" must be defined before use — move its definition above this call`,
        statement.nameSpan,
      )
      return cursor
    }
    if (this.#callStack.includes(statement.name)) {
      const chain = [...this.#callStack, statement.name].join(' → ')
      this.#error(
        `Recursion is not part of the Animation Script language — function call cycle ${chain}`,
        statement.nameSpan,
      )
      return cursor
    }
    if (this.#callStack.length >= SCRIPT_MAX_CALL_DEPTH) {
      this.#error(
        `Function call depth passes the compile budget of ${SCRIPT_MAX_CALL_DEPTH} — flatten the call chain`,
        statement.nameSpan,
      )
      return cursor
    }
    if (statement.args.length !== declared.params.length) {
      this.#error(
        `Function "${statement.name}" takes ${declared.params.length} argument${declared.params.length === 1 ? '' : 's'}, got ${statement.args.length}`,
        statement.span,
      )
      return cursor
    }
    const resolved: ScriptValue[] = []
    let failed = false
    for (let index = 0; index < declared.params.length; index += 1) {
      const param = declared.params[index]
      const arg = statement.args[index]
      const value = this.#resolveFunctionArg(declared.name, param, arg)
      if (value === null) {
        failed = true
        continue
      }
      resolved.push(value)
    }
    if (failed) return cursor
    return this.#invokeFunction(declared, resolved, statement, cursor)
  }

  /**
   * Resolve one call argument against its declared parameter type, in the
   * caller's scope. Mismatches name the parameter, the function, the expected
   * type and the source location.
   */
  #resolveFunctionArg(
    functionName: string,
    param: FunctionParamNode,
    arg: ScriptExpression,
  ): ScriptValue | null {
    return this.#checkValueAgainstType(functionName, param, arg, this.#evaluateArgValue(arg))
  }

  /** Evaluate a call argument in the caller's scope, without extra reporting. */
  #evaluateArgValue(arg: ScriptExpression): ScriptValue | null {
    return this.#evaluateValue(arg)
  }

  #checkValueAgainstType(
    functionName: string,
    param: FunctionParamNode,
    arg: ScriptExpression,
    value: ScriptValue | null,
  ): ScriptValue | null {
    if (value === null || value.kind === 'invalid') return value === null ? null : value
    return this.#matchType(functionName, param.name, param.paramType, value, arg)
  }

  #matchType(
    functionName: string,
    paramName: string,
    type: ScriptParamType,
    value: ScriptValue,
    arg: ScriptExpression,
  ): ScriptValue | null {
    const mismatch = (found: string, expected?: ScriptParamType): null => {
      this.#error(
        `Type mismatch for parameter "${paramName}" of function "${functionName}": expected ${describeParamType(expected ?? type)}, found ${found}`,
        arg.span,
      )
      return null
    }
    if (type.kind === 'base') {
      switch (type.name) {
        case 'number':
          return value.kind === 'number' ? value : mismatch(describeScriptValue(value))
        case 'color': {
          if (value.kind !== 'string') return mismatch(describeScriptValue(value))
          try {
            requireMaterialKeyframeValue('color', value.value)
          } catch (error) {
            this.#error(
              `Type mismatch for parameter "${paramName}" of function "${functionName}": expected color, found invalid color "${value.value}" (${error instanceof Error ? error.message : String(error)})`,
              arg.span,
            )
            return null
          }
          return value
        }
        case 'string':
          return value.kind === 'string' ? value : mismatch(describeScriptValue(value))
        case 'node':
        case 'group':
        case 'table':
        case 'cellRef':
        case 'clip':
        case 'collection': {
          if (value.kind !== 'binding') return mismatch(describeScriptValue(value))
          const binding = bindingOf(value)
          if (!binding) return mismatch(describeScriptValue(value))
          if (binding.kind !== type.name) {
            return mismatch(`a ${binding.kind === 'cellRef' ? 'cell reference' : binding.kind}`)
          }
          return value
        }
        case 'list':
          return value.kind === 'list' ? value : mismatch(describeScriptValue(value))
        default:
          return mismatch(describeScriptValue(value))
      }
    }
    if (type.kind === 'list') {
      if (value.kind !== 'list') return mismatch(describeScriptValue(value))
      const checked: ScriptValue[] = []
      for (const element of value.values) {
        const matched = this.#matchType(functionName, paramName, type.element, element, arg)
        if (matched === null) return null
        checked.push(matched)
      }
      return { kind: 'list', values: checked }
    }
    if (value.kind !== 'record') return mismatch(describeScriptValue(value))
    const fields = new Map<string, ScriptValue>()
    for (const field of type.fields) {
      const actual = value.fields.get(field.name)
      if (actual === undefined) {
        this.#error(
          `Record shape mismatch for parameter "${paramName}" of function "${functionName}": missing field "${field.name}" (expected ${describeParamType(field.type)})`,
          arg.span,
        )
        return null
      }
      const matched = this.#matchType(functionName, paramName, field.type, actual, arg)
      if (matched === null) return null
      fields.set(field.name, matched)
    }
    for (const key of value.fields.keys()) {
      if (!type.fields.some((field) => field.name === key)) {
        this.#error(
          `Record shape mismatch for parameter "${paramName}" of function "${functionName}": unexpected field "${key}"`,
          arg.span,
        )
        return null
      }
    }
    return { kind: 'record', label: value.label, fields }
  }

  /**
   * Inline a validated call with a closed scope: parameters plus the body's own
   * locals/loop variables only. Caller bindings, values, overrides, marks and
   * defaults are saved and restored; markers are per-invocation local.
   */
  #invokeFunction(
    def: FunctionDefNode,
    args: readonly ScriptValue[],
    call: FunctionCallNode,
    cursor: number,
  ): number {
    const paramBindings = new Map<string, BindingInfo>()
    const paramValues = new Map<string, ScriptValue>()
    for (let index = 0; index < def.params.length; index += 1) {
      const param = def.params[index]
      const value = args[index]
      if (isBindingParamType(param.paramType)) {
        const binding = bindingOf(value)
        if (binding) {
          paramBindings.set(param.name, {
            alias: param.name,
            aliasSpan: param.nameSpan,
            kind: binding.kind,
            members: binding.members,
            ...(binding.grid !== undefined ? { grid: binding.grid } : {}),
            ...(binding.clip !== undefined ? { clip: binding.clip } : {}),
            ...(binding.collection !== undefined ? { collection: binding.collection } : {}),
            used: false,
          })
          binding.used = true
        }
        continue
      }
      paramValues.set(param.name, value)
    }
    const savedBindings = this.#bindings
    const savedScopes = this.#scopes
    const savedOverrides = this.#aliasOverrides
    const savedMarkers = this.#markers
    const savedDefaults = this.#defaults
    const savedLoopDepth = this.#loopDepth
    const savedReadCursor = this.#readCursor
    this.#bindings = paramBindings
    this.#scopes = [new Map(paramValues)]
    this.#aliasOverrides = []
    this.#markers = new Map()
    this.#defaults = {}
    this.#loopDepth = 0
    this.#callStack.push(def.name)
    let current = cursor
    try {
      if (def.defaults) {
        const duration =
          def.defaults.duration !== undefined
            ? this.#evaluateNumber(def.defaults.duration, 'a duration in seconds')
            : undefined
        let ease: string | undefined
        if (def.defaults.ease !== undefined && def.defaults.easeSpan !== undefined) {
          if (resolveScriptEase(def.defaults.ease)) {
            ease = def.defaults.ease
          } else {
            const suggestion = nearMissSuggestion(def.defaults.ease, SCRIPT_EASE_NAMES)
            this.#error(`Unknown ease "${def.defaults.ease}".${suggestion}`, def.defaults.easeSpan)
          }
        }
        const validatedDuration =
          duration !== undefined && duration !== null && def.defaults.duration
            ? this.#validateDuration(duration, def.defaults.duration.span)
              ? { seconds: duration, span: def.defaults.duration.span }
              : undefined
            : undefined
        this.#defaults = {
          ...(validatedDuration !== undefined ? { duration: validatedDuration } : {}),
          ...(ease !== undefined ? { ease } : {}),
        }
      }
      for (const child of def.body) {
        if (!this.#claimUnrolledSlot(child.span)) {
          break
        }
        current = this.#lowerStatement(child, current)
      }
    } finally {
      this.#callStack.pop()
      this.#bindings = savedBindings
      this.#scopes = savedScopes
      this.#aliasOverrides = savedOverrides
      this.#markers = savedMarkers
      this.#defaults = savedDefaults
      this.#loopDepth = savedLoopDepth
      this.#readCursor = savedReadCursor
    }
    void call
    return current
  }

  #declareBinding(statement: BindNode): void {
    const existing = this.#bindings.get(statement.alias)
    if (existing) {
      // A loop body unrolls the same `bind` source once per iteration; the
      // second copy is the same declaration, not a duplicate.
      if (
        existing.aliasSpan.start === statement.aliasSpan.start &&
        existing.aliasSpan.end === statement.aliasSpan.end
      ) {
        return
      }
      this.#error(`Binding "${statement.alias}" is already declared`, statement.aliasSpan)
      return
    }
    if (this.#lookupOverride(statement.alias) !== undefined) {
      this.#error(
        `Name "${statement.alias}" is already used by a loop variable`,
        statement.aliasSpan,
      )
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
    if (this.#functions.has(statement.alias)) {
      this.#error(
        `Name "${statement.alias}" is already used by a function — call it like ${statement.alias}(...)`,
        statement.aliasSpan,
      )
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
    if (statement.resourceKind === 'clip') {
      this.#declareClipBinding(statement)
      return
    }
    if (statement.resourceKind === 'collection') {
      this.#declareCollectionBinding(statement)
      return
    }
    this.#error(
      `Unknown binding kind "${statement.resourceKind}". Available kinds: node, group, table, clip, collection.`,
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
   * `clip("name")` binds one project Clip Definition by exact name. The
   * compiler only references it — definitions are never minted. Zero matches
   * and ambiguous names are compile errors, mirroring node bindings.
   */
  #declareClipBinding(statement: BindNode): void {
    const matches = this.#context.clips.filter((clip) => clip.name === statement.resourceName)
    if (matches.length === 0) {
      const suggestion = nearMissSuggestion(
        statement.resourceName,
        this.#context.clips.map((clip) => clip.name),
      )
      this.#error(
        `No clip named "${statement.resourceName}".${suggestion}`,
        statement.resourceNameSpan,
      )
      return
    }
    if (matches.length > 1) {
      this.#error(
        `Clip name "${statement.resourceName}" is ambiguous — ${matches.length} clips share it`,
        statement.resourceNameSpan,
      )
      return
    }
    const clip = matches[0]
    this.#bindings.set(statement.alias, {
      alias: statement.alias,
      aliasSpan: statement.aliasSpan,
      kind: 'clip',
      members: [],
      clip,
      used: false,
    })
  }

  /**
   * `collection("name")` binds one project Clip Collection by exact name.
   * Broadcast placement resolves its Semantic Name bindings at `apply` time.
   */
  #declareCollectionBinding(statement: BindNode): void {
    const matches = this.#context.collections.filter(
      (collection) => collection.name === statement.resourceName,
    )
    if (matches.length === 0) {
      const suggestion = nearMissSuggestion(
        statement.resourceName,
        this.#context.collections.map((collection) => collection.name),
      )
      this.#error(
        `No collection named "${statement.resourceName}".${suggestion}`,
        statement.resourceNameSpan,
      )
      return
    }
    if (matches.length > 1) {
      this.#error(
        `Collection name "${statement.resourceName}" is ambiguous — ${matches.length} collections share it`,
        statement.resourceNameSpan,
      )
      return
    }
    const collection = matches[0]
    this.#bindings.set(statement.alias, {
      alias: statement.alias,
      aliasSpan: statement.aliasSpan,
      kind: 'collection',
      members: [],
      collection,
      used: false,
    })
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
      case 'repeat':
        return this.#lowerRepeat(statement, cursor)
      case 'for':
        return this.#lowerFor(statement, cursor)
      case 'stagger':
        return this.#lowerStagger(statement, cursor)
      case 'setText':
        return this.#lowerSetText(statement, cursor)
      case 'statement':
        return this.#lowerCall(statement, cursor)
      case 'function':
        this.#declareFunction(statement)
        return cursor
      case 'functionCall':
        return this.#lowerFunctionCall(statement, cursor)
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
    if (this.#loopDepth > 0) {
      this.#error(
        `Marker "${statement.name}" cannot be declared inside a repeat/for/stagger body — a label would duplicate per iteration`,
        statement.nameSpan,
      )
      return cursor
    }
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

  /**
   * `repeat(n) { ... }` unrolls at compile time to plain keyframes — no runtime
   * loop exists. The cursor advances by the unrolled sum; `repeat(0)` warns and
   * advances zero. Each iteration runs in its own `let` scope so body locals
   * never collide across iterations; `bind` declarations are idempotent by
   * source span for the same reason.
   */
  #lowerRepeat(statement: RepeatNode, cursor: number): number {
    if (containsDurationUnit(statement.count)) {
      this.#error(
        `Expected the repeat count without a duration suffix, found "${this.#source.slice(statement.count.span.start, statement.count.span.end)}"`,
        statement.count.span,
      )
      return cursor
    }
    const count = this.#evaluateNumber(statement.count, 'a repeat count')
    if (count === null) return cursor
    if (!Number.isInteger(count) || count < 0) {
      this.#error('repeat count must be a whole number, zero or greater', statement.count.span)
      return cursor
    }
    if (count === 0) {
      this.#warning('repeat(0) does nothing — the body never runs', statement.count.span)
      this.#reportLoopBodyMarks(statement.body)
      return cursor
    }
    if (count > SCRIPT_MAX_LOOP_ITERATIONS) {
      this.#error(
        `repeat(${count}) would unroll past the compile budget of ${SCRIPT_MAX_LOOP_ITERATIONS} iterations`,
        statement.count.span,
      )
      return cursor
    }
    let current = cursor
    this.#loopDepth += 1
    try {
      for (let index = 0; index < count; index += 1) {
        this.#scopes.push(new Map())
        try {
          for (const child of statement.body) {
            if (!this.#claimUnrolledSlot(child.span)) {
              return current
            }
            current = this.#lowerStatement(child, current)
          }
        } finally {
          this.#scopes.pop()
        }
      }
    } finally {
      this.#loopDepth -= 1
    }
    return current
  }

  /**
   * `for x in <list> { ... }` unrolls once per element. A list literal may hold
   * binding aliases (`for e in [e0, e1]`, each iteration rebinding `e` to that
   * alias's members), numbers, and data-row records (`for row in rows` where
   * `rows` is a `list<record>` parameter); a `let` variable, a parameter, or
   * `range(...)` may hold numbers, records, strings, lists, or bindings
   * threaded as values.
   */
  #lowerFor(statement: ForNode, cursor: number): number {
    const elements = this.#resolveForElements(statement)
    if (elements === null) return cursor
    if (elements.length === 0) {
      this.#reportLoopBodyMarks(statement.body)
      return cursor
    }
    if (elements.length > SCRIPT_MAX_LOOP_ITERATIONS) {
      this.#error(
        `for "${statement.variable}" would unroll ${elements.length} iterations, past the compile budget of ${SCRIPT_MAX_LOOP_ITERATIONS}`,
        statement.iterable.span,
      )
      return cursor
    }
    if (!this.#declareLoopVariable(statement)) return cursor
    let current = cursor
    this.#loopDepth += 1
    try {
      for (const element of elements) {
        this.#scopes.push(new Map())
        this.#aliasOverrides.push(new Map())
        try {
          if (element.kind === 'number') {
            this.#scopes[this.#scopes.length - 1].set(statement.variable, {
              kind: 'number',
              value: element.value,
            })
          } else if (element.kind === 'record' || element.kind === 'list') {
            this.#scopes[this.#scopes.length - 1].set(statement.variable, element.value)
          } else if (element.kind === 'string') {
            this.#scopes[this.#scopes.length - 1].set(statement.variable, {
              kind: 'string',
              value: element.value,
            })
          } else {
            this.#aliasOverrides[this.#aliasOverrides.length - 1].set(statement.variable, {
              alias: statement.variable,
              aliasSpan: statement.variableSpan,
              kind: element.binding.kind,
              members: element.binding.members,
              ...(element.binding.grid !== undefined ? { grid: element.binding.grid } : {}),
              ...(element.binding.clip !== undefined ? { clip: element.binding.clip } : {}),
              ...(element.binding.collection !== undefined
                ? { collection: element.binding.collection }
                : {}),
              used: false,
            })
            element.binding.used = true
          }
          for (const child of statement.body) {
            if (!this.#claimUnrolledSlot(child.span)) {
              return current
            }
            current = this.#lowerStatement(child, current)
          }
        } finally {
          this.#scopes.pop()
          this.#aliasOverrides.pop()
        }
      }
    } finally {
      this.#loopDepth -= 1
    }
    return current
  }

  /**
   * `stagger(step, targets) { ... }` runs its body once per target, starting
   * member `i` at `cursor + i×step`. The block advances by the latest member
   * end — `(n−1)×step + body extent` for deterministic bodies — so cascades are
   * one statement. Targets accept a group binding or a list of node bindings in
   * order; an empty target list is a compile error.
   */
  #lowerStagger(statement: StaggerNode, cursor: number): number {
    const step = this.#evaluateNumber(statement.step, 'a stagger step in seconds')
    if (step === null) return cursor
    if (!Number.isFinite(step) || step < 0) {
      this.#error('stagger step must be a non-negative number of seconds', statement.step.span)
      return cursor
    }
    const targets = this.#resolveStaggerTargets(statement)
    if (!targets) return cursor
    if (targets.members.length === 0) {
      this.#error(
        `stagger needs at least one target — "${this.#source.slice(statement.targets.span.start, statement.targets.span.end)}" resolves to no nodes`,
        statement.targets.span,
      )
      return cursor
    }
    if (targets.members.length > SCRIPT_MAX_LOOP_ITERATIONS) {
      this.#error(
        `stagger would unroll ${targets.members.length} targets, past the compile budget of ${SCRIPT_MAX_LOOP_ITERATIONS}`,
        statement.targets.span,
      )
      return cursor
    }
    let latest = cursor
    this.#loopDepth += 1
    try {
      for (let index = 0; index < targets.members.length; index += 1) {
        const member = targets.members[index]
        const start = roundTime(cursor + index * step)
        this.#scopes.push(new Map())
        this.#aliasOverrides.push(new Map())
        try {
          for (const alias of targets.rebindAliases) {
            this.#aliasOverrides[this.#aliasOverrides.length - 1].set(alias, {
              alias,
              aliasSpan: statement.targets.span,
              kind: 'node',
              members: [member],
              used: false,
            })
          }
          let current = start
          for (const child of statement.body) {
            if (!this.#claimUnrolledSlot(child.span)) {
              return latest
            }
            current = this.#lowerStatement(child, current)
          }
          if (current > latest) latest = current
        } finally {
          this.#scopes.pop()
          this.#aliasOverrides.pop()
        }
      }
    } finally {
      this.#loopDepth -= 1
    }
    return latest
  }

  /** One unrolled body statement against the whole-compile budget. */
  #claimUnrolledSlot(span: SourceSpan): boolean {
    if (this.#unrolledStatements >= SCRIPT_MAX_UNROLLED_STATEMENTS) {
      this.#error(
        `Unrolled loops pass the compile budget of ${SCRIPT_MAX_UNROLLED_STATEMENTS} statements — split the loop or shorten the body`,
        span,
      )
      return false
    }
    this.#unrolledStatements += 1
    return true
  }

  /**
   * Report markers inside a loop body that never unrolls (repeat(0), empty
   * for). Live iterations report via #lowerMark; zero-trip bodies still violate
   * the one-label rule syntactically, so scan without planning anything.
   */
  #reportLoopBodyMarks(body: readonly ScriptStatementNode[]): void {
    for (const child of body) {
      if (child.kind === 'mark') {
        this.#error(
          `Marker "${child.name}" cannot be declared inside a repeat/for/stagger body — a label would duplicate per iteration`,
          child.nameSpan,
        )
      } else if (
        child.kind === 'parallel' ||
        child.kind === 'repeat' ||
        child.kind === 'for' ||
        child.kind === 'stagger'
      ) {
        this.#reportLoopBodyMarks(child.body)
      } else if (child.kind === 'at') {
        this.#reportLoopBodyMarks([child.statement])
      }
    }
  }

  /**
   * Declare a `for` loop variable. Loop variables live in per-iteration scopes,
   * so they shadow outer `let`s and outer loop variables like a nested block;
   * only global bindings and built-ins collide.
   */
  #declareLoopVariable(statement: ForNode): boolean {
    if (this.#bindings.has(statement.variable)) {
      this.#error(
        `Name "${statement.variable}" is already used by a binding`,
        statement.variableSpan,
      )
      return false
    }
    if (this.#functions.has(statement.variable)) {
      this.#error(
        `Name "${statement.variable}" is already used by a function`,
        statement.variableSpan,
      )
      return false
    }
    if (
      SCRIPT_BUILTIN_NAMES.includes(statement.variable) ||
      (SCRIPT_RESERVED_NAMES as readonly string[]).includes(statement.variable)
    ) {
      this.#error(`Name "${statement.variable}" is reserved by a built-in`, statement.variableSpan)
      return false
    }
    return true
  }

  /**
   * Resolve a `for` iterable to its elements. A list literal may mix binding
   * aliases (each an iteration over that alias's members), numbers, strings,
   * records, and nested lists; any other list (a `let` variable, a function
   * parameter, `range(...)`) may hold numbers, records, strings, lists, or
   * bindings threaded as values.
   */
  #resolveForElements(statement: ForNode): ForElement[] | null {
    const iterable = statement.iterable
    if (iterable.kind === 'list') {
      const elements: ForElement[] = []
      for (const item of iterable.elements) {
        if (item.kind === 'identifier') {
          const binding = this.#lookupBinding(item.name)
          if (binding) {
            binding.used = true
            elements.push({ kind: 'binding', binding })
            continue
          }
        }
        const value = this.#evaluateValue(item)
        if (value === null || value.kind === 'invalid') return null
        if (value.kind === 'number') {
          elements.push({ kind: 'number', value: value.value })
          continue
        }
        if (value.kind === 'binding') {
          const binding = bindingOf(value)
          if (binding) {
            elements.push({ kind: 'binding', binding })
            continue
          }
          return null
        }
        if (value.kind === 'record' || value.kind === 'string' || value.kind === 'list') {
          elements.push({ kind: value.kind, value } as ForElement)
          continue
        }
        this.#error(
          `for "${statement.variable}" lists accept node bindings, records, strings, lists and numbers — found ${describeScriptValue(value)}`,
          item.span,
        )
        return null
      }
      return elements
    }
    if (iterable.kind === 'identifier') {
      const binding = this.#lookupBinding(iterable.name)
      if (binding && this.#lookupValue(iterable.name) === undefined) {
        this.#error(
          `for "${statement.variable}" needs a list to iterate — binding "${binding.alias}" is a ${binding.kind}, not a list. Use a list like [a, b, c] or range(0, 3, 1).`,
          iterable.span,
        )
        return null
      }
    }
    const value = this.#evaluateValue(iterable)
    if (value === null || value.kind === 'invalid') return null
    if (value.kind !== 'list') {
      this.#error(
        `for "${statement.variable}" needs a list to iterate, like for ${statement.variable} in [a, b, c] or for ${statement.variable} in range(0, 3, 1) — found ${describeScriptValue(value)}`,
        iterable.span,
      )
      return null
    }
    const elements: ForElement[] = []
    for (const item of value.values) {
      if (item.kind === 'number') {
        elements.push({ kind: 'number', value: item.value })
        continue
      }
      if (item.kind === 'binding') {
        const binding = bindingOf(item)
        if (binding) {
          elements.push({ kind: 'binding', binding })
          continue
        }
        return null
      }
      if (item.kind === 'record' || item.kind === 'string' || item.kind === 'list') {
        elements.push({ kind: item.kind, value: item } as ForElement)
        continue
      }
      if (item.kind === 'invalid') return null
      this.#error(
        `for "${statement.variable}" lists accept node bindings, records, strings, lists and numbers — found ${describeScriptValue(item)}. Bindings may be listed inline, like [a, b, c].`,
        iterable.span,
      )
      return null
    }
    return elements
  }

  /** Resolve stagger targets to ordered members plus aliases to rebind per member. */
  #resolveStaggerTargets(statement: StaggerNode): {
    members: readonly ScriptMember[]
    rebindAliases: readonly string[]
  } | null {
    const targets = statement.targets
    if (targets.kind === 'identifier') {
      const binding = this.#lookupBinding(targets.name)
      if (binding) {
        binding.used = true
        return { members: binding.members, rebindAliases: [binding.alias] }
      }
      const value = this.#lookupValue(targets.name)
      if (value !== undefined) {
        if (value.kind === 'list') {
          const members: ScriptMember[] = []
          for (const element of value.values) {
            if (element.kind !== 'binding') {
              this.#error(
                `stagger targets need a group binding or a list of node bindings — "${targets.name}" holds ${describeScriptValue(element)}, not a node`,
                targets.span,
              )
              return null
            }
            const memberBinding = bindingOf(element)
            if (!memberBinding || memberBinding.members.length !== 1) {
              this.#error(
                `stagger targets need a group binding or a list of node bindings — "${targets.name}" holds an empty target`,
                targets.span,
              )
              return null
            }
            memberBinding.used = true
            members.push(memberBinding.members[0])
          }
          if (members.length === 0) {
            this.#error(
              `stagger needs at least one target — "${targets.name}" resolves to no nodes`,
              targets.span,
            )
            return null
          }
          return { members, rebindAliases: [targets.name] }
        }
        if (value.kind === 'binding') {
          const memberBinding = bindingOf(value)
          if (memberBinding) {
            memberBinding.used = true
            return { members: memberBinding.members, rebindAliases: [targets.name] }
          }
        }
        this.#error(
          `stagger targets need a group binding or a list of node bindings — "${targets.name}" is ${describeScriptValue(value)}, not a node or group`,
          targets.span,
        )
        return null
      }
      const suggestion = nearMissSuggestion(targets.name, [
        ...this.#bindings.keys(),
        ...this.#overrideNames(),
      ])
      this.#error(`Unknown binding "${targets.name}".${suggestion}`, targets.span)
      return null
    }
    if (targets.kind === 'member') {
      const value = this.#evaluateValue(targets)
      if (value === null || value.kind === 'invalid') return null
      if (value.kind === 'binding') {
        const memberBinding = bindingOf(value)
        if (memberBinding) {
          memberBinding.used = true
          return { members: memberBinding.members, rebindAliases: [] }
        }
        return null
      }
      if (value.kind === 'list') {
        const members: ScriptMember[] = []
        for (const element of value.values) {
          if (element.kind !== 'binding') {
            this.#error(
              'stagger targets need a group binding or a list of node bindings',
              targets.span,
            )
            return null
          }
          const memberBinding = bindingOf(element)
          if (!memberBinding || memberBinding.members.length !== 1) {
            this.#error('stagger targets need single-node bindings', targets.span)
            return null
          }
          memberBinding.used = true
          members.push(memberBinding.members[0])
        }
        if (members.length === 0) {
          this.#error(
            'stagger needs at least one target — the list resolves to no nodes',
            targets.span,
          )
          return null
        }
        return { members, rebindAliases: [] }
      }
      this.#error(
        'stagger targets need a group binding or a list of node bindings, like stagger(0.2s, cards) or stagger(0.2s, [c1, c2])',
        targets.span,
      )
      return null
    }
    if (targets.kind === 'list') {
      if (targets.elements.length === 0) {
        this.#error(
          'stagger needs at least one target — an empty list staggers nothing',
          targets.span,
        )
        return null
      }
      const members: ScriptMember[] = []
      const rebindAliases: string[] = []
      for (const item of targets.elements) {
        if (item.kind !== 'identifier') {
          this.#error(
            'stagger lists accept node bindings, like stagger(0.2s, [c1, c2, c3])',
            item.span,
          )
          return null
        }
        const binding = this.#lookupBinding(item.name)
        if (!binding) {
          const suggestion = nearMissSuggestion(item.name, [
            ...this.#bindings.keys(),
            ...this.#overrideNames(),
          ])
          this.#error(`Unknown binding "${item.name}".${suggestion}`, item.span)
          return null
        }
        if (binding.kind === 'group') {
          this.#error(
            `stagger lists accept node bindings — "${binding.alias}" is a group. Pass the group directly, like stagger(0.2s, ${binding.alias}).`,
            item.span,
          )
          return null
        }
        binding.used = true
        if (binding.members.length !== 1) {
          this.#error(
            `stagger lists accept node bindings — "${binding.alias}" resolves to no nodes`,
            item.span,
          )
          return null
        }
        members.push(binding.members[0])
        if (!rebindAliases.includes(binding.alias)) rebindAliases.push(binding.alias)
      }
      return { members, rebindAliases }
    }
    this.#error(
      'stagger targets need a group binding or a list of node bindings, like stagger(0.2s, cards) or stagger(0.2s, [c1, c2])',
      targets.span,
    )
    return null
  }

  /** A binding by alias, checking loop-local overrides before globals. */
  #lookupBinding(name: string): BindingInfo | undefined {
    const override = this.#lookupOverride(name)
    if (override) return override
    return this.#bindings.get(name)
  }

  #lookupOverride(name: string): BindingInfo | undefined {
    for (let index = this.#aliasOverrides.length - 1; index >= 0; index -= 1) {
      const found = this.#aliasOverrides[index].get(name)
      if (found) return found
    }
    return undefined
  }

  #overrideNames(): string[] {
    const names: string[] = []
    for (const scope of this.#aliasOverrides) {
      for (const name of scope.keys()) {
        if (!names.includes(name)) names.push(name)
      }
    }
    return names
  }

  #lowerCall(statement: StatementNode, cursor: number): number {
    const binding = this.#resolveReceiver(statement)
    if (!binding) {
      return this.#advanceCursorByResolvedDuration(statement, cursor)
    }
    const target = this.#resolveTarget(statement, binding)
    if (!target) {
      return this.#advanceCursorByResolvedDuration(statement, cursor)
    }
    if (statement.method === 'play' || statement.method === 'apply') {
      if (target.kind === 'clip' || target.kind === 'collection') {
        this.#error(
          `"${statement.method}" needs a node to play on — "${target.alias}" is a ${target.kind}. Bind a node first, like bind hero = node("Hero").`,
          statement.aliasSpan,
        )
        return cursor
      }
      if (statement.method === 'play') {
        return this.#lowerPlay(statement, target, cursor)
      }
      return this.#lowerApply(statement, target, cursor)
    }
    if (target.kind === 'clip' || target.kind === 'collection') {
      this.#error(
        `"${statement.method}" needs a node binding — "${target.alias}" is a ${target.kind}. Play clips with node.play(clip, ...) instead.`,
        statement.aliasSpan,
      )
      return this.#advanceCursorByResolvedDuration(statement, cursor)
    }
    switch (statement.method) {
      case 'tween':
        return this.#lowerTween(statement, target, cursor)
      case 'set':
        return this.#lowerSet(statement, target, cursor)
      case 'move':
        return this.#lowerMove(statement, target, cursor)
      case 'fadeIn':
        return this.#lowerFade(statement, target, cursor, 1)
      case 'fadeOut':
        return this.#lowerFade(statement, target, cursor, 0)
      case 'tint':
        return this.#lowerTint(statement, target, cursor)
      case 'pulse':
        return this.#lowerPulse(statement, target, cursor)
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
    const binding = this.#lookupBinding(statement.alias)
    if (binding) {
      binding.used = true
      return binding
    }
    if (this.#lookupValue(statement.alias) !== undefined) {
      this.#error(
        `Binding "${statement.alias}" is a value — declare a node with bind first, or use it as a number`,
        statement.aliasSpan,
      )
      return null
    }
    if (this.#functions.has(statement.alias)) {
      this.#error(
        `Binding "${statement.alias}" is a function — call it like ${statement.alias}(...)`,
        statement.aliasSpan,
      )
      return null
    }
    const suggestion = nearMissSuggestion(statement.alias, [
      ...this.#bindings.keys(),
      ...this.#overrideNames(),
    ])
    this.#error(`Unknown binding "${statement.alias}".${suggestion}`, statement.aliasSpan)
    return null
  }

  /**
   * Resolve a statement receiver `alias[.field]*[.selector].method`: a plain
   * binding alias, or a record field path (`row.target`) where the base is a
   * data-row record (a loop variable or a function parameter) and the final
   * field holds a node/group/table/cell reference.
   */
  #resolveReceiver(statement: StatementNode): BindingInfo | null {
    if (statement.fields.length === 0) {
      return this.#resolveAlias(statement)
    }
    let current = this.#lookupValue(statement.alias)
    if (current === undefined) {
      const binding = this.#lookupBinding(statement.alias)
      if (binding) {
        this.#error(
          `"${statement.fields[0].name}" cannot be read from binding "${statement.alias}" — only record values have fields`,
          statement.fields[0].nameSpan,
        )
        return null
      }
      if (this.#functions.has(statement.alias)) {
        this.#error(
          `Binding "${statement.alias}" is a function — call it like ${statement.alias}(...)`,
          statement.aliasSpan,
        )
        return null
      }
      const suggestion = nearMissSuggestion(statement.alias, [
        ...this.#valueNames(),
        ...this.#bindings.keys(),
        ...this.#overrideNames(),
      ])
      this.#error(`Unknown name "${statement.alias}".${suggestion}`, statement.aliasSpan)
      return null
    }
    for (let index = 0; index < statement.fields.length; index += 1) {
      const field = statement.fields[index]
      if (current.kind === 'invalid') return null
      if (current.kind !== 'record') {
        this.#error(
          `"${field.name}" cannot be read from ${describeScriptValue(current)} — only record values have fields`,
          field.nameSpan,
        )
        return null
      }
      const next = current.fields.get(field.name)
      if (next === undefined) {
        const suggestion = nearMissSuggestion(field.name, [...current.fields.keys()])
        this.#error(
          `"${field.name}" is not a field of ${current.label} — available fields: ${[...current.fields.keys()].join(', ')}.${suggestion}`,
          field.nameSpan,
        )
        return null
      }
      current = next
    }
    if (current.kind === 'invalid') return null
    if (current.kind !== 'binding') {
      this.#error(
        `Receiver "${statement.alias}.${statement.fields.map((field) => field.name).join('.')}" is ${describeScriptValue(current)}, not a node — data-row fields holding nodes address statements, like row.target.tween({...})`,
        statement.fields[statement.fields.length - 1].nameSpan,
      )
      return null
    }
    const binding = bindingOf(current)
    if (!binding) return null
    binding.used = true
    return binding
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
   * `move({ x?, y?, rotation? }, duration?, ease?)`: compiler sugar over the
   * transform surface. Only the three move keys are legal; every value
   * validates exactly like the equivalent raw tween entry.
   */
  #lowerMove(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateMoveEntries(statement, binding),
    )
  }

  /**
   * `fadeIn(d?, e?)` / `fadeOut(d?, e?)`: opacity to 1/0 from the evaluated
   * value. Always opacity, never the `visible` lane — the same two keyframes
   * a raw `tween({ opacity })` would emit.
   */
  #lowerFade(
    statement: StatementNode,
    binding: BindingInfo,
    cursor: number,
    target: 0 | 1,
  ): number {
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateFadeEntries(statement, binding, target),
    )
  }

  /**
   * `tint(color, d?, e?)`: the material tint. Bare `tint(color)` is a set at
   * the cursor (advance 0, ignoring header defaults); with an explicit timing
   * argument it tweens from the evaluated tint like a raw tween would.
   */
  #lowerTint(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    if (isBareTint(statement)) {
      return this.#lowerTintSet(statement, binding, cursor)
    }
    return this.#lowerTweenLike(statement, cursor, () =>
      this.#validateTintEntries(statement, binding),
    )
  }

  /** `pulse(d?, e?)`: scale to ×1.1 at half duration and back to the start. */
  #lowerPulse(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    const duration = this.#resolveDuration(statement)
    if (duration.kind === 'missing') {
      this.#error(
        `pulse needs a duration — pass one, like pulse(0.4), or set defaults { duration }`,
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
    const endTime = roundTime(cursor + duration.seconds)
    if (ease === null) {
      return endTime
    }
    if (endTime > this.#context.slideDuration) {
      this.#error(
        `Statement ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        duration.span,
      )
      return endTime
    }
    const midTime = roundTime(cursor + duration.seconds / 2)
    for (const member of binding.members) {
      for (const property of ['scaleX', 'scaleY'] as const) {
        const track: ScriptTrack = { kind: 'node', property }
        // Plan the start pin first so a previous statement's end value on the
        // same track wins (statement-order priority, like sequential tweens);
        // the peak and the return then derive from that effective start.
        this.#plan(member, track, cursor, ease.ease, null)
        const startValue = this.#planned.get(slotKeyFor(member.nodeId, track, cursor))
          ?.value as unknown as number
        const peakValue = startValue * 1.1
        this.#plan(member, track, midTime, ease.ease, { value: peakValue })
        this.#plan(member, track, endTime, ease.ease, {
          value: startValue,
        })
      }
    }
    return endTime
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
        statement.method === 'fadeIn' ||
        statement.method === 'fadeOut' ||
        statement.method === 'pulse'
          ? `${statement.method}(0.4)`
          : statement.args.length > 0
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
   * `node.play(clip, { at?, duration? xor speed?, enabled?, params? })` lowers
   * to one Clip Instance per addressed node. `duration` and `speed` are
   * mutually exclusive with `speed = clip.duration / duration`; a visual
   * duration below the engine minimum or a speed at the clamp warns. Later
   * statements append later and win (statement order is priority).
   */
  #lowerPlay(statement: StatementNode, target: BindingInfo, cursor: number): number {
    if (statement.args.length === 0 || statement.args.length > 2) {
      this.#error(
        `play takes a clip and at most one options argument, like play(wave) or play(wave, { duration: 1.2 })`,
        statement.methodSpan,
      )
      return cursor
    }
    const clipBinding = this.#resolveClipReference(statement.args[0])
    const options = this.#parsePlayOptions(statement.args[1])
    if (!clipBinding || !options) return cursor
    const clip = clipBinding.clip
    if (!clip) return cursor
    if (target.members.length === 0) {
      this.#error(
        `play needs at least one node — "${target.alias}" resolves to no nodes`,
        statement.aliasSpan,
      )
      return cursor
    }
    if (options.duration !== undefined && options.speed !== undefined) {
      this.#error(
        `play takes duration or speed, not both — speed is clip.duration / duration`,
        statement.args[1]?.span ?? statement.methodSpan,
      )
      return cursor
    }
    let requestedSpeed: number
    let visual: number
    if (options.duration !== undefined) {
      visual = options.duration.seconds
      if (visual <= 0) {
        this.#error(`play duration must be greater than 0`, options.duration.span)
        return cursor
      }
      requestedSpeed = clip.duration / visual
    } else if (options.speed !== undefined) {
      requestedSpeed = options.speed.value
      if (requestedSpeed < 0 || !Number.isFinite(requestedSpeed)) {
        this.#error(`play speed must be a non-negative number`, options.speed.span)
        return cursor
      }
      visual = clip.duration / Math.max(requestedSpeed, MIN_CLIP_SPEED)
    } else {
      requestedSpeed = 1
      visual = clip.duration
    }
    if (!Number.isFinite(requestedSpeed) || !Number.isFinite(visual)) {
      this.#error(
        `play on clip "${clip.name}" produces a non-finite visual duration — pass a finite duration or speed`,
        statement.methodSpan,
      )
      return cursor
    }
    let effectiveSpeed = requestedSpeed
    if (effectiveSpeed < MIN_CLIP_SPEED) {
      this.#warning(
        `play on clip "${clip.name}" clamps speed ${formatSeconds(requestedSpeed)} to the engine minimum (${MIN_CLIP_SPEED})`,
        options.speed?.span ?? statement.methodSpan,
      )
      effectiveSpeed = MIN_CLIP_SPEED
      visual = clip.duration / effectiveSpeed
    }
    if (visual < MIN_VISUAL_DURATION) {
      this.#warning(
        `play on clip "${clip.name}" has a visual duration of ${formatSeconds(visual)}s, below the engine minimum (${MIN_VISUAL_DURATION}s)`,
        options.duration?.span ?? statement.methodSpan,
      )
    }
    const overrides = this.#validatePlayParams(options, clip)
    if (overrides === null) return cursor
    const start = options.at !== undefined ? options.at.seconds : cursor
    if (options.at !== undefined) {
      if (start < this.#from) {
        this.#error(
          `"at" cannot be before the segment start (from = ${formatSeconds(this.#from)}s)`,
          options.at.span,
        )
      } else if (start > this.#context.slideDuration) {
        this.#error(
          `"at" is past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
          options.at.span,
        )
      }
    }
    const endTime = roundTime(start + visual)
    if (endTime > this.#context.slideDuration) {
      this.#error(
        `Statement ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        options.duration?.span ?? statement.methodSpan,
      )
      return options.at !== undefined ? Math.max(cursor, endTime) : endTime
    }
    const enabled = options.enabled?.value ?? true
    for (const member of target.members) {
      this.#clipCommands.push({
        order: this.#order++,
        command: new AssignClipCommand({
          nodeId: member.nodeId,
          clipId: clip.id,
          startTime: start,
          speed: effectiveSpeed,
          enabled,
          paramOverrides: { ...overrides },
        }),
      })
      this.#trackInstanceNode(member.nodeId)
      this.#instanceCount += 1
    }
    return options.at !== undefined ? Math.max(cursor, endTime) : endTime
  }

  /**
   * `node.apply(collection, { at?, duration? })` places a Clip Collection by
   * Semantic Name broadcast with timing only. Each addressed parent gets one
   * placement at the start time; the cursor advances by the explicit duration
   * or the placed span (the max member visual).
   */
  #lowerApply(statement: StatementNode, target: BindingInfo, cursor: number): number {
    if (statement.args.length === 0 || statement.args.length > 2) {
      this.#error(
        `apply takes a collection and at most one options argument, like apply(rig) or apply(rig, { duration: 1.2 })`,
        statement.methodSpan,
      )
      return cursor
    }
    const collectionBinding = this.#resolveCollectionReference(statement.args[0])
    const options = this.#parseApplyOptions(statement.args[1])
    if (!collectionBinding || !options) return cursor
    const collection = collectionBinding.collection
    if (!collection) return cursor
    if (target.members.length === 0) {
      this.#error(
        `apply needs at least one node — "${target.alias}" resolves to no nodes`,
        statement.aliasSpan,
      )
      return cursor
    }
    const start = options.at !== undefined ? options.at.seconds : cursor
    if (options.at !== undefined) {
      if (start < this.#from) {
        this.#error(
          `"at" cannot be before the segment start (from = ${formatSeconds(this.#from)}s)`,
          options.at.span,
        )
      } else if (start > this.#context.slideDuration) {
        this.#error(
          `"at" is past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
          options.at.span,
        )
      }
    }
    let naturalSpan = 0
    let memberCount = 0
    let failed = false
    for (const parent of target.members) {
      const placed = this.#collectionPlacedSpan(collection, parent, statement.args[0].span)
      if (placed === null) {
        failed = true
        continue
      }
      if (placed.span > naturalSpan) naturalSpan = placed.span
      memberCount += placed.memberCount
    }
    if (failed) return cursor
    const extent = options.duration !== undefined ? options.duration.seconds : naturalSpan
    const endTime = roundTime(start + extent)
    if (endTime > this.#context.slideDuration) {
      this.#error(
        `Statement ends at ${formatSeconds(endTime)}s, past the slide duration (${formatSeconds(this.#context.slideDuration)}s)`,
        options.duration?.span ?? statement.methodSpan,
      )
      return options.at !== undefined ? Math.max(cursor, endTime) : endTime
    }
    for (const parent of target.members) {
      this.#clipCommands.push({
        order: this.#order++,
        command: new PlaceCollectionCommand({
          collectionId: collection.id,
          parentNodeId: parent.nodeId,
          startTime: start,
        }),
      })
      this.#trackPlacementParent(parent.nodeId)
    }
    this.#instanceCount += memberCount
    return options.at !== undefined ? Math.max(cursor, endTime) : endTime
  }

  /** The clip binding a `play` resource argument references, or null after reporting. */
  #resolveClipReference(expression: ScriptExpression): BindingInfo | null {
    const value = this.#evaluateValue(expression)
    if (value === null || value.kind === 'invalid') return null
    if (value.kind !== 'binding') {
      this.#error(
        `play needs a clip binding — found ${describeScriptValue(value)}. Bind one first, like bind wave = clip("Robot Wave").`,
        expression.span,
      )
      return null
    }
    const binding = bindingOf(value)
    if (!binding) return null
    if (binding.kind !== 'clip' || !binding.clip) {
      const found = binding.kind === 'cellRef' ? 'a cell reference' : `a ${binding.kind} binding`
      this.#error(
        `play needs a clip binding — "${expressionLabel(expression)}" is ${found}.`,
        expression.span,
      )
      return null
    }
    binding.used = true
    return binding
  }

  /** The collection binding an `apply` resource argument references, or null after reporting. */
  #resolveCollectionReference(expression: ScriptExpression): BindingInfo | null {
    const value = this.#evaluateValue(expression)
    if (value === null || value.kind === 'invalid') return null
    if (value.kind !== 'binding') {
      this.#error(
        `apply needs a collection binding — found ${describeScriptValue(value)}. Bind one first, like bind rig = collection("Rig").`,
        expression.span,
      )
      return null
    }
    const binding = bindingOf(value)
    if (!binding) return null
    if (binding.kind !== 'collection' || !binding.collection) {
      const found = binding.kind === 'cellRef' ? 'a cell reference' : `a ${binding.kind} binding`
      this.#error(
        `apply needs a collection binding — "${expressionLabel(expression)}" is ${found}.`,
        expression.span,
      )
      return null
    }
    binding.used = true
    return binding
  }

  /** Parsed `play` options: inline `at`/`duration`/`speed`/`enabled`/`params`. */
  #parsePlayOptions(expression: ScriptExpression | undefined): {
    readonly at?: { readonly seconds: number; readonly span: SourceSpan }
    readonly duration?: { readonly seconds: number; readonly span: SourceSpan }
    readonly speed?: { readonly value: number; readonly span: SourceSpan }
    readonly enabled?: { readonly value: boolean; readonly span: SourceSpan }
    readonly params?: {
      readonly fields: readonly { readonly key: string; readonly value: ScriptExpression }[]
      readonly span: SourceSpan
    }
  } | null {
    if (expression === undefined) return {}
    if (expression.kind !== 'record') {
      const seconds = this.#evaluateNumber(expression, 'a duration in seconds')
      if (seconds === null) return null
      if (!this.#validateDuration(seconds, expression.span)) return null
      return { duration: { seconds, span: expression.span } }
    }
    let at: { seconds: number; span: SourceSpan } | undefined
    let duration: { seconds: number; span: SourceSpan } | undefined
    let speed: { value: number; span: SourceSpan } | undefined
    let enabled: { value: boolean; span: SourceSpan } | undefined
    let params:
      | {
          fields: readonly { readonly key: string; readonly value: ScriptExpression }[]
          span: SourceSpan
        }
      | undefined
    const seen = new Set<string>()
    for (const field of expression.fields) {
      if (seen.has(field.key)) continue
      seen.add(field.key)
      if (field.key === 'at') {
        const seconds = this.#evaluateNumber(field.value, 'a time in seconds')
        if (seconds === null) return null
        at = { seconds: roundTime(seconds), span: field.value.span }
      } else if (field.key === 'duration') {
        const seconds = this.#evaluateNumber(field.value, 'a duration in seconds')
        if (seconds === null) return null
        if (!this.#validateDuration(seconds, field.value.span)) return null
        duration = { seconds, span: field.value.span }
      } else if (field.key === 'speed') {
        if (containsDurationUnit(field.value)) {
          this.#error(
            `Expected speed without a duration suffix, found "${this.#source.slice(field.value.span.start, field.value.span.end)}"`,
            field.value.span,
          )
          return null
        }
        const value = this.#evaluateNumber(field.value, 'a speed')
        if (value === null) return null
        speed = { value, span: field.value.span }
      } else if (field.key === 'enabled') {
        const parsed = this.#parseEnabledOption(field.value)
        if (parsed === null) return null
        enabled = { value: parsed, span: field.value.span }
      } else if (field.key === 'params') {
        if (field.value.kind !== 'record') {
          this.#error(`params must be a record of numbers, like { gain: 0.5 }`, field.value.span)
          return null
        }
        params = {
          fields: field.value.fields.map((entry) => ({ key: entry.key, value: entry.value })),
          span: field.value.span,
        }
      } else {
        this.#error(
          `Unknown play option "${field.key}". Available options: at, duration, speed, enabled, params.`,
          field.keySpan,
        )
        return null
      }
    }
    return {
      ...(at !== undefined ? { at } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(params !== undefined ? { params } : {}),
    }
  }

  /** Parsed `apply` options: inline `at`/`duration` timing only. */
  #parseApplyOptions(expression: ScriptExpression | undefined): {
    readonly at?: { readonly seconds: number; readonly span: SourceSpan }
    readonly duration?: { readonly seconds: number; readonly span: SourceSpan }
  } | null {
    if (expression === undefined) return {}
    if (expression.kind !== 'record') {
      const seconds = this.#evaluateNumber(expression, 'a duration in seconds')
      if (seconds === null) return null
      if (!this.#validateDuration(seconds, expression.span)) return null
      return { duration: { seconds, span: expression.span } }
    }
    let at: { seconds: number; span: SourceSpan } | undefined
    let duration: { seconds: number; span: SourceSpan } | undefined
    const seen = new Set<string>()
    for (const field of expression.fields) {
      if (seen.has(field.key)) continue
      seen.add(field.key)
      if (field.key === 'at') {
        const seconds = this.#evaluateNumber(field.value, 'a time in seconds')
        if (seconds === null) return null
        at = { seconds: roundTime(seconds), span: field.value.span }
      } else if (field.key === 'duration') {
        const seconds = this.#evaluateNumber(field.value, 'a duration in seconds')
        if (seconds === null) return null
        if (!this.#validateDuration(seconds, field.value.span)) return null
        duration = { seconds, span: field.value.span }
      } else {
        this.#error(
          `Unknown apply option "${field.key}". Available options: at, duration.`,
          field.keySpan,
        )
        return null
      }
    }
    return { ...(at !== undefined ? { at } : {}), ...(duration !== undefined ? { duration } : {}) }
  }

  /** `enabled: true|false` — the one boolean slot in the v1 language. */
  #parseEnabledOption(expression: ScriptExpression): boolean | null {
    if (
      expression.kind === 'identifier' &&
      (expression.name === 'true' || expression.name === 'false')
    ) {
      return expression.name === 'true'
    }
    this.#error(`enabled must be true or false`, expression.span)
    return null
  }

  /** Numeric `params` overrides against the clip's declared params, or null after reporting. */
  #validatePlayParams(
    options: {
      readonly params?: {
        readonly fields: readonly { readonly key: string; readonly value: ScriptExpression }[]
        readonly span: SourceSpan
      }
    },
    clip: AnimationScriptClipInfo,
  ): Record<string, number> | null {
    const overrides: Record<string, number> = {}
    if (options.params === undefined) return overrides
    const seen = new Set<string>()
    for (const field of options.params.fields) {
      if (seen.has(field.key)) continue
      seen.add(field.key)
      if (containsDurationUnit(field.value)) {
        this.#error(
          `Expected ${field.key} without a duration suffix, found "${this.#source.slice(field.value.span.start, field.value.span.end)}"`,
          field.value.span,
        )
        return null
      }
      const value = this.#evaluateNumber(field.value, `a value for clip param "${field.key}"`)
      if (value === null) return null
      if (!clip.params.includes(field.key)) {
        const suggestion = nearMissSuggestion(field.key, [...clip.params])
        this.#error(
          `Clip "${clip.name}" has no param "${field.key}".${suggestion}`,
          field.value.span,
        )
        return null
      }
      overrides[field.key] = value
    }
    return overrides
  }

  /**
   * The placed span of a collection under one parent: the max member visual at
   * speed 1, floored to the engine minimum like the placement lane displays
   * it. Null after reporting when nothing matches or a referenced clip is
   * gone.
   */
  #collectionPlacedSpan(
    collection: AnimationScriptCollectionInfo,
    parent: ScriptMember,
    span: SourceSpan,
  ): { readonly span: number; readonly memberCount: number } | null {
    const descendants = this.#descendantsOf(parent.nodeId)
    const clipById = new Map(this.#context.clips.map((clip) => [clip.id, clip] as const))
    let maxDuration = 0
    let matched = 0
    for (const node of descendants) {
      const semantic = node.semanticName?.trim()
      if (!semantic) continue
      const clipId = collection.bindings[semantic]
      if (!clipId) continue
      const clip = clipById.get(clipId)
      if (!clip) {
        this.#error(
          `Collection "${collection.name}" references a clip that no longer exists (Semantic Name "${semantic}")`,
          span,
        )
        return null
      }
      matched += 1
      if (clip.duration > maxDuration) maxDuration = clip.duration
    }
    if (matched === 0) {
      this.#error(
        `Collection "${collection.name}" matches no nodes under "${parent.nodeName}" — no descendant carries a Semantic Name the collection binds`,
        span,
      )
      return null
    }
    return { span: Math.max(maxDuration, MIN_VISUAL_DURATION), memberCount: matched }
  }

  /** A parent plus its descendants in scene pre-order (the broadcast scope). */
  #descendantsOf(parentId: string): AnimationScriptNodeInfo[] {
    const byId = new Map(this.#context.nodes.map((node) => [node.id, node] as const))
    const parent = byId.get(parentId)
    if (!parent) return []
    const isBelow = (node: AnimationScriptNodeInfo): boolean => {
      let current: AnimationScriptNodeInfo | undefined = node
      while (current) {
        if (current.id === parentId) return true
        current = current.parentId !== undefined ? byId.get(current.parentId) : undefined
      }
      return false
    }
    return this.#context.nodes.filter(isBelow)
  }

  /** Record a `play` node for the footprint, first-addressed order, deduplicated. */
  #trackInstanceNode(nodeId: string): void {
    if (!this.#instanceNodes.includes(nodeId)) this.#instanceNodes.push(nodeId)
  }

  /** Record an `apply` parent for the footprint, first-addressed order, deduplicated. */
  #trackPlacementParent(nodeId: string): void {
    if (!this.#placementParents.includes(nodeId)) this.#placementParents.push(nodeId)
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
   * `move` accepts only the transform keys. Any other key names the key and
   * points at `tween`, so the restriction reads as intent rather than a
   * missing property.
   */
  #validateMoveEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    if (statement.entries.length === 0) {
      this.#error('move needs at least one property, like move({ x: 4 })', statement.methodSpan)
      return []
    }
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      const entries: ValidatedEntry[] = []
      for (const entry of statement.entries) {
        if (entry.key !== 'x' && entry.key !== 'y' && entry.key !== 'rotation') {
          this.#error(
            memberName === null
              ? `move only supports x, y and rotation — "${entry.key}" cannot be used with move, use tween instead`
              : `move only supports x, y and rotation — "${entry.key}" on "${memberName}" cannot be used with move, use tween instead`,
            entry.keySpan,
          )
          continue
        }
        const validated = this.#resolveWriteEntry(entry, node, memberName)
        if (validated) entries.push(validated)
      }
      if (entries.length > 0) writes.push({ member, entries })
    }
    return writes
  }

  /**
   * `fadeIn`/`fadeOut` validate to a single opacity entry per member. The
   * value is fixed (1/0); only the member capability (Bone nodes) can fail,
   * exactly as the equivalent raw tween would.
   */
  #validateFadeEntries(
    statement: StatementNode,
    binding: BindingInfo,
    target: 0 | 1,
  ): MemberWrite[] {
    if (statement.entries.length > 0 || statement.args.length > 0) {
      this.#error(
        `${statement.method} takes no property values — it animates opacity to ${target}`,
        statement.methodSpan,
      )
      return []
    }
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      const node = this.#nodeOf(member)
      if (!node) continue
      const memberName = binding.kind === 'group' ? member.nodeName : null
      const track: ScriptTrack = { kind: 'node', property: 'opacity' }
      if (
        !this.#validateTrackCapability(track, node, 'opacity', memberName, statement.methodSpan)
      ) {
        continue
      }
      writes.push({
        member,
        entries: [
          {
            track,
            property: 'opacity',
            value: target,
            keySpan: statement.methodSpan,
            valueSpan: statement.methodSpan,
          },
        ],
      })
    }
    return writes
  }

  /**
   * `tint` validates its single color argument against the color material
   * kind, then fans out one entry per member on the shared tint track.
   */
  #validateTintEntries(statement: StatementNode, binding: BindingInfo): MemberWrite[] {
    const colorExpression = statement.args[0]
    if (statement.args.length !== 1 || colorExpression === undefined) {
      this.#error('tint takes one color, like tint("#ff0000", 0.5)', statement.methodSpan)
      return []
    }
    if (containsDurationUnit(colorExpression)) {
      this.#error(
        `Expected the tint color without a duration suffix, found "${this.#source.slice(colorExpression.span.start, colorExpression.span.end)}"`,
        colorExpression.span,
      )
      return []
    }
    const raw = this.#evaluateString(colorExpression, 'a color in quotes')
    if (raw === null) return []
    const value = this.#requireEngineValue(
      () => requireMaterialKeyframeValue('color', raw) as ScriptTrackValue,
      'tint',
      null,
      colorExpression.span,
    )
    if (value === null) return []
    const writes: MemberWrite[] = []
    for (const member of binding.members) {
      writes.push({
        member,
        entries: [
          {
            track: { kind: 'parameter', parameter: 'tint', kindOf: 'color' },
            property: 'tint',
            value,
            keySpan: colorExpression.span,
            valueSpan: colorExpression.span,
          },
        ],
      })
    }
    return writes
  }

  /** Bare `tint(color)`: an instant hold keyframe at the cursor, advance 0. */
  #lowerTintSet(statement: StatementNode, binding: BindingInfo, cursor: number): number {
    const writes = this.#validateTintEntries(statement, binding)
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
    // Loop bodies rebind values per iteration, so the broadcast cache is
    // bypassed inside loops — the same span may evaluate differently each time.
    if (this.#loopDepth === 0) {
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
      return this.#morphEntry(entry, node, memberName, coefficient as number)
    }
    const fresh = this.#evaluateNumberTrack(entry.value, 'morphCoefficient', memberName, (value) =>
      value < 0 || value > 1 ? 'morphCoefficient must be between 0 and 1' : null,
    )
    if (fresh === null) return null
    return this.#morphEntry(entry, node, memberName, fresh)
  }

  #morphEntry(
    entry: PropertyEntry,
    node: AnimationScriptNodeInfo,
    memberName: string | null,
    coefficient: number,
  ): ValidatedEntry | null {
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
    if (this.#loopDepth > 0) {
      return this.#evaluateTrackExpression(expression, track, memberName)
    }
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
    if (this.#loopDepth > 0) {
      const what = this.#valuePhrase(property, memberName)
      const raw =
        property === 'color'
          ? this.#evaluateString(entry.value, what)
          : this.#evaluateNumber(entry.value, what)
      const fresh =
        raw === null
          ? null
          : this.#requireEngineValue(
              () => requireShadowKeyframeValue(property, raw),
              property,
              memberName,
              entry.value.span,
            )
      if (fresh === null || fresh === undefined) return null
      return {
        track: { kind: 'shadow', property },
        property,
        value: fresh,
        keySpan: entry.keySpan,
        valueSpan: entry.value.span,
      }
    }
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
      // warning on top of the resolution error. Clip and collection bindings
      // carry no node members but still warn when never referenced.
      if (
        !binding.used &&
        (binding.members.length > 0 || binding.kind === 'clip' || binding.kind === 'collection')
      ) {
        this.#warning(`Binding "${binding.alias}" is never used`, binding.aliasSpan)
      }
    }
  }

  /**
   * The cursor a timed statement would have reached had it lowered cleanly.
   * Recovery paths use it so later statements keep sensible times without
   * re-reporting the failure; `set` and `setText` never advance. Bare
   * `tint(color)` is a set, so it never advances on recovery either.
   */
  #advanceCursorByResolvedDuration(statement: StatementNode, cursor: number): number {
    if (!isTimedStatementMethod(statement.method)) return cursor
    if (statement.method === 'tint' && isBareTint(statement)) {
      return cursor
    }
    // Play/apply timing lives in their options record, never in the header
    // defaults — a failed play/apply leaves the cursor where it found it.
    if (statement.method === 'play' || statement.method === 'apply') {
      return cursor
    }
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
    } else if (this.#lookupOverride(statement.name) !== undefined) {
      this.#error(`Name "${statement.name}" is already used by a loop variable`, statement.nameSpan)
      declared = false
    } else if (this.#functions.has(statement.name)) {
      this.#error(`Name "${statement.name}" is already used by a function`, statement.nameSpan)
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
      const cellRef = this.#resolveCellRefValue(expression)
      if (cellRef !== undefined) return cellRef
      this.#error(
        `"${expression.name}(...)" is a structural selector and not a value — use it as a read target, like bounds(alias.row(0))`,
        expression.nameSpan,
      )
      return null
    }
    if (expression.object.kind === 'identifier') {
      const binding = this.#lookupBinding(expression.object.name)
      if (binding) {
        binding.used = true
        if (binding.kind === 'group') {
          this.#errorGroupRead(binding.alias, expression.nameSpan)
          return null
        }
        if (binding.kind === 'clip' || binding.kind === 'collection') {
          this.#error(
            `"${expression.name}" cannot be read from ${binding.kind} "${binding.alias}" — reads cover node properties`,
            expression.nameSpan,
          )
          return null
        }
        if (binding.members.length !== 1) {
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
    if (object.kind === 'binding') {
      const binding = bindingOf(object)
      if (binding) {
        binding.used = true
        if (binding.kind === 'group') {
          this.#errorGroupRead(binding.alias, expression.nameSpan)
          return null
        }
        if (binding.kind === 'clip' || binding.kind === 'collection') {
          this.#error(
            `"${expression.name}" cannot be read from ${binding.kind} "${binding.alias}" — reads cover node properties`,
            expression.nameSpan,
          )
          return null
        }
        if (binding.members.length !== 1) {
          return null
        }
        return this.#readMemberProperty(binding.members[0], expression)
      }
    }
    this.#error(
      `"${expression.name}" cannot be read from ${describeScriptValue(object)} — only bindings and records have readable members`,
      expression.nameSpan,
    )
    return null
  }

  /**
   * `table.cell(r, c)` (and `row`/`col`) in a value position: a cell reference
   * for `cellRef` parameters, or a cell group for `group` parameters. Plain
   * nodes and groups stay identifier references; only table selectors produce
   * values here.
   */
  #resolveCellRefValue(expression: MemberExpression): ScriptValue | null | undefined {
    if (expression.object.kind !== 'identifier') return undefined
    const binding = this.#lookupBinding(expression.object.name)
    if (!binding) return undefined
    if (binding.kind !== 'table' || binding.grid === undefined) return undefined
    if (expression.name !== 'cell' && expression.name !== 'row' && expression.name !== 'col') {
      return undefined
    }
    binding.used = true
    const selector: SelectorNode = {
      kind: 'selector',
      name: expression.name,
      nameSpan: expression.nameSpan,
      args: expression.args ?? [],
      span: expression.span,
    }
    const resolved = this.#resolveSelectors([selector], binding)
    if (!resolved) return null
    if (resolved.kind === 'node') {
      const cellRef: BindingInfo = {
        alias: `${binding.alias}.${expression.name}`,
        aliasSpan: expression.nameSpan,
        kind: 'cellRef',
        members: resolved.members,
        used: false,
      }
      return bindingValueFor(cellRef)
    }
    return bindingValueFor(resolved)
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
    const binding = this.#lookupBinding(tableExpression.name)
    if (!binding) {
      if (this.#lookupValue(tableExpression.name) !== undefined) {
        this.#error(
          `cellRect needs a table("...") binding — "${tableExpression.name}" is a value`,
          tableExpression.span,
        )
        return null
      }
      const suggestion = nearMissSuggestion(tableExpression.name, [
        ...this.#bindings.keys(),
        ...this.#overrideNames(),
      ])
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
   * The target of a read: a node or table binding, a data-row field path
   * (`row.target`), or a table selector (`conj.cell(0, 1)`, `conj.row(2)`).
   * Groups are legal only for reads that accept a broadcast target (`bounds`,
   * `setText`); everything else needs one node.
   */
  #resolveReadTarget(
    expression: ScriptExpression,
    allowGroup: boolean,
    what: string,
  ): { readonly members: readonly ScriptMember[] } | null {
    if (expression.kind === 'identifier') {
      const binding = this.#lookupBinding(expression.name)
      if (binding) {
        binding.used = true
        if (binding.kind === 'clip' || binding.kind === 'collection') {
          this.#error(
            `${what} needs a node binding — "${binding.alias}" is a ${binding.kind}.`,
            expression.span,
          )
          return null
        }
        if (binding.kind === 'group' && !allowGroup) {
          this.#error(
            `${what} needs a single node — binding "${binding.alias}" is a group. Bind an individual node, or use bounds(...) for a group.`,
            expression.span,
          )
          return null
        }
        return { members: binding.members }
      }
      const value = this.#lookupValue(expression.name)
      if (value !== undefined) {
        if (value.kind === 'binding') {
          const memberBinding = bindingOf(value)
          if (memberBinding) {
            memberBinding.used = true
            if (memberBinding.kind === 'clip' || memberBinding.kind === 'collection') {
              this.#error(
                `${what} needs a node binding — "${expression.name}" is a ${memberBinding.kind}.`,
                expression.span,
              )
              return null
            }
            if (memberBinding.kind === 'group' && !allowGroup) {
              this.#error(
                `${what} needs a single node — "${expression.name}" is a group. Bind an individual node, or use bounds(...) for a group.`,
                expression.span,
              )
              return null
            }
            return { members: memberBinding.members }
          }
        }
        this.#error(
          `${what} targets a binding — "${expression.name}" is a value, not a node or group`,
          expression.span,
        )
        return null
      }
      const suggestion = nearMissSuggestion(expression.name, [
        ...this.#bindings.keys(),
        ...this.#overrideNames(),
      ])
      this.#error(`Unknown binding "${expression.name}".${suggestion}`, expression.span)
      return null
    }
    if (expression.kind === 'member' && expression.args === undefined) {
      const value = this.#evaluateValue(expression)
      if (value === null || value.kind === 'invalid') return null
      if (value.kind === 'binding') {
        const memberBinding = bindingOf(value)
        if (memberBinding) {
          memberBinding.used = true
          if (memberBinding.kind === 'clip' || memberBinding.kind === 'collection') {
            this.#error(
              `${what} needs a node binding — a ${memberBinding.kind} field cannot be read here.`,
              expression.span,
            )
            return null
          }
          if (memberBinding.kind === 'group' && !allowGroup) {
            this.#error(
              `${what} needs a single node — a group field needs bounds(...) for a group.`,
              expression.span,
            )
            return null
          }
          return { members: memberBinding.members }
        }
        return null
      }
      this.#error(
        `${what} targets a binding — found ${describeScriptValue(value)}, not a node or group`,
        expression.span,
      )
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
      const binding = this.#lookupBinding(expression.object.name)
      if (!binding) {
        const suggestion = nearMissSuggestion(expression.object.name, [
          ...this.#bindings.keys(),
          ...this.#overrideNames(),
        ])
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
      lookup: (name) => this.#lookupValueOrBinding(name),
      explain: (name) => {
        if (SCRIPT_BUILTIN_NAMES.includes(name)) {
          return `Built-in "${name}" is a function — call it like ${name}(...)`
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
   * A name in an expression position: a `let` value first, then a loop-local
   * binding proxy, then a top-level (or function-local) binding. Bindings
   * thread through as `binding` values so record literals (`{ target: e0 }`)
   * and data-row lists can carry node references; number contexts report them
   * as mismatches instead.
   */
  #lookupValueOrBinding(name: string): ScriptValue | undefined {
    const value = this.#lookupValue(name)
    if (value !== undefined) return value
    const binding = this.#lookupBinding(name)
    if (binding) {
      binding.used = true
      return bindingValueFor(binding)
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
    // Clip Instances and placements join the same source order: later
    // statements append later and win (statement order is priority).
    return [...planned, ...this.#textCommands, ...this.#clipCommands]
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
    method === 'move' ||
    method === 'fadeIn' ||
    method === 'fadeOut' ||
    method === 'tint' ||
    method === 'pulse' ||
    method === 'shadow' ||
    method === 'symmetry' ||
    method === 'morph' ||
    method === 'dataLabel' ||
    method === 'control' ||
    method === 'play' ||
    method === 'apply'
  )
}

/** Bare `tint(color)` carries no explicit timing and lowers to a set. */
function isBareTint(statement: StatementNode): boolean {
  return (
    statement.method === 'tint' && statement.duration === undefined && statement.ease === undefined
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
    case 'record':
      return expression.fields.some((field) => containsDurationUnit(field.value))
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

/** Whether a parameter type threads as a binding (not a `let` value). */
function isBindingParamType(type: ScriptParamType): boolean {
  if (type.kind === 'base') {
    return (
      type.name === 'node' ||
      type.name === 'group' ||
      type.name === 'table' ||
      type.name === 'cellRef' ||
      type.name === 'clip' ||
      type.name === 'collection'
    )
  }
  return false
}

function describeParamType(type: ScriptParamType): string {
  if (type.kind === 'base') return type.name
  if (type.kind === 'list') return `list<${describeParamType(type.element)}>`
  return `{ ${type.fields.map((field) => `${field.name}: ${describeParamType(field.type)}`).join(', ')} }`
}

/**
 * A binding threaded as a compile-time value (function arguments, data-row
 * fields, `list<node>` elements). The payload is the compiler's `BindingInfo`;
 * the expression layer only threads it.
 */
function bindingValueFor(binding: BindingInfo): ScriptValue {
  const label =
    binding.kind === 'node'
      ? 'a node'
      : binding.kind === 'group'
        ? 'a group'
        : binding.kind === 'table'
          ? 'a table'
          : binding.kind === 'clip'
            ? 'a clip'
            : binding.kind === 'collection'
              ? 'a collection'
              : 'a cell reference'
  return { kind: 'binding', label, bindingKind: binding.kind, payload: binding }
}

function bindingOf(value: ScriptValue): BindingInfo | null {
  return value.kind === 'binding' ? (value.payload as BindingInfo) : null
}

/** The source text of a resource argument, for kind-mismatch diagnostics. */
function expressionLabel(expression: ScriptExpression): string {
  if (expression.kind === 'identifier') return expression.name
  if (expression.kind === 'member' && expression.object.kind === 'identifier') {
    return `${expression.object.name}.${expression.name}`
  }
  return 'the resource'
}
