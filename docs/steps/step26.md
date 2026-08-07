# Step 26 – AI Asset Generation Workflow

## Goal

Implement a complete **Asset Generation Workflow** that guides users from identifying a missing asset to creating a reusable Asset Definition in the Asset Library.

The editor does **not** generate images itself. Instead, it acts as an intelligent orchestration layer that:

1. Identifies missing assets.
2. Helps define exactly what should be created.
3. Generates high-quality prompts.
4. Assists the user in selecting an external image generation service.
5. Imports the resulting artwork.
6. Converts the artwork into a reusable Asset Definition.
7. Adds semantic metadata so the asset becomes part of the AI ecosystem.

This workflow supports multiple image-generation providers and keeps the editor independent of any single AI model or service.

---

# Success Criteria

At the end of this step:

* ✅ Missing assets can enter a generation workflow.
* ✅ AI generates optimized image prompts.
* ✅ Multiple prompt variants are offered.
* ✅ Users can select an external generation provider.
* ✅ Generated artwork can be imported.
* ✅ Imported artwork is converted into an Asset Definition.
* ✅ Metadata creation is guided by AI.
* ✅ New assets immediately become searchable and reusable.

The editor does **not** directly invoke image-generation APIs yet.

---

# Scope

Implement:

* Asset generation wizard
* Prompt generation
* Style guidance
* Provider recommendations
* Import workflow
* Metadata assistance
* Asset Library integration

Do **not** implement:

* Direct image generation
* Automatic background removal
* AI image editing
* Vectorization
* Automatic rigging

---

# Architectural Principle

The editor manages the workflow—not the image generation.

```text id="jlwm701"
Missing Asset

↓

Generation Wizard

↓

AI Prompt

↓

External Generator

↓

Artwork

↓

Import

↓

Asset Playground

↓

Asset Library
```

The generated artwork always passes through the Asset Playground before becoming reusable.

---

# Workflow Overview

Typical workflow:

```text id="jlwm702"
Lesson Planning

↓

Missing Asset

↓

Generate Prompt

↓

Create Artwork

↓

Import

↓

Define Pivot

↓

Define Anchors

↓

Add Metadata

↓

Save Asset
```

---

# Generation Wizard

Create a dedicated Asset Generation Wizard.

Suggested steps:

```text id="jlwm703"
1

Missing Asset

↓

2

Prompt

↓

3

Generation

↓

4

Import

↓

5

Metadata

↓

6

Save
```

Users can move backward and forward between steps.

---

# Prompt Generation

Generate several prompt variants.

Example:

```text id="rgctxqm11"
Top-down koi fish

Highly detailed

White background

Separate object

Soft painted style

Educational illustration

No shadows
```

Offer multiple prompt styles:

* Detailed
* Concise
* Stylized

Users can edit prompts before use.

---

# Style Profiles

Support reusable style profiles.

Examples:

```text id="rgctxqm12"
Watercolor

Flat Cartoon

Paper Cut

Realistic

Vector Style

Hand Painted

Children's Book

Educational Illustration
```

These profiles help maintain visual consistency across projects.

---

# Asset Constraints

The AI should include production constraints in generated prompts.

Examples:

```text id="rgctxqm13"
Top view

Centered

Transparent background preferred

No perspective

Single object

No text

No watermark

High resolution
```

Additional constraints may depend on asset type.

---

# Provider Recommendations

Rather than integrating directly, recommend suitable external tools.

Examples:

* General image generation
* SVG generation
* Character illustration
* Pixel art
* Icon generation

The recommendation should be based on the requested asset type and desired style, while remaining provider-agnostic.

---

# Prompt History

Store prompt revisions.

Users can compare:

* Original AI prompt
* Edited prompt
* Final prompt used

This makes it easier to iterate on assets later.

---

# Import Workflow

Once artwork is created:

```text id="rgctxqm14"
Generated Image

↓

Import

↓

Asset Playground
```

The existing Asset Playground becomes responsible for preparing the asset.

---

# Asset Preparation

Reuse Step 21 functionality:

* Set pivot
* Create anchors
* Define bounding box
* Preview transforms

No duplicate implementation should be created.

---

# AI Metadata Assistant

After import, the AI suggests metadata.

Examples:

* Name
* Category
* Tags
* AI description
* Compatible animations
* Shader slots
* Attachment rules

