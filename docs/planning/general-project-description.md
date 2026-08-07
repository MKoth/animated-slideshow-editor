# AI Slideshow Editor for Interactive Language Lessons

## Project Overview

The AI Slideshow Editor is a desktop application for creating **animated educational lessons** using reusable visual assets, professional timeline animation, GLSL shaders, and AI-assisted authoring.

Its primary purpose is to make creation of high-quality language-learning lessons dramatically faster while maintaining full creative control.

Unlike traditional video editors, this application is built around the concept of **semantic educational content** rather than raw video editing.

Instead of manually drawing every scene, users assemble lessons from reusable assets that understand their own meaning, behavior, attachment points, animation capabilities, and AI metadata.

The editor combines modern animation tools with AI planning to allow a teacher or content creator to produce professional animated lessons with minimal manual work.

---

# Vision

The long-term vision is to create an AI-powered educational animation platform where a user can describe an entire lesson in natural language and receive a fully animated slideshow that can still be edited manually down to every individual keyframe.

The AI should become a creative assistant—not a replacement for the user.

Every suggestion remains reviewable, editable, and reversible.

---

# Target Audience

The editor is designed for:

* language teachers
* educational content creators
* online course authors
* YouTube educators
* instructional designers
* homeschooling creators
* animation hobbyists
* AI-assisted educational studios

Although the initial focus is language learning, the architecture should support any educational subject.

---

# Core Philosophy

The project follows several fundamental principles.

## AI Assists, Humans Decide

AI proposes.

Users approve.

No automatic modification of projects occurs without explicit confirmation.

---

## Everything Is Reusable

Every created element should become reusable.

Instead of creating artwork for every lesson, users gradually build an ever-growing Asset Library.

The value of the editor increases over time as the library grows.

---

## Metadata First

Images alone are insufficient.

Every asset carries semantic metadata describing:

* what it represents
* how it behaves
* where it can attach
* which animations it supports
* which shaders it accepts
* how AI should use it

This metadata transforms static artwork into intelligent building blocks.

---

## Non-Destructive Editing

Every operation must be reversible.

Users should feel safe experimenting because Undo/Redo, transaction history, and project recovery are always available.

---

## Modular Architecture

The application is built from independent modules with well-defined responsibilities.

Examples include:

* Project System
* Asset Library
* Timeline
* Animation Engine
* Renderer
* Shader System
* AI Planning
* Video Export
* Packaging

Modules communicate through commands and events rather than direct coupling.

---

## Deterministic Behavior

The same project with the same settings should always produce identical results.

This applies to:

* animation playback
* video export
* packaging
* AI command execution
* shader rendering

Deterministic behavior simplifies debugging, testing, and collaboration.

---

# Educational Workflow

A typical workflow consists of the following stages.

## 1. Create a Project

The user creates a new lesson project.

---

## 2. Plan the Lesson

The user collaborates with AI to define:

* learning goal
* lesson structure
* teaching strategy
* storyboard
* individual slides

The AI proposes improvements and alternative scenarios.

---

## 3. Discover Assets

The AI searches the existing Asset Library.

It recommends reusable assets before suggesting creation of new ones.

---

## 4. Generate Missing Assets

If necessary:

* AI generates image prompts.
* The user creates artwork using an external AI image generator.
* Artwork is imported.
* Metadata is added.
* The asset becomes part of the library.

---

## 5. Build Slides

Slides are assembled using:

* reusable assets
* materials
* shaders
* text
* particle systems
* animations

---

## 6. Animate

The timeline editor is used to create:

* movement
* scaling
* opacity
* rotation
* shader animations
* reusable animation clips

---

## 7. Preview

Users preview lessons in real time.

---

## 8. Export

Lessons can be exported as:

* MP4 videos
* reusable project packages

---

# Example Lesson

A lesson explaining Spanish Present Tense might consist of:

Slide 1

A clock appears while narration introduces the concept of actions happening "now."

Slide 2

The pronouns:

* Yo
* Tú
* Él / Ella

appear.

