# Step 1 – Project Bootstrap

## Goal

Create a fully working development environment that becomes the foundation for the entire project.

After completing this step, the developer should be able to start both the frontend and backend with a single command each, verify they communicate correctly, and have automated code quality and testing tools in place.

This step intentionally contains **no business logic**. Its only purpose is to establish a stable development environment.

---

# Success Criteria

At the end of this step, the following should work:

* ✅ Frontend starts successfully.
* ✅ Backend starts successfully.
* ✅ Frontend can communicate with backend.
* ✅ API documentation is available.
* ✅ TypeScript compiles without errors.
* ✅ Python project starts without errors.
* ✅ ESLint passes.
* ✅ Ruff passes.
* ✅ All tests pass.
* ✅ Git hooks are installed.
* ✅ README contains startup instructions.

---

# Functional Requirements

## Frontend

Create a React application using:

* React
* TypeScript
* Vite

Install all previously selected libraries.

The application should display a simple page containing:

* Application title
* Backend status
* "Ping Backend" button

Initially nothing else.

---

## Backend

Create a FastAPI application.

The backend exposes two endpoints.

### Health endpoint

```http
GET /health
```

Response

```json
{
    "status": "ok"
}
```

---

### Ping endpoint

```http
GET /ping
```

Response

```json
{
    "message": "pong"
}
```

---

FastAPI Swagger should be available.

---

# Communication

Frontend should call

```text
GET /health
```

when application starts.

Display

```text
Backend connected
```

or

```text
Backend unavailable
```

depending on result.

---

When user presses

```text
Ping Backend
```

call

```text
GET /ping
```

and display returned message.

---

# Environment Configuration

Create environment files.

Frontend

```text
.env
.env.example
```

Backend

```text
.env
.env.example
```

No secrets yet.

Only configurable values such as

* Backend URL
* Frontend URL
* Development mode

---

# Logging

Backend should have centralized logging.

Every request should be logged.

Example

```text
GET /ping 200 3ms
```

Frontend should log API errors to console.

---

# Error Handling

Create global error handlers.

Backend

* HTTP exceptions
* Unexpected exceptions

Frontend

* API request failures
* Unexpected rendering errors

Only simple default implementations are required.

---

# API Client

Create one reusable API client.

Do not perform fetch requests directly inside components.

Example structure

```text
ApiClient

↓

HealthApi

↓

PingApi
```

The rest of the project should always use these API abstractions.

---

# Backend Structure

At this stage only minimal modules are needed.

```text
main

↓

AppFactory

↓

Health Router

↓

Ping Router
```

Business logic is intentionally minimal.

---

# Frontend Structure

At this stage

```text
main

↓

App

↓

HomePage

↓

BackendStatus

↓

PingButton
```

No editor components yet.

---

# Testing

## Frontend

Create one unit test.

Verify

BackendStatus

renders correctly.

---

## Backend

Create tests verifying

```text
GET /health

↓

200
```

and

```text
GET /ping

↓

pong
```

---

# Static Analysis

Frontend

Verify

* ESLint
* TypeScript
* Prettier

run successfully.

---

Backend

Verify

* Ruff
* mypy
* pytest

run successfully.

---

# Git Hooks

Configure

Husky

with pre-commit hook.

The hook should execute

Frontend

* ESLint
* TypeScript
* Tests

Backend

* Ruff
* mypy
* pytest

Commit should fail if any check fails.

---

# Documentation

Update README.

Include

## Requirements

* Node version
* Python version
* uv version

---

## Installation

Frontend

Backend

---

## Running

Start backend

Start frontend

---

## Testing

Commands for

Frontend

Backend

---

## Linting

Commands

---

# Manual Verification Checklist

The developer should verify the following manually:

## Backend

* Backend starts successfully.
* Swagger opens in browser.
* `/health` returns `{"status":"ok"}`.
* `/ping` returns `{"message":"pong"}`.

---

## Frontend

* Frontend starts successfully.
* Browser opens application.
* Initial backend status is displayed.
* Clicking **Ping Backend** displays **pong**.
* Backend stopped → frontend shows connection error gracefully.

---

## Quality

Run:

Frontend

* ESLint
* TypeScript
* Tests

Backend

* Ruff
* mypy
* Tests

Everything passes without warnings or errors.

---

## Git

Attempt a commit with intentionally broken code.

Verify the pre-commit hook blocks the commit.

---

# Deliverables

After completing Step 1, the repository should contain:

* Fully configured frontend
* Fully configured backend
* Working API communication
* Automated testing
* Automated linting
* Git hooks
* Environment configuration
* Basic logging
* Basic error handling
* Initial documentation

No editor functionality should exist yet.

---

# Definition of Done

Step 1 is considered complete when:

* All automated checks pass.
* Frontend and backend communicate successfully.
* A new developer can clone the repository, follow the README, and have the project running in under 10 minutes.
* The development environment is stable enough that future implementation steps can focus solely on product features rather than tooling or infrastructure.
