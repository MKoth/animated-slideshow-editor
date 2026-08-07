# Step 9 – Timeline Editor (Foundation)

## Goal

Implement the **Timeline Editor**, which becomes the central place for all animation editing.

This step establishes the timeline UI and navigation only. It does **not** animate objects yet. Users should be able to navigate through time, organize tracks, and prepare the scene for keyframe animation in the next step.

The timeline is a visualization of time—it does not yet evaluate or play animations.

---

# Success Criteria

At the end of this step:

* ✅ Timeline is fully interactive.
* ✅ Playhead can be moved.
* ✅ Current time updates.
* ✅ Tracks are displayed.
* ✅ Zoom in/out works.
* ✅ Horizontal scrolling works.
* ✅ Objects automatically create tracks.
* ✅ Current time is synchronized across the application.

No keyframes exist yet.

---

# Scope

Implement:

* Timeline UI
* Time ruler
* Playhead
* Tracks
* Timeline scrolling
* Timeline zoom
* Current time synchronization

Do **not** implement:

* Keyframes
* Playback
* Animation interpolation
* Easing
* Curves
* Multiple timelines

---

# Architectural Principle

The timeline is **another view of the engine state**.

```text
Core Engine
        ↓
Timeline State
        ↓
Timeline UI
```

The Timeline never owns animation data.

---

# Timeline Layout

Replace the placeholder panel with a professional timeline.

Suggested layout:

```text
+--------------------------------------------------------------+
| Toolbar                                                      |
+--------------------------------------------------------------+
|        | 0s | 1s | 2s | 3s | 4s | 5s | 6s | 7s | 8s | 9s |10s |
|--------+------------------------------------------------------|
| Boy    |                                                      |
| Clock  |                                                      |
| Bubble |                                                      |
| Fish   |                                                      |
| Tree   |                                                      |
|--------+------------------------------------------------------|
```

---

# Timeline Sections

## Toolbar

Contains:

* Play (disabled)
* Pause (disabled)
* Stop (disabled)
* Zoom In
* Zoom Out
* Fit Timeline
* Current Time

Playback buttons are placeholders until Step 11.

---

## Time Ruler

Display:

```text
0.0
0.5
1.0
1.5
2.0
...
```

Tick spacing should adjust automatically based on zoom level.

---

## Playhead

Display a vertical playhead.

Requirements:

* Always visible.
* Can be dragged.
* Snaps to the ruler.
* Current time updates while dragging.

---

## Current Time

Display:

```text
00:00.000
```

Whenever the playhead moves.

---

# Tracks

Every Scene Node automatically receives a timeline track.

Example:

```text
Boy

Clock

Speech Bubble

Tree
```

Tracks are currently empty.

---

# Track Hierarchy

Mirror the Scene Hierarchy.

Example:

```text
Character

    Head

    Left Arm

    Right Arm

Bubble
```

Expanding/collapsing should match the hierarchy.

---

# Synchronization

Whenever:

* Node created
* Node deleted
* Node renamed

Timeline updates automatically.

---

# Selection Synchronization

Selecting an object:

Canvas →

Timeline highlights corresponding track.

Timeline →

Canvas highlights corresponding object.

Scene Hierarchy →

Timeline highlights track.

Selection should always stay synchronized.

---

# Timeline Navigation

Support:

## Horizontal Scroll

Mouse wheel + Shift

or

Scrollbar

---

## Vertical Scroll

Mouse wheel

---

## Zoom

Ctrl + Mouse Wheel

or

Toolbar buttons.

Zoom should center around the mouse cursor.

---

# Timeline Length

Initially:

```text
10 seconds
```

Visible range may exceed project duration.

Duration editing comes later.

---

# Timeline State

Introduce a dedicated Timeline State object.

Suggested properties:

* currentTime
* visibleStart
* visibleEnd
* zoomLevel
* selectedTracks

The Timeline UI owns only visualization state.

Animation data remains in the engine.

---

# Current Time Synchronization

Current time should be globally available.

Future systems:

* Playback
* Animation evaluator
* Video exporter
* AI preview

will all use this value.

---

# Track Header

Each track displays:

* Object icon
* Object name
* Visibility placeholder
* Lock placeholder

Future controls:

* Solo
* Mute
* Collapse
* Track color

---

# Empty Timeline

If no objects exist:

Display:

```text
No objects in this slide.

Drag assets into the scene to begin animating.
```

---

# Commands

Introduce timeline-related commands.

```text
SetCurrentTimeCommand

SetTimelineZoomCommand

FitTimelineCommand
```

Although these modify editor state rather than project data, keeping them in the command system prepares the architecture for timeline history and future collaboration.

---

# Events

Emit events:

```text
CurrentTimeChanged

TimelineZoomChanged

TimelineScrolled

TrackSelected
```

---

# Persistence

Persist UI preferences:

* Zoom level
* Timeline height
* Scroll position

Do **not** persist current playhead position inside the project yet.

---

# Performance

Requirements:

* Smooth scrolling.
* Smooth playhead dragging.
* Timeline handles hundreds of tracks.
* No unnecessary React re-renders while dragging.

---

# Testing

Unit tests should verify:

## Time

* Current time updates.
* Time formatting.

---

## Zoom

* Zoom in.
* Zoom out.
* Fit timeline.

---

## Tracks

* Node creation adds track.
* Node deletion removes track.
* Node rename updates track.

---

## Synchronization

Verify:

Canvas selection ↔ Timeline selection.

Hierarchy selection ↔ Timeline selection.

---

## Scroll

Verify visible range updates correctly.

---

# Manual Verification Checklist

## Timeline

Timeline replaces placeholder.

---

## Playhead

Drag playhead.

Verify:

* Time display updates.
* Playhead moves smoothly.

---

## Tracks

Create several objects.

Verify tracks appear automatically.

Delete objects.

Verify tracks disappear.

Rename objects.

Verify track names update.

---

## Selection

Click object.

Timeline highlights corresponding track.

Click track.

Canvas highlights corresponding object.

Scene hierarchy also reflects selection.

---

## Zoom

Zoom in.

Verify ruler becomes more detailed.

Zoom out.

Verify ruler compresses.

Fit Timeline.

Verify full timeline becomes visible.

---

## Scroll

Scroll horizontally.

Verify time ruler and tracks remain synchronized.

Scroll vertically.

Verify track list scrolls correctly.

---

## Empty State

Delete all objects.

Verify:

```text
No objects in this slide.

Drag assets into the scene to begin animating.
```

---

# Deliverables

After Step 9, the editor includes:

* Professional timeline UI
* Time ruler
* Interactive playhead
* Track list synchronized with the scene graph
* Timeline zoom
* Timeline scrolling
* Current time display
* Selection synchronization
* Timeline state management
* Timeline-specific commands
* Persistent UI preferences

No animation data or playback is implemented yet.

---

# Definition of Done

Step 9 is complete when:

* The timeline provides a stable, responsive foundation for animation authoring.
* Every scene object is represented by a synchronized track.
* Users can freely navigate through time using the playhead, zoom controls, and scrolling.
* The timeline integrates seamlessly with the Scene Hierarchy, Canvas, and Inspector, establishing a unified editing experience that is ready for keyframes and playback in the next implementation steps.
