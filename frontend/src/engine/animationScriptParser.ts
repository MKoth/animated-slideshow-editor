/**
 * Lexer and recovery-oriented recursive-descent parser for the Animation
 * Script language. The parser reports source-located syntax diagnostics and
 * keeps going so a Check can surface more than the first mistake.
 */

import { SCRIPT_EASE_NAMES } from './animationScriptEase'

export interface SourceSpan {
  readonly start: number
  readonly end: number
}

export interface ScriptParseDiagnostic {
  readonly message: string
  readonly span: SourceSpan
}

export interface HeaderNode {
  readonly kind: 'header'
  readonly title: string
  readonly titleSpan: SourceSpan
  readonly from: ScriptExpression
  readonly span: SourceSpan
}

/**
 * The optional script-wide `defaults { duration, ease }` block. Both fields
 * are optional and there is no silent fallback for duration: a tween whose
 * duration comes from neither its own arguments nor this block is an error.
 */
export interface DefaultsNode {
  readonly kind: 'defaults'
  readonly duration?: ScriptExpression
  readonly ease?: string
  readonly easeSpan?: SourceSpan
  readonly span: SourceSpan
}

export interface BindNode {
  readonly kind: 'bind'
  readonly alias: string
  readonly aliasSpan: SourceSpan
  readonly resourceKind: string
  readonly resourceKindSpan: SourceSpan
  readonly resourceName: string
  readonly resourceNameSpan: SourceSpan
  readonly span: SourceSpan
}

/**
 * A compile-time value expression. Expressions are pure: number literals
 * (bare seconds or `s`/`ms` suffixed), strings (rejected downstream), names of
 * `let` variables, list literals, the math built-ins, and `+ − * / %` with
 * parentheses and unary minus. Comparisons, conditionals, string operations,
 * mutation, the wall clock and randomness are not part of the language and are
 * reported by the parser with vocabulary-specific diagnostics.
 */
export interface NumberLiteralExpression {
  readonly kind: 'number'
  /** The literal's value in seconds; `ms` literals are already divided. */
  readonly value: number
  readonly unit?: 's' | 'ms'
  readonly span: SourceSpan
}

export interface StringLiteralExpression {
  readonly kind: 'string'
  readonly value: string
  readonly span: SourceSpan
}

export interface IdentifierExpression {
  readonly kind: 'identifier'
  readonly name: string
  readonly span: SourceSpan
}

export interface CallExpression {
  readonly kind: 'call'
  readonly callee: string
  readonly calleeSpan: SourceSpan
  readonly args: readonly ScriptExpression[]
  readonly span: SourceSpan
}

export interface ListLiteralExpression {
  readonly kind: 'list'
  readonly elements: readonly ScriptExpression[]
  readonly span: SourceSpan
}

/**
 * A `.` access on an expression: a property read (`alias.x`, `point.x`), a
 * structural table selector used as a read target (`conj.row(0)`), or a field
 * read on a record value returned by a read (`worldAt(a, t).rotation`). When
 * `args` is present the member is a call; when absent it is a property.
 */
export interface MemberExpression {
  readonly kind: 'member'
  readonly object: ScriptExpression
  readonly name: string
  readonly nameSpan: SourceSpan
  readonly args?: readonly ScriptExpression[]
  readonly span: SourceSpan
}

export interface UnaryExpression {
  readonly kind: 'unary'
  readonly operator: '-' | '+'
  readonly operatorSpan: SourceSpan
  readonly operand: ScriptExpression
  readonly span: SourceSpan
}

export interface BinaryExpression {
  readonly kind: 'binary'
  readonly operator: '+' | '-' | '*' | '/' | '%'
  readonly operatorSpan: SourceSpan
  readonly left: ScriptExpression
  readonly right: ScriptExpression
  readonly span: SourceSpan
}

export type ScriptExpression =
  | NumberLiteralExpression
  | StringLiteralExpression
  | IdentifierExpression
  | CallExpression
  | ListLiteralExpression
  | MemberExpression
  | UnaryExpression
  | BinaryExpression

export interface PropertyEntry {
  readonly key: string
  readonly keySpan: SourceSpan
  readonly value: ScriptExpression
}

/** The method vocabulary of a statement receiver; the compiler owns diagnostics. */
export const SCRIPT_METHOD_NAMES = ['tween', 'set'] as const

/** Structural table selectors: `conj.cell(r, c)` / `conj.row(i)` / `conj.col(j)`. */
export const SCRIPT_TABLE_SELECTOR_NAMES = ['cell', 'row', 'col'] as const

