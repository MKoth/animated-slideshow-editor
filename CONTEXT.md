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
A scene node's position, rotation, and scale plus an optional local pivot; the single source of placement for every node; parenting composes transforms.

**Local Pivot**:
The normalized offset of a node's rotation/scale origin from its bounds center, in the range [-0.5, 0.5] with (0,0) at center (IDENTITY_PIVOT). Static in v1 (not keyframable); changing it recomputes position to keep world placement stable.
_Avoid_: Anchor offset, pivot point

**Bounding Box**:
The axis-aligned world bounds of a scene node; the rectangle the canvas selection outline draws.
_Avoid_: Bounds rect

**Handles**:
The on-canvas gizmos on a selected node's bounding box: 8 resize handles (4 corners uniform, 4 edges axial) and 1 rotation handle above top-center. They respect the node's local pivot; Shift locks aspect, Alt scales from center.
_Avoid_: Grips, controls

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
A scene node component carrying grid configuration: an ordered list of column width definitions, plus inherited defaults for gap, borderColor, borderWidth, borderRadius (default 0), and padding. The table node owns TableRowComponent children; it does not carry cell data or content directly. Outer border is drawn as a PixiJS Graphics roundedRect when radius > 0; the table renderer delegates child rendering to the scene renderer.
_Avoid_: Table node, grid component

**Table Row Component**:
A scene node component for a row within a table. Carries optional borderColor, background, and borderRadius overrides (inheriting defaults from the parent table). Row height is set by the grid layout command. The row owns TableCellComponent children. No per-row gap — gap stays on the table to preserve column alignment.
_Avoid_: Row node

**Table Cell Component**:
A scene node component for a cell within a row. Carries colSpan and rowSpan (both default 1), optional borderColor, background, borderRadius, and padding overrides (padding inherits from table if absent). Column position is implicit — the cell's index among its row's children determines the column. Cells may contain zero or more child nodes with no truncation or wrapping. Borders are drawn per-cell as roundedRect when radius > 0.
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

**Circle Component**:
A procedural shape component carrying radius, startAngle and endAngle (degrees, 0..360 wedge from +X CCW), and segments. Renderer generates a triangle-fan MeshData on demand with radial UVs; start/end are animatable and UV transform applies.
_Avoid_: Arc, pie shape

**Texture Attachment**:
The operation attaching an asset-definition image to any mesh-like node (mesh or circle) by setting its material texture and rewriting or transforming UVs to map the image onto the geometry.
_Avoid_: UV mapping, assign texture

**UV Transform**:
The per-instance material parameters controlling how a texture maps onto geometry: uvScale {u,v}, uvOffset {u,v}, and fitMode (stretch | cover | contain). Default scale 1,1 and offset 0,0 with stretch; static v1, animatable later.
_Avoid_: UV scale, texture offset

**Material Instance**:
The per-node rendering settings (tint, opacity multiplier, shader-uniform values, and UV transform) owned by every renderable node — asset instances, text nodes, and procedural shapes alike. References a material definition and may override its parameter defaults.
_Avoid_: Style, fill color

