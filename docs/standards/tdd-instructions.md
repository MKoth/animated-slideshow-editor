# Development Methodology

## Test-Driven Development (TDD)

The project will follow a **Test-Driven Development (TDD)** approach whenever practical. Every new feature should begin with defining the expected behavior through tests before implementing the functionality.

### TDD Cycle

The development process follows the classic **Red → Green → Refactor** cycle:

1. **Red**

   * Write one or more failing tests that describe the desired behavior.
   * Confirm that the tests fail for the expected reason.

2. **Green**

   * Implement the minimal amount of code required to make the tests pass.
   * Avoid adding functionality beyond what the tests require.

3. **Refactor**

   * Improve the implementation while keeping all tests passing.
   * Remove duplication.
   * Improve naming and readability.
   * Simplify algorithms where possible.

---

## Testing Philosophy

Tests should verify **behavior**, not implementation details.

Prefer testing the public API of a module rather than its internal implementation.

A well-written test should continue to pass even if the internal implementation is completely rewritten.

---

## Unit Tests

Every business logic component should have unit tests.

Examples include:

* Timeline interpolation
* Animation evaluation
* Storyboard parsing
* Asset metadata validation
* Scene graph operations
* AI response parsing
* JSON serialization/deserialization
* Shader parameter validation

Unit tests should be:

* Fast (typically under a few milliseconds each)
* Independent
* Deterministic
* Easy to understand

---

## Integration Tests

Integration tests should verify interactions between multiple components.

Examples:

* Frontend ↔ Backend API
* Database persistence
* Asset loading
* Project serialization
* Video export pipeline
* AI workflow execution

---

## UI Tests

Critical editor workflows should be covered by UI tests.

Examples:

* Creating a project
* Creating slides
* Dragging assets
* Editing keyframes
* Saving/loading projects
* Undo/Redo

---

## Regression Tests

Every bug that is fixed should receive a regression test before implementing the fix whenever possible.

This prevents the same issue from reappearing later.

---

## AI-Specific Testing

Since the application uses AI, tests should avoid depending on live LLM responses.

Instead:

* Mock AI responses during automated tests.
* Store representative responses as fixtures.
* Validate that parsing and processing behave correctly.

Only dedicated integration tests should call real AI services.

---

## Code Coverage

Code coverage is a useful metric but **should not be treated as a goal itself**.

The objective is to cover important business logic rather than maximizing percentages.

Priority should be given to testing:

* Core animation engine
* Timeline evaluation
* Asset management
* Serialization
* API endpoints
* AI workflow orchestration

---

## Development Rules

When implementing a new feature:

1. Understand the requirements.
2. Write failing tests.
3. Verify the tests fail.
4. Implement the smallest possible solution.
5. Verify all tests pass.
6. Refactor if necessary.
7. Run all quality checks.
8. Commit only after the project builds and all tests pass.

---

## Continuous Verification

Before every commit, the following should succeed:

* Type checking
* Linting
* Code formatting verification
* Unit tests
* Integration tests (where applicable)

No code should be committed if any of these checks fail.

---

## Guiding Principle

> **Tests define the expected behavior of the system.** Implementation is free to evolve, but all existing tests must continue to pass unless the intended behavior has changed. This approach enables safe refactoring, supports AI-assisted development, and helps maintain long-term reliability as the project grows.
