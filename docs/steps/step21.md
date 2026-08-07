# Step 21 – Asset Playground (Asset Authoring Studio)

## Goal

Implement the **Asset Playground**, a dedicated environment for creating reusable **Asset Definitions** from imported artwork.

This is where every visual element (character, arm, hand, speech bubble, fish, jellyfish, cloud, petal, clock hand, etc.) is prepared before it can be used in lessons.

The playground is **not** a slide editor. It is an asset authoring tool where users define how an asset behaves: pivots, anchors, editable parameters, attachment points, bounding boxes, and metadata.

Well-authored assets become intelligent building blocks that both users and the AI can reuse across hundreds of lessons.

---

# Success Criteria

At the end of this step:

* ✅ Images can be imported.
* ✅ Asset Definitions can be created.
* ✅ Pivot points can be edited visually.
* ✅ Multiple attachment anchors can be created.
* ✅ Bounding boxes can be adjusted.
* ✅ Assets can be previewed with transforms.
* ✅ Metadata can be edited.
* ✅ Assets are saved into the Asset Library.
* ✅ AI can understand asset capabilities from metadata.

No AI asset generation is implemented yet.

---

# Scope

Implement:

* Asset Playground
* Image import
* Pivot editing
* Anchor editing
* Bounding box editing
* Transform preview
* Asset metadata
* Asset validation

Do **not** implement:

* SVG editing
* Skeleton animation
* Mesh deformation
* Asset generation
* Texture atlas packing

---

# Architectural Principle

Separate raw artwork from reusable asset definitions.

```text
Imported Image

↓

Asset Definition

↓

Asset Library

↓

Asset Instance

↓

Scene
```

The imported image is never placed directly into a scene.

---

# Playground Layout

Create a dedicated Asset Playground.

Suggested layout:

```text
+---------------------------------------------------------+

Asset Explorer

|

Canvas

|

Inspector

-----------------------------------------------------------

Timeline Preview

-----------------------------------------------------------
```

The playground should reuse the same rendering engine as the editor.

---

# Asset Creation Workflow

Typical workflow:

```text
Import PNG

↓

Create Asset Definition

↓

Set Pivot

↓

Create Anchors

↓

Define Metadata

↓

Test Transformations

↓

Save to Library
```

---

# Supported Imports

Initially support:

* PNG
* JPG
* WebP

Future:

* SVG
* PSD
* Aseprite
* Spine
* Lottie

---

# Asset Definition

Each Asset Definition contains:

* id
* name
* image
* category
* pivot
* anchors
* bounding box
* default material
* metadata

Future:

* LOD
* collision shapes
* animation presets
* physics data

---

# Pivot Editor

Every asset has exactly one pivot.

Display a draggable pivot handle.

Examples:

```text
Clock Hand

↓

Pivot at bottom

--------------------

Character

↓

Pivot between feet

--------------------

Fish

↓

Pivot at center
```

Rotation always occurs around the pivot.

---

# Anchors

An asset may define multiple named anchors.

Examples:

```text
Left Hand

Right Hand

Head

Mouth

Center

Speech Bubble

Weapon

Tail
```

Anchors become attachment points for other assets.

---

# Anchor Editor

Users can:

* Create anchor
* Rename anchor
* Delete anchor
* Move anchor

Anchors are visualized as labeled markers.

---

# Bounding Box

Display editable bounds.

Used for:

* Selection
* Snapping
* Visibility
* Future collision detection

Allow resizing directly on the canvas.

---

# Metadata

Each asset contains descriptive metadata.

Examples:

* Name
* Description
* Category
* Tags
* Language (optional)
* Usage notes

Future AI-specific fields:

* Semantic description
* Compatible animations
* Compatible shaders

---

# AI Metadata

This is particularly important for later AI generation.

Examples:

```text
Name:
Running Boy

Category:
Character

Can Rotate:
Yes

Can Stretch:
No

Recommended Pivot:
Feet

Anchors:
Left Hand
Right Hand
Head

Typical Use:
Running animations
```

The AI uses this information when planning scenes.

---

# Asset Categories

Initially support:

```text
Character

Character Part

Animal

Object

Background

UI

Decoration

Text

Effect

Particle
```

---

# Transform Preview

Provide interactive controls:

* Move
* Rotate
* Scale
* Flip Horizontal
* Flip Vertical

These changes are previews only and do not alter the Asset Definition.

---

