# Step 10 – Keyframe Animation

## Goal

Implement the animation system by introducing **keyframes**. Users should be able to animate object properties over time by placing keyframes on the timeline.

At the end of this step, the editor can create simple animations by interpolating between keyframes. Playback controls are still disabled; users scrub the playhead manually to preview animations.

---

# Success Criteria

At the end of this step:

* ✅ Keyframes can be added.
* ✅ Keyframes can be selected.
* ✅ Keyframes can be moved.
* ✅ Keyframes can be deleted.
* ✅ Property values interpolate between keyframes.
* ✅ Scrubbing the timeline updates the scene.
* ✅ Multiple properties can be animated independently.
* ✅ All edits use the Command System.

Playback, easing curves, and animation clips are intentionally postponed.

---

# Scope

Implement:

* Animation model
* Keyframes
* Property tracks
* Timeline keyframe visualization
* Interpolation
* Scrubbing preview

Do **not** implement:

* Playback
* Easing curves
* Animation layers
* Animation clips
* Keyframe tangents
* Motion paths

---

# Architectural Principle

Animation data belongs to the engine.

```text
Timeline

↓

Commands

↓

Animation Engine

↓

Evaluated Transform

↓

Renderer
```

The renderer receives evaluated values only.

---

# Animation Model

Extend each Scene Node with animation data.

Each animatable property owns its own track.

Example:

```text
Boy

├── Position X

├── Position Y

├── Rotation

├── Scale X

├── Scale Y

└── Opacity
```

Each track contains zero or more keyframes.

---

# Animatable Properties

Initially support:

* Position X
* Position Y
* Rotation
* Scale X
* Scale Y
* Opacity

Future versions may add:

* Pivot
* Color
* Shader parameters
* Text
* Custom asset parameters

---

# Keyframe Model

Each keyframe contains:

* id
* property
* time
* value

Future fields (placeholders):

* interpolation
* easing
* tangent in
* tangent out

---

# Timeline Visualization

Expand each object track into property subtracks.

Example:

```text
Boy
    Position X    ●──────●
    Position Y    ●────────────●
    Rotation
    Scale X
    Scale Y
    Opacity
```

Collapsed by default.

Users can expand/collapse individual objects.

---

# Creating Keyframes

Users can create keyframes by:

### Method 1 (Primary)

Move playhead →

Change a property in Inspector →

Automatically create a keyframe.

---

### Method 2

Right-click track →

Add Keyframe

---

### Method 3

Dedicated "+" button beside each property track.

---

# Editing Values

If the playhead is positioned exactly on a keyframe:

Editing the Inspector updates that keyframe.

Otherwise:

A new keyframe is automatically created.

---

# Selecting Keyframes

Single click:

Select one keyframe.

Ctrl-click:

Multi-select.

Selection color should differ from normal keyframes.

---

# Moving Keyframes

Drag horizontally.

Requirements:

* Snap to timeline grid.
* Snap to neighboring keyframes (optional).
* Live preview while dragging.
* Time updates continuously.

Only time changes, not value.

---

# Deleting Keyframes

Support:

* Delete key
* Context menu
* Toolbar button

Deleting the final keyframe removes the property track's animation, reverting the property to its static value.

---

# Interpolation

Implement linear interpolation.

Examples:

```text
0s

Position X = 100

↓

2s

Position X = 300
```

At:

```text
1s
```

Renderer displays:

```text
Position X = 200
```

Only linear interpolation is required.

---

# Timeline Scrubbing

Dragging the playhead should:

* Evaluate animation.
* Update all animated objects.
* Refresh the renderer immediately.

No playback yet.

---

# Property Indicators

Inspector should indicate animation state.

Examples:

Not animated:

```text
Position X
```

Animated:

```text
● Position X
```

Playhead on keyframe:

```text
◆ Position X
```

This helps users understand what will happen when editing values.

---

# Mixed Static / Animated Properties

Properties without keyframes continue using their static value.

Example:

```text
Position → Animated

Rotation → Static

Scale → Static
```

The evaluator combines animated and static values seamlessly.

---

# Commands

Introduce animation commands:

```text
AddKeyframeCommand

DeleteKeyframeCommand

MoveKeyframeCommand

SetKeyframeValueCommand

BatchMoveKeyframesCommand
```

Property edits continue to use the Command System.

---

# Animation Evaluator

Implement an evaluator responsible for:

* Finding surrounding keyframes.
* Interpolating values.
* Returning evaluated property values.

The evaluator must not modify project data.

---

# Events

Emit events such as:

```text
KeyframeAdded

KeyframeDeleted

KeyframeMoved

AnimationChanged

TimelineEvaluated
```

The Timeline UI and Renderer update automatically.

---

# Performance

Requirements:

* Scrubbing remains smooth.
* Only visible objects are updated.
* Timeline redraws only changed tracks.
* Evaluator avoids unnecessary allocations.

---

# Testing

Unit tests should verify:

## Keyframes

* Add
* Delete
* Move
* Update value

---

## Interpolation

Verify:

* Beginning
* Middle
* End
* Before first keyframe
* After last keyframe

---

## Property Tracks

Verify:

* Independent properties
* Multiple animated objects

---

## Commands

Verify all animation commands update engine state correctly.

---

## Scrubbing

Verify:

* Playhead movement updates evaluated values.
* Renderer reflects interpolated transforms.

---

# Manual Verification Checklist

## Create Keyframes

Move playhead to:

```text
0s
```

Set:

```text
Position X = 100
```

Move playhead to:

```text
2s
```

Set:

```text
Position X = 400
```

Verify two keyframes appear.

---

## Scrub

Drag playhead.

Verify object moves smoothly between:

```text
100

↓

400
```

---

## Multiple Properties

Animate:

* Position
* Rotation
* Opacity

Verify all interpolate independently.

---

## Move Keyframe

Drag keyframe.

Verify animation timing changes.

---

## Delete

Delete one keyframe.

Verify:

* Timeline updates.
* Animation updates.

Delete last keyframe.

Verify property becomes static.

---

## Inspector

Select a keyframe.

Change value.

Verify:

* Keyframe updates.
* Renderer updates.

---

## Multiple Objects

Animate two different objects.

Scrub timeline.

Verify both animate correctly.

---

# Deliverables

After Step 10, the editor includes:

* Animation data model
* Property tracks
* Keyframe creation
* Keyframe editing
* Keyframe movement
* Keyframe deletion
* Linear interpolation
* Timeline scrubbing
* Animation evaluator
* Animated property indicators
* Command-based animation editing

Playback, easing, looping, and advanced animation editing are intentionally postponed.

---

# Definition of Done

Step 10 is complete when:

* Users can animate supported object properties by creating and editing keyframes on the timeline.
* Moving the playhead immediately evaluates the animation and updates the canvas, allowing frame-accurate preview without playback.
* Animation data is stored independently for each property, enabling multiple properties and multiple objects to animate simultaneously.
* The animation system is fully integrated with the Command System and Core Engine, providing a solid foundation for playback, easing, animation clips, and video export in future steps.