/**
 * A structural target selector after a binding alias, e.g. `conj.cell(0, 1)`
 * where `conj = table("...")`. The arguments are compile-time expressions the
 * compiler resolves against the table's Grid Slots.
 */
export interface SelectorNode {
  readonly kind: 'selector'
  readonly name: string
  readonly nameSpan: SourceSpan
  readonly args: readonly ScriptExpression[]
  readonly span: SourceSpan
}

export interface StatementNode {
  readonly kind: 'statement'
  readonly alias: string
  readonly aliasSpan: SourceSpan
  /** Structural table selectors between the alias and the method, in source order. */
  readonly selectors: readonly SelectorNode[]
  readonly method: string
  readonly methodSpan: SourceSpan
  readonly entries: readonly PropertyEntry[]
  readonly duration?: ScriptExpression
  readonly ease?: string
  readonly easeSpan?: SourceSpan
  readonly span: SourceSpan
}

/** `let name = expression` declares an immutable, block-scoped compile-time value. */
export interface LetNode {
  readonly kind: 'let'
  readonly name: string
  readonly nameSpan: SourceSpan
  readonly value: ScriptExpression
  readonly span: SourceSpan
}

/** `wait(duration)` advances the cursor by `d` and emits nothing. */
export interface WaitNode {
  readonly kind: 'wait'
  readonly duration: ScriptExpression
  readonly span: SourceSpan
}

/** `mark("name")` labels the cursor time; compile-time only, emits nothing. */
export interface MarkNode {
  readonly kind: 'mark'
  readonly name: string
  readonly nameSpan: SourceSpan
  readonly span: SourceSpan
}

/**
 * `at(t)` / `at("marker")` places the wrapped statement at an absolute slide
 * second. Exact seconds arrive resolved; marker lookups resolve in the compiler.
 */
export interface AtNode {
  readonly kind: 'at'
  readonly time?: ScriptExpression
  readonly marker?: string
  readonly markerSpan?: SourceSpan
  readonly statement: ScriptStatementNode
  readonly span: SourceSpan
}

/**
 * `parallel { ... }` starts every child at the cursor it found and advances by
 * the latest child end (absolute placements inside children count).
 */
export interface ParallelNode {
  readonly kind: 'parallel'
  readonly body: readonly ScriptStatementNode[]
  readonly span: SourceSpan
}

export type ScriptStatementNode =
  BindNode | LetNode | StatementNode | WaitNode | MarkNode | AtNode | ParallelNode

export interface ScriptProgram {
  readonly header: HeaderNode | null
  readonly defaults: DefaultsNode | null
  readonly statements: readonly ScriptStatementNode[]
  readonly diagnostics: readonly ScriptParseDiagnostic[]
}

type TokenKind = 'identifier' | 'number' | 'string' | 'punctuation' | 'eof'

interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly value?: number | string
  /** Set when a number token carried a duration suffix, e.g. `0.4s` or `250ms`. */
  readonly unit?: 's' | 'ms'
  readonly span: SourceSpan
}

const PUNCTUATION = new Set([
  '{',
  '}',
  '(',
  ')',
  ',',
  '.',
  '=',
  ':',
  '+',
  '-',
  '*',
  '/',
  '%',
  '[',
  ']',
])

/**
 * Tokens the tokenizer recognizes only so the parser can reject them with
 * language-vocabulary diagnostics instead of "unexpected character".
 */
const COMPARISON_OPERATORS = new Set(['<', '>', '<=', '>=', '==', '!='])
const LOGICAL_OPERATORS = new Set(['&&', '||', '!'])

/** Statement keywords for constructs the language deliberately does not have. */
const FORBIDDEN_KEYWORD_MESSAGES = new Map<string, string>([
  ['if', 'Conditionals are not part of the Animation Script language.'],
  ['else', 'Conditionals are not part of the Animation Script language.'],
  ['while', 'Conditionals are not part of the Animation Script language.'],
  ['return', 'Value-returning functions are not part of the Animation Script language.'],
])

/**
 * Identifiers that begin an operator statement. `wait(...)` is the operator
 * while `wait.tween(...)` is an alias named `wait`, which is why the `.` lookahead
 * keeps deciding; `bind` and `let` are handled separately because their forms differ.
 */
const OPERATOR_KEYWORDS = new Set(['wait', 'mark', 'at', 'parallel'])

export function parseAnimationScript(source: string): ScriptProgram {
  return new Parser(source).parse()
}

class Parser {
  readonly #tokens: Token[]
  readonly #diagnostics: ScriptParseDiagnostic[] = []
  #index = 0

  constructor(source: string) {
    this.#tokens = tokenize(source, this.#diagnostics)
  }

