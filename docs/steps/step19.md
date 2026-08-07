# Step 19 – AI Lesson Planning & Storyboard Generation

## Goal

Implement the **AI Planning System**, allowing the AI to transform a learning objective into a complete lesson storyboard before any assets or animations are created.

Unlike Step 18, where the AI only answered questions, the AI now becomes a **creative planning assistant**. It analyzes the educational topic, proposes a teaching strategy, generates a slide-by-slide storyboard, identifies required assets, and explains the reasoning behind each slide.

The AI still **does not modify the project automatically**. Every proposal is reviewed and explicitly accepted by the user before becoming part of the project.

This planning-first workflow mirrors how human instructional designers work and provides a strong foundation for future AI-driven slide generation.

---

# Success Criteria

At the end of this step:

* ✅ Users can ask the AI to create a lesson.
* ✅ AI generates a complete storyboard.
* ✅ AI explains the educational reasoning behind the lesson.
* ✅ AI proposes slide titles and durations.
* ✅ AI identifies required assets.
* ✅ AI identifies reusable animation clips.
* ✅ AI identifies missing assets.
* ✅ Users can review the proposal before importing it into the project.

The AI does **not** create slides or assets yet.

---

# Scope

Implement:

* Lesson planning
* Storyboard generation
* Slide planning
* Asset planning
* Animation planning
* Proposal viewer
* Plan persistence

Do **not** implement:

* Slide generation
* Asset generation
* Shader generation
* Scene editing
* Timeline editing
* Project modification

---

# Architectural Principle

The AI produces **plans**, not editor commands.

```text id="6l81pn"
User Request

↓

AI Planner

↓

Lesson Plan

↓

User Review

↓

Accepted Plan
```

Editor modifications begin in a later step.

---

# Planning Workflow

Typical interaction:

```text id="4wjlwm"
User

↓

"I want to teach Spanish Present Tense."

↓

AI analyzes the topic.

↓

AI proposes a storyboard.

↓

User reviews.

↓

User approves.
```

Only after approval will later steps generate slides.

---

# Lesson Plan

Introduce a Lesson Plan model.

Fields:

* id
* title
* description
* language
* estimated duration
* learning objective
* teaching strategy
* slides

Future:

* difficulty
* prerequisites
* target audience
* curriculum mapping

---

# Storyboard

The storyboard is the primary output.

Example:

```text id="jlwm101"
Lesson

↓

Slide 1

Introduction

↓

Slide 2

Present Tense

↓

Slide 3

Yo

↓

Slide 4

Tú

↓

Slide 5

Él / Ella

↓

Slide 6

Summary
```

Each slide includes an explanation of its purpose.

---

# Slide Proposal

Each proposed slide contains:

* Title
* Goal
* Estimated duration
* Explanation
* Suggested narration

Example:

```text id="jlwm102"
Slide

Title

Yo Corro

Goal

Introduce first-person singular.

Duration

12 seconds.
```

---

# Teaching Strategy

The AI should explain *why* the lesson is structured this way.

Example:

```text id="jlwm103"
Start with a real-world concept (time),
introduce pronouns,
demonstrate one form at a time,
reinforce with repetition,
finish with a summary.
```

This helps users refine the lesson before investing time in animation.

---

# Asset Planning

For every slide, the AI proposes required assets.

Example:

```text id="jlwm104"
Clock

Boy

Speech Bubble

Running Character

Arrow

Text Label
```

Each asset is classified as:

* Existing Asset
* Missing Asset
* Optional Asset

---

# Material Planning

If appropriate, the AI recommends materials.

Example:

```text id="jlwm105"
Glow Material

Water Material

Speech Bubble Material
```

Recommendations only—no creation yet.

---

# Shader Planning

If beneficial, the AI suggests shaders.

Example:

```text id="jlwm106"
Ripple Shader

Glow Shader

Cloud Shader
```

These are references to future implementation steps.

---

# Animation Planning

For each slide, the AI suggests reusable animation clips.

Example:

```text id="jlwm107"
Fade In

Bounce

Point

Speech Bubble Pop

Clock Tick
```

These should reference existing clips whenever possible.

---

# Missing Resources

The AI identifies gaps.

Example:

```text id="jlwm108"
Missing Assets

Running Girl

Clock Hands

Spanish Flag

Need Image Generation
```

