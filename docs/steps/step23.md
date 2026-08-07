# Step 23 – Video Export & Rendering Pipeline

## Goal

Implement an **offline video rendering pipeline** that exports complete lessons as high-quality MP4 videos.

Unlike real-time playback, video export is **frame-perfect and deterministic**. The renderer evaluates every frame using the timeline, animation system, shaders, and materials, then encodes the result into a video file.

This pipeline will later support narration, subtitles, image sequences, alpha export, multiple resolutions, and batch rendering.

---

# Success Criteria

At the end of this step:

* ✅ Projects can be exported to MP4.
* ✅ Rendering is frame-perfect.
* ✅ Export progress is displayed.
* ✅ Export can be cancelled.
* ✅ Output resolution is configurable.
* ✅ Frame rate is configurable.
* ✅ Export settings are persisted.
* ✅ Exported videos match the editor preview.

Audio, subtitles, and alpha-channel exports are intentionally postponed.

---

# Scope

Implement:

* Offline renderer
* MP4 export
* Export dialog
* Progress reporting
* Cancellation
* Resolution selection
* Frame rate selection
* Export history

Do **not** implement:

* Audio
* Narration
* GIF export
* Alpha video
* Batch rendering
* Distributed rendering

---

# Architectural Principle

Video export uses the same rendering engine as the editor, but evaluates the timeline deterministically rather than relying on real-time playback.

```text id="jlwm401"
Project

↓

Timeline

↓

Animation Evaluator

↓

Pixi Renderer

↓

Frame Buffer

↓

Video Encoder

↓

MP4
```

The renderer should never depend on monitor refresh rate or real-time timing.

---

# Export Workflow

Typical workflow:

```text id="jlwm402"
Project

↓

Export

↓

Choose Settings

↓

Render Frames

↓

Encode Video

↓

Save MP4
```

---

# Export Dialog

Create a dedicated export dialog.

Suggested layout:

```text id="jlwm403"
Output File

Resolution

Frame Rate

Quality

Background Color

Estimated Duration

Export
```

---

# Export Settings

Initially support:

## Resolution

```text id="jlwm404"
1280 × 720

1920 × 1080

2560 × 1440

3840 × 2160
```

Future:

* Custom resolution
* Portrait presets
* Square presets

---

## Frame Rate

Support:

```text id="jlwm405"
24 FPS

30 FPS

60 FPS
```

---

## Quality

Support:

```text id="jlwm406"
Low

Medium

High

Maximum
```

These map to encoder settings such as bitrate or CRF.

---

## Background

Support:

* Transparent checker preview (editor only)
* Solid background color in exported video

Transparent video export will be added later.

---

# Offline Timeline Evaluation

The exporter evaluates:

* Slides
* Animations
* Curves
* Materials
* Shaders
* Visibility
* Opacity

using an exact timestamp for every frame.

Example:

```text id="jlwm407"
Frame 0

Time = 0.000

Frame 1

Time = 0.01667

Frame 2

Time = 0.03333
```

No dropped or duplicated frames.

---

# Rendering Pipeline

Each frame:

```text id="jlwm408"
Evaluate Timeline

↓

Update Scene

↓

Render Pixi

↓

Capture Frame

↓

Encode
```

The editor UI is never rendered into the output.

---

# Encoder

Use **FFmpeg** as the encoding backend.

Initially output:

```text id="jlwm409"
MP4

H.264

AAC (future)
```

Future codecs:

* H.265
* AV1
* ProRes
* VP9
* WebM

The encoding backend should be abstracted behind an interface so alternative encoders can be added later.

---

# Progress Reporting

Display:

* Current frame
* Total frames
* Percentage
* Elapsed time
* Estimated remaining time

Example:

```text id="jlwm410"
Frame

540 / 1800

30%

ETA

00:01:24
```

---

# Cancellation

Users can stop rendering.

If cancelled:

