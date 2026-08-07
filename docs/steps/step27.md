# Step 27 – Undo / Redo System

## Goal

Implement a **global Undo/Redo system** that allows users to safely revert or reapply **every editing operation** performed in the editor.

Undo/Redo should feel instantaneous, deterministic, and reliable. Every user action that modifies the project—including AI-generated edits—must participate in the same history mechanism.

The system should be based on the Command Pattern introduced in earlier phases, ensuring every operation is reversible without relying on full project snapshots.

---

# Success Criteria

At the end of this step:

* ✅ Every editing operation supports Undo.
* ✅ Every undone operation supports Redo.
* ✅ Multiple undo/redo levels are supported.
* ✅ Compound operations undo as a single action.
* ✅ AI-generated edits integrate seamlessly.
* ✅ Undo history survives auto-save and project reload.
* ✅ History remains deterministic and memory-efficient.

---

# Scope

Implement:

* Global Undo manager
* Redo manager
* Command history
* Transactions
* History UI
* Keyboard shortcuts
* History persistence

Do **not** implement:

* Collaborative undo
* Cross-project history
* Branching history
* Time-travel debugging

---

# Architectural Principle

Every modification is represented by a reversible command.

```text
User Action

↓

Command

↓

Execute()

↓

Undo Stack

↓

Undo()

↓

Redo Stack
```

No system should modify project state outside the Command System.

---

# Command Contract

Every command implements:

```text
execute()

undo()

redo()
```

Normally:

```text
redo() == execute()
```

Commands must be deterministic.

---

# Undo Manager

Create a dedicated service:

```text
UndoManager
```

Responsibilities:

* Execute commands
* Store history
* Undo
* Redo
* Transactions
* History notifications

It becomes the single entry point for project modifications.

---

# History Model

Maintain two stacks:

```text
Undo Stack

↓

Executed Commands

----------------------

Redo Stack

↓

Undone Commands
```

Executing a new command clears the Redo stack.

---

# Transactions

Many operations consist of multiple commands.

Example:

```text
Create Character

↓

Create Object

Assign Material

Create Animation

Move Object
```

Users should undo this as **one operation**, not four.

Introduce:

```text
BeginTransaction()

CommitTransaction()

RollbackTransaction()
```

---

# Nested Transactions

Support nested transactions.

Example:

```text
AI Proposal

↓

Create Slide

↓

Create Objects

↓

Create Animations
```

Only the outer transaction appears in history.

---

# History Entry

Each history item contains:

* ID
* Name
* Timestamp
* Transaction ID
* Command count
* Source

Example:

```text
Move Fish

14:32:18

User
```

or

```text
Create Lesson

AI
```

---

# Command Sources

Track where commands originate.

Supported sources:

* User
* AI
* Import
* Migration
* System

This improves debugging and future analytics.

---

# Keyboard Shortcuts

Support standard shortcuts:

Windows/Linux

```text
Ctrl + Z
Ctrl + Y
```

macOS

```text
⌘ + Z
⌘ + Shift + Z
```

Keyboard mappings should be configurable in the future.

---

# History Panel

Create a History panel.

Suggested layout:

```text
History

────────────

Move Fish

Create Slide

Add Bubble

Assign Shader

Rename Asset
```

Selecting an entry should preview where it sits in history.

Time-travel navigation is reserved for a future phase.

---

# Coalescing

Some operations generate hundreds of tiny updates.

Example:

Dragging an object.

Instead of:

```text
Move

Move

Move

Move

Move
```

Create:

```text
Move Object
```

Only when the drag ends.

Similarly:

* Slider drags
* Timeline scrubbing
* Numeric input drags
* Rotation gizmos

should coalesce into a single history entry.

---

# Memory Strategy

Commands should store only the data required to undo themselves.

Avoid storing complete project snapshots.

Example:

Instead of:

```text
Entire Scene
```

Store:

```text
Old Position

↓

New Position
```

This keeps memory usage predictable.

---

# Persistence

Persist Undo history with the project.

Store:

* Undo stack
* Redo stack
* Transactions
* Command metadata