  parse(): ScriptProgram {
    const header = this.#parseHeader()
    const defaults = this.#isIdentifier('defaults') ? this.#parseDefaults() : null
    const statements: ScriptStatementNode[] = []
    while (!this.#atEnd()) {
      const before = this.#index
      const statement = this.#parseStatement()
      if (statement) {
        statements.push(statement)
        continue
      }
      this.#skipToNextStatement()
      if (this.#index === before) this.#index += 1
    }
    return { header, defaults, statements, diagnostics: this.#diagnostics }
  }

  #parseHeader(): HeaderNode | null {
    if (!this.#isIdentifier('script')) {
      const token = this.#peek()
      this.#report(
        'Animation Script must start with a header: script "<title>" from <seconds>',
        token.kind === 'eof' ? { start: 0, end: 0 } : token.span,
      )
      return null
    }
    const scriptToken = this.#advance()
    const title = this.#parseString('a script title in quotes')
    const fromToken = this.#expectIdentifier('the word "from"')
    const from = this.#parseExpression('a start time in seconds')
    if (title === null || fromToken === null || from === null) {
      this.#report('Animation Script header is incomplete', scriptToken.span)
      return null
    }
    return {
      kind: 'header',
      title: title.value as string,
      titleSpan: title.span,
      from,
      span: { start: scriptToken.span.start, end: this.#previousEnd() },
    }
  }

  #parseStatement(): ScriptStatementNode | null {
    if (this.#isIdentifier('bind')) {
      return this.#parseBind()
    }
    if (this.#isIdentifier('let')) {
      return this.#parseLet()
    }
    const operator = this.#operatorKeyword()
    if (operator === 'wait') return this.#parseWait()
    if (operator === 'mark') return this.#parseMark()
    if (operator === 'at') return this.#parseAt()
    if (operator === 'parallel') return this.#parseParallel()
    if (this.#isIdentifier('defaults')) {
      this.#report('defaults must appear immediately after the script header', this.#peek().span)
      return null
    }
    if (this.#peek().kind === 'identifier') {
      const forbidden = FORBIDDEN_KEYWORD_MESSAGES.get(this.#peek().text)
      if (forbidden !== undefined) {
        this.#report(forbidden, this.#peek().span)
        return null
      }
      if (this.#nextIsPunctuation('=')) {
        this.#report(
          `Cannot reassign "${this.#peek().text}" — a value declared with let is immutable. Declare a new let instead.`,
          this.#peek().span,
        )
        return null
      }
      return this.#parseCallStatement()
    }
    const token = this.#peek()
    this.#report(`Unexpected ${describeToken(token)}`, token.span)
    return null
  }

  #parseDefaults(): DefaultsNode | null {
    const start = this.#peek().span.start
    this.#advance()
    if (!this.#expectPunctuation('{')) {
      return null
    }
    let duration: ScriptExpression | undefined
    let ease: string | undefined
    let easeSpan: SourceSpan | undefined
    const seen = new Set<string>()
    while (!this.#atEnd() && !this.#checkPunctuation('}')) {
      const key = this.#expectIdentifier('a default name')
      if (key === null) break
      this.#expectPunctuation(':')
      if (seen.has(key.text)) {
        this.#report(`Default "${key.text}" is written twice`, key.span)
      }
      seen.add(key.text)
      if (key.text === 'duration') {
        duration = this.#parseExpression('a duration in seconds') ?? undefined
      } else if (key.text === 'ease') {
        const token = this.#expectIdentifier('an ease name')
        if (token !== null) {
          ease = token.text
          easeSpan = token.span
        }
      } else {
        this.#report(`Unknown default "${key.text}". Available defaults: duration, ease.`, key.span)
        if (
          this.#peek().kind === 'number' ||
          this.#peek().kind === 'identifier' ||
          this.#peek().kind === 'string'
        ) {
          this.#advance()
        }
      }
      if (!this.#matchPunctuation(',')) break
    }
    if (!this.#matchPunctuation('}')) {
      const token = this.#peek()
      this.#report(
        `Expected "}" to close the defaults block, found ${describeToken(token)}`,
        token.span,
      )
      return null
    }
    return {
      kind: 'defaults',
      duration,
      ease,
      easeSpan,
      span: { start, end: this.#previousEnd() },
    }
  }

