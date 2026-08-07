# Step 5 – Command System

## Goal

Implement a **Command System** as the only mechanism for modifying the Core Engine.

From this point forward, **no part of the application (UI, AI, scripts, tests, or future automation)** may modify the project directly. Every change must be represented by a command.

This is one of the foundational architectural decisions of the project and enables:

* Undo / Redo
* AI editing
* Macro recording
* Action history
* Multiplayer collaboration (future)
* Deterministic replay
* Easier testing

---

# Success Criteria

At the end of this step:

* ✅ Every scene modification happens through commands.
* ✅ Commands are validated before execution.
* ✅ Commands can be logged.
* ✅ Commands can be serialized.
* ✅ UI no longer calls engine methods directly.
* ✅ Engine remains renderer-independent.

Undo/Redo will be implemented later.

---

# Scope

Implement:

* Command infrastructure
* Command dispatcher
* Command execution
* Validation
* Command history (execution log only)

Do **not** implement:

* Undo
* Redo
* Command merging
* Network synchronization

---

# Architectural Principle

Everything flows through the command system.

```text
UI

↓

Command

↓

Command Dispatcher

↓

Core Engine

↓

Events

↓

Renderer
```

The UI never modifies the engine directly.

The AI never modifies the engine directly.

---

# Command Lifecycle

Every command follows the same lifecycle.

```text
Create

↓

Validate

↓

Execute

↓

Emit Events

↓

Store in History
```

Commands should be immutable after creation.

---

# Command Responsibilities

A command should:

* Represent one user intention.
* Validate its input.
* Modify the engine.
* Return success or failure.

A command should **not**:

* Render UI.
* Display dialogs.
* Access React.
* Access Pixi.
* Call AI.

---

# Command Dispatcher

Introduce a dispatcher responsible for executing commands.

Responsibilities:

* Receive command.
* Validate.
* Execute.
* Record history.
* Emit events.

Nothing else.

---

# Base Command Interface

All commands should share a common interface.

Suggested operations:

* validate()
* execute()

Undo functionality will be added later.

---

# Initial Commands

Implement the following commands:

## Project

* CreateProjectCommand

---

## Slides

* CreateSlideCommand
* DeleteSlideCommand

---

## Scene

* CreateNodeCommand
* DeleteNodeCommand
* ReparentNodeCommand

---

## Transform

* MoveNodeCommand
* RotateNodeCommand
* ScaleNodeCommand
* SetVisibilityCommand

---

# Validation

Every command should validate before execution.

Examples:

Cannot:

* delete root node
* move node under itself
* reference nonexistent node
* create duplicate IDs

Validation errors should be descriptive.

---

# Events

Successful commands should emit events.

Examples:

```text
NodeCreated

NodeDeleted

NodeMoved

SlideCreated

SlideDeleted

ProjectCreated
```

The renderer already subscribes to these events.

---

# Command History

Store every successfully executed command.

For now, only execution history is required.

Example:

```text
1

CreateProject

----------------

2

CreateSlide

----------------

3

CreateNode

----------------

4

MoveNode
```

Undo information is not required yet.

---

# Debug Panel

Extend the existing debug panel.

Add a "Command History" section.

Example:

```text
Project Created

Create Slide

Create Character

Move Character

Rotate Character
```

Newest command at the top.

---

# React Integration

React components should no longer call engine methods directly.

Instead:

```text
Button

↓

Create Command

↓

Dispatcher

↓

Engine
```

The UI should never know how the engine performs an operation.

---

# Testing

Unit tests should verify:

## Dispatcher

* Executes commands.
* Rejects invalid commands.
* Records history.
* Emits events.

---

## Commands

Each command:

* Valid input succeeds.
* Invalid input fails.
* Engine state changes correctly.

---

## Validation

Attempt invalid operations.

Verify engine remains unchanged.

---

## Events

Verify expected events are emitted.

---

# Manual Verification Checklist

## Create Project

Click "Create Project".

Verify:

* Project appears.
* Command history records action.

---

## Create Slides

Create multiple slides.

Verify:

* Scene updates.
* Command history grows.

---

## Create Nodes

Create several nodes.

Verify:

* Renderer displays placeholders.
* Command history updates.

---

## Move Node

Move node.

Verify:

* Position changes.
* Move command appears.

---

## Rotate Node

Rotate node.

Verify:

* Placeholder rotates.

---

## Visibility

Hide node.

Verify:

* Placeholder disappears.

---

## Invalid Operations

Attempt:

* Delete root.
* Move node under itself.

Verify:

* Error message.
* No command recorded.
* Scene unchanged.

---

# Logging

Every executed command should be logged.

Example:

```text
[Command]

MoveNode

Node:

Character

Old Position:

100,100

New Position:

250,180
```

Useful for debugging and future replay functionality.

---

# Serialization

Every command should be serializable.

Future replay should be possible.

Example:

```json
{
    "type": "MoveNode",
    "nodeId": "...",
    "x": 200,
    "y": 150
}
```

Execution replay is not required yet.

---

# Deliverables

After Step 5, the project contains:

* Command infrastructure
* Command dispatcher
* Base command abstraction
* Project commands
* Scene commands
* Transform commands
* Validation
* Command execution history
* Event integration
* UI using commands exclusively

Undo/Redo is intentionally deferred.

---

# Definition of Done

Step 5 is complete when:

* Every project modification is performed through the Command Dispatcher.
* Direct mutation of engine state from the UI has been eliminated.
* Commands are validated, executed, logged, and recorded in history.
* The renderer continues to update through engine events without any direct dependency on the command system.
* The architecture is now ready to support Undo/Redo, AI-driven editing, macro recording, and future collaboration features without requiring changes to how state is modified.
