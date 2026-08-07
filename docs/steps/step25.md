# Step 25 – AI Asset Discovery & Recommendation System

## Goal

Implement an **AI Asset Discovery System** that analyzes lesson plans, storyboards, and scene composition to determine which assets are already available, which can be reused, and which are missing.

Instead of immediately generating new artwork, the AI should first maximize reuse of the existing Asset Library. This minimizes duplication, keeps projects visually consistent, and significantly reduces generation costs.

The AI acts as an intelligent librarian before becoming an artist.

---

# Success Criteria

At the end of this step:

* ✅ AI searches the Asset Library automatically.
* ✅ Existing assets are ranked by relevance.
* ✅ Missing assets are identified.
* ✅ Alternative assets are suggested.
* ✅ Similar assets are grouped.
* ✅ Asset recommendations include explanations.
* ✅ Users can accept or reject recommendations.
* ✅ Discovery integrates into lesson planning and AI editing workflows.

No asset generation is implemented yet.

---

# Scope

Implement:

* Asset search
* Semantic search
* Recommendation engine
* Missing asset detection
* Similarity ranking
* Recommendation panel
* Asset replacement suggestions

Do **not** implement:

* Asset generation
* Image generation
* Automatic downloads
* Marketplace search
* Internet search

---

# Architectural Principle

The AI should always attempt to **reuse before creating**.

```text id="jlwm601"
Lesson Plan

↓

Required Assets

↓

Asset Discovery

↓

Existing Assets

+

Missing Assets

↓

User Review
```

Generation is the final option, not the first.

---

# Discovery Workflow

Typical workflow:

```text id="jlwm602"
Lesson Plan

↓

Need:

Running Boy

↓

Search Asset Library

↓

Found:

Running Child

Running Student

Walking Boy

↓

Recommend Best Match
```

If no acceptable match exists:

```text id="jlwm603"
Missing Asset

↓

Recommend Generation
```

---

# Search Sources

Initially search:

* Asset Library
* Metadata
* Tags
* AI descriptions
* Categories
* Animation compatibility

Future:

* Shared libraries
* Marketplace
* Cloud repositories

---

# Search Strategy

The discovery engine should combine multiple signals:

1. Exact name matches
2. Tag similarity
3. Category compatibility
4. AI description similarity
5. Anchor compatibility
6. Animation compatibility
7. Shader compatibility

No single signal should determine the final ranking.

---

# Semantic Search

Rather than relying solely on names, use semantic understanding.

Example:

```text id="jlwm604"
Need:

Running Boy

Library:

Young Student

↓

High Match
```

Another example:

```text id="jlwm605"
Need:

Clock

Library:

Watch

↓

Partial Match
```

Semantic similarity allows the AI to recommend assets even when names differ.

---

# Recommendation Scores

Each recommendation includes a confidence score.

Example:

```text id="jlwm606"
Running Boy

98%

Running Student

91%

Walking Child

76%

Standing Boy

43%
```

Scores are informational and should not be treated as absolute.

---

# Recommendation Explanation

Every suggestion should explain *why* it was selected.

Example:

```text id="jlwm607"
Running Student

Matched because:

Character

Running animation compatible

Front-facing

Suitable scale

Has Left/Right Hand anchors
```

This helps users trust AI decisions.

---

# Missing Assets

Assets that cannot be matched become Missing Assets.

Example:

```text id="jlwm608"
Need:

Clock Hands

Status:

Missing

Recommendation:

Generate Asset
```

These feed directly into future AI asset generation workflows.

---

# Similar Assets

Group visually or semantically similar assets.

Example:

```text id="rgctxqm2"
Characters

Boy

Girl

Teacher

Student
```

This helps users choose replacements manually.

---

# Asset Alternatives

Allow users to substitute one recommendation for another.

Example:

```text id="rgctxqm3"
Recommended

Running Boy

Replace With

Running Girl
```

The AI updates subsequent recommendations accordingly.

---

# Recommendation Panel

Create a dedicated Asset Discovery panel.

Suggested layout:

```text id="rgctxqm4"
Required Assets

↓

Recommended Matches

↓

Missing Assets

↓

Alternatives
```

