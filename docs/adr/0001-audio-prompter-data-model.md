# ADR 0001 — Audio & Prompter Data Model (per-slide, fixed tracks, embed WAV)

Date: 2026-08-31
Status: Accepted (grill #221)
Deciders: MKoth + Muse Spark (wayfinder grill)
Context: Map #218 — Audio Timeline + Prompter

## Context

The editor needs per-slide audio (voice/SFX/music) and a teleprompter that stays in sync with the slide timeline. The domain already fixes Slide as the primary timeline unit (owns Scene + SlideAnimation + fullscreenShader), storage as `.lesson` v2 with embedded `library.assets` base64 blobs, and the engine/store split (engine owns persisted project data + undo, Zustand stores own transient playback/selection).

Research #219 fixed playback = raw Web Audio API (AudioContext currentTime leader + look-ahead scheduler), waveform = dual frontend decode + backend ffprobe peaks, stretch = server FFmpeg rubberband derived asset. Research #220 fixed TTS = Qwen3-TTS 0.6B CustomVoice via MLX on localhost:8000 with `POST /api/tts/generate` and `voice_prompts` SQLite table. Remaining open design was the persisted shape and engine integration.

## Decision

1. **Per-slide ownership.** `Slide` owns `prompter: Prompter | null` (ordered `PrompterPart[]`) and flat `audio: { clips: AudioClip[] }`. Slide remains the one-screenful unit; Audio tab's ruler is per-slide, not a global concat. Migration: absent `prompter`/`audio` → empty.

2. **Fixed three tracks as enum.** `AudioTrackId = 'voice' | 'sfx' | 'music'`. `AudioClip.trackId` is the lane; no track CRUD, no add/remove commands. Keeps drag target unambiguous and export mixing deterministic. Out-of-scope DAW features stay out.

3. **AudioAsset reuses EmbeddedAsset.** `{id, name, data: base64, mimeType: audio/*, metadata: {duration, sampleRate, channels, waveformPeaks?}}` lives in `Project.embeddedAssets` → `LessonJSON.library.assets` (filtered by mimeType) — same mechanism as images. No new top-level `library.audioAssets`. Backend may mirror as `asset_definitions.category='audio'`. Waveforms follow the dual path (#219).

4. **Flat JSON shape (additive, v2 stays).**
   - `SlideJSON.prompter?: { parts: PrompterPartJSON[] }`
   - `SlideJSON.audio?: { clips: AudioClipJSON[] }`
   - `PrompterPartJSON = {id, text, startTime, endTime, duration, audioClipId?, audioAssetId?, promptId?, status?, segments?: AudioSegmentJSON[]}`
   - `AudioSegmentJSON = {id, text, audioClipId, audioAssetId?, order}`
   - `AudioClipJSON = {id, assetId, trackId: AudioTrackId, timelineStart, sourceStart, sourceEnd, volume, muted, fadeIn?, fadeOut?, playbackRate}`
   Additive + validated; validator tolerates missing `audio`/`prompter`/`segments` (backward compat, see Spec 15.10).

5. **Commands vs store.** Every persisted change (create/move/trim/split/duplicate/delete clip, volume/mute/playbackRate, create/update/delete prompter part, `UpdatePrompterPartWithShift`) is an **engine command** grouped as a `Transaction` (one undo entry). Playback (`isPlaying`, `currentTime`, `selectedClipIds`, solo/mute preview) and TTS generation progress are Zustand-only. The "extend duration + optionally shift downstream" operation is a single-Slide transaction that atomically updates one part's duration and shifts `startTime` of later parts and clips.

6. **Non-destructive + v1 cardinality.** `AudioAsset` is immutable; `AudioClip.playbackRate` is the non-destructive stretch flag (server FFmpeg RubberBand produces a derived asset at export, original WAV preserved). v1: `AudioAsset 1—* AudioClip`; `PrompterPart 0..1 AudioClip`. `AudioSegment` was reserved for v1 for future word-level replacement (`Part 1—* Segment`, `[recorded][TTS][recorded]`) — **graduated in v1.1 Spec 15.10 (#238)** to concrete `PrompterPart 1—* AudioSegment {id, text, audioClipId, order}` with `PrompterPart.segments?: AudioSegment[]` stored additively in `SlideJSON.prompter.parts[].segments`. Fallback `Part 1—* Segment` split without AudioSegment (pure PrompterPart split) was considered but not chosen for TTS replacement; full AudioSegment model is now materialised, additive and backward-compatible (missing `segments` → empty). **Pure PrompterPart split without AudioSegment is retained for manual word-boundary split without TTS** (Spec 15.10 follow-up: `SplitPrompterWordsCommand` → up to 3 silent PrompterParts, no AudioClip/AudioSegment, gap-free reflow, old clip deleted, asset preserved). Chosen shape noted here per #238 contingency.

7. **TTS abstraction.** Frontend `engine/ttsProvider.ts: interface TTSProvider { generate(req): Promise<AudioAsset> }` wrapping `api/ttsApi.ts` → `api/apiClient.ts#postForWav` → `POST /api/tts/generate` (→ `audio/wav`). Voice prompts live in `voice_prompts` SQLite via `/api/voice-prompts` (global, shared). Switching providers = swapping backend impl behind the same endpoint.

8. **Engine files (thin scaffold).** New: `engine/audioClip.ts` (AudioClip + AudioTrackId + validators), `engine/prompter.ts` (Prompter + PrompterPart + reflow + AudioSegment), `engine/ttsProvider.ts` (interface). Edit: `engine/slide.ts`, `engine/json.ts`, `engine/lessonSerializer.ts`, `engine/librarySection.ts`. `engine/commands/replacePrompterWordsCommand.ts` (Spec 15.10) + `WordLevelTtsModal.tsx` implement word-level replacement. No separate `audioAsset.ts`/`audioTrack.ts` classes — they are type alias + enum.

## Alternatives Considered

- **Project-global audio partition by slideId** — rejected: breaks per-slide mental model, indirection for every clip lookup.
- **Dynamic tracks** — rejected: DAW scope creep, track CRUD UX, indeterminate export mix; enum is forward-compatible via migration if ever needed.
- **Separate `library.audioAssets`** — rejected: duplicates binary path, extra serializer branches for no gain.
- **Nested `audioTracks: [{clips}]`** — rejected: duplicates lane knowledge, complicates move-across-tracks and `BlockedBy` in JSON.
- **Introducing AudioSegment in v1** — rejected: no concrete UI yet; premature join complexity.
- **No TTSProvider interface (direct fetch)** — rejected: provider swap would churn all call sites; one-file abstraction isolates it.

## Consequences

- Lesson files remain self-contained (embedded WAV) and backward-compatible (missing audio fields → empty).
- TimelinePanel / audio tab can share `timelineViewStore` ruler; drag from Asset Panel's Audio section creates an `AudioClip` at drop time (single command).
- Undo covers all persisted audio/prompter edits; playback stays non-undoable as intended.
- Export can deterministically mix Voice+SFX+Music + animation frames (per Research #219/#220).
- Scaffold ticket (#227) can implement the model without ambiguity; downstream grills (#222–#226) are unblocked.

## Links

- Map: #218
- This grill: #221
- Research: #219 (browser audio), #220 (local TTS)
- Glossary: `CONTEXT.md` § Audio & Prompter
- Follow-ups: #222 (Audio tab layout), #223 (Prompter splitting), #224 (Recording flow), #225 (Shared playhead), #226 (Prototype), #227 (Scaffold)
