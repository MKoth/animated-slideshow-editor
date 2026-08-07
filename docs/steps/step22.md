# Step 22 – Asset Metadata Editor

## Goal

Implement a **rich Metadata Editor** that transforms visual assets into intelligent, self-describing components.

The metadata system is the bridge between artists, the editor, and the AI. While an image defines **how an asset looks**, metadata defines **what the asset is**, **how it behaves**, **how it connects to other assets**, and **how the AI should use it**.

This step is one of the most important for future AI-driven lesson creation. A high-quality metadata model allows the AI to automatically compose scenes, attach objects correctly, choose appropriate animations, assign shaders, and avoid incorrect asset usage.

---

# Success Criteria

At the end of this step:

* ✅ Every Asset Definition has editable metadata.
* ✅ Assets support tags and categories.
* ✅ Anchors become semantic attachment points.
* ✅ Shader slots can be defined.
* ✅ Animation compatibility can be specified.
* ✅ AI descriptions can be edited.
* ✅ Metadata is searchable.
* ✅ Metadata is persisted and versioned.

No AI-generated metadata is implemented yet.

---

# Scope

Implement:

* Metadata editor
* Tags
* Categories
* Semantic anchors
* Shader slots
* Animation compatibility
* AI description
* Validation
* Metadata search

Do **not** implement:

* Automatic metadata generation
* AI metadata editing
* Ontology learning
* Bone definitions
* Physics metadata

---

# Architectural Principle

Metadata describes **capabilities**, not appearance.

```text id="1m1ggz"
Image

↓

Asset Definition

↓

Metadata

↓

AI

↓

Scene Generation
```

The renderer ignores most metadata, while the editor and AI rely on it extensively.

---

# Metadata Categories

Split metadata into logical sections.

```text id="0df3na"
General

Geometry

Anchors

Materials

Shaders

Animations

AI

Validation
```

Each section should be independently expandable.

---

# General

Contains:

* Name
* Category
* Description
* Tags
* Version
* Author (optional)

Example:

```text id="hhxg79"
Running Boy

Category

Character

Tags

boy

running

human

child
```

---

# Tags

Tags provide fast searching and semantic grouping.

Examples:

```text id="8m0v2p"
animal

water

flower

character

hand

clock

speech

education

verb

fish

jellyfish
```

Support:

* Add
* Remove
* Auto-complete
* Search

---

# Categories

Initially support:

```text id="uysn4r"
Character

Character Part

Animal

Object

Plant

Background

UI

Effect

Particle

Text
```

Future projects may define custom categories.

---

# Geometry

Display read-only information:

* Width
* Height
* Pivot
* Bounding Box

Quick actions should navigate to the Asset Playground for editing.

---

# Semantic Anchors

Extend the anchor system with semantic information.

Instead of:

```text id="0y8xms"
Anchor 1
```

Use:

```text id="i7aqa6"
Left Hand

Attachment

Rotation Allowed

Yes
```

Each anchor contains:

* Name
* Purpose
* Rotation allowed
* Scale allowed
* Accepted attachment categories
* Notes

---

# Attachment Rules

Examples:

```text id="h2zhk8"
Head

Accepts:

Hat

Hair

Speech Bubble

---------------

Left Hand

Accepts:

Tool

Book

Pointer
```

The AI uses these constraints when assembling scenes.

---

# Shader Slots

Allow assets to expose predefined shader attachment points.

Examples:

```text id="jlwm301"
Body

Outline

Eyes

Glow

Shadow

Water

Highlight
```

Each slot specifies:

* Name
* Region
* Allowed shader categories
* Default material

Later, shaders can target specific slots instead of the whole asset.

---

# Material Compatibility

Define recommended materials.

Example:

```text id="jlwm302"
Recommended

Character Material

Allowed

Glow

Outline

Shadow
```

The AI prefers compatible materials during scene generation.

---

# Animation Compatibility

Specify reusable animation clips that work well with this asset.

Example:

```text id="jlwm303"
Idle

Run

Jump

Point

Wave

Blink
```

This helps the AI avoid suggesting incompatible animations.

---

# Transform Constraints

Specify optional constraints.

Examples:

```text id="jlwm304"
Can Rotate

Yes

Can Stretch

No

Can Flip

Yes

Uniform Scale Only

No
```

Useful for protecting delicate artwork and guiding AI decisions.

---

# AI Description

One of the most important fields.

Free-form natural language describing the asset.

Example:

