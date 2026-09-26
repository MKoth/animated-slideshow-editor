/**
 * Compile-time value evaluation for the Animation Script language: immutable
 * numbers and lists, arithmetic, and the math built-ins. Pure — evaluation
 * reports diagnostics through the caller and never touches the engine. Division
 * by zero and non-finite results are compile errors; comparisons, conditionals,
 * string operations, mutation, the wall clock and randomness are not part of
 * the language.
 */

import type { MemberExpression, ScriptExpression, SourceSpan } from './animationScriptParser'
import { nearMissSuggestion } from './animationScriptNearMiss'

export type ScriptValue =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'list'; readonly values: readonly ScriptValue[] }
  | { readonly kind: 'string'; readonly value: string }
  /**
   * A compile-time record: a compiled read's named fields (`worldAt`, `bounds`,
   * `cellRect`). Fields are read with `.name`; records never persist.
   */
  | {
      readonly kind: 'record'
      readonly label: string
      readonly fields: ReadonlyMap<string, ScriptValue>
    }
  /**
   * A value whose initializer already failed. Arithmetic and number contexts
   * propagate it silently so one root-cause error is not reported again at
   * every downstream use.
   */
  | { readonly kind: 'invalid' }

export const SCRIPT_MATH_BUILTINS = [
  'abs',
  'min',
  'max',
  'clamp',
  'lerp',
  'atan2',
  'sin',
  'cos',
  'deg',
  'rad',
] as const

export const SCRIPT_RANGE_BUILTIN = 'range'

/** Compile-time read functions; the compiler evaluates them against the slide. */
export const SCRIPT_READ_BUILTIN_NAMES = ['worldAt', 'bounds', 'cellRect', 'controlValue'] as const

export function isScriptReadBuiltin(name: string): boolean {
  return (SCRIPT_READ_BUILTIN_NAMES as readonly string[]).includes(name)
}

export const SCRIPT_BUILTIN_NAMES: readonly string[] = [
  ...SCRIPT_MATH_BUILTINS,
  SCRIPT_RANGE_BUILTIN,
  ...SCRIPT_READ_BUILTIN_NAMES,
]

const BUILTIN_ARITY: Readonly<Record<string, number>> = {
  abs: 1,
  min: 2,
  max: 2,
  clamp: 3,
  lerp: 3,
  atan2: 2,
  sin: 1,
  cos: 1,
  deg: 1,
  rad: 1,
  range: 3,
}

/** A pathological range is a diagnostic, not a compiler hang. */
export const SCRIPT_MAX_LIST_LENGTH = 10000

export interface ScriptExpressionContext {
  lookup(name: string): ScriptValue | undefined
  /** A specific diagnostic for a name that exists but cannot be a value. */
  explain(name: string): string | undefined
  /** A near-miss suffix for an unknown name. */
  suggest(name: string): string
  report(message: string, span: SourceSpan): void
  /**
   * A compiler-provided native call, e.g. a compile-time read. `undefined`
   * means the callee is not a native and evaluation falls through to the
   * built-ins; `null` means the native failed and already reported.
   */
  call?(expression: Extract<ScriptExpression, { kind: 'call' }>): ScriptValue | null | undefined
  /**
   * A compiler-provided `.` access: a property read (`alias.x`), a selector
   * target, or a field read on a record. `undefined` falls through to the
   * default diagnostic; `null` means the access failed and already reported.
   */
  member?(expression: MemberExpression): ScriptValue | null | undefined
}

export function evaluateScriptExpression(
  expression: ScriptExpression,
  context: ScriptExpressionContext,
): ScriptValue | null {
  switch (expression.kind) {
    case 'number':
      if (!Number.isFinite(expression.value)) {
        context.report('Number literal is not a finite number', expression.span)
        return null
      }
      return { kind: 'number', value: expression.value }
    case 'string':
      return { kind: 'string', value: expression.value }
    case 'identifier': {
      const value = context.lookup(expression.name)
      if (value !== undefined) return value
      const explanation = context.explain(expression.name)
      context.report(
        explanation ?? `Unknown name "${expression.name}".${context.suggest(expression.name)}`,
        expression.span,
      )
      return null
    }
    case 'list': {
      const values: ScriptValue[] = []
      let failed = false
      for (const element of expression.elements) {
        const value = evaluateScriptExpression(element, context)
        if (value === null) {
          failed = true
          continue
        }
        values.push(value)
      }
      return failed ? null : { kind: 'list', values }
    }
    case 'unary': {
      const operand = evaluateScriptExpression(expression.operand, context)
      if (operand === null) return null
      if (operand.kind === 'invalid') return operand
      if (operand.kind !== 'number') {
        context.report(
          `Unary ${expression.operator} expects a number, found ${describeScriptValue(operand)}`,
          expression.operatorSpan,
        )
        return null
      }
      const value = expression.operator === '-' ? -operand.value : operand.value
      if (!Number.isFinite(value)) {
        context.report(`Unary ${expression.operator} produced a non-finite number`, expression.span)
        return null
      }
      return { kind: 'number', value }
    }
    case 'binary':
      return evaluateBinary(expression, context)
    case 'call':
      return evaluateCall(expression, context)
    case 'member': {
      const value = context.member?.(expression)
      if (value !== undefined) return value
      context.report(
        `Cannot read "${expression.name}" here — only bindings and record values have properties`,
        expression.nameSpan,
      )
      return null
    }
  }
}

