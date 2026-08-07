# Step 15 – GLSL Shader System

## Goal

Implement a **GLSL Shader System** that allows materials to render using custom GPU shaders.

Shaders become first-class resources in the editor, just like assets and materials. Users can assign shaders to materials, edit uniforms through the Inspector, and immediately preview changes on the canvas.

This step establishes the rendering foundation for visual effects such as water, glow, dissolve, metaballs, outlines, gradients, distortions, procedural backgrounds, and educational animations.

The system should be designed around **PixiJS/WebGL2 GLSL shaders**, while remaining abstract enough that a future Vulkan/WebGPU renderer could implement the same interfaces.

---

# Success Criteria

At the end of this step:

* ✅ Shader library exists.
* ✅ GLSL shaders can be imported.
* ✅ Materials can reference shaders.
* ✅ Uniforms are automatically discovered.
* ✅ Uniforms can be edited in the Inspector.
* ✅ Shader updates appear immediately.
* ✅ Live preview works.
* ✅ Shader compilation errors are displayed clearly.
* ✅ Shader resources are cached.

A visual shader graph editor is intentionally postponed.

---

# Scope

Implement:

* Shader library
* Shader assets
* Shader compilation
* Material shader assignment
* Uniform reflection
* Uniform editor
* Live shader preview
* Shader caching

Do **not** implement:

* Shader graph
* Multi-pass rendering
* Compute shaders
* Particle shaders
* Custom render pipelines

---

# Architectural Principle

Rendering becomes fully data-driven.

```text id="x91m8l"
Asset

↓

Material

↓

Shader

↓

GPU Program

↓

Renderer
```

Assets never contain rendering logic.

---

# Shader Library

Create a Shader Library similar to the Asset and Material libraries.

Each shader contains:

* Name
* Preview
* Shader Type
* Description
* Tags
* Author (optional)

Future metadata:

* Category
* AI description
* Version
* Documentation URL

---

# Shader Asset

Each shader stores:

* id
* name
* vertex shader source
* fragment shader source
* default uniforms
* metadata

Initially support:

* Vertex GLSL
* Fragment GLSL

---

# Shader Types

Initially support:

```text id="m4ns4s"
Image Shader

Fullscreen Shader
```

Future types:

```text id="dgu4sa"
Particle Shader

Lighting Shader

Post Process

Text Shader

Geometry Shader
```

---

# Material Integration

Extend Material Definitions:

```text id="p8vrkc"
Material

↓

Shader

↓

Uniform Defaults
```

A material without a shader uses the built-in Image Shader.

---

# Shader Assignment

Inspector gains:

```text id="ryjlwm"
Shader

▼ Water Ripple
```

Changing shaders updates immediately.

---

# Shader Compilation

Compilation should happen automatically when:

* importing a shader
* editing shader source
* changing shader files

Display:

* Success
* Warnings
* Errors

---

# Error Reporting

Shader errors should include:

* file
* line
* message

Example:

```text id="ifqeh8"
Fragment Shader

Line 42

Unknown identifier:

uTimee
```

Highlight the affected line in the editor.

---

# Uniform Reflection

Automatically discover shader uniforms.

Example:

```glsl id="u0f1tx"
uniform float uTime;
uniform float uRadius;
uniform vec3 uColor;
```

Inspector generates:

```text id="6ml9ar"
uTime

Slider

uRadius

Slider

uColor

Color Picker
```

No manual registration required.

---

# Supported Uniform Types

Initially support:

* float
* int
* bool
* vec2
* vec3
* vec4
* color
* sampler2D

Future:

* arrays
* matrices
* structs

---

# Uniform Editor

Automatically generate controls.

Examples:

Float

```text id="m4h8d6"
Slider

0

↓

1
```

Boolean

```text id="yr4bwy"
Checkbox
```

Color

```text id="9z2pq2"
Color Picker
```

Vector

```text id="rgsrlt"
X

Y

Z
```

Texture

```text id="sq13kq"
Asset Picker
```

---

# Material Overrides

Uniforms participate in the Material System.

Material Definition:

```text id="4g7vqj"
Glow Strength

2.0
```

Material Instance Override:

```text id="jlwmk9"
Glow Strength

4.5
```

Only one object changes.

---

# Live Preview

Changing a uniform updates:

* Renderer
* Material Preview
* Scene

No recompilation unless shader source changes.

---

# Shader Preview Panel