The user reviews and edits before saving.

---

# Quality Checklist

Before saving:

Verify:

* Background removed (if required)
* Pivot configured
* Anchors defined
* Metadata complete
* Thumbnail generated

Warn users about incomplete assets but allow saving when appropriate.

---

# Asset Variants

Allow optional grouping of related assets.

Example:

```text id="rgctxqm15"
Koi Fish

↓

Blue

↓

Orange

↓

White

↓

Golden
```

Variants share metadata where appropriate while maintaining separate artwork.

---

# Conversation Integration

Link generated prompts back to the AI conversation.

Example:

```text id="rgctxqm16"
Conversation

↓

Prompt

↓

Artwork

↓

Asset
```

Users can understand why an asset was created and regenerate it later if needed.

---

# Commands

Introduce:

```text id="rgctxqm17"
StartAssetGenerationWorkflowCommand

GenerateAssetPromptCommand

ImportGeneratedArtworkCommand

CreateAssetFromArtworkCommand

ApplySuggestedMetadataCommand

FinishAssetGenerationWorkflowCommand
```

These orchestrate the workflow without depending on a specific AI provider.

---

# Events

Emit:

```text id="rgctxqm18"
AssetGenerationStarted

PromptGenerated

ArtworkImported

MetadataSuggested

AssetCreatedFromArtwork

AssetGenerationCompleted
```

---

# Persistence

Persist:

* Prompt history
* Selected style profile
* Imported artwork reference
* AI metadata suggestions
* Workflow progress (if interrupted)

Users can resume an unfinished workflow later.

---

# Performance

Requirements:

* Prompt generation should be near-instant.
* Large imported images should load efficiently.
* Metadata suggestion should not block the UI.
* Thumbnail generation should occur asynchronously.

---

# Future Placeholders

Reserve architecture for:

* Direct AI image generation
* Background removal
* Image upscaling
* Image editing
* Multi-image generation
* SVG generation
* Automatic rigging
* Automatic pivot detection
* Automatic anchor detection
* Style transfer

---

# Testing

Unit tests should verify:

## Prompt Generation

Verify multiple prompt variants are produced and editable.

---

## Import

Verify imported artwork enters the Asset Playground correctly.

---

## Metadata

Verify AI-generated metadata suggestions populate editable fields.

---

## Variants

Verify asset variants can be grouped and managed correctly.

---

## Persistence

Restart the application.

Verify unfinished workflows, prompt history, and imported artwork references are restored.

---

# Manual Verification Checklist

## Missing Asset

During lesson planning, identify a missing asset.

Select:

```text id="rgctxqm19"
Generate Asset
```

Verify the Asset Generation Wizard opens.

---

## Prompt

Generate prompts.

Verify multiple editable prompt variants are displayed.

---

## External Generation

Copy a prompt into an external image-generation tool.

Create the artwork.

Import it back into the editor.

Verify the image appears in the Asset Playground.

---

## Preparation

Configure:

* Pivot
* Anchors
* Bounding box

Verify transform previews behave correctly.

---

## Metadata

Review AI-suggested:

* Tags
* Category
* AI description
* Animation compatibility

Modify if necessary and save.

---

## Library

Save the asset.

Verify it appears in the Asset Library.

Rerun Asset Discovery.

Verify the previously missing asset is now recognized as available.

---

## Reuse

Create a new lesson requiring the same asset.

Verify the AI recommends the newly created asset instead of suggesting generation again.

---

# Deliverables

After Step 26, the editor includes:

* Asset Generation Wizard
* AI prompt generation
* Prompt history
* Style profiles
* Production constraints
* Provider recommendations
* Artwork import workflow
* AI-assisted metadata creation
* Asset variant support
* Full Asset Playground integration
* Asset Library integration
* Conversation traceability

Direct AI image generation and automated image processing are intentionally deferred.

---

# Definition of Done

Step 26 is complete when:

* Users can move seamlessly from a missing asset to a reusable Asset Definition using a guided, AI-assisted workflow.
* The system generates high-quality prompts, assists with metadata, and integrates imported artwork into the existing asset ecosystem without duplicating functionality.
* Newly created assets immediately participate in discovery, planning, scene construction, and future AI workflows, completing the full asset lifecycle from concept to reusable library component.
