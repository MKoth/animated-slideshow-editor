# Step 6 – Asset Library

## Goal

Implement the **Asset Library**, the central repository of reusable assets used throughout all projects.

The Asset Library manages **asset definitions**, not scene objects. Users can import images, organize them, edit metadata, define pivots and anchors, and prepare assets for reuse.

Assets remain immutable. Scenes contain **Asset Instances** that reference these definitions.

---

# Success Criteria

At the end of this step:

* ✅ Images can be imported.
* ✅ Asset library displays imported assets.
* ✅ Asset metadata can be edited.
* ✅ Pivot point can be configured.
* ✅ Anchor points can be created.
* ✅ Asset categories and tags exist.
* ✅ Asset preview is available.
* ✅ Assets persist between application restarts.

No scene editing is implemented yet.

---

# Scope

Implement:

* Asset library
* Import images
* Asset metadata
* Preview generation
* Pivot editor
* Anchor editor
* Search and filtering

Do **not** implement:

* Dragging assets into the scene
* Asset animation
* Shaders
* Asset playground
* AI asset generation

---

# Architectural Principle

Separate **Definition** from **Instance**.

```text
Asset Definition

↓

Asset Instance

↓

Scene
```

Only Asset Definitions belong to the library.

---

# Asset Lifecycle

```text
Import Image

↓

Create Asset Definition

↓

Generate Thumbnail

↓

Configure Metadata

↓

Ready for Use
```

---

# Supported Formats

Initially support:

* PNG
* JPG
* WEBP

SVG support is intentionally postponed until the rendering strategy is finalized.

---

# Asset Storage

Store imported assets in a dedicated storage folder.

Suggested structure:

```text
storage/

    assets/

        originals/

        thumbnails/

        metadata/
```

Imported files should never be modified directly.

---

# Asset Definition

Each asset definition contains:

## Identification

* id
* name
* description

---

## Classification

* category
* tags

Examples:

```text
Characters

Animals

Fish

Plants

UI

Backgrounds

Speech Bubbles

Icons
```

---

## Source Information

* original filename
* import date
* image size
* file size

---

## Rendering Information

* width
* height
* aspect ratio

---

## Transform Defaults

* default scale
* default rotation

---

## Pivot

Default rotation point.

Coordinates stored relative to image.

Example:

```text
Center

Bottom

Custom
```

---

## Anchors

Multiple named anchor points.

Examples:

```text
Left Hand

Right Hand

Head

Speech Bubble

Tail

Wing

Root
```

Future assets may attach to these anchors.

---

## AI Description

Optional text describing the asset.

Example:

```text
Boy standing and smiling.

Suitable for present tense lessons.
```

Useful for AI search later.

---

# Asset Browser

Create an asset browser panel.

Display:

* Thumbnail
* Name
* Category
* Tags

Support:

* Grid view
* List view

---

# Search

Search by:

* Name
* Tags
* Description

Search should update results immediately.

---

# Filtering

Support filtering by:

* Category
* Tags
* Asset type

Multiple filters may be active simultaneously.

---

# Sorting

Support:

* Name
* Import date
* Recently modified

---

# Thumbnail Generation

Generate thumbnails automatically during import.

Store them separately.

Do not regenerate on every startup.

---

# Preview Panel

Selecting an asset opens a preview.

Display:

* Original image
* Metadata
* Resolution
* Tags
* Category
* AI description

---

# Pivot Editor

Implement a visual pivot editor.

Display:

* Asset image
* Pivot marker

User can:

* Move pivot
* Reset to center
* Snap to corners
* Snap to edges

Store normalized coordinates.

---

# Anchor Editor

Allow creation of multiple anchors.

Each anchor has:

* name
* x
* y

User can:

* Add anchor
* Rename anchor
* Move anchor
* Delete anchor

Display all anchors visually.

---

# Metadata Editor

Editable fields:

* Name
* Description
* Category
* Tags
* AI description

Read-only fields:

* Image size
* Import date
* File size

---

# Validation

Reject:

* Unsupported formats
* Missing files
* Corrupted images

Display meaningful error messages.

---

# Persistence

Asset definitions should be stored in SQLite.

Image files remain on disk.

Project files reference asset IDs, not image copies.

---

# Asset Repository

Introduce an Asset Repository responsible for:

* Loading assets
* Saving metadata
* Searching
* Filtering

The repository should hide database implementation details from the rest of the application.

---

# Asset Cache

Introduce an in-memory cache.

Responsibilities:

* Avoid duplicate loading.
* Share asset definitions.
* Invalidate on metadata updates.

---

# Events

Emit events such as:

```text
AssetImported

AssetDeleted

AssetUpdated

AssetMetadataChanged
```

The Asset Browser listens to these events.

---

# Testing

Unit tests should verify:

## Import

* PNG imports successfully.
* Invalid formats are rejected.
* Metadata is generated.

---

## Metadata

* Editing metadata persists.
* Validation works.

---

## Pivot

* Pivot updates correctly.
* Coordinates are normalized.

---

## Anchors

* Add anchor.
* Delete anchor.
* Rename anchor.
* Move anchor.

---

## Search

Verify searching by:

* name
* tag
* description

---

## Filtering

Verify:

* category
* multiple tags
* combined filters

---

# Manual Verification Checklist

## Import

Import several PNG images.

Verify:

* Images appear in Asset Browser.
* Thumbnails are generated.
* Metadata is created.

---

## Preview

Select an asset.

Verify preview displays:

* Image
* Size
* Tags
* Category
* Description

---

## Pivot

Move pivot.

Save.

Restart application.

Verify pivot remains.

---

## Anchors

Create anchors.

Move them.

Rename them.

Restart.

Verify they persist.

---

## Search

Search by:

* Asset name
* Tag
* Description

Verify filtering updates instantly.

---

## Categories

Assign categories.

Filter by category.

Verify correct assets appear.

---

## Restart

Restart application.

Verify:

* Assets remain.
* Metadata remains.
* Thumbnails remain.
* Search still works.

---

# Deliverables

After Step 6, the project contains:

* Asset import pipeline
* Asset browser
* Asset metadata editor
* Thumbnail generation
* Pivot editor
* Anchor editor
* Search and filtering
* SQLite-backed asset repository
* Asset cache
* Event integration
* Persistent asset library

No assets can yet be placed into scenes.

---

# Definition of Done

Step 6 is complete when:

* Users can build a reusable asset library independent of any project.
* Every imported asset has editable metadata, configurable pivots, and named anchors.
* Asset definitions persist across application restarts and can be efficiently searched and filtered.
* The library serves as the single source of truth for reusable visual assets, preparing the foundation for scene composition, AI-assisted asset selection, shader assignment, and animation in subsequent steps.
