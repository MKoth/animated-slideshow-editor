# AI Slideshow Editor

An interactive slideshow editor for AI-assisted language lessons, rendered in the browser.

## Language

### Scene graph

**Scene Node**:
A node in the scene graph. Owns an id, name, parent, children, transform, and visibility; its kind is defined by the components it carries, not a type field.
_Avoid_: Node type, game object

**Component**:
The unit of a scene node's identity. A node is an asset instance, a text, or a camera by which components it carries (e.g. an asset-instance component, a text component, a camera component).
_Avoid_: Node type enum

**Transform**:
A scene node's position, rotation, and scale. The single source of placement for every node; parenting composes transforms.

**Camera Node**:
The implicit scene node every slide has exactly one of. Its transform drives the viewport (position = pan, scale = zoom); rotation is locked. It is animatable in the timeline like any node.
_Avoid_: Viewport, scene camera object

**Slide**:
The primary organizational unit of a lesson; a timeline whose nodes render to one screenful. A slide owns a name, a duration, an order (its index in the project's slide list), one scene, and the animation data of its nodes.

**Project**:
The root model of the editor: metadata (id, name, description, author, dates, version) plus an ordered list of slides. Exactly one project exists in memory; it serializes to the `.lesson` format.

**Active Slide**:
The slide the renderer, animation evaluator, and timeline currently operate on. Engine state — set through the engine API, never a command; not undoable and not persisted (the first slide is active after load).

**`.lesson` file**:
The portable project representation: a single JSON file holding project metadata, slides (scenes, nodes, keyframes), and the definitions they reference. Self-contained by default: the optional `library` section carries the referenced asset definitions with their image bytes (base64), so the same format stored in the backend and exchanged on download/import restores everything on another machine — including after a library asset is deleted. Slim (reference-only) v1 files remain readable; embedded definitions never appear in the library store. Editor state is never in the file.
_Avoid_: Package file, project file

### Export

**Video Export**:
The flow rendering a whole project to an MP4 video: the browser evaluates every frame through the shared evaluator at exact timestamps and streams it to the backend, which FFmpeg encodes. Deterministic per machine (same machine + settings → pixel-identical frames); the exported frames equal the editor preview per timestamp.
_Avoid_: Rendering, render-to-video

**Export Job**:
The unit of export work — one client-rendered frame stream plus one backend encode, tracked through the `/export/jobs` surface with a single-concurrency rule. Never project data: no commands, no execution-log entries.
_Avoid_: Export transaction, render task

### Content

**Asset Definition**:
An immutable, reusable asset: metadata (name, category, anchors, pivot) plus its image. Lives in the asset library; scenes never edit it. A project embeds a snapshot of each definition its nodes reference at placement — a project-owned copy restored from the file on open, never re-entering the library.
_Avoid_: Asset

**Asset Instance**:
A scene node (or part of one) referencing an asset definition, carrying its own transform, visibility, and material instance. Changing an instance never modifies the definition.
_Avoid_: Asset copy, sprite

**Text Node**:
A scene node that renders text content with a font size and alignment; color and opacity come from its material instance. Text content is edited, not animated, in v1.
_Avoid_: Text label, label

**Table Component**:
A scene node component carrying grid configuration: an ordered list of column width definitions, plus inherited defaults for gap, borderColor, and borderWidth. The table node owns TableRowComponent children; it does not carry cell data or content directly. Borders are drawn as a single outer PixiJS Graphics stroke; the table renderer is a thin container that delegates child rendering to the scene renderer.
_Avoid_: Table node, grid component

**Table Row Component**:
A scene node component for a row within a table. Carries optional borderColor and background overrides (inheriting defaults from the parent table). Row height is set by the grid layout command. The row owns TableCellComponent children. No per-row gap — gap stays on the table to preserve column alignment.
_Avoid_: Row node

**Table Cell Component**:
A scene node component for a cell within a row. Carries colSpan and rowSpan (both default 1), optional borderColor and background overrides, and optional padding override. Column position is implicit — the cell's index among its row's children determines the column. Cells may contain zero or more child nodes (text, morpheme containers, etc.) with no truncation or wrapping; text overflows visually beyond cell bounds. Borders are drawn per-cell by the renderer.
_Avoid_: Cell node

**Grid Layout**:
The engine-side computation that resolves cell positions, column widths, and row heights by walking the table's row and cell child nodes. Fixed columns are sized explicitly; auto columns share remaining space proportionally. Layout writes relative transforms (local to parent) on row and cell nodes via a command, making positions undoable. Recomputed on structure or config change (dirty-flagged), not per-frame.
_Avoid_: Table layout, cell positioning

**Cell Spanning**:
A TableCellComponent feature where individual cells can span multiple columns and/or rows via colSpan/rowSpan. Spanning is layout-only — columns are sized independently; spanned cells sit across resolved columns. No circular width dependencies.
_Avoid_: Merged cells, cell merge

**Anchor**:
A named attachment point defined on an asset definition (e.g. Head, Speech Bubble). Metadata in v1 — nodes attach by parenting, not by anchor.

**Asset Category**:
The canonical classification label on an asset definition: Character, Character Part, Animal, Plant, Object, Background, UI, Decoration, Speech Bubble, Icon, Effect, Particle, Text, or Uncategorized (default). Shared by the asset library, asset authoring, and the AI asset pipeline.
_Avoid_: Fish, Flowers, custom per-step category vocabularies

**Missing Assets Report**:
The reconciliation of a project's asset-definition references against the live library store, run on open/import: references with no definition in the store — and no embedded snapshot in the project — are listed by the affected nodes' names ("Missing Assets: Clock.png, Boy.png"), and the user continues with those nodes rendered as grey-box placeholders on the canvas and marked in the scene tree. Projects are self-contained, so the report applies only to legacy/slim files whose references resolve neither embedded nor store-side.
_Avoid_: Broken asset, unresolved reference

**Material Instance**:
The per-node rendering settings (tint, opacity multiplier, and shader-uniform values) owned by every renderable node — asset instances and text nodes alike. References a material definition and may override its parameter defaults.
_Avoid_: Style, fill color

**Material Definition**:
A reusable library resource: a parameter set (tint, opacity multiplier, and any shader's uniforms) that every referencing node inherits. Instances override parameters; scenes never edit the definition.
_Avoid_: Style preset, material type

**Shader Definition**:
A reusable library resource holding a fragment shader and its uniform defaults. Applied per-node through a material, or per-slide as a fullscreen effect over the rendered scene.
_Avoid_: Effect, filter

**Fullscreen Shader**:
The shader a slide renders its entire scene through; the slide references one, with per-slide uniform overrides.

### Animation

**Keyframe**:
A point on an animated track: an id, a property or channel, a time, a value, an interpolation type (hold, linear, or bezier) governing the segment to the next keyframe, and in/out tangents (control-point offsets in time/value units) used when bezier. Node keyframes use seconds; clip keyframes are normalized (time and value in [0, 1]). The value is a number for the uniform-six properties and clip channels; for material-parameter tracks it carries the parameter's kind shape (number, color hex string, boolean, int, number[] vector, or asset-id string), interpolating linearly for continuous kinds and holding for discrete ones.
_Avoid_: Frame, animation point

**Time Uniform (`uTime`)**:
The reserved shader uniform every shader may declare to receive the slide playhead time in float seconds — deterministic, scrubbable, and identical across render/preview/export; a still playhead freezes it at the playhead. Modeled on the reserved `uTexture`; authors cannot define a conflicting default.
_Avoid_: Clock uniform, uTimeMS

**Interpolation**:
The engine rule for values between keyframes. Six types — hold (constant until the next keyframe), linear, bezier (cubic through tangents), and the parametric family (bounce, elastic, spring). Easing presets (Ease In, Ease Out, Ease In-Out, Quadratic, Cubic, Quartic, Quintic, Back) are named Bezier configurations, not interpolator types; parametric types are grouped separately in the interpolation picker and are rejected on discrete material kinds (int, bool, sampler2D).

**Curve Editor**:
The timeline's second view mode (besides the Dope Sheet): one curve per animated property of the selected node, value vs time, with draggable keyframes and tangent handles.

**Animation Clip**:
A reusable, project-local animation definition: a name, duration, category, parameters, and channels (animated properties with normalized keyframes). Authored once in clip-edit mode and assignable to any node on any slide.
_Avoid_: Animation component, preset animation

**Clip Instance**:
A node's reference to an animation clip: a clip id, start time, speed, enabled flag, and per-parameter overrides. Instances layer on a node in order; a channel owned by several layers resolves to the last layer's output.
_Avoid_: Animation instance

**Clip Parameter**:
A named scalar on an animation clip of one of two kinds — gain (multiplies the channel's base value) or offset (adds to it). A clip channel links to at most one parameter; unlinked channels are absolute. Instances may override a parameter's default.

**Clip Channel**:
An animated property inside an animation clip (one of the uniform six), existing while it has at least one keyframe. Keyframe times and values are normalized to the clip.
_Avoid_: Track, clip property

### AI

**Conversation**:
A project-scoped AI chat thread: an id, title, timestamps, and an ordered list of messages (user/assistant). Persists server-side with the project; never part of the `.lesson` file.
_Avoid_: Chat session, thread

**Lesson Plan**:
A structured, reviewable AI proposal for a lesson: title, description, language, estimated duration, learning objective, teaching strategy, and per-slide proposals (title, goal, duration, explanation, suggested narration, required assets classified existing/missing/optional, recommended clips). Plans are edited and accepted before anything becomes a project; acceptance stores the plan without modifying the project.
_Avoid_: Storyboard, outline

**AI Edit Proposal**:
A reviewable batch of editor commands the AI generates from a natural-language request or an accepted lesson plan: title, description, optional confidence, affected slides, warnings, and the commands themselves. Validated (server-side schema, then a client dry-run against the live engine) and executed only with user approval — wholly, partially, or not at all. Execution dispatches the canonical engine commands; one approved proposal executes as one transaction and links back to the conversation that produced it.
_Avoid_: AI action, edit suggestion

**Context Snapshot**:
The read-only digest of the current project state sent with each AI request: project summary, slide list, scene hierarchy, selection, materials, shaders, animation clips, and asset library names. Regenerated per request, trimmed to a token budget server-side, and never serialized into conversations or the project file.

**Asset Discovery Run**:
One reconciliation pass over a lesson plan's required assets, evaluating its missing-class assets against the library: a backend SQLite record, project-scoped and never in the `.lesson` file, holding per-required-asset verdicts (matched or missing), ranked candidates with match scores and explanations, and accept/reject/replace decisions. The latest run is the authoritative state; older runs remain as history. Acceptance maps a required asset to a library definition so build-from-plan can place it.
_Avoid_: Recommendation, asset search session

**Match Score**:
The weighted server-side similarity a discovery run computes for a required-asset × definition pair, over name, tags, category, and AI description. Candidates above an absolute floor rank as matches; none above the floor means the asset is missing. Informational — scores guide, never gate, user choices.
_Avoid_: Confidence, relevance percentage

**Generation Workflow**:
The guided AI-assisted flow from a missing asset to a reusable definition: a thin wizard (asset info → prompt → import → handoff) producing editable prompt variants under a style profile, importing artwork through the standard upload, then handing off to the Asset Playground for preparation and the Metadata Assistant for suggestions. A backend SQLite record, project-scoped, conversation-linked, and resumable; never part of the `.lesson` file. The editor never generates images itself.
_Avoid_: Asset generation, AI image generation

**Style Profile**:
A named prompt style (e.g. Watercolor, Flat Cartoon) in the global AI settings, selected when generating prompt variants to keep artwork visually consistent across projects.
_Avoid_: Art style, theme

**Prompt Variant**:
One of the three editable drafts (Detailed, Concise, Stylized) a generation workflow produces from the asset's intent under a style profile; the original, the edits, and the final used prompt are kept on the workflow record.
_Avoid_: Prompt, suggestion

**Metadata Assistant**:
The AI step that suggests asset metadata — name, category, tags, AI description, compatible materials and clips, shader slots — from the prompt, style, and intent, never from image pixels (no vision). Suggestions pre-fill only empty fields in the Asset Playground Inspector; nothing is saved until the user's save.
_Avoid_: Auto-metadata, metadata generator

### Undo & history

**Undo Stack**:
The engine-owned record of every executed project-data command, newest first, each carrying its inverse payload. `UndoManager.undo()` replays the top entry's inverse; `redo()` re-applies it. In-memory and session-scoped: cleared on reload and on `openProject`/import, never serialized into `.lesson`.
_Avoid_: Command history, edit history

**History Entry**:
One row of the undo stack: a display name, timestamp, source (User or AI), and — for transactions — the command list it groups. One entry per user gesture or per AI proposal.
_Avoid_: Log record, command item

**Transaction**:
A grouping of commands that undo together as one entry — an AI proposal, a multi-command gesture (e.g. an Inspector numeric drag). Nested transactions collapse to their outer entry; a failed transaction rolls back fully with no partial history.
_Avoid_: Batch, composite command

**History Panel**:
The user-facing timeline view of the undo stack (a bottom-panel tab beside the Timeline): grouped entries, search by name, source filter, AI provenance links. A pure view — selecting an entry never restores state.
_Avoid_: Command History panel, activity log

### Content authority

**Definition / instance separation**:
Definitions (asset, material, shader) are reusable and immutable; instances belong to a project and override parameters. Projects embed snapshots of the definitions they reference at placement; library definitions stay shared for new placements.