Selecting a shader displays:

* Preview
* Uniform list
* Compile status
* Metadata

Future:

* Documentation
* Examples

---

# Shader Hot Reload

Editing shader code should automatically:

```text id="ztd5dt"
Compile

↓

Replace GPU Program

↓

Refresh Scene
```

No application restart required.

---

# Shader Cache

Introduce a Shader Cache.

Responsibilities:

* Avoid duplicate compilation.
* Share GPU programs.
* Recompile only when source changes.
* Dispose unused shaders.

---

# Built-in Shaders

Ship several default shaders.

Examples:

```text id="t5h62m"
Image

Tint

Grayscale

Sepia

Glow

Outline

Ripple

Water

Blur

Gradient

Noise

Dissolve
```

These provide immediate examples and testing assets.

---

# Renderer Integration

Pixi Renderer becomes:

```text id="fp6esx"
Asset

↓

Material

↓

Shader

↓

Uniforms

↓

GPU
```

The renderer no longer assumes image-only rendering.

---

# Shader Inspector

Display:

General

Shader

Uniforms

Compile Status

Performance

---

# Performance Information

Display:

```text id="pjlwmv"
Compiled

GPU Program

Compile Time

Uniform Count

Texture Count
```

Useful for debugging.

---

# Commands

Introduce:

```text id="ovv1cz"
CreateShaderCommand

DeleteShaderCommand

AssignShaderCommand

CompileShaderCommand

SetShaderUniformCommand

OverrideShaderUniformCommand

ReloadShaderCommand
```

---

# Events

Emit:

```text id="mu3gjh"
ShaderCreated

ShaderCompiled

ShaderCompilationFailed

ShaderAssigned

UniformChanged

ShaderReloaded
```

---

# Performance

Requirements:

* Uniform changes update in real time.
* No shader recompilation when only uniforms change.
* GPU programs are reused.
* Compilation occurs asynchronously where possible.
* Multiple objects sharing a shader share the same compiled GPU program.

---

# Testing

Unit tests should verify:

## Compilation

* Valid shader compiles.
* Invalid shader reports errors.

---

## Uniform Reflection

Verify all supported uniform types are detected correctly.

---

## Assignment

Assign shaders to materials.

Verify rendering updates.

---

## Uniform Editing

Change:

* float
* color
* vector

Verify renderer updates immediately.

---

## Overrides

Verify instance overrides function correctly.

---

## Cache

Verify identical shaders compile only once.

---

## Serialization

Save project.

Restart.

Verify shaders and uniform values restore correctly.

---

# Manual Verification Checklist

## Import

Import a GLSL shader.

Verify it appears in the Shader Library.

---

## Assignment

Assign shader to a material.

Verify object appearance changes.

---

## Uniform Editing

Modify:

```text id="r8whpd"
Radius

Strength

Color
```

Verify live updates.

---

## Shader Source

Introduce a syntax error.

Verify compile error appears with the correct line number.

Fix the error.

Verify shader recompiles automatically.

---

## Shared Materials

Assign one shader material to multiple objects.

Modify a shared uniform.

Verify all linked objects update.

Override a uniform on one object.

Verify only that object changes.

---

## Performance

Open several objects using the same shader.

Verify only one GPU program is compiled and reused.

---

## Persistence

Save the project.

Restart.

Verify:

* Shaders restored.
* Materials restored.
* Uniform values restored.
* Overrides restored.

---

# Deliverables

After Step 15, the editor includes:

* Shader library
* GLSL shader assets
* Shader compilation pipeline
* Automatic uniform reflection
* Uniform inspector
* Live shader preview
* Shader hot reload
* Shader caching
* Material integration
* Shared and overridden shader parameters
* Built-in shader collection
* Comprehensive shader error reporting

Shader graphs, multi-pass rendering, and compute shaders are intentionally deferred.

---

# Definition of Done

Step 15 is complete when:

* Users can assign custom GLSL shaders to materials and edit their uniforms through the Inspector with immediate visual feedback.
* The renderer efficiently manages compiled GPU programs, sharing shader resources whenever possible and recompiling only when shader source changes.
* Shader compilation, validation, caching, and error reporting are fully integrated into the editor, providing a professional shader development workflow.
* The rendering architecture is now ready for advanced visual effects such as water, metaballs, procedural backgrounds, particle rendering, transition effects, and AI-generated shaders without requiring further architectural changes.
