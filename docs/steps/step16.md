# Step 16 – Advanced Timeline & Animation Editor

## Goal

Transform the basic timeline into a **professional animation editor** comparable in workflow to Adobe After Effects, Blender, Unity Timeline, or Godot AnimationPlayer.

This step upgrades the animation workflow by introducing **easing, Bezier curves, advanced keyframe editing, batch operations, curve visualization, and professional editing tools**.

The objective is to make complex animations fast and intuitive to create while keeping the underlying animation system deterministic and command-driven.

---

# Success Criteria

At the end of this step:

* ✅ Animation curves can be edited visually.
* ✅ Keyframes support easing.
* ✅ Bezier handles can be manipulated.
* ✅ Multiple keyframes can be selected.
* ✅ Keyframes can be copied and pasted.
* ✅ Box selection works.
* ✅ Timeline snapping works.
* ✅ Curve Editor is synchronized with the Timeline.
* ✅ Animation preview reflects easing correctly.

Playback and export automatically use the new interpolation system.

---

# Scope

Implement:

* Curve Editor
* Easing
* Bezier interpolation
* Multi-keyframe editing
* Timeline snapping
* Keyframe copy/paste
* Keyframe scaling
* Batch editing
* Property filtering

Do **not** implement:

* Animation layers
* Constraints
* Motion paths
* Inverse kinematics
* Audio synchronization

---

# Architectural Principle

Timeline editing modifies **animation data**, while playback evaluates it.

```text id="x27ghs"
Timeline UI

↓

Animation Commands

↓

Animation Data

↓

Animation Evaluator

↓

Renderer
```

The evaluator remains separate from the editor.

---

# Timeline Layout

Extend the timeline.

```text id="w6tc6d"
Timeline

--------------------------------------------------------

Tracks

|

|

Curve Editor

--------------------------------------------------------
```

Users can switch between:

* Dope Sheet
* Curve Editor

---

# Curve Editor

Each animated property can be viewed as a graph.

Example:

```text id="8bjlwm"
Value

^

|

|

|         ●

|      /

|    /

| ●

+---------------------------->

Time
```

---

# Curves

Initially support:

* Position X
* Position Y
* Rotation
* Scale X
* Scale Y
* Opacity

Future:

* Shader uniforms
* Colors
* Material parameters
* Custom properties

---

# Interpolation Types

Support:

```text id="z5epjl"
Linear

Bezier

Constant
```

Future:

```text id="or6kyb"
Bounce

Elastic

Spring
```

---

# Easing Presets

Provide common presets.

Examples:

```text id="jlwm17"
Linear

Ease In

Ease Out

Ease In-Out

Quadratic

Cubic

Quartic

Quintic

Back

Bounce

Elastic
```

Changing interpolation updates the curve immediately.

---

# Bezier Handles

Bezier keyframes expose:

* Left handle
* Right handle

Users can:

* Drag handles
* Break tangents
* Lock tangents
* Reset tangents

---

# Keyframe Types

Support:

```text id="ix4v76"
Linear

Bezier

Constant
```

Display distinct icons for each type.

---

# Keyframe Selection

Support:

* Single click
* Ctrl-click
* Shift-click
* Marquee selection
* Lasso selection (optional)

---

# Multi-Keyframe Editing

Multiple selected keyframes may be:

* Moved
* Deleted
* Copied
* Pasted
* Scaled
* Shifted

All through batch commands.

---

# Copy / Paste

Keyboard:

```text id="2i6b0v"
Ctrl + C

Ctrl + V
```

Paste preserves:

* Relative timing
* Relative values
* Interpolation
* Tangents

---

# Duplicate

Keyboard:

```text id="6a1dlu"
Ctrl + D
```

Creates duplicate keyframes with a small time offset.

---

# Box Selection

Dragging creates:

```text id="fb8pjb"
□□□□□□□□□□□□□
```

Intersecting keyframes become selected.

---

# Timeline Snapping

Snap to:

* Frames
* Seconds
* Other keyframes
* Timeline markers (future)

Toggle snapping on/off.

---

# Scaling Keyframes

Select multiple keyframes.

Scale around:

* First
* Last
* Current Time