function evaluateBinary(
  expression: Extract<ScriptExpression, { kind: 'binary' }>,
  context: ScriptExpressionContext,
): ScriptValue | null {
  const left = evaluateScriptExpression(expression.left, context)
  const right = evaluateScriptExpression(expression.right, context)
  if (left === null || right === null) return null
  if (left.kind === 'invalid' || right.kind === 'invalid') return { kind: 'invalid' }
  const { operator } = expression
  if (left.kind === 'string' || right.kind === 'string') {
    context.report(
      `String operations are not part of the Animation Script language (operator "${operator}")`,
      expression.operatorSpan,
    )
    return null
  }
  if (left.kind === 'list' || right.kind === 'list') {
    context.report(
      `Operator "${operator}" cannot combine lists — lists feed loops and staggers, not arithmetic`,
      expression.operatorSpan,
    )
    return null
  }
  if (left.kind === 'record' || right.kind === 'record') {
    context.report(
      `Operator "${operator}" cannot combine records — read a field instead, like alias.field`,
      expression.operatorSpan,
    )
    return null
  }
  if ((operator === '/' || operator === '%') && right.value === 0) {
    context.report('Division by zero', expression.operatorSpan)
    return null
  }
  const value =
    operator === '+'
      ? left.value + right.value
      : operator === '-'
        ? left.value - right.value
        : operator === '*'
          ? left.value * right.value
          : operator === '/'
            ? left.value / right.value
            : left.value % right.value
  if (!Number.isFinite(value)) {
    context.report(`Operator "${operator}" produced a non-finite number`, expression.operatorSpan)
    return null
  }
  return { kind: 'number', value }
}

function evaluateCall(
  expression: Extract<ScriptExpression, { kind: 'call' }>,
  context: ScriptExpressionContext,
): ScriptValue | null {
  const native = context.call?.(expression)
  if (native !== undefined) return native
  const arity = BUILTIN_ARITY[expression.callee]
  if (arity === undefined) {
    context.report(
      `Unknown function "${expression.callee}".${nearMissSuggestion(expression.callee, SCRIPT_BUILTIN_NAMES)}`,
      expression.calleeSpan,
    )
    return null
  }
  if (expression.args.length !== arity) {
    context.report(
      `${expression.callee} takes ${arity} argument${arity === 1 ? '' : 's'}, got ${expression.args.length}`,
      expression.span,
    )
    return null
  }
  const args: ScriptValue[] = []
  let failed = false
  for (const arg of expression.args) {
    const value = evaluateScriptExpression(arg, context)
    if (value === null) {
      failed = true
      continue
    }
    args.push(value)
  }
  if (failed) return null
  if (args.some((value) => value.kind === 'invalid')) return { kind: 'invalid' }
  const numbers: number[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value.kind !== 'number') {
      context.report(
        `${expression.callee} expects a number, but argument ${index + 1} is ${describeScriptValue(value)}`,
        expression.span,
      )
      return null
    }
    numbers.push(value.value)
  }
  if (expression.callee === SCRIPT_RANGE_BUILTIN) {
    return evaluateRange(numbers[0], numbers[1], numbers[2], expression.span, context)
  }
  const value = applyMathBuiltin(expression.callee, numbers)
  if (!Number.isFinite(value)) {
    context.report(`${expression.callee} produced a non-finite number`, expression.span)
    return null
  }
  return { kind: 'number', value }
}

function applyMathBuiltin(callee: string, args: readonly number[]): number {
  switch (callee) {
    case 'abs':
      return Math.abs(args[0])
    case 'min':
      return Math.min(args[0], args[1])
    case 'max':
      return Math.max(args[0], args[1])
    case 'clamp':
      return Math.min(Math.max(args[0], args[1]), args[2])
    case 'lerp':
      return args[0] + (args[1] - args[0]) * args[2]
    case 'atan2':
      return Math.atan2(args[0], args[1])
    case 'sin':
      return Math.sin(args[0])
    case 'cos':
      return Math.cos(args[0])
    case 'deg':
      return (args[0] * 180) / Math.PI
    case 'rad':
      return (args[0] * Math.PI) / 180
    default:
      return Number.NaN
  }
}

/**
 * `range(start, end, step)` is start-inclusive and end-exclusive with a
 * positive, non-zero step; the length is checked before the list is built so a
 * pathological range cannot hang the compiler.
 */
function evaluateRange(
  start: number,
  end: number,
  step: number,
  span: SourceSpan,
  context: ScriptExpressionContext,
): ScriptValue | null {
  if (step === 0) {
    context.report('range step must not be zero', span)
    return null
  }
  if (step < 0) {
    context.report('range step must be a positive number', span)
    return null
  }
  if (!(start < end)) {
    return { kind: 'list', values: [] }
  }
  const count = Math.ceil((end - start) / step)
  if (!Number.isFinite(count) || count > SCRIPT_MAX_LIST_LENGTH) {
    context.report(
      `range would produce ${count} values, past the compile budget of ${SCRIPT_MAX_LIST_LENGTH}`,
      span,
    )
    return null
  }
  const values: ScriptValue[] = []
  for (let index = 0; index < count; index += 1) {
    values.push({ kind: 'number', value: start + index * step })
  }
  return { kind: 'list', values }
}

export function describeScriptValue(value: ScriptValue): string {
  switch (value.kind) {
    case 'number':
      return `the number ${value.value}`
    case 'string':
      return 'a string'
    case 'list':
      return `a list of ${value.values.length} value${value.values.length === 1 ? '' : 's'}`
    case 'record':
      return value.label
    case 'invalid':
      return 'an unknown value'
  }
}
