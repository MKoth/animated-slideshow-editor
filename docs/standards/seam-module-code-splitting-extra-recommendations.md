I actually think this is one of the most important design decisions for a long-lived project. One thing I'd change from my previous proposal is **not to organize around folders first, but around seams (modules)**.

A seam is simply a place where one module can be replaced without affecting the rest of the system.

For example:

```
Timeline
        ↓
Animation Engine
        ↓
Renderer
```

The renderer should never know how the timeline is stored.

---

# General Rules

## Module Size

A module should answer **one question**.

Examples:

```
Asset Library

Timeline

Animation Engine

Project Persistence

Scene Graph

Shader Compiler
```

Not

```
EditorUtils

Common

Helpers

Manager
```

Those tend to become dumping grounds.

---

## File Size

Recommended limits:

* 200–300 lines → ideal
* 400 lines → acceptable
* 500+ lines → split
* 1000+ lines → redesign

A large class is usually hiding multiple responsibilities.

---

## One Public Type Per File

Prefer:

```
Scene.ts
SceneNode.ts
AnimationTrack.ts
Timeline.ts
Asset.ts
```

instead of:

```
Scene.ts

class Scene
class SceneNode
class Animation
class Timeline
class Keyframe
class Material
...
```

---

# Frontend Entry Points

```
src/

main.tsx
```

Bootstraps React.

↓

```
App.tsx
```

Creates providers:

* Theme
* Query
* Zustand
* Router

↓

```
EditorPage.tsx
```

Creates the editor.

↓

```
Editor.tsx
```

Coordinates all editor modules.

---

# The Editor should not do work

Instead of

```
Editor

load project

render scene

select assets

play animation

save project

chat with AI
```

Editor should simply compose modules.

```
Editor

↓

TimelinePanel

↓

Canvas

↓

Inspector

↓

AI Chat

↓

Asset Browser
```

---

# Pixi Engine

```
Renderer

↓

Scene

↓

RenderPass

↓

Materials

↓

Shaders
```

Each should be replaceable.

---

# Scene Graph

Instead of giant Scene class.

```
Scene

SceneNode

Transform

SpriteRenderer

TextRenderer

ParticleEmitter

ShaderComponent

AnimationComponent
```

Each component has its own file.

---

# Timeline

```
Timeline

AnimationTrack

Keyframe

Interpolator

AnimationPlayer
```

Each separate.

Never let Timeline become 2000 lines.

---

# Asset System

Instead of

```
AssetManager.ts
```

Split.

```
AssetLibrary

AssetLoader

AssetMetadata

AssetValidator

AssetImporter

AssetExporter

AssetThumbnailGenerator
```

Each one job.

---

# AI

Very important.

Don't build

```
AiService
```

Instead.

```
PlannerAgent

StoryboardAgent

AnimatorAgent

ReviewerAgent

AssetAgent

ShaderAgent
```

Each one independent.

---

# Prompts

Never inline.

Instead.

```
PlannerPrompt.md

StoryboardPrompt.md

AnimatorPrompt.md

ReviewerPrompt.md
```

Prompt loading service.

```
PromptRepository
```

---

# Backend

Entry point

```
main.py
```

↓

Creates

```
AppFactory
```

↓

Registers

```
ProjectModule

AssetModule

TimelineModule

AiModule

ExportModule
```

Exactly like NestJS modules.

---

# API

Never

```
project_controller.py
```

with 3000 lines.

Instead.

```
create_project.py

delete_project.py

save_project.py

load_project.py
```

Router simply imports them.

---

# Services

Don't build

```
ProjectService
```

that becomes 5000 lines.

Instead.

```
ProjectCreator

ProjectLoader

ProjectSaver

ProjectDuplicator

ProjectExporter
```

Each one class.

---

# Scene Engine

```
Scene

↓

Node

↓

Components

↓

Systems
```

Systems.

```
RenderSystem

AnimationSystem

SelectionSystem

LayoutSystem

ParticleSystem
```

Exactly ECS style.

---

# Shaders

Never

```
Shaders.ts
```

Instead.

```
Shader

ShaderProgram

ShaderCompiler

ShaderLibrary

ShaderUniform

ShaderInstance
```

---

# Timeline Animation

Don't store logic in components.

Instead.

```
AnimationPlayer

↓

evaluates

↓

TrackEvaluator

↓

returns

↓

PropertyValue
```

Renderer only receives values.

---

# Dependency Direction

Always.

```
UI

↓

Editor

↓

Scene

↓

Animation

↓

Renderer
```

Never upward.

Renderer should never import React.

---

# Suggested Naming Convention

Entities (data):

```
Scene
Slide
Project
Timeline
Track
Keyframe
Asset
Material
Shader
Node
```

Behavior:

```
SceneLoader
SceneSerializer
TimelinePlayer
TimelineEvaluator
AssetImporter
AssetExporter
ShaderCompiler
ShaderValidator
ProjectLoader
ProjectSaver
```

Repositories:

```
AssetRepository
ProjectRepository
PromptRepository
```

Factories:

```
SceneFactory
MaterialFactory
NodeFactory
```

Builders:

```
StoryboardBuilder
TimelineBuilder
SceneBuilder
```

Validators:

```
AssetValidator
ShaderValidator
TimelineValidator
```

---

# My Favorite Rule

Every class should complete this sentence:

> **"I am responsible for..."**

If the sentence contains **"and"**, it's usually a sign the class should be split.

For example:

❌

```
ProjectService

"I load projects and save them and export them and validate them and duplicate them..."
```

That's already at least five responsibilities.

Better:

```
ProjectLoader

"I load projects."

ProjectSaver

"I save projects."

ProjectExporter

"I export projects."

ProjectValidator

"I validate projects."

ProjectDuplicator

"I duplicate projects."
```

This style keeps files small, makes AI-assisted development more reliable, and allows modules to evolve independently with minimal coupling. Over time, it also makes refactoring much safer because each seam has a narrow, well-defined responsibility.