Users can review before making changes to the project.

---

# Context

The discovery engine receives:

* Current lesson plan
* Storyboard
* Active slide
* Existing Asset Library
* Metadata
* AI descriptions
* Animation library
* Material library

This ensures recommendations are consistent with the current project.

---

# Similarity Engine

Introduce a pluggable similarity engine.

Initial implementation may use:

* Keyword matching
* Tag overlap
* Embedding similarity (optional)

Design the interface so future implementations can switch to vector databases or external embedding services without changing editor code.

---

# Embeddings (Future-Ready)

Although not required initially, design the metadata model to support semantic embeddings.

Potential future workflow:

```text id="rgctxqm5"
Asset Metadata

↓

Embedding Generator

↓

Vector Index

↓

Semantic Search
```

This will enable highly accurate AI recommendations as the library grows.

---

# Commands

Introduce:

```text id="rgctxqm6"
RunAssetDiscoveryCommand

AcceptAssetRecommendationCommand

RejectAssetRecommendationCommand

ReplaceAssetRecommendationCommand
```

These update planning state rather than modifying scenes directly.

---

# Events

Emit:

```text id="rgctxqm7"
AssetDiscoveryStarted

AssetRecommendationsReady

MissingAssetsIdentified

AssetRecommendationAccepted

AssetRecommendationRejected
```

---

# Persistence

Persist:

* Discovery results
* User-selected replacements
* Accepted recommendations
* Rejected recommendations

Discovery can be rerun whenever the Asset Library changes.

---

# Performance

Requirements:

* Discovery should complete quickly for typical projects.
* Searches should scale to thousands of assets.
* Recommendation ranking should be cached where appropriate.
* Semantic search should degrade gracefully if embeddings are unavailable.

---

# Future Placeholders

Reserve architecture for:

* AI asset generation
* Internet asset search
* Marketplace integration
* Cloud asset libraries
* Automatic metadata generation
* Embedding-based similarity
* Style compatibility scoring
* Visual similarity search

---

# Testing

Unit tests should verify:

## Search

* Exact name matches
* Tag-based matches
* Category filtering

---

## Ranking

Verify recommendations are ordered by relevance.

---

## Missing Assets

Verify unmatched assets are correctly classified as missing.

---

## Alternatives

Verify users can replace recommendations and the planning state updates accordingly.

---

## Persistence

Save and reload the project.

Verify discovery results and user decisions are restored.

---

# Manual Verification Checklist

## Existing Asset

Create a lesson requiring:

```text id="rgctxqm8"
Running Boy
```

Verify the system recommends an existing compatible asset if one exists.

---

## Similar Asset

Search for:

```text id="rgctxqm9"
Clock
```

Verify similar assets such as watches or timers are suggested when appropriate.

---

## Missing Asset

Request:

```text id="rgctxqm10"
Medieval Castle Gate
```

If no suitable asset exists, verify it appears in the Missing Assets section.

---

## Explanation

Select a recommendation.

Verify the UI explains why it was chosen, including matching metadata and compatibility.

---

## Replacement

Replace a recommended asset with another compatible asset.

Verify the lesson plan updates to use the selected replacement.

---

## Library Update

Import a new asset that satisfies a previously missing requirement.

Rerun discovery.

Verify the missing asset is replaced by the newly imported asset.

---

# Deliverables

After Step 25, the editor includes:

* AI Asset Discovery engine
* Metadata-driven search
* Semantic recommendation framework
* Missing asset detection
* Recommendation explanations
* Similar asset grouping
* Replacement workflow
* Asset Discovery panel
* Future-ready embedding architecture
* Persistent recommendation state

AI asset generation, external asset sources, and marketplace integration are intentionally deferred.

---

# Definition of Done

Step 25 is complete when:

* The AI consistently reuses existing assets before proposing new ones, reducing duplication and improving project consistency.
* Users receive clear, explainable recommendations for existing assets, suitable alternatives, and genuinely missing resources during lesson planning and AI editing.
* The discovery architecture is scalable, metadata-driven, and prepared for future semantic search, vector embeddings, cloud libraries, and AI-generated assets without requiring fundamental redesign.
