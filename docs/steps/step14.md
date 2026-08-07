# Step 14 – Material System

## Goal

Implement a **Material System** that separates **what an object is** (Asset Definition) from **how it is rendered** (Material).

This is a major architectural milestone. Until now, an Asset Instance directly referenced an image. From this step onward, rendering is controlled by a Material, making it possible to reuse the same asset with different colors, shaders, effects, and rendering parameters.

This abstraction is essential for future shader editing, AI-assisted material generation, reusable visual styles, and efficient rendering.

---

# Success Criteria

At the end of this step:

* ✅ Materials can be created.
* ✅ Materials can be assigned to objects.
* ✅ Multiple objects can share the same material.
* ✅ Material instances override individual parameters.
* ✅ The same asset can appear differently using different materials.
* ✅ Renderer uses the Material System exclusively.

No shader graph or custom shader editing is implemented yet.

---

# Scope

Implement:

* Material definitions
* Material instances
* Material library
* Material assignment
* Material inspector
* Material serialization

Do **not** implement:

* Shader graph
* Node editor
* Custom GLSL editing
* Animated shader parameters
* Procedural materials

---

# Architectural Principle

Separate geometry from appearance.

```text id="2jbq8v"
Asset Definition
        ↓
Asset Instance
        ↓
Material
        ↓
Material Instance
        ↓
Renderer
```

Changing a material never changes the asset itself.

---

# Rendering Pipeline

Update the rendering model:

```text id="ytpnwv"
Scene Node
        ↓
Asset Instance
        ↓
Material Instance
        ↓
Material Definition
        ↓
Renderer
```

The renderer should never access textures directly from the asset.

---

# Material Definition

A Material Definition contains reusable rendering information.

Fields:

* id
* name
* material type
* default parameters

Future fields:

* shader
* blend mode
* render passes
* metadata
* AI description

---

# Material Instance

Each Asset Instance owns a Material Instance.

A Material Instance contains:

* material reference
* overridden parameters

If no overrides exist, the default material values are used.

---

# Default Material

Every imported asset automatically receives a default material.

Example:

```text id="j2v8h9"
Boy.png

↓

Default Material
```

Existing projects should migrate automatically.

---

# Material Types

Initially support:

```text id="7kqglo"
Image

Tinted Image
```

Future types:

```text id="c4vnxt"
GLSL Shader

Particle

Procedural

Text

Vector

Multi-pass
```

---

# Material Parameters

Initially support:

* Tint Color
* Opacity Multiplier

Future parameters:

* Brightness
* Contrast
* Saturation
* Glow
* Outline
* Blur
* Shader uniforms

---

# Material Library

Create a new Material Library panel.

Display:

* Preview
* Name
* Material Type

Support:

* Search
* Rename
* Duplicate
* Delete

---

# Material Assignment

Inspector gains:

```text id="jlwmn0"
Material

▼ Default Material
```

User can:

* Select existing material
* Duplicate material
* Create new material

Assignment updates immediately.

---

# Material Instances

Changing a Material Definition affects every object using it.

Example:

```text id="4mklob"
Boy

↓

Default Material

↓

Tint = Blue
```

Every Boy using that material updates instantly.

---

# Overrides

A Material Instance may override specific values.

Example:

Material:

```text id="g3kpp2"
Tint

Blue
```

Instance Override:

```text id="zxt6n0"
Tint

Red
```

Only that object becomes red.

---

# Material Inspector

Selecting a Material opens its Inspector.

Initially editable:

* Name
* Tint Color
* Opacity Multiplier

Future sections remain placeholders.

---

# Material Preview

Generate previews automatically.

Initially:

Render a thumbnail using the assigned material.

---

# Serialization

Projects store:

* Material Definitions
* Material Instances
* References

Asset Definitions remain separate.

---

# Commands

Introduce:

```text id="xmxqf4"
CreateMaterialCommand

DeleteMaterialCommand

AssignMaterialCommand

DuplicateMaterialCommand

RenameMaterialCommand

SetMaterialParameterCommand

OverrideMaterialParameterCommand

ClearMaterialOverrideCommand
```

All material edits use the Command System.

---

# Events

Emit:

```text id="i4q91p"
MaterialCreated

MaterialDeleted

MaterialUpdated

MaterialAssigned

MaterialOverrideChanged
```

Renderer refreshes affected objects only.

---

# Renderer Integration

Update Pixi renderer.

Instead of:

```text id="qtwumk"
Asset

↓

Texture
```

Use:

```text id="88n4xq"
Asset

↓

Material

↓

Render Object
```

This prepares the renderer for future shader support without redesign.

---

# Performance

Requirements:

* Shared materials should reuse renderer resources.
* Parameter changes update only affected objects.
* No unnecessary texture recreation.
* Material lookup should be cached.

---

# Migration

Existing projects:

Automatically create a default material for every imported asset.

Migration must be transparent to users.

---

# Testing

Unit tests should verify:

## Materials

* Create
* Delete
* Rename
* Duplicate

---

## Assignment

Verify assigning materials updates rendering.

---

## Overrides

Verify:

* Default values
* Instance overrides
* Clearing overrides

---

## Sharing

Verify modifying one material updates all linked objects.

---

## Serialization

Verify projects correctly save and restore materials and overrides.

---

# Manual Verification Checklist

## Create

Create several materials.

Verify they appear in the Material Library.

---

## Assign

Assign different materials to identical assets.

Verify they render differently.

---

## Shared Material

Assign one material to several objects.

Modify tint.

Verify all linked objects update.

---

## Override

Override tint on one object.

Verify only that object changes.

Clear override.

Verify it returns to the shared material appearance.

---

## Duplicate

Duplicate a material.

Modify the duplicate.

Verify the original remains unchanged.

---

## Persistence

Save the project.

Restart.

Verify:

* Materials restored.
* Assignments restored.
* Overrides restored.

---

## Migration

Open an older project created before the Material System.

Verify default materials are created automatically and the project renders identically.

---

# Deliverables

After Step 14, the editor includes:

* Material definitions
* Material instances
* Material library
* Material assignment
* Material inspector
* Shared materials
* Instance overrides
* Material serialization
* Renderer abstraction through materials
* Migration for legacy projects

Custom shaders and advanced rendering techniques are intentionally deferred.

---

# Definition of Done

Step 14 is complete when:

* Assets and rendering are fully decoupled through the Material System.
* The same asset can be rendered with different appearances by assigning different materials or overriding material parameters per instance.
* Material changes propagate efficiently across all linked objects while preserving per-instance customization.
* The rendering architecture is now prepared for future shader support, procedural materials, AI-generated visual styles, and advanced rendering pipelines without requiring structural changes to the engine.
