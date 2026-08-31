# ADR 0002 — Audio Asset Scope: Global Library vs Project-Embedded

Date: 2026-09-01
Status: Accepted
Deciders: MKoth + Muse Spark
Context: Handoff #1 items 2 & 3 (global vs project, inspector parity), Spec 15.08 follow-up
Amends: ADR 0001 §3 (AudioAsset reuses EmbeddedAsset)

## Context

ADR 0001 stored `AudioAsset` only as `EmbeddedAsset` in `Project.embeddedAssets` → `LessonJSON.library.assets`. Images use a dual path: global `asset_definitions` in SQLite (`assetLibraryStore` + `assetLibrarySync` + `importer` + `assetSnapshot`) plus project-embedded snapshots for portability. Audio initially bypassed the global path: `AssetsPanel` created `CreateAudioAssetCommand` directly (project-only). User request: imported/dropped audio should persist globally like images, recorded audio stays project-only, `.lesson` remains self-contained.

## Decision

1. **Imported audio goes global.** `AssetsPanel.handleImportFiles` for `audio/*` now calls `assetLibraryStore.importFiles` → `POST /api/assets` → backend `asset_definitions` with `category='audio'`, `mime_type` (`audio/wav`|`audio/mpeg`|…), and `asset_metadata` (`duration`, `sampleRate`, `channels`, `waveformPeaks` via `probe_audio_metadata`). `ImagePipeline` already sniffs WAV/MP3/OGG/WEBM and creates a generic thumbnail. No `CreateAudioAssetCommand` for imports. Backend remains single `asset_definitions` table, filtered by `AudioAsset.isAudioDefinition`.

2. **Recorded audio stays project-only.** `RecordModal` → `CreateAudioAssetCommand` → `Project.embeddedAssets` with `audio/*` mime, never enters `assetLibraryStore`. No backend mirroring.

3. **Referenced global audio is snapshotted on export/download.** New `engine/missingAssets.collectReferencedAudioAssetIds` + `app/assetSnapshot.captureAudioSnapshot`/`ensureReferencedAudioEmbedded` fetch `original_url`, base64-encode, and `engine.embedAsset` with `metadata` preserved. Called in `EngineProvider` persistence `ensureEmbedded` and `lessonTransfer.downloadLessonCopy` alongside existing `ensureReferencedEmbedded` for images. `LessonJSON.library.assets` thus contains both image and audio embedded snapshots for portability; slim files still readable via fallback fetch.

4. **Playback supports both scopes.** `SyncedAudioController.ensureBufferForAsset` tries `engine.getEmbeddedAsset` first (base64 decode via `decodeAudioData`), then `assetLibraryStore.definitions` (fetch `original_url` → `decodeArrayBuffer`). `AudioBufferCache` LRU shared. `AudioTimelineBody` drop resolves duration from either source and, for global assets, triggers `captureAudioSnapshot` so the lesson becomes self-contained immediately.

5. **Inspector parity.** `AssetsPanel` now shows `AudioEmbeddedPreview` (project-only) and `AudioGlobalPreview` (global) with `WaveformCanvas`, `formatDurationBadge`, delete (`DeleteAudioAssetCommand` for embedded, `assetLibraryStore.deleteAsset` for global), audition (`HTMLAudioElement` via `data:` URL or `original_url`), and “Save between projects” promotion (embedded → global via `importFiles` from decoded `Blob`). Filter chips `[All|Images|Audio]` include both stores. New `DeleteAudioAssetCommand` (`engine/project.deleteEmbeddedAsset` + `Engine.deleteEmbeddedAsset` + `EnginePublic` exposure) is undo-recorded.

## Alternatives Considered

- **All audio embedded only** — rejected: loses global reusability, duplicates bytes per project, diverges from image model.
- **All audio global only** — rejected: recorded takes would pollute global library, privacy, and require immediate backend round-trip.
- **Separate `library.audioAssets` top-level array** — rejected: duplicates `EmbeddedAsset` path, extra serializer branches, breaks self-contained `library.assets` convention.
- **No snapshotting (reference-only .lesson)** — rejected: breaks portability requirement; lesson would be broken after global delete, unlike images.

## Consequences

- `.lesson` files remain self-contained for both images and audio; global audio deletions do not break imported lessons that have been saved.
- Audio timeline drag works for both `AUDIO_ASSET_MIME` ids (embedded and global); playback fetches missing buffers lazily.
- `AssetsPanel` Audio filter shows `BackendAudioCell` (global) + `AudioAssetCell` (embedded) with unified selection and previews.
- New command and snapshot helpers are covered by `assetSnapshot.test.ts` extension and manual Audio tab verification steps in handoff.

## Links

- Handoff: `/var/folders/.../handoff-audio-next.md` §2 & §3
- ADR 0001: `docs/adr/0001-audio-prompter-data-model.md`
- Code: `frontend/src/components/panels/AssetsPanel.tsx`, `frontend/src/app/assetSnapshot.ts`, `frontend/src/audio/syncedAudioController.ts`, `frontend/src/engine/missingAssets.ts`, `frontend/src/components/panels/AudioTimelineBody.tsx`, `frontend/src/engine/commands/deleteAudioAssetCommand.ts`
