# Step 7 – Scene Editing

## Goal

Implement basic **scene editing**, allowing users to place reusable assets from the Asset Library into a slide, manipulate the scene hierarchy, and interact directly with objects on the canvas.

This is the first step where the editor becomes a true WYSIWYG scene editor.

The user edits **Asset Instances**. Asset Definitions remain immutable.

---

# Success Criteria

At the end of this step:

* ✅ Assets can be dragged into the scene.
* ✅ Asset instances are created.
* ✅ Objects can be selected.
* ✅ Objects can be moved using the mouse.
* ✅ Scene hierarchy updates automatically.
* ✅ Multiple objects can exist in a scene.
* ✅ Scene immediately reflects engine state.
* ✅ Every modification uses the Command System.

Rotation, scaling, timeline animation, and shaders are intentionally deferred.

---

# Scope

Implement:

* Drag asset into scene
* Object selection
* Scene hierarchy panel
* Move tool
* Multi-selection
* Copy/Paste/Duplicate/Delete
* Z-order editing
* Snap/Grid support

Do **not** implement:

* Rotation
* Scaling
* Timeline
* Animation
* Shader editing
* Grouping
* Parenting by drag-and-drop (comes later)

---

# Architectural Principle

Editing always happens through Asset Instances.

```text
Asset Definition
        ↓
CreateAssetInstanceCommand
        ↓
Scene Node
        ↓
Renderer
```

The Asset Library never changes when editing a scene.

---

# Asset Placement

The user drags an asset from the Asset Browser onto the canvas.

The editor should:

1. Create an Asset Instance.
2. Create a Scene Node.
3. Attach the instance.
4. Add it to the scene.
5. Render it immediately.

All through commands.

---

# Scene Hierarchy

Replace the temporary debug hierarchy with a real **Scene Hierarchy Panel**.

Example:

```text
Slide 1

├── Background

├── Boy

├── Clock

└── Speech Bubble
```

Each node displays:

* icon
* name
* visibility indicator (placeholder)
* lock indicator (placeholder)

---

# Selection

Single click:

Select one object.

Click empty space:

Clear selection.

Selection should be synchronized between:

* Canvas
* Scene Hierarchy
* Inspector (next step)

---

# Selection Visualization

Selected object displays:

* Bounding box
* Selection outline
* Resize handles (disabled for now)

Handles are placeholders for future scaling.

---

# Multi Selection

Support:

* Ctrl + Click
* Shift + Click
* Drag selection rectangle

Selection should preserve insertion order.

---

# Marquee Selection

Dragging on empty canvas creates a selection rectangle.

All intersecting objects become selected.

The selection rectangle is rendered above the scene.

---

# Move Tool

Dragging a selected object moves it.

Requirements:

* Real-time movement
* Smooth updates
* Uses MoveNodeCommand
* Grid snapping (optional toggle)

---

# Duplicate

Keyboard shortcut:

```text
Ctrl + D
```

Creates new Asset Instances referencing the same Asset Definition.

Transforms should be slightly offset.

---

# Copy / Paste

Support:

```text
Ctrl + C

Ctrl + V
```

Paste creates new Asset Instances.

Copied objects should preserve:

* Asset reference
* Transform
* Name

---

# Delete

Delete selected objects.

Restrictions:

* Root cannot be deleted.
* Invalid deletions show an error.

Uses DeleteNodeCommand.

---

# Z-Order

Support:

* Bring Forward
* Send Backward
* Bring To Front
* Send To Back

Implemented by changing sibling order in the Scene Graph.

Renderer reflects new draw order immediately.

---

# Drag & Drop Feedback

While dragging from the Asset Browser:

Display a ghost preview.

Valid drop area:

Canvas.

Invalid areas reject the drop.

---

# Object Naming

Default names:

```text
Boy

Boy (2)

Boy (3)
```

Names should remain unique within a slide.

---