This prepares future AI asset generation.

---

# Proposal Viewer

Create a dedicated planning panel.

Suggested layout:

```text id="jlwm109"
Lesson Overview

↓

Slides

↓

Assets

↓

Animations

↓

Missing Resources
```

The user can inspect the proposal before accepting it.

---

# Editable Plan

Users can edit:

* Lesson title
* Slide order
* Slide duration
* Teaching strategy
* Slide descriptions

before importing into the project.

---

# Revision Loop

Users should be able to refine the proposal conversationally.

Example:

```text id="jlwm110"
Make the lesson shorter.

↓

Replace the running boy with a girl.

↓

Add a practice slide.
```

The AI updates the plan while preserving accepted decisions where possible.

---

# Context

The planner receives:

* Current project
* Existing assets
* Existing materials
* Existing shaders
* Existing animation clips
* Asset library
* User conversation

This enables reuse instead of suggesting duplicates.

---

# Planning Output Format

Internally, the planner should return structured data rather than free-form text.

Suggested top-level structure:

* Lesson
* Slides
* Assets
* Materials
* Shaders
* Animations
* Missing Resources

The UI renders this structure into readable panels.

---

# Commands

Introduce planning commands:

```text id="jlwm111"
CreateLessonPlanCommand

UpdateLessonPlanCommand

DeleteLessonPlanCommand

AcceptLessonPlanCommand

RejectLessonPlanCommand
```

At this stage, accepting a plan stores it but does not yet modify the project.

---

# Events

Emit:

```text id="jlwm112"
LessonPlanCreated

LessonPlanUpdated

LessonPlanAccepted

LessonPlanRejected
```

---

# Persistence

Persist:

* Lesson plans
* Revisions
* User edits
* Acceptance state

Plans become part of the project history.

---

# Performance

Requirements:

* Large lesson plans remain responsive.
* Proposal rendering is virtualized if necessary.
* Revisions reuse existing plan data where possible.
* Context generation minimizes unnecessary token usage.

---

# Future Placeholders

Reserve architecture for:

* Automatic slide creation
* Scene generation
* Asset generation
* Shader generation
* Animation generation
* Narration generation
* Quiz generation
* Video export

---

# Testing

Unit tests should verify:

## Planning

* Lesson plan creation
* Storyboard generation
* Slide generation
* Revision handling

---

## Resources

Verify:

* Existing assets are reused.
* Missing assets are correctly identified.
* Animation recommendations reference available clips when appropriate.

---

## Editing

Verify manual edits to the lesson plan are preserved during AI revisions unless explicitly changed.

---

## Persistence

Save the project.

Restart.

Verify lesson plans and revisions are restored correctly.

---

# Manual Verification Checklist

## Lesson

Ask:

```text id="jlwm113"
Create a lesson explaining Spanish present tense.
```

Verify a complete storyboard is generated.

---

## Slides

Verify each proposed slide includes:

* Title
* Goal
* Duration
* Explanation

---

## Assets

Verify every slide lists required assets.

Confirm existing assets are reused where available.

---

## Animations

Verify suggested animation clips are relevant to each slide.

---

## Missing Resources

Verify the planner identifies assets that are not currently available.

---

## Revision

Ask:

```text id="jlwm114"
Add a practice exercise after the Tú slide.
```

Verify the storyboard updates without losing unrelated slides.

---

## Persistence

Restart the application.

Verify lesson plans remain available for further editing.

---

# Deliverables

After Step 19, the editor includes:

* AI lesson planner
* Structured storyboard generation
* Slide proposals
* Teaching strategy explanations
* Asset planning
* Material recommendations
* Shader recommendations
* Animation clip recommendations
* Missing resource analysis
* Interactive revision workflow
* Proposal viewer
* Persistent lesson plans

Automatic scene creation and project editing are intentionally deferred.

---

# Definition of Done

Step 19 is complete when:

* Users can describe a lesson objective and receive a complete, structured storyboard that explains not only *what* to teach, but also *how* and *why* it should be presented.
* The planner intelligently reuses existing project resources, identifies missing ones, and prepares all information required for automated content generation in later steps.
* Lesson plans remain editable, reviewable, and persistent, establishing a clear separation between AI planning and AI execution while laying the foundation for fully AI-assisted lesson authoring.
