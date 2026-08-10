# AI Slideshow Editor

An interactive slideshow editor for AI-assisted language lessons, rendered in the browser.

**Phase 1 — Foundation:** full-window editor shell (no editing, rendering, or project functionality yet).

## Requirements

| Tool            | Minimum version   |
| --------------- | ----------------- |
| Node.js         | 22 LTS (npm)      |
| Python          | 3.12              |
| uv              | 0.7+ (any recent) |

Install uv: <https://docs.astral.sh/uv/getting-started/installation/>

## Repository layout

```
backend/    FastAPI backend (uv, Python 3.12)
frontend/   React 19 + TypeScript + Vite editor shell (npm)
```

## Backend setup

```bash
cd backend
uv sync                # installs dependencies and creates .venv
cp .env.example .env   # optional; defaults work out of the box
```

### Run the backend

```bash
cd backend
uv run uvicorn app.main:app --reload
```

- API base: http://localhost:8000
- Swagger UI: http://localhost:8000/docs
- Health check: http://localhost:8000/health → `{"status":"ok"}`

### Backend checks

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest
```

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env   # optional; defaults work out of the box
```

### Run the frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 — the dev server proxies `/health`, `/ping` (and `/api/*`) to the backend at http://localhost:8000, so no CORS configuration is needed in development.

### Frontend checks

```bash
cd frontend
npm run lint           # ESLint
npm run typecheck      # TypeScript (strict)
npm run format:check   # Prettier
npm test               # Vitest
```

## Git hooks

[Husky](https://typicode.github.io/husky/) installs a pre-commit hook that runs [lint-staged](https://github.com/lint-staged/lint-staged) over the staged files:

- Frontend: ESLint, TypeScript, Prettier, Vitest
- Backend: Ruff (lint + format), mypy, pytest

A commit fails if any check fails. Hooks are installed automatically by `npm install` in `frontend/`.

## Editing environment

- Minimum supported window width: 1400 px (no mobile support).
- Theme (light/dark), panel sizes, and the selected sidebar tab persist in the browser's `localStorage`.
- With the backend stopped the editor still loads; the status bar shows `Backend unavailable` and the page keeps working (degraded mode).

## Standards and specs

The 12 phase specs on the [project tracker](https://github.com/MKoth/animated-slideshow-editor/issues/21) are the implementation contract. See `docs/standards/` for the coding standards and `CONTEXT.md` for the domain model.