Example:

```text id="eswb9k"
1 s

↓

2 s
```

Animation duration doubles.

---

# Shifting Keyframes

Move all selected keyframes together.

Relative spacing remains unchanged.

---

# Property Filtering

Timeline supports filtering.

Examples:

```text id="q1nz8i"
Position

Rotation

Opacity

Animated Only
```

Useful for complex scenes.

---

# Curve Navigation

Support:

* Pan
* Zoom
* Fit Curves
* Frame Selected

Independent from timeline zoom.

---

# Inspector Integration

Inspector gains:

```text id="ktzqoi"
Interpolation

▼ Ease In-Out
```

Changing interpolation updates the timeline instantly.

---

# Animation Evaluator

Upgrade evaluator.

Support:

* Linear
* Constant
* Cubic Bezier

Architecture should allow adding new interpolation types without modifying evaluator logic.

---

# Commands

Introduce:

```text id="pc9m6g"
SetInterpolationCommand

MoveKeyframesCommand

DeleteKeyframesCommand

PasteKeyframesCommand

ScaleKeyframesCommand

ShiftKeyframesCommand

EditBezierHandleCommand
```

Batch operations should be represented as composite commands.

---

# Events

Emit:

```text id="jkmxwe"
InterpolationChanged

BezierHandleMoved

CurveChanged

KeyframesPasted

KeyframesScaled
```

---

# Performance

Requirements:

* Thousands of keyframes remain interactive.
* Curve rendering is GPU accelerated where practical.
* Only visible curves are rendered.
* Curve recalculation occurs only when necessary.

---

# Future Placeholders

Reserve support for:

* Animation layers
* Animation masks
* Constraints
* Motion paths
* Audio waveforms
* Camera tracks

---

# Testing

Unit tests should verify:

## Interpolation

* Linear
* Constant
* Bezier

---

## Curves

Verify evaluated values match expected curve positions.

---

## Handles

Moving handles updates curves correctly.

---

## Copy/Paste

Verify:

* Timing
* Values
* Interpolation
* Tangents

---

## Multi-selection

Verify:

* Move
* Delete
* Scale
* Shift

---

## Snapping

Verify snapping to frames and nearby keyframes.

---

# Manual Verification Checklist

## Curves

Switch to Curve Editor.

Verify animated properties display editable curves.

---

## Bezier

Convert a keyframe to Bezier.

Drag handles.

Verify curve changes immediately.

---

## Ease

Apply:

```text id="jlwm92"
Ease In-Out
```

Play animation.

Verify motion accelerates and decelerates smoothly.

---

## Constant

Apply:

```text id="ym43qe"
Constant
```

Verify stepped animation with no interpolation.

---

## Copy/Paste

Copy several keyframes.

Paste.

Verify timing and interpolation are preserved.

---

## Multi-selection

Select multiple keyframes.

Move them together.

Verify relative spacing remains unchanged.

---

## Scale

Scale selected keyframes.

Verify animation duration changes proportionally.

---

## Snapping

Move keyframes near frame boundaries.

Verify they snap correctly.

Disable snapping.

Verify free movement.

---

## Performance

Create hundreds of animated objects.

Verify:

* Timeline remains responsive.
* Curve editor remains smooth.
* Playback continues to evaluate correctly.

---

# Deliverables

After Step 16, the editor includes:

* Professional Curve Editor
* Multiple interpolation modes
* Bezier handles
* Easing presets
* Multi-keyframe editing
* Copy/Paste
* Duplicate
* Box selection
* Timeline snapping
* Keyframe scaling and shifting
* Property filtering
* Upgraded animation evaluator
* Batch animation commands

Animation layers, constraints, and advanced cinematic tools are intentionally deferred.

---

# Definition of Done

Step 16 is complete when:

* Users can create polished, professional-quality animations using easing curves and visual curve editing.
* The timeline supports efficient editing of large numbers of keyframes through advanced selection and batch operations.
* The animation evaluator accurately reproduces the edited curves during scrubbing and playback.
* The animation system now provides a solid foundation for cinematic transitions, procedural animation, AI-generated motion, and advanced lesson authoring without requiring further architectural redesign.
