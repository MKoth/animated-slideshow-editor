# Step 13 – Project Persistence

## Goal

Implement a robust **Project Persistence System** that allows users to save, load, recover, and continue working on projects across application restarts.

A project should be completely self-contained, referencing assets from the Asset Library while storing all editor-specific data such as slides, scenes, animations, timelines, and editor state.

This step also introduces **automatic saving** and crash recovery.

---

# Success Criteria

At the end of this step:

* ✅ Projects can be created.
* ✅ Projects can be saved.
* ✅ Projects can be loaded.
* ✅ Auto-save works.
* ✅ Unsaved changes are tracked.
* ✅ Crash recovery works.
* ✅ Recent projects list exists.
* ✅ Project versioning is introduced.

---

# Scope

Implement:

* Project serialization
* Save
* Save As
* Open
* Recent projects
* Auto-save
* Crash recovery
* Project versioning

Do **not** implement:

* Cloud synchronization
* Collaboration
* Git integration
* Incremental saving
* Export

---

# Architectural Principle

The Persistence Layer sits outside the Core Engine.

```text id="4qrz3f"
Core Engine
        ↓
Serializer
        ↓
Persistence Service
        ↓
Project File
```

The Core Engine never performs file I/O directly.

---

# Project File Format

Use a single project file.

Suggested extension:

```text id="yrxt3z"
.lesson
```

Internally store JSON for the prototype.

Future versions may migrate to a binary format without changing the public API.

---

# Project Contents

A project file stores:

* Project metadata
* Slides
* Scene graphs
* Asset instance references
* Animations
* Timelines
* Commands (optional, future)
* Editor state

It **does not** embed Asset Library files.

Assets are referenced by asset IDs.

---

# Project Metadata

Store:

* Project ID
* Project name
* Description
* Author (optional)
* Created date
* Last modified date
* Version

Future fields:

* Language
* Lesson category
* AI generation metadata

---

# Persistence Service

Create a dedicated service.

Responsibilities:

* Save
* Load
* Validate
* Upgrade older versions
* Auto-save
* Recovery

No UI logic.

---

# Save

Support:

```text id="9fq4dk"
File

↓

Save
```

Keyboard shortcut:

```text id="qmtrvv"
Ctrl + S
```

If no file exists:

Open Save As dialog.

---

# Save As

Allows choosing:

* filename
* location

Updates the current project path.

---

# Open

Support:

```text id="n24nj0"
File

↓

Open
```

Open file dialog.

Load project.

Replace current project after confirmation if there are unsaved changes.

---

# New Project

Support:

```text id="9m5kdp"
File

↓

New Project
```

Confirmation if project contains unsaved changes.

---

# Dirty State

Track whether the project contains unsaved changes.

Examples:

```text id="xtlb6i"
Project*

```

Window title:

```text id="v2j6dc"
Spanish Lesson*
```

Removing all unsaved changes clears the indicator.

---

# Auto-save

Automatically save every:

```text id="n4v5dk"
30 seconds
```

or after:

```text id="1c72si"
significant edits
```

Auto-save should not interrupt editing.

---

# Recovery

Maintain a recovery copy.

On unexpected shutdown:

Display:

```text id="zowy79"
Recovered project found.

Restore?

[Restore]

[Discard]
```

---

# Recent Projects

Store:

Last:

```text id="kdn8z6"
10 projects
```

Display in:

```text id="r8v5sj"
File

↓

Recent Projects
```

Missing files are removed automatically.

---

# Versioning

Introduce project version.

Example:

```text id="h1a44m"
Version 1
```

Future migrations:

```text id="t3v2yc"
Version 2

↓

Migration

↓

Version 3
```

Persistence service performs upgrades automatically.

---

# Serialization

The serializer should support:

```text id="wmf0m7"
serialize()

deserialize()

validate()

upgrade()
```

Serialization must preserve object IDs.

---

# Validation

Reject:

* Missing required fields
* Invalid references
* Duplicate IDs
* Corrupted JSON
* Unsupported versions

Display user-friendly error messages.

---

# Asset References

Verify referenced Asset Definitions exist.

If assets are missing:

Display:

```text id="j3y5s6"
Missing Assets

Clock.png

Boy.png
```

Allow users to continue while displaying placeholders.

---

# Commands

Introduce:

```text id="eqot81"
SaveProjectCommand

LoadProjectCommand

NewProjectCommand

AutoSaveCommand
```

These commands coordinate editor behavior but delegate file operations to the Persistence Service.

---

# Events

Emit:

```text id="5bwk4o"
ProjectSaved

ProjectLoaded

ProjectAutoSaved

ProjectRecovered

DirtyStateChanged
```

---

# Performance

Requirements:

* Saving should not freeze the UI.
* Auto-save runs in the background.
* Loading large projects remains responsive.
* Serialization minimizes unnecessary allocations.

---

# Testing

Unit tests should verify:

## Save

* Project serializes correctly.
* IDs preserved.
* Metadata stored.

---

## Load

* Complete project restored.
* References resolved.
* Missing assets handled gracefully.

---

## Dirty State

Verify edits correctly mark the project as modified.

Saving clears the dirty flag.

---

## Auto-save

Verify:

* Timer-based save.
* Edit-triggered save.
* Recovery file creation.

---

## Recovery

Simulate crash.

Verify recovery dialog appears.

---

## Versioning

Load older project versions.

Verify automatic migration.

---

# Manual Verification Checklist

## Save

Create a project.

Save it.

Verify:

* File exists.
* Metadata correct.
* Dirty indicator disappears.

---

## Restart

Close application.

Restart.

Open project.

Verify:

* Slides restored.
* Objects restored.
* Animations restored.
* Timeline restored.
* Inspector state restored.

---

## Auto-save

Wait:

```text id="j7np5m"
30 seconds
```

Verify recovery file updates.

---

## Dirty State

Modify an object.

Verify:

```text id="yn6z4k"
Project*
```

appears.

Save.

Verify indicator disappears.

---

## Recovery

Simulate an unexpected shutdown.

Restart application.

Verify recovery dialog appears and successfully restores the project.

---

## Recent Projects

Open multiple projects.

Verify:

* Recent list updates.
* Missing files are removed automatically.

---

## Missing Assets

Temporarily remove an asset from the Asset Library.

Open the project.

Verify placeholders appear and missing assets are reported.

---

## Version

Save a project.

Verify:

```text id="mjlwmu"
Version 1
```

is stored in the project metadata.

---

# Deliverables

After Step 13, the editor includes:

* Project save/load
* Save As
* New Project
* Auto-save
* Crash recovery
* Dirty state tracking
* Recent projects
* Project versioning
* Persistence service
* Serialization validation
* Missing asset handling
* Background saving

Cloud synchronization and collaboration are intentionally deferred.

---

# Definition of Done

Step 13 is complete when:

* Users can confidently save, close, and later reopen complex projects without losing data.
* Automatic saving and recovery protect against accidental crashes or power failures.
* The persistence layer cleanly separates serialization and file management from the Core Engine.
* Projects remain forward-compatible through versioning, providing a stable foundation for future cloud storage, collaboration, asset packaging, and export workflows.
