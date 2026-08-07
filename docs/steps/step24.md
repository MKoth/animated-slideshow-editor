# Step 24 – Project Packaging & Portable Project Format

## Goal

Implement a **portable project packaging system** that allows complete projects to be exported as a single file and imported on another computer without manual asset management.

A package should contain everything required to reproduce the project:

* project data
* slides
* assets
* materials
* shaders
* animation clips
* metadata
* AI conversations
* lesson plans
* thumbnails

A packaged project should behave identically after being imported.

This is the foundation for sharing projects, versioning, backups, cloud synchronization, marketplace distribution, and collaborative workflows.

---

# Success Criteria

At the end of this step:

* ✅ Projects can be exported into a single package.
* ✅ Packages can be imported.
* ✅ All project assets are restored automatically.
* ✅ References remain intact.
* ✅ Version compatibility is supported.
* ✅ Package validation is performed.
* ✅ Missing dependencies are reported.
* ✅ Packages are deterministic.

Cloud synchronization and collaboration are intentionally postponed.

---

# Scope

Implement:

* Project packaging
* Package import
* Package validation
* Versioning
* Dependency collection
* Thumbnail generation
* Integrity checking

Do **not** implement:

* Cloud sync
* Incremental packages
* Marketplace publishing
* Encryption
* Digital signatures
* Team collaboration

---

# Architectural Principle

A package is a **self-contained snapshot** of a project.

```text id="jlwm501"
Project

↓

Dependency Collector

↓

Package Builder

↓

Project Package

↓

Package Importer

↓

Project
```

The project should not depend on external files after packaging.

---

# Package Format

Introduce a dedicated package extension.

Suggested extension:

```text id="jlwm502"
.lessonproj
```

Internally, this is a ZIP archive with a defined directory structure.

Using a standard ZIP container keeps the format inspectable and simplifies tooling.

---

# Package Contents

The package contains:

```text id="jlwm503"
project.json

slides/

assets/

materials/

shaders/

animations/

metadata/

ai/

thumbnails/

preview.png

manifest.json
```

Future additions:

* audio/
* subtitles/
* fonts/
* translations/

---

# Manifest

Create a manifest describing the package.

Contains:

* package version
* project name
* creation date
* application version
* asset counts
* dependency summary

Example:

```text id="jlwm504"
Project

Spanish Present Tense

Version

1.0

Assets

124

Slides

18
```

---

# Project Data

Persist:

* Slides
* Scene hierarchy
* Timeline
* Keyframes
* Materials
* Shader assignments
* Animation clips
* Metadata
* Lesson plans
* AI conversations
* Export settings

Everything required to reopen the project should be included.

---

# Dependency Collection

Before packaging, scan the project graph.

Collect:

* Images
* Materials
* Shaders
* Animation clips
* Metadata
* Thumbnails

Unused resources should not be included by default.

Future option:

```text id="jlwm505"
Include Unused Assets
```

---

# Asset Packaging

Every referenced asset includes:

* image
* metadata
* thumbnail
* pivots
* anchors
* shader slots
* AI description

Asset IDs must remain stable during export/import.

---

# Shader Packaging

Include:

* GLSL source
* metadata
* default uniforms

Compiled GPU binaries are **not** packaged.

Shaders are recompiled after import.

---

# Material Packaging

Include:

* material definitions
* shader references
* parameter values
* overrides

---

# Animation Packaging

Include:

* animation clips
* timelines
* easing
* curves
* parameters

---

# AI Packaging

Persist:

* conversations
* lesson plans
* accepted proposals
* execution history

This allows users to continue collaborating with the AI after importing the project.

---

# Preview Image

Automatically generate:

```text id="jlwm506"
preview.png
```

Displayed in:

* File Open dialog
* Recent Projects
* Marketplace (future)

---

# Validation

Before export:

Verify:

* Missing assets
* Broken references
* Duplicate IDs
* Invalid metadata
* Unsupported versions

Warnings should be shown before packaging.

---

# Import Workflow

