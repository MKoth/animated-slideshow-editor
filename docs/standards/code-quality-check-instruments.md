For a project that will likely grow to **50k–200k+ lines of code**, I would set up quality tools from the very beginning. They pay for themselves quickly.

---

# Code Quality & Development Tools

## Frontend (React + TypeScript)

### ESLint

Purpose

* Detect common mistakes
* Enforce consistent code style
* Catch potential bugs

Website

[https://eslint.org/](https://eslint.org/)

---

### Prettier

Purpose

* Automatic code formatting
* Keeps formatting identical across contributors and AI-generated code

Website

[https://prettier.io/](https://prettier.io/)

---

### TypeScript Strict Mode

Purpose

* Catch type errors during compilation
* Reduce runtime bugs

Recommended configuration

```json
"strict": true
```

---

### Husky

Purpose

* Run quality checks before every commit
* Prevent committing broken code

Website

[https://typicode.github.io/husky/](https://typicode.github.io/husky/)

---

### lint-staged

Purpose

* Run ESLint and Prettier only on modified files
* Makes commits much faster

Website

[https://github.com/lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)

---

### Vitest

Purpose

* Unit testing
* Fast integration with Vite

Website

[https://vitest.dev/](https://vitest.dev/)

---

### React Testing Library

Purpose

* Component testing
* User interaction testing

Website

[https://testing-library.com/](https://testing-library.com/)

---

# Backend (Python)

## Ruff

Purpose

* Extremely fast linter
* Replaces many traditional Python linters
* Also formats code (optionally)

Recommended instead of:

* flake8
* isort
* pyflakes
* pycodestyle

Website

[https://docs.astral.sh/ruff/](https://docs.astral.sh/ruff/)

---

## Black

Purpose

* Automatic Python formatting

Website

[https://black.readthedocs.io/](https://black.readthedocs.io/)

*(If you decide to use Ruff's formatter, you can skip Black.)*

---

## mypy

Purpose

* Static type checking

Very useful when using:

* FastAPI
* Pydantic
* SQLAlchemy

Website

[https://mypy-lang.org/](https://mypy-lang.org/)

---

## pytest

Purpose

* Backend testing

Website

[https://pytest.org/](https://pytest.org/)

---

## pytest-cov

Purpose

* Code coverage reports

---

# API

## OpenAPI

Already provided automatically by FastAPI.

Useful for

* API testing
* Documentation
* AI agents understanding available endpoints

---

# Security

## npm audit

Checks JavaScript dependency vulnerabilities.

---

## pip-audit

Checks Python dependency vulnerabilities.

Website

[https://github.com/pypa/pip-audit](https://github.com/pypa/pip-audit)

---

# Git

## Commitlint

Purpose

Checks commit message format.

Example

```
feat: add slide timeline

fix: shader compilation bug

refactor: asset loading
```

---

## Conventional Commits

Purpose

Consistent commit history.

---

# AI Development

## Cursor Rules / Claude Code Rules

Since much of the code may be AI-assisted, define project rules early.

Examples:

* Always use TypeScript strict mode.
* Prefer composition over inheritance.
* Avoid `any`.
* Never duplicate business logic.
* Keep API endpoints thin; business logic belongs in services.
* All new features should include tests where practical.

---

# Recommended Installation

## Frontend

```
eslint
prettier
typescript (strict mode)
husky
lint-staged
vitest
@testing-library/react
```

---

## Backend

```
ruff
mypy
pytest
pytest-cov
pip-audit
```

*(Optionally add `black` if you don't use Ruff's formatter.)*

---

# Continuous Integration (Later)

When the project moves to GitHub, add a CI workflow that automatically runs:

1. Frontend build
2. ESLint
3. Prettier check
4. Vitest
5. Backend lint (Ruff)
6. mypy
7. pytest
8. Dependency vulnerability checks (`npm audit`, `pip-audit`)

This ensures that no code can be merged unless it meets your quality standards.

---

# Overall Recommendation

If I were choosing the **minimum high-value toolset** for this project, it would be:

### Frontend

* TypeScript (strict mode)
* ESLint
* Prettier
* Husky
* lint-staged
* Vitest

### Backend

* Ruff (linter + formatter)
* mypy
* pytest
* pytest-cov

This combination provides excellent code quality, fast feedback, consistent formatting, and strong type safety while keeping the toolchain relatively simple.
