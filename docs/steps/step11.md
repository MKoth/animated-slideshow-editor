# Step 11 – Animation Playback

## Goal

Implement the **Playback Engine**, enabling users to preview animations in real time directly inside the editor.

The playback system controls time progression, evaluates animations continuously, and synchronizes the timeline, renderer, and inspector. This step transforms the editor from a static keyframe editor into a functional animation preview tool.

The playback engine does **not** modify animation data—it only evaluates it.

---

# Success Criteria

At the end of this step:

* ✅ Play starts animation.
* ✅ Pause freezes animation.
* ✅ Stop resets the playhead.
* ✅ Loop playback works.
* ✅ Playback speed can be changed.
* ✅ Timeline playhead moves automatically.
* ✅ Renderer updates in real time.
* ✅ Inspector reflects animated values during playback.
* ✅ Playback remains smooth for complex scenes.

---

# Scope

Implement:

* Playback controller
* Real-time timeline progression
* Play/Pause/Stop
* Loop mode
* Playback speed
* Frame stepping

Do **not** implement:

* Audio
* Reverse playback
* Timeline recording
* Animation blending
* Scrubbing inertia

---

# Architectural Principle

Playback controls time only.

```text id="9v5d0r"
Playback Controller
        ↓
Current Time
        ↓
Animation Evaluator
        ↓
Renderer
```

The playback engine never edits keyframes.

---

# Playback State

Introduce a Playback Controller.

Suggested state:

* Playing
* Paused
* Stopped

Additional properties:

* currentTime
* playbackSpeed
* loopEnabled

---

# Timeline Toolbar

Replace placeholder buttons with functional controls.

Suggested layout:

```text id="0q1wlr"
⏮  ▶  ⏸  ⏹  🔁

0.5×

1×

2×

Current Time
```

---

# Play

When Play is pressed:

* Playback starts from current playhead position.
* Current time advances every frame.
* Renderer evaluates animation continuously.
* Timeline playhead moves automatically.

If already at the end:

Start from beginning unless loop is enabled.

---

# Pause

Pause should:

* Stop advancing time.
* Preserve current playhead position.
* Allow editing while paused.

Resuming continues from the same position.

---

# Stop

Stop should:

* End playback.
* Reset current time to:

```text id="2g9pcz"
0.000 s
```

* Update renderer.
* Move playhead to the beginning.

---

# Loop

Loop toggle.

When enabled:

```text id="yg2h0l"
End

↓

Beginning

↓

Continue
```

Playback should appear seamless.

---

# Playback Speed

Support:

```text id="h3utxg"
0.25×

0.5×

1×

1.5×

2×

4×
```

Current time advances according to the selected speed.

Example:

At:

```text id="34fryz"
2×
```

One real second equals two timeline seconds.

---

# Frame Stepping

Support stepping while paused.

Buttons:

```text id="69mkx5"
Previous Frame

Next Frame
```

Frame rate:

```text id="myj00l"
60 FPS
```

Each step advances:

```text id="wmlg72"
1 / 60 second
```

---

# Timeline Synchronization

During playback:

* Playhead moves smoothly.
* Timeline scrolls automatically if needed.
* Current time display updates continuously.

---

# Inspector Synchronization

While playback is active:

The Inspector displays evaluated values rather than raw keyframe values.

Animated fields should appear read-only during playback to avoid accidental edits.

---

# Scene Synchronization

The renderer should:

* Evaluate every animated object.
* Update only changed transforms.
* Avoid recreating Pixi objects.

---

# Playback End

If loop is disabled:

```text id="4zqgza"
Current Time >= Duration
```

Playback stops automatically.

State becomes:

```text id="adghqm"
Stopped
```

---

# Timeline Auto Scroll

Optional but recommended.

If playhead approaches the right edge:

Timeline scrolls automatically.

This keeps the playhead visible during playback.

---

# Commands

Introduce playback-related commands:

```text id="mwhj4r"
PlayCommand

PauseCommand

StopCommand

SetPlaybackSpeedCommand

ToggleLoopCommand

StepFrameCommand
```

These modify editor state, not project data.

---

# Events

Emit:

```text id="bvr2dj"
PlaybackStarted

PlaybackPaused

PlaybackStopped

PlaybackFinished

PlaybackLooped

CurrentTimeChanged
```

---

# Performance

Requirements:

* Stable 60 FPS playback for typical scenes.
* No unnecessary allocations during playback.
* Timeline and renderer remain synchronized.
* Playback remains responsive while interacting with the UI.

---

# Testing

Unit tests should verify:

## Playback

* Play
* Pause
* Stop

---

## Loop

Verify looping restarts correctly.

---

## Speed

Verify all playback speeds.

---

## Frame Step

Verify stepping advances exactly one frame.

---

## End Detection

Verify playback stops at the project duration.

---

## Synchronization

Verify:

* Timeline updates.
* Renderer updates.
* Inspector updates.

---

# Manual Verification Checklist

## Play

Create an animation.

Press:

```text id="6yih93"
Play
```

Verify:

* Object moves.
* Timeline playhead advances.
* Current time updates.

---

## Pause

Press:

```text id="8m4o0l"
Pause
```

Verify:

* Object freezes.
* Current time remains unchanged.

Resume.

Verify playback continues correctly.

---

## Stop

Press:

```text id="qlw7fr"
Stop
```

Verify:

* Playhead returns to:

```text id="n56r77"
0s
```

* Object returns to its initial state.

---

## Loop

Enable:

```text id="v9ssmu"
Loop
```

Play animation.

Verify playback restarts automatically at the end.

---

## Speed

Test:

```text id="bwz1qx"
0.5×

2×

4×
```

Verify playback speed changes accordingly.

---

## Frame Step

Pause animation.

Use:

```text id="stmp9w"
Next Frame
```

Verify object advances by exactly one frame.

Repeat with:

```text id="4b8npd"
Previous Frame
```

---

## Timeline

Verify playhead remains synchronized throughout playback.

---

## Inspector

Select an animated object.

Play animation.

Verify transform values update continuously and editing controls are disabled until playback is paused or stopped.

---

# Deliverables

After Step 11, the editor includes:

* Playback controller
* Play
* Pause
* Stop
* Loop mode
* Playback speed control
* Frame stepping
* Timeline synchronization
* Renderer synchronization
* Inspector synchronization
* Playback commands
* Playback events

Audio, reverse playback, recording, and advanced playback modes are intentionally deferred.

---

# Definition of Done

Step 11 is complete when:

* Users can preview animations in real time using standard playback controls.
* The timeline, renderer, and inspector remain perfectly synchronized throughout playback.
* Looping, speed adjustment, and frame stepping behave predictably and accurately.
* The playback engine evaluates animation efficiently without modifying project data, providing a robust foundation for future features such as audio synchronization, video export, timeline recording, and animation debugging.