# Preview Timeline

Reuse the existing timeline system.

Users can quickly test:

* Rotation
* Scaling
* Opacity
* Translation

without creating a slide.

This preview is discarded when leaving the playground.

---

# Grid & Guides

Support:

* Grid
* Snap to Grid
* Rulers
* Safe Area
* Center Lines

Useful for accurate pivot and anchor placement.

---

# Origin Display

Display:

```text
X Axis

Y Axis

Origin
```

Users always know where `(0,0)` is relative to the asset.

---

# Validation

Before saving:

Verify:

* Image exists
* Pivot defined
* Bounding box valid
* Anchor names unique
* Metadata complete

Warnings should not block saving unless the asset is invalid.

---

# Asset Preview

Generate a thumbnail automatically.

Thumbnail updates whenever the asset definition changes.

---

# Asset Library Integration

Saving immediately creates or updates an Asset Definition in the Asset Library.

Existing scenes referencing the asset should refresh automatically.

---

# Commands

Introduce:

```text
ImportAssetCommand

CreateAssetDefinitionCommand

SetPivotCommand

CreateAnchorCommand

RenameAnchorCommand

MoveAnchorCommand

DeleteAnchorCommand

SetBoundingBoxCommand

UpdateAssetMetadataCommand

SaveAssetDefinitionCommand
```

All changes remain fully undoable.

---

# Events

Emit:

```text
AssetImported

AssetDefinitionCreated

PivotChanged

AnchorCreated

AnchorMoved

AnchorDeleted

BoundingBoxChanged

AssetSaved
```

---

# Persistence

Persist:

* Imported image reference
* Pivot
* Anchors
* Bounding box
* Metadata
* Thumbnail

Future versions may also store editable source files.

---

# Performance

Requirements:

* Large textures remain responsive.
* Pivot and anchor editing is immediate.
* Preview transforms render at 60 FPS.
* Thumbnail generation occurs asynchronously.

---

# Future Placeholders

Reserve architecture for:

* SVG assets
* Vector editing
* Mesh deformation
* Bone rigs
* Auto-generated pivots
* AI-generated anchors
* Asset variants
* Texture atlases

---

# Testing

Unit tests should verify:

## Import

* PNG import
* Image loading
* Asset creation

---

## Pivot

Verify:

* Move pivot
* Save pivot
* Reload pivot

---

## Anchors

Verify:

* Create
* Rename
* Move
* Delete

---

## Bounding Box

Verify resizing and persistence.

---

## Metadata

Verify metadata is saved and restored correctly.

---

## Asset Library

Verify saved assets immediately appear in the Asset Library and can be instantiated in scenes.

---

# Manual Verification Checklist

## Import

Import a PNG.

Verify it appears in the playground canvas.

---

## Pivot

Move the pivot to a new position.

Rotate the preview.

Verify rotation occurs around the new pivot.

---

## Anchors

Create:

```text
Left Hand

Right Hand

Head
```

Verify markers appear and can be repositioned.

---

## Bounding Box

Resize the bounding box.

Verify selection uses the updated bounds.

---

## Preview

Test:

* Move
* Rotate
* Scale
* Flip

Verify the preview behaves correctly without modifying the original image.

---

## Save

Save the Asset Definition.

Verify it appears in the Asset Library with a generated thumbnail.

---

## Reuse

Place the saved asset into a slide.

Verify the pivot, anchors, and metadata are available to the editor and AI systems.

---

## Persistence

Restart the application.

Verify the Asset Definition, including pivots, anchors, metadata, and thumbnails, is restored correctly.

---

# Deliverables

After Step 21, the editor includes:

* Asset Playground
* Image import
* Asset Definition editor
* Pivot editor
* Multi-anchor system
* Bounding box editor
* Metadata editor
* Transform preview
* Preview timeline
* Grid and guides
* Asset validation
* Asset thumbnails
* Full Asset Library integration

Advanced rigging, vector editing, and AI-generated assets are intentionally deferred.

---

# Definition of Done

Step 21 is complete when:

* Users can convert raw artwork into reusable Asset Definitions with correctly configured pivots, anchors, metadata, and bounding boxes.
* Every asset behaves consistently when reused across scenes, animations, and lessons.
* The Asset Playground becomes the single source of truth for reusable visual components, providing high-quality semantic information that future AI systems can leverage for automatic scene construction, animation generation, and intelligent lesson authoring.