  #parseWait(): WaitNode | null {
    const start = this.#peek().span.start
    this.#advance()
    if (!this.#expectPunctuation('(')) return null
    const duration = this.#parseExpression('a duration in seconds')
    this.#expectPunctuation(')')
    if (duration === null) return null
    return {
      kind: 'wait',
      duration,
      span: { start, end: this.#previousEnd() },
    }
  }

  #parseLet(): LetNode | null {
    const start = this.#peek().span.start
    this.#advance()
    const name = this.#expectIdentifier('a variable name')
    this.#expectPunctuation('=')
    const value = this.#parseExpression('a value')
    if (name === null || value === null) return null
    return {
      kind: 'let',
      name: name.text,
      nameSpan: name.span,
      value,
      span: { start, end: this.#previousEnd() },
    }
  }

  #parseMark(): MarkNode | null {
    const start = this.#peek().span.start
    this.#advance()
    if (!this.#expectPunctuation('(')) return null
    const name = this.#parseString('a marker name in quotes')
    this.#expectPunctuation(')')
    if (name === null) return null
    return {
      kind: 'mark',
      name: name.value as string,
      nameSpan: name.span,
      span: { start, end: this.#previousEnd() },
    }
  }

  #parseAt(): AtNode | null {
    const start = this.#peek().span.start
    this.#advance()
    if (!this.#expectPunctuation('(')) return null
    let time: ScriptExpression | undefined
    let marker: string | undefined
    let markerSpan: SourceSpan | undefined
    if (this.#peek().kind === 'string') {
      const token = this.#advance()
      marker = token.value as string
      markerSpan = token.span
    } else {
      time = this.#parseExpression('a time or a marker name in quotes') ?? undefined
    }
    this.#expectPunctuation(')')
    if (time === undefined && marker === undefined) return null
    const statement = this.#parseStatement()
    if (statement === null) return null
    if (statement.kind === 'bind') {
      this.#report('"at" cannot place a binding', statement.aliasSpan)
      return null
    }
    if (statement.kind === 'let') {
      this.#report('"at" cannot place a let', statement.nameSpan)
      return null
    }
    return {
      kind: 'at',
      time,
      marker,
      markerSpan,
      statement,
      span: { start, end: this.#previousEnd() },
    }
  }

  #parseParallel(): ParallelNode | null {
    const start = this.#peek().span.start
    this.#advance()
    if (!this.#expectPunctuation('{')) return null
    const body: ScriptStatementNode[] = []
    while (!this.#atEnd() && !this.#checkPunctuation('}')) {
      const before = this.#index
      const statement = this.#parseStatement()
      if (statement) {
        body.push(statement)
        continue
      }
      this.#skipToNextStatement()
      if (this.#index === before) this.#index += 1
    }
    if (!this.#matchPunctuation('}')) {
      const token = this.#peek()
      this.#report(
        `Expected "}" to close the parallel block, found ${describeToken(token)}`,
        token.span,
      )
      return null
    }
    return { kind: 'parallel', body, span: { start, end: this.#previousEnd() } }
  }

  #parseBind(): BindNode | null {
    const start = this.#peek().span.start
    this.#advance()
    const alias = this.#expectIdentifier('a binding name')
    this.#expectPunctuation('=')
    const resourceKind = this.#expectIdentifier('a resource kind')
    this.#expectPunctuation('(')
    const resourceName = this.#parseString('a Unique Name in quotes')
    this.#expectPunctuation(')')
    if (alias === null || resourceKind === null || resourceName === null) {
      return null
    }
    return {
      kind: 'bind',
      alias: alias.text,
      aliasSpan: alias.span,
      resourceKind: resourceKind.text,
      resourceKindSpan: resourceKind.span,
      resourceName: resourceName.value as string,
      resourceNameSpan: resourceName.span,
      span: { start, end: this.#previousEnd() },
    }
  }

  /**
   * `alias [.selector(args)]* .method(record, duration?, ease?)`. A table
   * binding may carry structural selectors (`cell`, `row`, `col`) between the
   * alias and the method; the compiler types them against the bound table.
   */
  #parseCallStatement(): StatementNode | null {
    const start = this.#peek().span.start
    const alias = this.#advance()
    const selectors: SelectorNode[] = []
    let method: Token | null = null
    let entries: PropertyEntry[] | null = null
    let duration: ScriptExpression | undefined
    let ease: string | undefined
    let easeSpan: SourceSpan | undefined

    this.#expectPunctuation('.')
    for (;;) {
      const name = this.#expectIdentifier('a method name')
      if (name === null) return null
      this.#expectPunctuation('(')
      if (this.#isMethodSegment(name.text)) {
        entries = this.#parseRecord()
        const timing = this.#parseTimingArguments()
        if (timing === null) return null
        duration = timing.duration
        ease = timing.ease
        easeSpan = timing.easeSpan
        method = name
        break
      }
      const args = this.#parseSelectorArguments()
      if (!this.#expectPunctuation(')')) return null
      selectors.push({
        kind: 'selector',
        name: name.text,
        nameSpan: name.span,
        args,
        span: { start: name.span.start, end: this.#previousEnd() },
      })
      if (!this.#matchPunctuation('.')) break
    }
    if (method === null) {
      this.#report(
        'A table selector needs a method call, like cell(0, 1).tween({...}) or row(0).set({...})',
        selectors[selectors.length - 1].span,
      )
      return null
    }
    if (entries === null) {
      return null
    }
    return {
      kind: 'statement',
      alias: alias.text,
      aliasSpan: alias.span,
      selectors,
      method: method.text,
      methodSpan: method.span,
      entries,
      duration,
      ease,
      easeSpan,
      span: { start, end: this.#previousEnd() },
    }
  }

  /**
   * Whether a segment after the alias opens a method (a property map follows)
   * or a structural selector (bare arguments follow). Known vocabulary decides
   * first; an unknown name is read by its argument shape so the compiler can
   * report either an unknown method or an unknown selector.
   */
  #isMethodSegment(name: string): boolean {
    if ((SCRIPT_METHOD_NAMES as readonly string[]).includes(name)) return true
    if ((SCRIPT_TABLE_SELECTOR_NAMES as readonly string[]).includes(name)) return false
    return this.#checkPunctuation('{')
  }

  #parseSelectorArguments(): ScriptExpression[] {
    const args: ScriptExpression[] = []
    while (!this.#atEnd() && !this.#checkPunctuation(')')) {
      const arg = this.#parseExpression('a number')
      if (arg === null) break
      args.push(arg)
      if (!this.#matchPunctuation(',')) break
    }
    return args
  }

  /** The optional `, duration` and `, ease` arguments after a property map. */
  #parseTimingArguments(): {
    duration?: ScriptExpression
    ease?: string
    easeSpan?: SourceSpan
  } | null {
    let duration: ScriptExpression | undefined
    let ease: string | undefined
    let easeSpan: SourceSpan | undefined
    while (this.#matchPunctuation(',')) {
      if (this.#isEaseName()) {
        const token = this.#advance()
        if (ease !== undefined) {
          this.#report('Only one ease is allowed', token.span)
          continue
        }
        ease = token.text
        easeSpan = token.span
      } else if (this.#peek().kind === 'identifier' && duration !== undefined) {
        // After a duration, an identifier is always an ease name — unknown
        // eases get the compiler's near-miss diagnostic, not a syntax error.
        const token = this.#advance()
        if (ease !== undefined) {
          this.#report('Only one ease is allowed', token.span)
          continue
        }
        ease = token.text
        easeSpan = token.span
      } else if (this.#startsExpression()) {
        if (duration !== undefined) {
          this.#report('Only one duration is allowed', this.#peek().span)
          this.#parseExpression('a duration in seconds')
          continue
        }
        duration = this.#parseExpression('a duration in seconds') ?? undefined
      } else {
        const token = this.#peek()
        this.#report(
          `Expected a duration or an ease name, found ${describeToken(token)}`,
          token.span,
        )
        return null
      }
    }
    this.#expectPunctuation(')')
    return { duration, ease, easeSpan }
  }

  #parseRecord(): PropertyEntry[] | null {
    if (!this.#matchPunctuation('{')) {
      const token = this.#peek()
      this.#report(
        `Expected a property map like { x: 4 }, found ${describeToken(token)}`,
        token.span,
      )
      return null
    }
    const entries: PropertyEntry[] = []
    const seen = new Set<string>()
    while (!this.#atEnd() && !this.#checkPunctuation('}')) {
      const key = this.#expectIdentifier('a property name')
      this.#expectPunctuation(':')
      const value = this.#parseExpression('a number value')
      if (key === null || value === null) {
        return null
      }
      if (seen.has(key.text)) {
        this.#report(`Property "${key.text}" is written twice in one statement`, key.span)
      }
      seen.add(key.text)
      entries.push({ key: key.text, keySpan: key.span, value })
      if (!this.#matchPunctuation(',')) break
    }
    if (!this.#matchPunctuation('}')) {
      const token = this.#peek()
      this.#report(
        `Expected "}" to close the property map, found ${describeToken(token)}`,
        token.span,
      )
      return null
    }
    return entries
  }

  #parseString(what: string): Token | null {
    if (this.#peek().kind !== 'string') {
      this.#report(`Expected ${what}, found ${describeToken(this.#peek())}`, this.#peek().span)
      return null
    }
    return this.#advance()
  }

  /**
   * A full expression with the language's operator surface. Forbidden
   * comparison and logical operators are reported with vocabulary-specific
   * diagnostics and their right-hand side is consumed so recovery keeps going.
   */
  #parseExpression(what: string): ScriptExpression | null {
    const left = this.#parseAdditive(what)
    if (left === null) return null
    const result = left
    for (;;) {
      const token = this.#peek()
      if (!isForbiddenBinaryOperator(token)) return result
      this.#report(forbiddenOperatorMessage(token.text), token.span)
      this.#advance()
      this.#parseAdditive('a number')
    }
  }