Typical flow:

```text id="jlwm507"
Select Package

↓

Validate

↓

Import

↓

Rebuild Library

↓

Open Project
```

---

# Version Compatibility

Every package stores:

* package format version
* editor version

Importers should:

* load older versions when possible
* migrate outdated data automatically
* warn about unsupported future versions

---

# Package Migration

Introduce migration infrastructure.

Example:

```text id="jlwm508"
Version 1

↓

Migration

↓

Version 2
```

Each migration should be incremental and testable.

---

# Integrity Checking

During import:

Verify:

* ZIP structure
* manifest
* checksums (optional)
* required files
* valid JSON

Reject corrupted packages gracefully.

---

# Missing Dependencies

If a package is incomplete:

Display:

* missing assets
* missing shaders
* missing materials

Allow import to continue only when recovery is possible.

---

# Export Dialog

Provide options:

```text id="jlwm509"
Include Preview

Compress Images

Include Unused Assets

Package Name
```

Future options:

* password protection
* compression level

---

# Commands

Introduce:

```text id="jlwm510"
ExportPackageCommand

ImportPackageCommand

ValidatePackageCommand

MigratePackageCommand
```

These commands affect project lifecycle rather than project content.

---

# Events

Emit:

```text id="jlwm511"
PackageExportStarted

PackageExportCompleted

PackageImported

PackageValidationFailed

PackageMigrated
```

---

# Persistence

The package becomes the canonical portable representation of a project.

Internal working files remain unchanged until the imported project is explicitly saved.

---

# Performance

Requirements:

* Packaging should not freeze the UI.
* Large assets should stream into the archive.
* Import should rebuild project indices efficiently.
* Thumbnail generation should be asynchronous.

---

# Future Placeholders

Reserve architecture for:

* Cloud synchronization
* Incremental packages
* Shared asset repositories
* Marketplace publishing
* Team collaboration
* Package encryption
* Digital signatures
* Dependency deduplication

---

# Testing

Unit tests should verify:

## Export

Create a package.

Verify all referenced resources are included.

---

## Import

Import a package.

Verify the project opens without missing references.

---

## Validation

Verify corrupted manifests, missing files, and invalid package versions are detected correctly.

---

## Migration

Import an older package.

Verify automatic migration updates the data model successfully.

---

## Integrity

Corrupt a packaged asset intentionally.

Verify the importer reports the problem clearly.

---

## Determinism

Export the same project twice without changes.

Verify the package contents are logically identical (allowing for timestamps if applicable).

---

# Manual Verification Checklist

## Export

Open a completed project.

Choose:

```text id="rgctxqm"
Export Project Package
```

Verify a `.lessonproj` file is created.

---

## Transfer

Copy the package to another computer.

Import it.

Verify:

* Slides
* Assets
* Materials
* Shaders
* Animations
* Metadata
* AI conversations
* Lesson plans

are restored correctly.

---

## Validation

Attempt to import a corrupted package.

Verify an informative validation error is displayed.

---

## Version

Import a package created with an older editor version.

Verify migration occurs automatically.

---

## Preview

Open the package selection dialog.

Verify the generated project thumbnail is displayed.

---

## Integrity

Compare the imported project with the original.

Verify there are no missing assets or broken references.

---

# Deliverables

After Step 24, the editor includes:

* Portable `.lessonproj` package format
* Project export
* Project import
* Dependency collection
* Manifest generation
* Validation
* Versioning
* Migration framework
* Preview image generation
* Integrity checking
* Self-contained project packages

Cloud synchronization, collaboration, and marketplace publishing are intentionally deferred.

---

# Definition of Done

Step 24 is complete when:

* Users can export an entire project into a single portable package and import it on another computer without manual asset management.
* Every project dependency, including assets, materials, shaders, animations, metadata, lesson plans, and AI history, is preserved and restored correctly.
* The package format is versioned, validated, and designed for long-term compatibility, providing a robust foundation for backups, sharing, cloud storage, collaboration, and future marketplace distribution.
