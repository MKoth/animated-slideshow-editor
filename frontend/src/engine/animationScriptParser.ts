/**
 * Lexer and recovery-oriented recursive-descent parser for the Animation
 * Script language. The parser reports source-located syntax diagnostics and
 * keeps going so a Check can surface more than the first mistake.
 */

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
  readonly from: number
  readonly fromSpan: SourceSpan
  readonly span: SourceSpan
}

/**
 * The optional script-wide `defaults { duration, ease }` block. Both fields
 * are optional and there is no silent fallback for duration: a tween whose
 * duration comes from neither its own arguments nor this block is an error.
 */
export interface DefaultsNode {
  readonly kind: 'defaults'
  readonly duration?: number
  readonly durationSpan?: SourceSpan
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

export interface PropertyEntry {
  readonly key: string
  readonly keySpan: SourceSpan
  readonly value: number
  readonly valueSpan: SourceSpan
}

export interface StatementNode {
  readonly kind: 'statement'
  readonly alias: string
  readonly aliasSpan: SourceSpan
  readonly method: string
  readonly methodSpan: SourceSpan
  readonly entries: readonly PropertyEntry[]
  readonly duration?: number
  readonly durationSpan?: SourceSpan
  readonly ease?: string
  readonly easeSpan?: SourceSpan
  readonly span: SourceSpan
}

/** `wait(duration)` advances the cursor by `d` and emits nothing. */
export interface WaitNode {
  readonly kind: 'wait'
  readonly duration: number
  readonly durationSpan: SourceSpan
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
  readonly time?: number
  readonly timeSpan?: SourceSpan
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
  BindNode | StatementNode | WaitNode | MarkNode | AtNode | ParallelNode

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

const PUNCTUATION = new Set(['{', '}', '(', ')', ',', '.', '=', ':'])

/**
 * Identifiers that begin an operator statement. `wait(...)` is the operator
 * while `wait.tween(...)` is an alias named `wait`, which is why the `.` lookahead
 * keeps deciding; `bind` is handled separately because its form differs.
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
    const from = this.#parseSeconds('a start time in seconds')
    if (title === null || fromToken === null || from === null) {
      this.#report('Animation Script header is incomplete', scriptToken.span)
      return null
    }
    return {
      kind: 'header',
      title: title.value as string,
      titleSpan: title.span,
      from: from.seconds,
      fromSpan: from.span,
      span: { start: scriptToken.span.start, end: this.#previousEnd() },
    }
  }

  #parseStatement(): ScriptStatementNode | null {
    if (this.#isIdentifier('bind')) {
      return this.#parseBind()
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
    let duration: number | undefined
    let durationSpan: SourceSpan | undefined
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
        const value = this.#parseSeconds('a duration in seconds')
        if (value !== null) {
          duration = value.seconds
          durationSpan = value.span
        }
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
      durationSpan,
      ease,
      easeSpan,
      span: { start, end: this.#previousEnd() },
    }
  }

  #parseWait(): WaitNode | null {
    const start = this.#peek().span.start
    this.#advance()
    if (!this.#expectPunctuation('(')) return null
    const duration = this.#parseSeconds('a duration in seconds')
    this.#expectPunctuation(')')
    if (duration === null) return null
    return {
      kind: 'wait',
      duration: duration.seconds,
      durationSpan: duration.span,
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
    let time: number | undefined
    let timeSpan: SourceSpan | undefined
    let marker: string | undefined
    let markerSpan: SourceSpan | undefined
    if (this.#peek().kind === 'number') {
      const value = this.#parseSeconds('a time or a marker name in quotes')
      if (value !== null) {
        time = value.seconds
        timeSpan = value.span
      }
    } else if (this.#peek().kind === 'string') {
      const token = this.#advance()
      marker = token.value as string
      markerSpan = token.span
    } else {
      this.#report(
        `Expected a time or a marker name in quotes, found ${describeToken(this.#peek())}`,
        this.#peek().span,
      )
      return null
    }
    this.#expectPunctuation(')')
    if (time === undefined && marker === undefined) return null
    const statement = this.#parseStatement()
    if (statement === null) return null
    if (statement.kind === 'bind') {
      this.#report('"at" cannot place a binding', statement.aliasSpan)
      return null
    }
    return {
      kind: 'at',
      time,
      timeSpan,
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

  #parseCallStatement(): StatementNode | null {
    const start = this.#peek().span.start
    const alias = this.#advance()
    this.#expectPunctuation('.')
    const method = this.#expectIdentifier('a method name')
    this.#expectPunctuation('(')
    const entries = this.#parseRecord()
    let duration: number | undefined
    let durationSpan: SourceSpan | undefined
    let ease: string | undefined
    let easeSpan: SourceSpan | undefined
    while (this.#matchPunctuation(',')) {
      if (this.#peek().kind === 'number') {
        const token = this.#advance()
        if (duration !== undefined) {
          this.#report('Only one duration is allowed', token.span)
          continue
        }
        duration = secondsOf(token)
        durationSpan = token.span
      } else if (this.#peek().kind === 'identifier') {
        const token = this.#advance()
        if (ease !== undefined) {
          this.#report('Only one ease is allowed', token.span)
          continue
        }
        ease = token.text
        easeSpan = token.span
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
    if (method === null || entries === null) {
      return null
    }
    return {
      kind: 'statement',
      alias: alias.text,
      aliasSpan: alias.span,
      method: method.text,
      methodSpan: method.span,
      entries,
      duration,
      durationSpan,
      ease,
      easeSpan,
      span: { start, end: this.#previousEnd() },
    }
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
      const value = this.#parseNumber('a number value')
      if (key === null || value === null) {
        return null
      }
      if (seen.has(key.text)) {
        this.#report(`Property "${key.text}" is written twice in one statement`, key.span)
      }
      seen.add(key.text)
      entries.push({
        key: key.text,
        keySpan: key.span,
        value,
        valueSpan: this.#previousToken().span,
      })
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

  /** A plain number: duration suffixes belong to durations, not values. */
  #parseNumber(what: string): number | null {
    if (this.#peek().kind !== 'number') {
      this.#report(`Expected ${what}, found ${describeToken(this.#peek())}`, this.#peek().span)
      return null
    }
    const token = this.#advance()
    if (token.unit !== undefined) {
      this.#report(`Expected ${what} without a duration suffix, found "${token.text}"`, token.span)
    }
    return token.value as number
  }

  /** A number in seconds, honoring the optional `s`/`ms` suffix. */
  #parseSeconds(what: string): { seconds: number; span: SourceSpan } | null {
    if (this.#peek().kind !== 'number') {
      this.#report(`Expected ${what}, found ${describeToken(this.#peek())}`, this.#peek().span)
      return null
    }
    const token = this.#advance()
    return { seconds: secondsOf(token), span: token.span }
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
    if (token.text === 'bind' || this.#operatorKeyword() !== null) return true
    const next = this.#tokens[this.#index + 1]
    return next?.kind === 'punctuation' && next.text === '.'
  }
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
    if (isDigit(char) || (char === '-' && isDigit(source[offset + 1]))) {
      if (char === '-') offset += 1
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
    if (PUNCTUATION.has(char)) {
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