  #parseAdditive(what: string): ScriptExpression | null {
    let left = this.#parseMultiplicative(what)
    if (left === null) return null
    for (;;) {
      const token = this.#peek()
      if (token.kind !== 'punctuation' || (token.text !== '+' && token.text !== '-')) return left
      this.#advance()
      const right = this.#parseMultiplicative('a number')
      if (right === null) return null
      left = binaryExpression(token, left, right)
    }
  }

  #parseMultiplicative(what: string): ScriptExpression | null {
    let left = this.#parseUnary(what)
    if (left === null) return null
    for (;;) {
      const token = this.#peek()
      if (
        token.kind !== 'punctuation' ||
        (token.text !== '*' && token.text !== '/' && token.text !== '%')
      ) {
        return left
      }
      this.#advance()
      const right = this.#parseUnary('a number')
      if (right === null) return null
      left = binaryExpression(token, left, right)
    }
  }

  #parseUnary(what: string): ScriptExpression | null {
    const token = this.#peek()
    if (token.kind === 'punctuation' && (token.text === '-' || token.text === '+')) {
      this.#advance()
      const operand = this.#parseUnary('a number')
      if (operand === null) return null
      return {
        kind: 'unary',
        operator: token.text,
        operatorSpan: token.span,
        operand,
        span: { start: token.span.start, end: operand.span.end },
      }
    }
    if (token.kind === 'punctuation' && token.text === '!') {
      this.#report(forbiddenOperatorMessage(token.text), token.span)
      this.#advance()
      this.#parseUnary('a number')
      return null
    }
    return this.#parsePrimary(what)
  }

  #parsePrimary(what: string): ScriptExpression | null {
    const token = this.#peek()
    if (token.kind === 'number') {
      this.#advance()
      return {
        kind: 'number',
        value: secondsOf(token),
        ...(token.unit !== undefined ? { unit: token.unit } : {}),
        span: token.span,
      }
    }
    if (token.kind === 'string') {
      this.#advance()
      return { kind: 'string', value: token.value as string, span: token.span }
    }
    if (token.kind === 'identifier') {
      this.#advance()
      if (!this.#matchPunctuation('(')) {
        return this.#parseMemberChain({ kind: 'identifier', name: token.text, span: token.span })
      }
      const args: ScriptExpression[] = []
      while (!this.#atEnd() && !this.#checkPunctuation(')')) {
        const arg = this.#parseExpression('a value')
        if (arg === null) return null
        args.push(arg)
        if (!this.#matchPunctuation(',')) break
      }
      if (!this.#matchPunctuation(')')) {
        this.#report(
          `Expected ")" to close the call to "${token.text}", found ${describeToken(this.#peek())}`,
          this.#peek().span,
        )
        return null
      }
      return this.#parseMemberChain({
        kind: 'call',
        callee: token.text,
        calleeSpan: token.span,
        args,
        span: { start: token.span.start, end: this.#previousEnd() },
      })
    }
    if (token.kind === 'punctuation' && token.text === '(') {
      this.#advance()
      const inner = this.#parseExpression('a value')
      this.#expectPunctuation(')')
      return inner === null ? null : this.#parseMemberChain(inner)
    }
    if (token.kind === 'punctuation' && token.text === '[') {
      this.#advance()
      const elements: ScriptExpression[] = []
      while (!this.#atEnd() && !this.#checkPunctuation(']')) {
        const element = this.#parseExpression('a value')
        if (element === null) return null
        elements.push(element)
        if (!this.#matchPunctuation(',')) break
      }
      if (!this.#matchPunctuation(']')) {
        this.#report(
          `Expected "]" to close the list, found ${describeToken(this.#peek())}`,
          this.#peek().span,
        )
        return null
      }
      return this.#parseMemberChain({
        kind: 'list',
        elements,
        span: { start: token.span.start, end: this.#previousEnd() },
      })
    }
    if (token.kind === 'punctuation' && isForbiddenBinaryOperator(token)) {
      this.#report(forbiddenOperatorMessage(token.text), token.span)
      this.#advance()
      this.#parseUnary('a number')
      return null
    }
    this.#report(`Expected ${what}, found ${describeToken(token)}`, token.span)
    return null
  }

  /**
   * Attach `.` accesses to a primary expression: `alias.x` (a property read),
   * `conj.row(0)` (a selector target), `worldAt(a, t).rotation` (a field read on
   * a record). The compiler types each member against its object.
   */
  #parseMemberChain(base: ScriptExpression): ScriptExpression {
    let expression = base
    while (this.#matchPunctuation('.')) {
      const name = this.#expectIdentifier('a property or function name')
      if (name === null) return expression
      let args: ScriptExpression[] | undefined
      if (this.#matchPunctuation('(')) {
        args = []
        while (!this.#atEnd() && !this.#checkPunctuation(')')) {
          const arg = this.#parseExpression('a value')
          if (arg === null) return expression
          args.push(arg)
          if (!this.#matchPunctuation(',')) break
        }
        if (!this.#matchPunctuation(')')) {
          this.#report(
            `Expected ")" to close the call to "${name.text}", found ${describeToken(this.#peek())}`,
            this.#peek().span,
          )
          return expression
        }
      }
      expression = {
        kind: 'member',
        object: expression,
        name: name.text,
        nameSpan: name.span,
        ...(args !== undefined ? { args } : {}),
        span: { start: expression.span.start, end: this.#previousEnd() },
      }
    }
    return expression
  }

  /** Whether the current token can begin an expression in an argument slot. */
  #startsExpression(): boolean {
    const token = this.#peek()
    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'identifier') {
      return true
    }
    return (
      token.kind === 'punctuation' &&
      (token.text === '(' || token.text === '-' || token.text === '+' || token.text === '[')
    )
  }

  #isEaseName(): boolean {
    const token = this.#peek()
    return (
      token.kind === 'identifier' && (SCRIPT_EASE_NAMES as readonly string[]).includes(token.text)
    )
  }

  #nextIsPunctuation(text: string): boolean {
    const next = this.#tokens[this.#index + 1]
    return next?.kind === 'punctuation' && next.text === text
  }

  #expectIdentifier(what: string): Token | null {
    if (this.#peek().kind !== 'identifier') {
      this.#report(`Expected ${what}, found ${describeToken(this.#peek())}`, this.#peek().span)
      return null
    }
    return this.#advance()
  }

  #expectPunctuation(text: string): boolean {
    if (this.#matchPunctuation(text)) return true
    this.#report(`Expected "${text}", found ${describeToken(this.#peek())}`, this.#peek().span)
    return false
  }

  #isIdentifier(text: string): boolean {
    const token = this.#peek()
    return token.kind === 'identifier' && token.text === text
  }

  #checkPunctuation(text: string): boolean {
    const token = this.#peek()
    return token.kind === 'punctuation' && token.text === text
  }

  #matchPunctuation(text: string): boolean {
    if (this.#checkPunctuation(text)) {
      this.#advance()
      return true
    }
    return false
  }

  #atEnd(): boolean {
    return this.#peek().kind === 'eof'
  }

  #peek(): Token {
    return this.#tokens[this.#index]
  }

  #previousToken(): Token {
    return this.#tokens[Math.max(0, this.#index - 1)]
  }

  #previousEnd(): number {
    return this.#previousToken().span.end
  }

  #advance(): Token {
    const token = this.#tokens[this.#index]
    if (token.kind !== 'eof') this.#index += 1
    return token
  }

  #report(message: string, span: SourceSpan): void {
    this.#diagnostics.push({ message, span })
  }

  /** Recover after a malformed statement: skip to the next statement start. */
  #skipToNextStatement(): void {
    while (!this.#atEnd() && !this.#checkPunctuation('}') && !this.#isStatementStart()) {
      this.#advance()
    }
  }

  /** The operator keyword at the cursor, or null for call statements. */
  #operatorKeyword(): string | null {
    const token = this.#peek()
    if (token.kind !== 'identifier' || !OPERATOR_KEYWORDS.has(token.text)) return null
    return this.#nextIsPunctuation('.') ? null : token.text
  }

  #isStatementStart(): boolean {
    const token = this.#peek()
    if (token.kind !== 'identifier') return false
    if (token.text === 'bind' || token.text === 'let' || this.#operatorKeyword() !== null) {
      return true
    }
    const next = this.#tokens[this.#index + 1]
    return next?.kind === 'punctuation' && (next.text === '.' || next.text === '=')
  }
}