On project reload, users should be able to continue undoing recent edits.

For very large histories, configurable limits may be introduced later.

---

# History Limits

Provide configurable limits.

Defaults:

```text
Maximum Commands

10,000

Maximum Memory

256 MB
```

When limits are exceeded:

* Remove the oldest history entries.
* Preserve project integrity.

---

# Command Validation

Before execution:

Verify:

* Command is valid.
* References exist.
* Required resources are available.

Invalid commands should never enter history.

---

# Error Handling

If execution fails:

* Roll back the current transaction.
* Do not record partial history.
* Keep Undo/Redo stacks consistent.
* Present a clear error message.

---

# AI Integration

AI-generated edits should appear exactly like user edits.

Example:

```text
History

────────────

AI

Create Lesson

AI

Add Fish

User

Move Fish

User

Rename Slide
```

Users should not need to understand whether an action came from AI or manual editing to undo it.

---

# Import & Migration

Project imports and migrations should be recorded as single history entries.

Example:

```text
Import Package

↓

Undo

↓

Project Returns
```

This keeps behavior predictable.

---

# Events

Emit:

```text
CommandExecuted

CommandUndone

CommandRedone

TransactionStarted

TransactionCommitted

HistoryChanged
```

Other systems (UI, autosave, analytics) should react to these events rather than polling history.

---

# Performance

Requirements:

* Undo and Redo should feel instantaneous for normal editing operations.
* Large transactions should remain responsive.
* Coalescing should minimize unnecessary history entries.
* Memory usage should remain bounded.

---

# Future Placeholders

Reserve architecture for:

* Time-travel debugging
* Visual history timeline
* History search
* Branching histories
* Collaborative undo
* Cloud-synchronized history
* Selective undo

---

# Testing

Unit tests should verify:

## Basic Commands

Execute a command.

Undo it.

Redo it.

Verify project state matches expectations.

---

## Transactions

Execute multiple commands inside a transaction.

Undo once.

Verify the entire transaction is reverted.

---

## Nested Transactions

Verify nested transactions appear as a single history item.

---

## Coalescing

Drag an object continuously.

Verify only one history entry is created.

---

## Redo Reset

Undo several commands.

Execute a new command.

Verify the Redo stack is cleared.

---

## Persistence

Save the project.

Reload it.

Verify Undo and Redo history are restored.

---

## Limits

Generate more history entries than the configured limit.

Verify the oldest entries are discarded without affecting project correctness.

---

## AI Commands

Execute an AI proposal.

Undo it.

Redo it.

Verify all generated changes behave exactly like manually created edits.

---

# Manual Verification Checklist

## Move Object

Move a character.

Press:

```text
Ctrl + Z
```

Verify the character returns to its previous position.

Press:

```text
Ctrl + Y
```

(or `⌘ + Shift + Z` on macOS)

Verify the movement is restored.

---

## Compound Action

Create a slide containing multiple objects.

Undo once.

Verify the entire slide creation is removed.

Redo once.

Verify everything returns.

---

## Dragging

Drag an object for several seconds.

Open History.

Verify only a single **Move Object** entry exists.

---

## AI Edit

Ask the AI to create several slides.

Approve the proposal.

Undo once.

Verify all AI-created changes disappear together.

---

## Persistence

Save the project.

Restart the application.

Verify recent Undo and Redo operations remain available.

---

# Deliverables

After Step 27, the editor includes:

* Global Undo/Redo manager
* Transaction-based history
* Nested transactions
* History panel
* Command coalescing
* Keyboard shortcuts
* History persistence
* AI integration
* Import and migration support
* Memory-efficient command storage

Collaborative undo, branching history, and time-travel debugging are intentionally deferred.

---

# Definition of Done

Step 27 is complete when:

* Every project modification—whether performed manually, by AI, or through import—can be undone and redone reliably.
* Related operations are grouped into meaningful transactions, producing a clean and intuitive history.
* The Undo/Redo system is deterministic, memory-efficient, and forms the central mechanism for safely evolving project state throughout the editor.