```text id="jlwm305"
A smiling young boy viewed from the front.

Best used for educational scenes involving
running, pointing, speaking, or interacting
with another character.

Usually stands on the ground.

Should not be rotated upside down.

Can hold objects using Left Hand and Right Hand anchors.
```

Future AI systems will use this description to select and position assets appropriately.

---

# Usage Examples

Allow optional usage notes.

Example:

```text id="jlwm306"
Typically paired with:

Running Path

Speech Bubble

Clock

Spanish Pronouns
```

This can later power recommendation systems.

---

# Search

Metadata becomes searchable.

Search by:

* Name
* Category
* Tags
* AI description
* Compatible animations
* Shader slots

This enables both users and AI to quickly discover appropriate assets.

---

# Validation

Before saving:

Verify:

* Required fields present.
* Unique anchor names.
* Valid shader slot names.
* Valid categories.
* No duplicate tags.

Warnings should explain any issues clearly.

---

# Metadata Versioning

Every Asset Definition includes a metadata version.

Future migrations can upgrade older assets without breaking compatibility.

---

# Commands

Introduce:

```text id="jlwm307"
UpdateMetadataCommand

AddTagCommand

RemoveTagCommand

UpdateAIDescriptionCommand

CreateShaderSlotCommand

DeleteShaderSlotCommand

UpdateAnimationCompatibilityCommand

UpdateAttachmentRuleCommand
```

All metadata changes participate in Undo/Redo.

---

# Events

Emit:

```text id="jlwm308"
MetadataUpdated

TagAdded

TagRemoved

ShaderSlotCreated

AnimationCompatibilityChanged

AIDescriptionChanged
```

---

# Persistence

Persist:

* Tags
* Categories
* AI description
* Shader slots
* Animation compatibility
* Attachment rules
* Constraints
* Metadata version

Metadata is stored with the Asset Definition and shared across all projects that reference it.

---

# Performance

Requirements:

* Metadata editing is instantaneous.
* Search remains responsive with thousands of assets.
* Validation runs incrementally.
* Frequently accessed metadata can be cached in memory.

---

# Future Placeholders

Reserve architecture for:

* AI-generated metadata
* Automatic image recognition
* Ontology management
* Semantic similarity search
* Embedding-based asset retrieval
* Physics metadata
* Bone metadata
* Localization of metadata

---

# Testing

Unit tests should verify:

## Tags

* Add
* Remove
* Search
* Persistence

---

## Anchors

Verify semantic anchor properties are saved and restored.

---

## Shader Slots

Verify creation, editing, and deletion.

---

## Animation Compatibility

Verify compatible clip lists are persisted correctly.

---

## AI Description

Verify descriptions are editable, searchable, and persisted.

---

## Validation

Verify duplicate tags, invalid categories, and duplicate anchor names are detected correctly.

---

# Manual Verification Checklist

## Tags

Add:

```text id="jlwm309"
fish

water

koi
```

Verify the asset appears when searching for "fish".

---

## Shader Slots

Create:

```text id="jlwm310"
Body

Outline

Glow
```

Verify the slots are available when assigning shaders.

---

## Anchors

Edit the "Left Hand" anchor.

Restrict it to accepting only "Tool" and "Book" categories.

Verify the metadata updates correctly.

---

## AI Description

Write a detailed description.

Verify it appears in the metadata panel and is searchable.

---

## Animation Compatibility

Mark the asset as compatible with:

```text id="jlwm311"
Run

Point

Wave
```

Verify these recommendations are visible in the editor.

---

## Persistence

Restart the application.

Verify all metadata, tags, shader slots, anchor semantics, and AI descriptions are restored correctly.

---

# Deliverables

After Step 22, the editor includes:

* Rich Metadata Editor
* Tag system
* Categories
* Semantic anchors
* Attachment rules
* Shader slots
* Material compatibility
* Animation compatibility
* Transform constraints
* AI descriptions
* Metadata validation
* Searchable metadata
* Metadata versioning

Automatic metadata generation and semantic learning are intentionally deferred.

---

# Definition of Done

Step 22 is complete when:

* Every Asset Definition contains rich semantic metadata describing not only its appearance but also its capabilities, compatibility, and intended usage.
* Both users and future AI systems can reliably discover, select, and assemble assets using metadata rather than relying on naming conventions alone.
* The metadata architecture provides a scalable foundation for AI-assisted scene composition, animation planning, shader assignment, and automated lesson generation without requiring changes to the underlying asset model.
