# AI Slideshow Editor — Backend

FastAPI backend for the AI Slideshow Editor.

See the [repository README](../README.md) for requirements, installation, and run instructions.

## Run

```bash
uv run uvicorn app.main:app --reload
```

Swagger UI: http://localhost:8000/docs

## Checks

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest
```
