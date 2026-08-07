# Step 12 – Slide System

## Goal

Implement the **Slide System**, allowing a project to contain multiple independent slides, each with its own scene, timeline, and animation.

Slides are the primary organizational unit for educational explanations. Each slide represents one "moment" in the lesson (for example: introducing a rule, demonstrating "Yo corro", then "Tú corres", etc.).

At the end of this step, users can build complete multi-slide presentations and switch between them seamlessly.

---

# Success Criteria

At the end of this step:

* ✅ Projects support multiple slides.
* ✅ Slides can be created.
* ✅ Slides can be renamed.
* ✅ Slides can be duplicated.
* ✅ Slides can be deleted.
* ✅ Slides can be reordered.
* ✅ Switching slides updates the canvas.
* ✅ Switching slides updates the timeline.
* ✅ Each slide has independent scene and animation data.

Transitions between slides are intentionally postponed.

---

# Scope

Implement:

* Slide Manager
* Slide tree
* Active slide
* Slide CRUD
* Slide ordering
* Slide duplication
* Independent timelines

Do **not** implement:

* Slide transitions
* Nested slides
* Sections
* Storyboards
* Video export

---

# Architectural Principle

A project owns multiple slides.

```text
Project

├── Slide 1

├── Slide 2

├── Slide 3

└── Slide 4
```

Only one slide is active at any given time.

---

# Project Structure

Extend the project model:

```text
Project

↓

Slides[]

↓

Scene

↓

Timeline

↓

Animation
```

Each slide is completely independent.

---

# Slide Model

Each slide contains:

* id
* name
* order
* duration
* scene
* animation data

Future fields:

* notes
* transition
* thumbnail
* narration
* AI description

---

# Active Slide

Introduce an Active Slide Manager.

Responsibilities:

* Track current slide.
* Load scene.
* Load timeline.
* Notify renderer.
* Notify inspector.

---

# Slide Panel

Replace the placeholder "Slides" panel.

Suggested layout:

```text
Slides

+ Slide 1

+ Slide 2

+ Slide 3

+ Slide 4

[ + ]
```

Each slide displays:

* thumbnail placeholder
* name
* duration
* active indicator

---

# Slide Operations

Support:

## Add

Creates a new empty slide.

Default name:

```text
Slide 1

Slide 2

Slide 3
```

---

## Rename

Inline editing.

Updates immediately.

---

## Duplicate

Creates:

* new scene
* new animation data
* new IDs

Asset Definitions remain shared.

---

## Delete

Cannot delete the last remaining slide.

Confirmation dialog:

```text
Delete Slide?

This action cannot be undone.
```

---

## Reorder

Drag-and-drop.

Project execution order updates immediately.

---

# Slide Switching

Selecting another slide should:

* Update renderer.
* Update timeline.
* Update scene hierarchy.
* Update inspector.
* Preserve playback state (stopped).

No visible delay.

---

# Independent Scene State

Every slide owns:

* Objects
* Hierarchy
* Animation
* Timeline

Example:

```text
Slide 1

Boy

Clock

-------------

Slide 2

Boy

Bubble

Fish
```

Changes in one slide must never affect another.

---

# Independent Timeline

Each slide has:

* Current duration
* Property tracks
* Keyframes

Switching slides loads the appropriate timeline.

---

# Thumbnails

Generate placeholder thumbnails.

Initially:

Capture current canvas when switching away from a slide.

Future versions may generate them automatically.

Display:

```text
[ Preview ]

Slide Name
```

---

# Slide Duration

Each slide stores:

```text
10 seconds
```

Initially editable.

Timeline length automatically reflects slide duration.

---

# Commands

Introduce:

```text
CreateSlideCommand

DeleteSlideCommand

RenameSlideCommand

DuplicateSlideCommand

MoveSlideCommand

SetActiveSlideCommand

SetSlideDurationCommand
```

No direct mutation.

---

# Events

Emit:

```text
SlideCreated

SlideDeleted

SlideDuplicated

SlideMoved

SlideActivated

SlideDurationChanged
```

Renderer and timeline respond automatically.

---

# Performance

Requirements:

* Switching slides under 100 ms for typical projects.
* Renderer reuses resources where possible.
* Shared textures remain loaded.
* Only active slide is rendered.

---

# Testing

Unit tests should verify:

## Slides

* Create
* Rename
* Duplicate
* Delete
* Reorder

---

## Switching

Verify:

* Renderer updates.
* Timeline updates.
* Scene hierarchy updates.

---

## Duplication

Verify duplicated slide contains:

* New IDs
* Same visual appearance
* Independent animation

---

## Duration

Changing duration updates the timeline correctly.

---

# Manual Verification Checklist

## Create

Create several slides.

Verify they appear in the slide panel.

---

## Rename

Rename slides.

Verify updates immediately.

---

## Duplicate

Duplicate a slide.

Verify:

* Objects copied.
* Animations copied.
* Editing duplicate does not affect original.

---

## Delete

Delete a slide.

Verify:

* Slide removed.
* Active slide changes appropriately.
* Last slide cannot be deleted.

---

## Reorder

Drag slides.

Verify execution order changes.

---

## Switch

Click different slides.

Verify:

* Canvas updates.
* Timeline updates.
* Inspector updates.
* Scene hierarchy updates.

---

## Independent Editing

Modify:

```text
Slide 1
```

Verify:

```text
Slide 2
```

remains unchanged.

---

## Duration

Change duration from:

```text
10 s

↓

15 s
```

Verify timeline length updates.

---

## Thumbnail

Modify a slide.

Switch away.

Verify thumbnail updates to reflect the latest state.

---

# Deliverables

After Step 12, the editor includes:

* Multi-slide projects
* Slide manager
* Slide panel
* Slide thumbnails
* Slide CRUD
* Slide duplication
* Slide reordering
* Independent scenes
* Independent timelines
* Slide duration
* Active slide management
* Command-based slide editing

Transitions and presentation mode are intentionally deferred.

---

# Definition of Done

Step 12 is complete when:

* Users can build complete lessons composed of multiple independent slides.
* Each slide maintains its own scene, animation, and duration while sharing reusable asset definitions from the Asset Library.
* Switching between slides is immediate and updates every editor panel consistently.
* The Slide System provides the structural foundation for future features such as slide transitions, branching lesson flows, AI-generated explanations, and final video export.