# Coordinate System

Objects are placed using world coordinates.

Dropping an asset positions it at the cursor location in world space.

Camera transformations should not affect placement accuracy.

---

# Hit Testing

Implement object hit testing.

Selection should respect:

* Object bounds
* Draw order

If objects overlap, the topmost visible object receives the click.

---

# Grid Snapping

Optional toggle.

Snap:

* Position

Future steps will include:

* Rotation
* Anchors
* Guides

---

# Alignment Helpers

While moving:

Show guide lines when aligned with nearby objects.

Initial implementation may include:

* Horizontal alignment
* Vertical alignment
* Canvas center

---

# Commands

Introduce new commands:

```text
CreateAssetInstanceCommand

DuplicateNodeCommand

DeleteNodeCommand

MoveNodeCommand

ChangeZOrderCommand

SelectNodeCommand (optional UI command)
```

No direct engine mutation.

---

# Events

Emit events such as:

```text
NodeSelected

SelectionChanged

NodeMoved

NodeDuplicated

NodeDeleted

NodeOrderChanged
```

The renderer and UI respond to these events.

---

# Performance

Requirements:

* Dragging should remain smooth.
* Selection updates should not recreate Pixi objects.
* Only modified nodes should be updated.

---

# Testing

Unit tests should verify:

## Placement

* Asset instance is created.
* Scene node is created.
* Correct Asset Definition is referenced.

---

## Selection

* Single selection
* Multi-selection
* Clear selection

---

## Duplication

Verify duplicated instances reference the same Asset Definition.

---

## Movement

Moving objects updates:

* Engine
* Renderer
* Scene hierarchy

---

## Z-Order

Verify sibling ordering changes correctly.

---

## Copy/Paste

Verify:

* New IDs
* Same asset reference
* Same transform

---

## Deletion

Verify:

* Objects removed
* Root protected
* Renderer updated

---

# Manual Verification Checklist

## Import

Import several assets.

---

## Placement

Drag assets into the scene.

Verify:

* Objects appear immediately.
* Scene hierarchy updates.
* New Asset Instances are created.

---

## Selection

Click objects.

Verify:

* Selection outline appears.
* Hierarchy highlights selected node.

Click empty canvas.

Selection clears.

---

## Multi Selection

Ctrl-click several objects.

Verify:

* Multiple selection outline.
* All selected nodes move together.

---

## Marquee

Drag a selection rectangle.

Verify intersecting objects become selected.

---

## Movement

Drag selected objects.

Verify:

* Smooth movement.
* Correct world coordinates.
* Commands recorded.

---

## Copy

Copy several objects.

Paste.

Verify:

* New objects created.
* Same Asset Definitions referenced.

---

## Duplicate

Press:

```text
Ctrl + D
```

Verify duplicate appears slightly offset.

---

## Delete

Delete objects.

Verify:

* Renderer updates.
* Scene hierarchy updates.
* Command history records deletion.

---

## Z-Order

Bring an object to front.

Verify it renders above overlapping objects.

---

# Deliverables

After Step 7, the editor includes:

* Asset placement
* Scene hierarchy
* Object selection
* Multi-selection
* Marquee selection
* Object movement
* Copy/Paste
* Duplicate
* Delete
* Z-order editing
* Grid snapping
* Alignment guides
* Drag-and-drop asset workflow
* Command-based scene editing

Rotation, scaling, parenting, and animation are intentionally postponed.

---

# Definition of Done

Step 7 is complete when:

* Users can compose complete scenes by placing reusable assets from the Asset Library onto the canvas.
* Scene editing feels immediate and intuitive, with synchronized updates across the canvas, scene hierarchy, and command history.
* All editing operations are executed through the Command System, preserving the architectural principle that the Core Engine is the single source of truth.
* The editor is now capable of building static scenes, providing a solid foundation for property editing, animation, and AI-assisted authoring in the following steps.
