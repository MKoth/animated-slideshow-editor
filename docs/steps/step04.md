# Step 4 – Pixi Renderer

## Goal

Integrate **PixiJS** as the first renderer for the Core Engine.

The renderer is responsible **only for visualization**. It reads the engine state and draws it on the canvas. It never modifies the project.

At the end of this step, users will be able to see scene objects rendered on the canvas and interact with the camera (pan and zoom), but there is still no object selection or editing.

---

# Success Criteria

At the end of this step:

* ✅ PixiJS is fully integrated.
* ✅ Renderer displays the scene graph.
* ✅ Grid is visible.
* ✅ Camera supports pan and zoom.
* ✅ Scene updates are reflected automatically.
* ✅ Renderer contains no business logic.
* ✅ Core Engine remains independent of Pixi.

---

# Scope

This step implements:

* Pixi renderer
* Camera
* Scene synchronization
* Grid
* Basic rendering primitives

It does **not** implement:

* Selection
* Dragging
* Timeline
* Animation
* Shaders
* Asset importing
* Inspector editing

---

# Architectural Principle

The rendering flow should always be:

```text
Core Engine
        ↓
Scene Graph
        ↓
Pixi Renderer
        ↓
GPU
```

The renderer never modifies the engine.

---

# Renderer Architecture

Create a dedicated renderer module.

Suggested components:

```text
Renderer

↓

SceneRenderer

↓

NodeRenderer

↓

Camera

↓

GridRenderer

↓

TextureCache
```

Each has a single responsibility.

---

# Renderer Responsibilities

Responsible for:

* Creating Pixi application
* Managing viewport
* Rendering nodes
* Updating transforms
* Camera
* Resource cleanup

Not responsible for:

* Project logic
* Commands
* Selection
* Timeline
* Animation

---

# Renderer Initialization

When the editor opens:

1. Create Pixi Application.
2. Attach canvas to the Canvas Panel.
3. Create renderer.
4. Render current scene.

If no project exists:

Display an empty scene.

---

# Scene Synchronization

The renderer mirrors the Core Engine.

Every SceneNode has a corresponding Pixi display object.

Example:

```text
SceneNode
    ↓
Pixi Container

SceneNode
    ↓
Pixi Sprite

SceneNode
    ↓
Pixi Graphics
```

The renderer owns only the visual representation.

---

# Temporary Rendering

Since assets do not exist yet, render simple placeholder graphics.

Examples:

Character

```text
Blue rectangle
```

Tree

```text
Green rectangle
```

Bubble

```text
White circle
```

The node name should be rendered above the placeholder.

---

# Node Types

Introduce temporary visual types.

Example:

```text
Rectangle

Circle

Text
```

These are only for development and testing.

---

# Transform Synchronization

Synchronize:

* Position
* Rotation
* Scale
* Visibility

Whenever the engine changes.

The renderer should not cache transform values independently.

---

# Camera

Implement a 2D editor camera.

Features:

* Pan
* Zoom
* Reset View

The camera should not rotate.

---

# Mouse Controls

Mouse wheel

→ Zoom

Middle mouse button

→ Pan

Double click background

→ Reset camera

---

# Grid

Render an infinite editor grid.

Requirements:

* World-space grid
* Major and minor lines
* Remains crisp during zoom
* Grid follows camera movement

The grid is rendered beneath all scene objects.

---

# Coordinate System

Define world coordinates.

Example:

```text
Origin

(0,0)
```

Display axis lines.

Positive X:

Right

Positive Y:

Down

---

# Debug Overlay

Add a renderer debug overlay.

Display:

* FPS
* Camera position
* Camera zoom
* Number of rendered nodes

This is a development feature.

---

# Texture Management

Introduce a texture cache abstraction.

Even though textures are not yet imported, define the interface now.

Responsibilities:

* Load texture
* Retrieve texture
* Dispose texture

Initially it may return placeholder textures.

---

# Renderer Events

React to engine events.

Examples:

```text
NodeCreated

↓

Create Pixi object

----------------

NodeRemoved

↓

Destroy Pixi object

----------------

TransformChanged

↓

Update Pixi transform
```

Do not poll the engine every frame.

---

# Rendering Loop

The renderer should:

* Render continuously using Pixi's ticker.
* Avoid unnecessary allocations inside the render loop.
* Read only the current visual state.

No animation interpolation yet.

---

# Canvas Resize

Handle browser resizing.

Requirements:

* Canvas always fills available editor area.
* Camera remains valid.
* Grid adjusts correctly.

---

# Error Handling

If rendering fails:

* Show an error overlay.
* Log details.
* Do not crash the application.

---

# Testing

Unit tests

Verify:

* Renderer initializes.
* Camera calculations.
* Coordinate conversion.
* Scene synchronization.

---

Integration tests

Verify:

* Engine creates node.
* Renderer displays placeholder.
* Engine removes node.
* Renderer removes placeholder.

---

# Manual Verification Checklist

## Renderer

Start application.

Canvas initializes successfully.

---

## Grid

Grid is visible.

Grid remains aligned while panning and zooming.

---

## Camera

Mouse wheel:

Zoom.

Middle mouse:

Pan.

Double click:

Reset view.

---

## Scene

Create nodes using temporary debug controls.

Verify placeholders appear.

---

Move nodes.

Verify placeholders move.

---

Rotate nodes.

Verify placeholders rotate.

---

Hide nodes.

Verify placeholders disappear.

---

Delete nodes.

Verify placeholders are removed.

---

## Resize

Resize browser window.

Canvas adjusts correctly.

---

## Debug Overlay

Verify:

* FPS
* Camera coordinates
* Zoom
* Rendered node count

update correctly.

---

# Deliverables

After Step 4, the application includes:

* PixiJS renderer
* Camera
* Infinite editor grid
* Placeholder node rendering
* Transform synchronization
* Renderer debug overlay
* Texture cache abstraction
* Automatic scene synchronization
* Responsive canvas resizing

There is still no asset importing, object selection, or editing.

---

# Definition of Done

Step 4 is complete when:

* The Pixi renderer accurately reflects the Core Engine's scene graph using placeholder graphics.
* Camera controls provide a smooth editing experience with pan, zoom, and reset functionality.
* The renderer remains a passive visualization layer with no knowledge of business logic or editor workflows.
* Creating, updating, and removing nodes in the Core Engine is immediately reflected on the canvas without requiring manual refreshes.
* The rendering architecture is ready to support real assets, shaders, animation, and interaction in subsequent implementation steps.