* Encoder closes gracefully.
* Partial output is discarded (or clearly marked as incomplete).
* Resources are released.

---

# Export Queue

Initially support one export at a time.

Design the architecture to allow multiple queued exports in the future.

---

# Preview

Before exporting:

Display:

* Resolution
* Estimated file size (approximate)
* Estimated render time

---

# Export History

Maintain export history.

Each entry stores:

* File name
* Date
* Resolution
* FPS
* Duration
* Status

Future:

* Open containing folder
* Re-export

---

# Renderer Synchronization

The export renderer should reuse:

* Asset system
* Material system
* Shader system
* Animation evaluator

Avoid maintaining a separate rendering implementation.

---

# Determinism

Rendering the same project twice with identical settings should produce visually identical output.

Randomized effects should use deterministic seeds during export.

---

# Error Handling

Handle gracefully:

* Disk full
* Invalid output path
* Encoder failure
* Missing assets
* Corrupt textures

Provide clear error messages and preserve project state.

---

# Commands

Introduce:

```text id="jlwm411"
StartExportCommand

CancelExportCommand

FinishExportCommand

OpenExportCommand
```

These integrate export into the editor's command/event architecture without affecting project content.

---

# Events

Emit:

```text id="jlwm412"
ExportStarted

ExportProgress

ExportCompleted

ExportCancelled

ExportFailed
```

---

# Persistence

Persist:

* Last export settings
* Recent output directory
* Export history

The exported video itself is stored outside the project.

---

# Performance

Requirements:

* Export should not block the editor UI.
* Rendering should run on a background worker or separate process where practical.
* GPU resources should be reused efficiently.
* Memory usage should remain stable during long exports.

---

# Future Placeholders

Reserve architecture for:

* Audio mixing
* Voice narration
* Subtitle rendering
* Alpha-channel video
* Image sequence export (PNG, EXR)
* GIF export
* Batch export
* Distributed/cloud rendering

---

# Testing

Unit tests should verify:

## Settings

* Resolution selection
* FPS selection
* Quality presets

---

## Timeline

Verify exported frames match timeline evaluation at known timestamps.

---

## Cancellation

Start an export, cancel it, and verify resources are released cleanly.

---

## Error Handling

Simulate:

* Invalid output path
* Encoder failure
* Missing texture

Verify informative errors are shown.

---

## Determinism

Export the same project twice.

Verify frame-by-frame visual output is identical.

---

## Persistence

Restart the application.

Verify last-used export settings and export history are restored.

---

# Manual Verification Checklist

## Export

Open a completed lesson.

Choose:

```text id="jlwm413"
1920×1080

30 FPS

High Quality
```

Start export.

Verify progress updates continuously.

---

## Playback

Open the generated MP4.

Verify:

* All slides render correctly.
* Animations are smooth.
* Shaders match the editor preview.
* No missing assets or visual artifacts.

---

## Cancellation

Start exporting a long project.

Press **Cancel**.

Verify the export stops immediately and the application remains responsive.

---

## Re-export

Export the same project twice.

Verify both videos are visually identical.

---

## History

Open Export History.

Verify the completed export appears with the correct metadata.

---

# Deliverables

After Step 23, the editor includes:

* Offline rendering pipeline
* MP4 export
* Configurable resolution
* Configurable frame rate
* Quality presets
* Export dialog
* Progress reporting
* Cancellation
* Export history
* Deterministic rendering
* FFmpeg-based encoding abstraction

Audio, subtitles, alpha export, and batch rendering are intentionally deferred.

---

# Definition of Done

Step 23 is complete when:

* Users can export any project to a high-quality MP4 video whose visual output matches the editor preview.
* The export process is deterministic, configurable, cancellable, and provides clear progress feedback throughout rendering.
* The rendering architecture is prepared for future extensions such as narration, subtitles, image-sequence export, transparent video, and cloud rendering without requiring major redesign.
