# Step 3 – Core Engine

## Goal

Implement the **Core Engine**, the heart of the application.

The Core Engine is responsible for managing the project state and exposing a clean API for future editing operations. It is completely independent of React, PixiJS, AI, or any rendering technology.

At the end of this step, there is still **no rendering**. The engine only manages data.

---

# Success Criteria

At the end of this step:

* ✅ A project can be created.
* ✅ Slides can be created.
* ✅ A scene graph exists.
* ✅ Scene nodes can be added and removed.
* ✅ Asset instances exist.
* ✅ The engine owns all project state.
* ✅ Engine is fully unit tested.
* ✅ No React component stores project state.

---

# Scope

This step implements only the data model and engine.

It does **not** include:

* Pixi rendering
* Timeline
* Animation
* AI
* Commands
* Undo / Redo
* Saving
* Database

---

# Core Principle

Everything in the editor should eventually use:

```text
UI

↓

Core Engine

↓

Project State
```

The UI never edits data directly.

---

# Responsibilities

The engine is responsible for:

* Creating projects
* Creating slides
* Creating scene nodes
* Managing hierarchy
* Managing transforms
* Managing asset instances
* Reading current project state

Nothing else.

---

# Public API

The engine should expose a minimal, clean public API.

Examples:

```text
createProject()

openProject()

createSlide()

deleteSlide()

createSceneNode()

removeSceneNode()

addChild()

removeChild()

findNode()

getProject()
```

Only public operations should be accessible.

---

# Project Model

Implement the root project model.

Contains:

* Project metadata
* Slides
* Settings

Initially only one project may exist in memory.

---

# Slide Model

Each slide contains exactly one scene.

A slide owns:

* Name
* Duration (placeholder)
* Scene

No animation yet.

---

# Scene

The scene is the root of the scene graph.

Responsibilities:

* Root node
* Node lookup
* Hierarchy management

---

# Scene Graph

Implement a tree structure.

Example:

```text
Root

├── Background

├── Character

│     ├── Speech Bubble

│     └── Shadow

└── Tree
```

Every node has exactly one parent except the root.

---

# Scene Node

Each node contains only basic information.

Suggested properties:

* id
* name
* parent
* children
* transform
* visibility

No rendering information yet.

---

# Transform

Every node owns a transform.

Properties:

* x
* y
* rotation
* scaleX
* scaleY

No animation.

No interpolation.

Just values.

---

# Asset Definition vs Asset Instance

Implement the separation from the beginning.

Definitions

```text
Fish

Boy

Clock
```

Instances

```text
Fish #1

Fish #2

Fish #3
```

Scene nodes reference asset instances.

Asset definitions remain immutable.

---

# Asset Definition

Contains reusable metadata.

For now:

* id
* name
* type

No images yet.

---

# Asset Instance

Contains:

* reference to asset definition
* transform
* visibility

Future steps will extend this.

---

# Identifiers

Every object should receive a globally unique identifier.

Objects requiring IDs:

* Project
* Slide
* Scene
* Node
* Asset Definition
* Asset Instance

IDs should never change.

---

# Engine Services

Split responsibilities.

Recommended services:

```text
ProjectManager

SlideManager

SceneManager

NodeManager

AssetManager
```

Each service owns one responsibility.

---

# Validation

Engine should reject invalid operations.

Examples:

* Parent cannot become its own child.
* Root cannot be deleted.
* Duplicate IDs are not allowed.
* Null references are rejected.

Throw meaningful exceptions.

---

# Events

Introduce an internal event system.

Examples:

```text
ProjectCreated

SlideCreated

NodeCreated

NodeRemoved

NodeMoved
```

Events only.

No listeners required yet.

---

# Serialization

Implement serialization interfaces.

Methods:

```text
toJSON()

fromJSON()
```

Persistence comes later.

Only conversion is needed now.

---

# React Integration

Introduce a thin Engine Provider.

Responsibilities:

* Create engine
* Provide engine through React context

React components should only call engine methods.

They should not contain project logic.

---

# Developer Debug Panel

Create a temporary debug panel.

Display:

```text
Project

└── Slide 1

      └── Root

            ├── Node A

            └── Node B
```

This allows visual verification without rendering.

This panel is for development only.

---

# Testing

Unit tests should cover:

## Project

* Create project
* Delete project

---

## Slides

* Add slide
* Remove slide

---

## Scene

* Create scene
* Root exists

---

## Nodes

* Add child
* Remove child
* Move child
* Prevent circular hierarchy

---

## Assets

* Create definition
* Create instance

---

## Serialization

* Serialize
* Deserialize
* Objects remain equivalent

---

## Validation

Verify invalid operations throw errors.

---

# Manual Verification Checklist

## Project

Create a project.

Verify:

Debug panel displays:

```text
Project

└── Slide 1

      └── Root
```

---

## Slides

Add slides.

Verify tree updates.

Delete slides.

Verify tree updates.

---

## Nodes

Create several nodes.

Verify hierarchy.

Example:

```text
Root

├── Character

│     └── Bubble

└── Tree
```

---

Move nodes.

Verify hierarchy changes.

---

Attempt invalid operations.

Examples:

* Move root under child
* Delete root

Verify engine rejects them.

---

## Asset Instances

Create an asset definition.

Create several instances.

Verify instances reference the same definition.

---

## Serialization

Serialize project.

Deserialize project.

Verify project remains identical.

---

## React

Reload page.

Engine initializes correctly.

No React component stores project state.

---

# Deliverables

After Step 3, the project contains:

* Core Engine
* Project model
* Slide model
* Scene graph
* Node hierarchy
* Asset definitions
* Asset instances
* Transform model
* Validation
* Event infrastructure
* Serialization support
* React engine provider
* Debug hierarchy viewer

Still **no rendering**.

---

# Definition of Done

Step 3 is complete when:

* The Core Engine is the single source of truth for all project data.
* The complete project hierarchy can be created, modified, inspected, and serialized through the engine API.
* All core operations are covered by unit tests.
* The temporary debug panel accurately reflects the engine state, allowing users to verify scene structure before any rendering functionality is introduced.
* The engine has **no dependency on React, PixiJS, browser APIs, or AI services**, ensuring it can later power multiple renderers and platforms.
