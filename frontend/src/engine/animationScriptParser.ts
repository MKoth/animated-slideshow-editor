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

export type ScriptStatementNode = BindNode | StatementNode

export interface ScriptProgram {
  readonly header: HeaderNode | null
  readonly statements: readonly ScriptStatementNode[]
  readonly diagnostics: readonly ScriptParseDiagnostic[]
}

type TokenKind = 'identifier' | 'number' | 'string' | 'punctuation' | 'eof'

interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly value?: number | string
  readonly span: SourceSpan
}

const PUNCTUATION = new Set(['{', '}', '(', ')', ',', '.', '=', ':'])

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
    return { header, statements, diagnostics: this.#diagnostics }
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
    const from = this.#parseNumber('a start time in seconds')
    if (title === null || fromToken === null || from === null) {
      this.#report('Animation Script header is incomplete', scriptToken.span)
      return null
    }
    return {
      kind: 'header',
      title: title.value as string,
      titleSpan: title.span,
      from,
      fromSpan: this.#previousToken().span,
      span: { start: scriptToken.span.start, end: this.#previousEnd() },
    }
  }

  #parseStatement(): ScriptStatementNode | null {
    if (this.#isIdentifier('bind')) {
      return this.#parseBind()
    }
    if (this.#peek().kind === 'identifier') {
      return this.#parseCallStatement()
    }
    const token = this.#peek()
    this.#report(`Unexpected ${describeToken(token)}`, token.span)
    return null
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
        duration = token.value as number
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

  #parseNumber(what: string): number | null {
    if (this.#peek().kind !== 'number') {
      this.#report(`Expected ${what}, found ${describeToken(this.#peek())}`, this.#peek().span)
      return null
    }
    return this.#advance().value as number
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
    while (!this.#atEnd() && !this.#isStatementStart()) {
      this.#advance()
    }
  }

  #isStatementStart(): boolean {
    const token = this.#peek()
    if (token.kind !== 'identifier') return false
    if (token.text === 'bind') return true
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
      tokens.push({
        kind: 'number',
        text: source.slice(start, offset),
        value: Number(source.slice(start, offset)),
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