The active pronoun is highlighted.

Slide 3

A running character appears.

The text

```
Yo correr
```

animates into

```
Yo corro
```

The ending fades away while the new ending appears.

Slide 4

Another character enters.

Speech bubbles demonstrate:

```
Tú corres
```

Slide 5

The camera shifts to another person.

The sentence becomes:

```
Él corre
```

Each slide combines reusable assets, animations, shaders, and AI-assisted planning.

---

# AI Responsibilities

The AI is responsible for assisting with:

* lesson planning
* storyboard generation
* asset discovery
* asset prompt generation
* scene composition
* animation suggestions
* metadata suggestions
* shader recommendations
* command generation

The AI never directly modifies project data.

Every modification passes through the Command System and requires user approval.

---

# Asset System

Assets are the foundation of the application.

Examples include:

* characters
* body parts
* fish
* jellyfish
* flowers
* clocks
* books
* speech bubbles
* particles
* decorative objects
* backgrounds

Each asset includes:

* artwork
* pivots
* anchors
* metadata
* shader slots
* animation compatibility

Assets are authored once and reused across countless lessons.

---

# Material System

Materials separate rendering behavior from artwork.

Multiple materials may be applied to the same asset.

Examples:

* glow
* outline
* grayscale
* blur
* dissolve
* water ripple
* highlighting

Materials expose editable shader parameters.

---

# Shader System

GLSL shaders provide advanced visual effects.

Shaders are treated as reusable resources with configurable uniforms and metadata.

Examples:

* highlights
* wave distortion
* dissolve
* fire
* water
* bloom
* outline
* glow
* blur

---

# Timeline System

The timeline provides professional animation editing.

Supported concepts include:

* keyframes
* easing
* curves
* animation clips
* reusable animations
* playback controls

Animations remain fully editable throughout the project lifecycle.

---

# Command System

Every project modification is represented by commands.

Benefits include:

* Undo/Redo
* transactions
* AI editing
* validation
* history
* deterministic behavior

The Command System forms the backbone of the editor.

---

# Rendering Engine

Rendering is performed using:

* PixiJS
* WebGL
* GLSL shaders

This provides high-performance rendering suitable for large animated scenes.

---

# Video Rendering

Projects can be rendered offline into MP4 videos.

Offline rendering guarantees deterministic output independent of display refresh rate.

---

# Project Packaging

Projects can be exported into portable packages containing:

* project
* assets
* materials
* shaders
* metadata
* AI conversations
* lesson plans

A packaged project can be opened on another computer without manual setup.

---

# Technical Stack

Frontend:

* React
* TypeScript
* PixiJS
* React Pixi
* Zustand
* React Flow
* Vite

Backend:

* Python
* FastAPI
* LangGraph
* LangChain

Database:

* SQLite (prototype)
* PostgreSQL (future)

Storage:

* Local filesystem
* Amazon S3 (future)

Rendering:

* PixiJS
* WebGL
* GLSL

Video:

* FFmpeg

AI:

* OpenAI-compatible providers
* Anthropic-compatible providers
* Local models (future)

The architecture is intentionally provider-agnostic.

---

# Long-Term Roadmap

Future versions may introduce:

* direct AI image generation
* AI animation generation
* AI shader generation
* AI voice generation
* narration
* subtitles
* localization
* cloud synchronization
* collaboration
* plugin system
* marketplace
* mobile companion application
* web publishing
* vector asset generation
* skeletal animation
* physics simulation

The current architecture is designed so these capabilities can be added without major redesign.

---

# Project Goals

The project aims to become a professional authoring environment where AI and traditional animation tools work together seamlessly.

Rather than replacing creative work, the application amplifies it by combining reusable assets, semantic metadata, deterministic editing, and AI-assisted planning into a workflow that makes producing educational content significantly faster, more consistent, and easier to maintain.

The result is a platform where a single creator can build an expanding library of intelligent assets and use them to produce polished, animated lessons that would traditionally require a multidisciplinary team of illustrators, animators, and developers.
