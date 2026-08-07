# Core Architecture Principles

**Version:** 1.0

This document defines the fundamental architectural principles of the project. Every feature, module, and future architectural decision should follow these principles.

These rules take precedence over implementation convenience.

---

# 1. Engine First

The **Core Engine** is the heart of the application.

It owns:

* Scene graph
* Timeline
* Animation evaluation
* Asset instances
* Materials
* Serialization
* Project state

Everything else communicates with the engine.

---

# 2. Renderer is Read-Only

The renderer must **never** modify application state.

Its only responsibility is to render the current state of the engine.

It may:

* Read scene objects
* Read animation values
* Draw graphics

It must never:

* Create objects
* Delete objects
* Modify transforms
* Change animation data

---

# 3. Renderer Independence

The engine must not depend on PixiJS or any rendering technology.

Future renderers should be replaceable without changing the engine.

Possible renderers:

* PixiJS
* React Native
* Headless renderer
* Video renderer

---

# 4. AI Never Modifies State Directly

AI is treated as another editor user.

AI cannot directly modify the project.

Instead, AI generates commands.

Example:

```text
AI

↓

MoveNodeCommand

↓

Core Engine

↓

Scene Updated
```

This ensures:

* Undo / Redo
* Validation
* Logging
* Repeatability
* Easier debugging

---

# 5. Everything is a Command

Every project modification should be represented as a command.

Examples:

* CreateSlide
* DeleteSlide
* AddAsset
* RemoveAsset
* MoveNode
* RotateNode
* ScaleNode
* AddKeyframe
* DeleteKeyframe
* ChangeMaterial
* ApplyShader

Commands should be:

* Serializable
* Undoable
* Redoable
* Loggable

---

# 6. Engine Owns the Truth

There is only one authoritative project state.

React state is a UI representation.

Pixi objects are rendering representations.

Database is persistence.

The Core Engine owns the actual state.

---

# 7. Assets are Immutable

Assets represent reusable definitions.

An asset never changes after creation.

Slides contain **asset instances**, not editable assets.

Changing an instance must never modify the original asset.

---

# 8. Separate Definition from Instance

Definitions:

* Asset
* Material
* Shader
* Animation Clip

Instances:

* AssetInstance
* MaterialInstance
* ShaderInstance

Definitions are reusable.

Instances belong to a project.

---

# 9. Timeline Owns Animation

Animation data belongs to the timeline.

Objects contain state.

Timeline changes state over time.

Objects should never contain animation logic.

---

# 10. Scene Graph Owns Hierarchy

Scene hierarchy belongs exclusively to the scene graph.

The renderer mirrors the scene graph.

The UI visualizes the scene graph.

Neither owns it.

---

# 11. Components Over Inheritance

Prefer composition.

Example:

```
SceneNode

TransformComponent

SpriteComponent

AnimationComponent

MaterialComponent

ShaderComponent
```

Avoid deep inheritance hierarchies.

---

# 12. Single Responsibility

Every module should answer exactly one question.

If a class description contains "and", it likely has multiple responsibilities.

Example:

Bad:

```
ProjectService

Loads
Saves
Exports
Duplicates
Validates
```

Good:

```
ProjectLoader

ProjectSaver

ProjectExporter

ProjectValidator

ProjectDuplicator
```

---

# 13. Small Files

Recommended limits:

Ideal:

200–300 lines

Acceptable:

400 lines

Maximum:

500 lines

If a file approaches the maximum size, it should be split into smaller modules.

---

# 14. One Public Type Per File

Each file should expose a single primary class, interface, or function.

Example:

```
Scene.ts

Timeline.ts

AnimationTrack.ts

ShaderProgram.ts
```

Avoid multiple unrelated public classes in one file.

---

# 15. Dependency Direction

Dependencies should always flow downward.

```
UI

↓

Editor

↓

Core Engine

↓

Renderer
```

Lower layers must never depend on upper layers.

---

# 16. Modules Communicate Through Public APIs

Modules must not access another module's internal implementation.

Interaction should happen only through clearly defined public interfaces.

---

# 17. Event-Driven Communication

Modules should communicate using events whenever possible.

Examples:

* SlideCreated
* AssetImported
* TimelineChanged
* ProjectSaved
* MaterialUpdated

Avoid tightly coupling modules through direct calls.

---

# 18. Treat Prompts as Source Code

Prompts are part of the application.

They should:

* Be version controlled
* Be reviewed
* Be tested
* Have descriptive names
* Live outside application code

Prompts must never be embedded directly inside business logic.

---

# 19. AI Generates Intent, Not Implementation

AI should describe **what** should happen.

The engine decides **how** it happens.

Example:

Good:

```
Move character to x=300 over 2 seconds.
```

Not:

```
Call renderer.moveSprite(...)
```

---

# 20. Data-Driven Design

Projects should be represented entirely as data.

The editor is simply a tool that edits this data.

The renderer visualizes this data.

The AI reasons about this data.

This enables:

* Saving
* Loading
* Versioning
* Collaboration
* Video export
* Future platforms

---

# 21. Deterministic Engine

Given:

* Project
* Timeline position
* Random seed

the engine must always produce exactly the same scene.

Avoid hidden mutable state or frame-dependent behavior.

---

# 22. Testability First

Every core module should be testable without:

* React
* PixiJS
* Browser APIs
* AI services

Business logic should be platform-independent whenever possible.

---

# 23. Explicit State

Avoid hidden side effects.

Every state transition should be explicit, traceable, and reproducible.

Implicit behavior makes debugging and AI-assisted development significantly harder.

---

# 24. Prefer Configuration Over Code

Behavior should be described through:

* JSON
* Project files
* Metadata
* Timelines
* Asset definitions
* Shader parameters

rather than hard-coded logic.

---

# 25. Extensibility Before Optimization

The initial implementation should prioritize clear module boundaries and extensibility.

Optimize performance only after profiling identifies real bottlenecks.

Premature optimization should never compromise architecture.

---

# Guiding Principle

> **The Core Engine owns the project state. Every modification is expressed as a command. The renderer visualizes state, the UI edits state, and AI proposes state changes. All three are independent clients of the same engine.**

Following these principles will keep the codebase modular, testable, AI-friendly, and capable of supporting future renderers, platforms, and features without major architectural changes.
