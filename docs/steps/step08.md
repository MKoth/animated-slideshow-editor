# Step 8 – Inspector

## Goal

Implement the **Inspector Panel**, allowing users to view and edit the properties of the currently selected object.

The Inspector is the primary interface for precise editing. While objects can be manipulated directly on the canvas, the Inspector provides exact numerical control and access to properties that are difficult or impossible to edit visually.

All changes must go through the **Command System**.

---

# Success Criteria

At the end of this step:

* ✅ Selecting an object populates the Inspector.
* ✅ Position can be edited.
* ✅ Rotation can be edited.
* ✅ Scale can be edited.
* ✅ Opacity can be edited.
* ✅ Object name can be renamed.
* ✅ Multiple selection is supported.
* ✅ Property changes immediately update the canvas.
* ✅ Every modification creates a command.

---

# Scope

Implement:

* Inspector UI
* Property editing
* Multi-selection support
* Numeric controls
* Reset buttons
* Property validation

Do **not** implement:

* Timeline keyframes
* Animation curves
* Shader editing
* Materials
* Custom asset properties
* Parent/child editing

---

# Architectural Principle

The Inspector is **just another client** of the Command System.

```text
Inspector

↓

Commands

↓

Core Engine

↓

Events

↓

Renderer
```

The Inspector never modifies objects directly.

---

# Inspector Layout

Suggested layout:

```text
Inspector

──────────────────────

General

    Name

Transform

    X

    Y

    Rotation

    Scale X

    Scale Y

Appearance

    Opacity

──────────────────────

Reset Transform
```

The layout should be easily extensible for future sections.

---

# Empty State

If nothing is selected:

```text
Nothing selected.

Select an object to edit its properties.
```

---

# General Section

### Name

Editable text field.

Renaming should update:

* Scene Hierarchy
* Command History
* Future AI references

Validation:

* Empty names are not allowed.
* Duplicate names should automatically receive a numeric suffix if uniqueness is enforced.

---

# Transform Section

## Position

Fields:

```text
X

Y
```

Support:

* Typing
* Arrow keys
* Mouse wheel (optional)
* Drag-to-adjust (optional)

Updates should occur immediately after confirmation (or continuously during drag adjustment).

---

## Rotation

Field:

```text
Rotation (degrees)
```

Support:

* Positive values
* Negative values
* Values beyond 360° (engine may normalize internally)

Optional quick actions:

```text
0°

90°

180°

270°
```

---

## Scale

Fields:

```text
Scale X

Scale Y
```

Initially independent.

Future versions may introduce:

```text
🔒 Maintain aspect ratio
```

---

## Reset Transform

Button:

```text
Reset Transform
```

Resets:

```text
Position

Rotation

Scale
```

Uses commands.

---

# Appearance Section

## Opacity

Range:

```text
0

↓

100%
```

Displayed as either:

* Slider
* Numeric input

Changing opacity updates the renderer immediately.

---

# Multi Selection

When multiple objects are selected:

Display:

```text
3 Objects Selected
```

Common values:

If identical:

```text
X: 100
```

If different:

```text
—
```

Editing a field applies the value to all selected objects.

Example:

Three objects selected.

Set Rotation:

```text
45°
```

All become 45°.

---

# Validation

Examples:

Reject:

```text
Opacity = 200%

Scale = 0

NaN

Infinity
```

Clamp values where appropriate.

Display validation messages without crashing.

---

# Property Change Strategy

While editing:

Numeric input should support:

* Temporary text
* Commit on Enter
* Commit on blur

Dragging sliders should update continuously.

---

# Commands

Introduce new commands:

```text
RenameNodeCommand

SetPositionCommand

SetRotationCommand

SetScaleCommand

SetOpacityCommand

ResetTransformCommand
```

For multi-selection:

The UI may dispatch one command per object or a composite command (recommended for future Undo support).

---

# Composite Commands (Recommended)

Instead of:

```text
SetRotation

SetRotation

SetRotation
```

Create:

```text
BatchCommand

↓

SetRotation

SetRotation

SetRotation
```

This prepares the architecture for clean Undo/Redo.

---

# Events

Emit events:

```text
NodeRenamed

TransformChanged

OpacityChanged

SelectionChanged
```

The renderer updates automatically.

---

# Performance

Requirements:

* Editing values should not recreate Pixi objects.
* Only changed properties should be synchronized.
* Numeric typing should remain responsive.

---

# Future Sections (Placeholders)

Reserve expandable sections:

```text
Material

Animation

Shader

Anchors

Physics

AI Metadata
```

Display:

```text
Coming in future versions.
```

This keeps the Inspector layout stable as new capabilities are added.

---

# Testing

Unit tests should verify:

## Name

* Rename object
* Validation
* Duplicate handling

---

## Position

* X updates
* Y updates

---

## Rotation

* Positive
* Negative
* Large values

---

## Scale

* Independent X/Y
* Validation

---

## Opacity

* Range validation
* Renderer updates

---

## Multi Selection

Verify:

* Mixed values
* Batch updates
* Batch commands

---

# Manual Verification Checklist

## Empty

No selection.

Verify:

```text
Nothing selected.
```

---

## Selection

Click an object.

Inspector populates correctly.

---

## Rename

Rename object.

Verify:

* Hierarchy updates.
* Command history records rename.

---

## Position

Change X and Y.

Verify:

* Object moves immediately.
* Renderer updates.
* Commands recorded.

---

## Rotation

Enter:

```text
45°
```

Verify object rotates.

---

## Scale

Set:

```text
Scale X = 2

Scale Y = 0.5
```

Verify object scales correctly.

---

## Opacity

Move slider.

Verify:

Object fades smoothly.

---

## Reset

Click:

```text
Reset Transform
```

Verify:

* Position reset.
* Rotation reset.
* Scale reset.

---

## Multi Selection

Select several objects.

Change:

```text
Rotation

Opacity
```

Verify all selected objects update.

---

## Validation

Attempt invalid values.

Verify:

* Errors displayed.
* Engine remains valid.
* Application remains stable.

---

# Deliverables

After Step 8, the editor includes:

* Fully functional Inspector
* Property editing
* Object renaming
* Position editing
* Rotation editing
* Scale editing
* Opacity editing
* Multi-selection editing
* Validation
* Batch commands
* Extensible Inspector layout

No timeline, animation, or shader editing is included yet.

---

# Definition of Done

Step 8 is complete when:

* Selecting any object immediately displays its editable properties in the Inspector.
* Changes made through the Inspector are reflected instantly on the canvas and recorded through the Command System.
* Multi-selection editing behaves predictably and efficiently.
* The Inspector is structured so future sections (materials, shaders, animation, AI metadata, etc.) can be added without redesigning the UI, making it the long-term property editor for every object in the scene.