**Material Definition**:
A reusable library resource: a parameter set (tint, opacity multiplier, and any shader's uniforms) that every referencing node inherits. Instances override parameters; scenes never edit the definition.
_Avoid_: Style preset, material type

**Shader Definition**:
A reusable library resource holding a fragment shader and its uniform defaults. Applied per-node through a material, or per-slide as a fullscreen effect over the rendered scene.
_Avoid_: Effect, filter

**Shader Source**:
The fragment GLSL text of a Shader Definition plus its uniform declarations. Immutable in the library; per-node or per-slide overrides only affect uniform values, never the source. Editing forks a new definition.
_Avoid_: Shader code (ambiguous)

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
An animated property inside an animation clip (one of the uniform six plus visible and circle angles and morph coefficient), existing while it has at least one keyframe. Keyframe times and values are normalized to the clip (`morphCoefficient` normalized to [0,1] like `opacity`; bespoke lane like `visible`, not a `ClipChannelDef` property).
_Avoid_: Track, clip property

**Clip Extraction**:
The workflow that copies a selection of node keyframes (time/value/interp/tangents) into a new or existing animation clip, normalizing time to clip range [0,1] and value to [0,1] where applicable (including `morphCoefficient`). Non-destructive copy; invoked via timeline right-click “Add to clip” modal. `morphCoefficient` keyframes layer on the target node's `MorphBinding {fromShapeId,toShapeId}` at apply time; shape ids are not stored in the clip and must resolve in the target scene (missing → warn + fallback to base mesh).
_Avoid_: Bake to clip, export keyframes

**Clip Collection** (also **Rig Animation**, **Hierarchical Clips**):
A named grouping of per-node clips bound by semantic name: a map from semanticName → clipId plus parent id. Export walks a parent subtree collecting each node's clip instances (including `morphCoefficient` clips); apply walks a target subtree and broadcasts each clip to all nodes matching the semantic name. No morph-specific naming convention — the same `semanticName` (e.g. `left_hand`) carries any morph clip; binding remains node-local (`MorphBinding` stays on `NodeAnimation`, not in the clip).
_Avoid_: Animation set, pose library

**Scale Group** (also **Group Node** alias):
An empty scene node used as a parent to uniformly scale a rig and its animations without breaking relative motion; clips remain in local space and compose via world transform. No new component — reuses Rig Handle / Locator primitive.
_Avoid_: Scale container, multiplier node

**Visible Track**:
The boolean visibility animation track on a scene node. Interpolates with hold only (no tween); eye icon toggles base value or adds a hold keyframe at playhead in animation mode.
_Avoid_: Opacity zero, hide track

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

### Audio & Prompter

**AudioAsset**:
An immutable reusable audio resource: an id, name, `data` (base64 WAV/MP3), `mimeType` (`audio/wav`, `audio/mpeg`, …), and `metadata {duration, sampleRate, channels, waveformPeaks?}`. It is the binary unit — never mutated after creation. Dual scope: imported audio lives globally in backend SQLite `asset_definitions` (`category='audio'`, `mime_type` `audio/*`, `asset_metadata`) via `assetLibraryStore` and `POST /api/assets` (like images); recorded/take audio lives project-only as `EmbeddedAsset` in `Project.embeddedAssets` / `LessonJSON.library.assets` (filtered by `audio/*` mimeType) via `CreateAudioAssetCommand`. Referenced global audio is snapshotted into `Project.embeddedAssets` on save/download (`captureAudioSnapshot`/`ensureReferencedAudioEmbedded`) so `.lesson` remains self-contained. Playback resolves either scope (`SyncedAudioController` → embedded base64 or fetch `original_url`). Duration/peaks are cached so thumbnails don't require decoding on every open.
_Avoid_: Audio file, sound asset (ambiguous vs AudioClip)

**AudioClip**:
The placement of an AudioAsset on a Slide's timeline: `{id, assetId, trackId, timelineStart, sourceStart, sourceEnd, volume, muted, fadeIn, fadeOut, playbackRate, pitchSemitones?, noiseReduction?, uvTransform?}`. `trackId` is the fixed `AudioTrack` enum (`voice` | `sfx` | `music`); `sourceStart/sourceEnd` define the kept contiguous interval (trim to selection; middle delete splits into two clips); `volume` ∈ [0,1]; `playbackRate` and `pitchSemitones` (-12..+12) are non-destructive speed/pitch flags baked via FFmpeg RubberBand at export; `noiseReduction` (0..1) is a non-destructive flag. Clips are stored flat as `slide.audio.clips[]`.
_Avoid_: Audio region, audio block

**Audio Effects**:
The non-destructive per-clip audio parameters: pitchSemitones, noiseReduction (and future eq), plus trim interval. Original AudioAsset immutable; preview via Web Audio OfflineAudioContext, bake at export. Middle-interval deletion splits a clip into two; length mismatch after effects prompts a dialog (stretch rubberband vs trim/shift PrompterPart).
_Avoid_: Audio filter, destructive edit

**Waveform Editor**:
The modal editor for an AudioClip showing its waveform: edits sourceStart/sourceEnd (including split on middle delete), pitch, noiseReduction, and audition; on save with derived duration mismatch, offers Stretch / Trim PrompterPart / Shift Downstream choices.
_Avoid_: Sound editor, audio modal

**AudioTrack**:
One of three fixed lanes a Slide owns: Voice, SFX, or Music. Not a dynamic entity — the `AudioTrackId` enum enumerates the only legal values for `AudioClip.trackId`. One lane each; no add/remove track commands. Export mixes the three lanes deterministically.
_Avoid_: Channel, bus, lane (dynamic)

**Prompter**:
The per-Slide teleprompter document: `Prompter { parts: PrompterPart[] }` — an ordered, gap-free list owned by the Slide, stored as `slide.prompter`. Each part maps a text span to time (`startTime`, `endTime`, `duration`) and lies on the same horizontal time axis as audio clips. Array order equals time order (`parts[i].startTime === parts[i-1].endTime` gap-free by default; `reflowPrompter` recomputes `startTime` as prefix sum of `duration`s on any mutation). Import auto-splits on `prompter.splitChars`; empty prompter → `parts: []`.
_Avoid_: Script, narrator script

**PrompterPart**:
One contiguous textual unit inside a Prompter: `{id, text, startTime, endTime, duration, audioClipId?, audioAssetId?, promptId?, status?, segments?}` with invariant `duration = endTime - startTime` (validator within 1e-6). v1 cardinality is 0..1 AudioClip per part (linked via `audioClipId`); the part's text maps to that clip's utterance. Since v1.1 (Spec 15.10) a PrompterPart may contain `segments: AudioSegment[]` (0..n) for word-level replacement — each segment owns its own AudioClip. Text splitting uses `splitChars = [.,;:!?\\n—]` (project setting `prompter.splitChars`, `prompter.secondsPerCharacter` default 0.2); import one-pass splits, consecutive delimiters collapsed, no empty parts. Manual ops: Split Left/Right/Out are whitespace-aware cursor-on-word splits (preserving spacing, discarding whitespace-only pieces) and Unite/Merge concats with single space and `duration = sum`. Duration estimation `charCount * secondsPerCharacter` (including spaces); on Split durations redistribute proportionally to charCount, on Merge sum, on text edit auto-re-estimates only if no audio attached — otherwise `status='stale'` and duration frozen until resolved. Editing a part's duration with “shift downstream” atomically shifts later parts and clips in one Slide command (`UpdatePrompterPartWithShift`). Word-level replacement (Spec 15.10) selects arbitrary words inside a part and replaces them with TTS, splitting the host part into up to three PrompterParts plus AudioSegments [recorded][TTS][recorded] via `ReplacePrompterWordsCommand` as a single Transaction — original AudioAsset preserved non-destructively, gap-free reflow, stale cleared on new binding. Manual word-boundary split without TTS (Spec 15.10 follow-up) selects a contiguous word range via click / Shift+click and splits the host part into up to three silent PrompterParts (no AudioClip/AudioSegment creation) via `SplitPrompterWordsCommand` as a single Transaction — contiguous range yields a single new block, durations redistribute proportionally, old AudioClip deleted (asset preserved), gap-free reflow, `segments` omitted, one undo step.
_Avoid_: Sentence chip (UI term), cue

**secondsPerCharacter**:
The project-level duration estimator for PrompterParts: `estimatedDuration = charCount * secondsPerCharacter`, default 0.2s. Stored as `settings.prompter.secondsPerCharacter`; overridden per-part by explicit `duration` edits. Drives import and proportional split redistribution.
_Avoid_: reading speed, chars-per-second

**AudioSegment**:
The word-level subdivision of a PrompterPart's utterance for Spec 15.10 word replacement. `AudioSegment {id, text, audioClipId, audioAssetId?, order}` where `order` is the time order (0..n-1 equals array index, validated sequential, duplicates rejected) and `id` is globally unique across the Slide's Prompter. Cardinality `PrompterPart 1—* AudioSegment 1—1 AudioClip` — each segment owns exactly one AudioClip. Example “The butterfly flies gracefully” selecting “butterfly” → three PrompterParts each with one AudioSegment [recorded][TTS][recorded], each segment owning its clip (outer recorded re-use original AudioAsset, middle TTS uses generated asset), original AudioAsset preserved, reflow gap-free, stale cleared, undo is one Transaction. Fallback split without AudioSegment (Part 1—* Segment) was considered but not chosen — full AudioSegment model is materialised (see ADR 0001 update).
_Avoid_: Using this term for v1 clips without segments

**Voice Prompt** (also **TTS Voice Prompt**):
A reusable text preset for local TTS generation: `{id, title, instruction, language?, voice?, params JSON}`. Persisted server-side in SQLite `voice_prompts` (CRUD at `/api/voice-prompts` on `localhost:8000`), shared across all Slides — not stored in `.lesson` and not localStorage.

**TTSProvider**:
The frontend abstraction over local speech synthesis: `interface TTSProvider { generate(req: {text, promptId?, language?, voice?, instruction?}): Promise<AudioAsset> }`. Concrete implementation `TtsApi` calls `POST /api/tts/generate` (→ `audio/wav` bytes) via `ApiClient.postForWav`; backend owns the model singleton (Qwen3-TTS 0.6B CustomVoice via MLX, Apache 2.0) and serializes inference. Swapping providers = swapping backend impl behind the same endpoint.

### Rig & Skeleton

**Bone**:
A scene-node–backed joint in a skeleton hierarchy. Owns a transform; parenting composes transforms. Bones form a chain via parent linkage; the tail of a parent is the origin of its child in the default snap.
_Avoid_: Joint (ambiguous)

**Skeleton**:
The bone hierarchy owned by a rigged mesh. One root bone per mesh; children form chains. Evaluated by the rig system to deform mesh vertices via weight maps.
_Avoid_: Armature, rig (overloaded)

**Weight Map**:
Per-mesh, per-bone scalar weights in [0,1] on vertices that drive deformation. Painted via brush; normalized when the user requests it, not per-dab.
_Avoid_: Skin weights (synonym), vertex group

**Weight Paint** (also **Weight Brush**):
The mesh-space brush that adds or erases a bone's influence. Operates by raycasting faces (not vertices) and applying within a screen-space radius with falloff (`weight += strength*(1 - dist/radius)` toward 1, erase lerps toward 0). Strength is symmetric for add/erase; erasure is Shift/Alt modifier.
_Avoid_: Vertex paint (overloaded)

**IK Handle**:
A scene node that drives an IK chain: moving the handle solves the chain's bone rotations to reach it. One-way constraint — the handle's transform drives the chain; FK manipulation of the chain does not move the handle.
_Avoid_: IK effector, controller

**Pole Vector** (also **Pole Target**):
The auxiliary transform controlling the elbows/knees of an IK chain (the plane of the solution). Like an IK Handle, it is a one-way driver that follows its own parent, not the chain.
_Avoid_: Vector handle

**Rig Handle** (also **Group Node**, **Locator**, **Scale Group**):
An empty scene node (no mesh, only transform) used to group a rig — mesh, skeleton root, IK handles, and pole vectors — under one transform for rigid moves and uniform scaling of the whole setup. Reuses Scene Node composition; moving/scaling the handle composes with all children in one Transaction. Clips remain local.
_Avoid_: Rig root object, master bone

**Parenting Mode**:
The policy applied when reparenting a bone or node: `Keep World Transform` (recompute local so world position stays, default) vs `Snap to Parent Tail` (child local reset to 0 at parent's tail, legacy rigging snap). Chosen per reparent via intercept dialog that remembers last choice per session; the operation acts on the dragged root, its descendant chain follows rigidly.
_Avoid_: Parent type

**Shape**:
An absolute per-mesh snapshot of all rest vertices sharing the mesh's topology. A `Shape {id, name, vertices: MeshVertex[]}` lives inside `MeshComponent.shapes`; `faces`/`uvs`/`boneWeights`/`bindPose` are not duplicated per Shape and `shape.vertices.length === mesh.vertices.length` is invariant. Shapes are node-owned and embedded in `NodeJSON` (and copied into `ReusableObjectJSON` and `LessonJSON` via `SlideAnimation` sidecars), never in `library`/`embeddedAssets`.
_Avoid_: Morph target, blendshape (topology-varying)

**Morph**:
The one-active-at-a-time lerp between any two Shapes on the same mesh, defined by `Morph {fromShapeId, toShapeId, coefficient}` with `coefficient` in [0,1] (exaggeration beyond 1 allowed in preview). Evaluated as `lerp(from.vertices[i], to.vertices[i], coefficient)` on rest vertices before `evaluateMeshDeformation` (morph then bones), deterministic per frame for preview and Video Export. `coefficient` is the `morphCoefficient` track on `NodeAnimation` with static sidecar `MorphBinding {fromShapeId,toShapeId|null}` (one lane, visible-pattern); clip and collection portability animates only the coefficient — the binding stays node-local and soft-warns if shape ids are missing on the target.
_Avoid_: Blend, shape key

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

### Naming

**Unique Name**:
The per-scene unique display name of a scene node. User-renamable, validated with block-on-duplicate (inline error); history and scene tree show it. Uniqueness scoped to the slide's scene.
_Avoid_: Label, id

**Semantic Name**:
An optional, repeatable tag on a scene node used only for hierarchical clip binding (e.g. left_hand). Many nodes may share it; Clip Collection apply broadcasts to all matches.
_Avoid_: Tag, category

### Object Library

**Reusable Object** (also **Component**, **Object**):
An exported subtree of scene nodes (including descendants, bones, IK handles, pole vectors, materials, clip bindings, Shapes, and morph tracks where applicable) serialized as a `.lesson_object` JSON file. Stored both as downloadable file and as a library entry in the “Objects” panel; import copies the subtree into the active slide with new node/clip/collection ids and remapped shape ids, and snapshots definitions into Project.embeddedAssets. May include or reference a Clip Collection; `MeshComponent.shapes` are embedded in `nodes[].components.mesh.shapes` and `SlideAnimation` carries `morphBinding`/`morphTrack` per node, with referenced morph clips/collections in `library`.
_Avoid_: Prefab, template

### Content authority

**Definition / instance separation**:
Definitions (asset, material, shader) are reusable and immutable; instances belong to a project and override parameters. Projects embed snapshots of the definitions they reference at placement; library definitions stay shared for new placements.