function binaryExpression(
  operator: Token,
  left: ScriptExpression,
  right: ScriptExpression,
): BinaryExpression {
  return {
    kind: 'binary',
    operator: operator.text as BinaryExpression['operator'],
    operatorSpan: operator.span,
    left,
    right,
    span: { start: left.span.start, end: right.span.end },
  }
}

function isForbiddenBinaryOperator(token: Token): boolean {
  return (
    token.kind === 'punctuation' &&
    (COMPARISON_OPERATORS.has(token.text) || LOGICAL_OPERATORS.has(token.text))
  )
}

function forbiddenOperatorMessage(operator: string): string {
  if (COMPARISON_OPERATORS.has(operator)) {
    return 'Comparisons are not part of the Animation Script language — script values are compile-time numbers and lists.'
  }
  return 'Logical operators are not part of the Animation Script language.'
}

function tokenize(source: string, diagnostics: ScriptParseDiagnostic[]): Token[] {
  const tokens: Token[] = []
  let offset = 0

  while (offset < source.length) {
    const char = source[offset]
    if (char === '\n' || char === ' ' || char === '\t' || char === '\r') {
      offset += 1
      continue
    }
    if (char === '/' && source[offset + 1] === '/') {
      while (offset < source.length && source[offset] !== '\n') {
        offset += 1
      }
      continue
    }
    const start = offset
    if (isIdentifierStart(char)) {
      while (offset < source.length && isIdentifierPart(source[offset])) {
        offset += 1
      }
      tokens.push({
        kind: 'identifier',
        text: source.slice(start, offset),
        span: { start, end: offset },
      })
      continue
    }
    if (isDigit(char)) {
      while (offset < source.length && isDigit(source[offset])) {
        offset += 1
      }
      if (source[offset] === '.' && isDigit(source[offset + 1])) {
        offset += 1
        while (offset < source.length && isDigit(source[offset])) {
          offset += 1
        }
      }
      const digitsEnd = offset
      let unit: 's' | 'ms' | undefined
      if (
        source[offset] === 'm' &&
        source[offset + 1] === 's' &&
        !isIdentifierPart(source[offset + 2] ?? '')
      ) {
        unit = 'ms'
        offset += 2
      } else if (source[offset] === 's' && !isIdentifierPart(source[offset + 1] ?? '')) {
        unit = 's'
        offset += 1
      }
      tokens.push({
        kind: 'number',
        text: source.slice(start, offset),
        value: Number(source.slice(start, digitsEnd)),
        unit,
        span: { start, end: offset },
      })
      continue
    }
    if (char === '"') {
      offset += 1
      let value = ''
      let closed = false
      while (offset < source.length) {
        const current = source[offset]
        if (current === '\\' && offset + 1 < source.length) {
          value += source[offset + 1]
          offset += 2
          continue
        }
        if (current === '"') {
          offset += 1
          closed = true
          break
        }
        if (current === '\n') break
        value += current
        offset += 1
      }
      if (!closed) {
        diagnostics.push({ message: 'Unterminated string literal', span: { start, end: offset } })
        continue
      }
      tokens.push({
        kind: 'string',
        text: source.slice(start, offset),
        value,
        span: { start, end: offset },
      })
      continue
    }
    const twoCharOperator = source.slice(offset, offset + 2)
    if (
      twoCharOperator === '<=' ||
      twoCharOperator === '>=' ||
      twoCharOperator === '==' ||
      twoCharOperator === '!=' ||
      twoCharOperator === '&&' ||
      twoCharOperator === '||'
    ) {
      offset += 2
      tokens.push({
        kind: 'punctuation',
        text: twoCharOperator,
        span: { start, end: offset },
      })
      continue
    }
    if (PUNCTUATION.has(char) || char === '<' || char === '>' || char === '!') {
      offset += 1
      tokens.push({
        kind: 'punctuation',
        text: char,
        span: { start, end: offset },
      })
      continue
    }
    offset += 1
    diagnostics.push({ message: `Unexpected character "${char}"`, span: { start, end: offset } })
  }
  tokens.push({
    kind: 'eof',
    text: '',
    span: { start: source.length, end: source.length },
  })
  return tokens
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char)
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function describeToken(token: Token): string {
  if (token.kind === 'eof') return 'the end of the script'
  if (token.kind === 'string') return `string ${token.text}`
  return `"${token.text}"`
}

/** A number token's value in seconds: bare numbers are seconds, `ms` divides. */
function secondsOf(token: Token): number {
  const value = token.value as number
  return token.unit === 'ms' ? value / 1000 : value
}

/** Convert a source offset to a 1-based line and column. */
export function lineColumnAt(source: string, offset: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}
