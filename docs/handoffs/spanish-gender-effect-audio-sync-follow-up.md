# Spanish Gender Scenario — Effect Audio Sync Follow-up

## Status

**Root cause found and fixed in code; audible verification still open.** A stale
playhead bug in `SyncedAudioController.handlePlay` delayed every overlapped
effect SFX by the buffer-preload duration on cold Play (see "Fix applied").
Do not call the sound issue fully closed until someone auditions the browser
output — the serialized-timing E2E and the new unit tests still do not prove
audible synchronization.

## Current demo

- Project: `Spanish Gender Scenario` (`project-spanish-gender-1792391757983`).
- Script: `frontend/e2e/fixtures/spanish-gender-lesson.script`.
- The visible `reveal` calls use `writing-on-black-board`; visible `wipe` calls use `dry-erase`. Both use `sound:` on the effect, so planned clips have `timelineStart === effect.start`.
- The 15 short `wipe(... visual: none)` calls at 52s are internal cell-mask setup, not visible erasing; they intentionally have no sound. `mark` and `carry` also have no SFX in this lesson.
- The E2E project clone clears the reference slide's audio clips before creating the demo. It must preserve that behavior.

## Why stale clips survived the earlier clone

`frontend/src/engine/animationScriptRun.ts` deletes audio clips listed in the previous script footprint's `audioClipIds` (and clips in the new footprint before recreation). It intentionally preserves unrelated/manual clips.

The earlier E2E clone deleted `animationScript` metadata but copied `audio.clips`. This detached the reference script's clips from their `lastCompiled.audioClipIds`, making them look like manual clips. The copied clips at 3s (`dry-erase`) and 5s (`writing-on-black-board`) therefore survived Run. The clone now clears inherited clips before running the Spanish script.

## What is verified—and what is not

- The E2E test verifies 27 SFX clips on the `sfx` track at the expected effect start times, with no inherited clips.
- It reruns the same script and verifies the 27 clips are replaced rather than duplicated.
- `frontend/src/engine/animationScriptEffectSound.test.ts` passes (9 tests); the targeted E2E and typecheck also pass.
- **No one has auditioned the browser output or measured the audible onset.** Exact timeline timestamps do not prove the browser playback sounds synchronized.

## Fix applied

- `frontend/src/audio/syncedAudioController.ts` `handlePlay` re-anchors
  `basePlayhead` to the live playback-store time **after** awaiting
  `ensureBuffersForSlide`, instead of using the stale `PlaybackStarted` event
  time. The store's own rAF keeps advancing visuals during the async
  fetch+decode, so the old code replayed every overlapped clip head late —
  audio trailed the visible reveal/wipe by the whole preload gap (hundreds of
  ms cold). Now an overlapped clip resumes mid-slice in sync with the visual.
- `handleSlideSwitch` fire-and-forget warms the incoming slide's decoded
  buffers, so the next Play's preload is usually hot and starts promptly from
  the effect head instead of mid-slice.
- New regression tests in `frontend/src/tests/syncedAudioEffectSync.test.ts`
  (3 tests): stale-base re-anchor (fails before, passes after), warm-Play
  full-slice behavior, and slide-switch warming. Verified RED (2 fail) with
  the fix stashed and GREEN with it applied. Existing
  `audioPlaybackBugRepro` tests and `typecheck` still pass.
- Deliberately **not** changed: `scheduleClip` `when` computation and drift
  polling. Steady-state mixing of `currentTime` base with output-timestamp
  playhead is self-consistent (both sides shift by output latency together),
  so "fixing" it would break audible alignment. Touch only with a real-browser
  measurement in hand.

## Measured asset notes (2026-10-19, backend originals)

- `writing-on-black-board` (mp3, actual ~7.06s decoded) has ~50ms near-silence
  at its head (MP3 encoder padding) then a strong transient — negligible lag
  on its own.
- `dry-erase` (mp3, actual ~4.82s decoded) ramps up over ~150–200ms
  (peak 0–0.1s ≈ 0.009 vs 0.5–1.0s ≈ 0.27) — a genuine soft onset that can
  still read as lag on short wipes even with scheduling fixed. If the soft
  attack survives the scheduling fix in audition, plan effect slices from the
  first onset instead of `sourceStart: 0` (needs onset metadata; the compiler
  only sees durations today).
- Backend `probe_audio_metadata` has no `ffprobe`/`audiowaveform` on this
  machine, so both durations (43.4s / 26.7s) and `waveformPeaks` are
  hash-based fiction (`_estimate_duration_fallback` / `_synthetic_peaks`).
  Harmless for this lesson (fake durations exceed every effect duration, so
  planning still yields one slice per effect), but durations/peaks for MP3
  uploads are wrong in general — separate issue, not fixed here.

## Next investigation

1. Reproduce in the user's playback path and record whether the lag occurs during normal Play, scrubbing/audition, or export. Note one exact effect/time and whether every reveal/wipe or only some of them is affected. Cold first Play (preload gap, now fixed) vs warm replay is the key split.
2. ~~Compare the actual renderer effect start at timeline time `t` with `SyncedAudioController` scheduling~~ — done by analysis: steady-state scheduling is self-consistent; the transient preload gap was the bug and is now anchored. Reopen only with a measured counter-example.
3. ~~Check whether audio buffers are decoded before playback~~ — done: `handlePlay` preloads, and slide switch now warms. Remaining risk is Play-during-warm (in-flight decode returns cold); tick retries, staying in sync via the re-anchored base.
4. Listen to the start of `writing-on-black-board` and `dry-erase` themselves — see "Measured asset notes": dry-erase has a ~150–200ms soft onset that may still read as lag; consider onset-based slice starts if audition confirms.
5. After fixing the actual cause, retain assertions for exact clip starts and rerun-without-duplicates, then add a browser-level playback/audition regression check if the audio harness can observe scheduled onset reliably.

## Reproduction and verification commands

```sh
npm run test:e2e --prefix frontend -- spanish-gender-lesson.spec.ts
npm run test --prefix frontend -- animationScriptEffectSound.test.ts --run
npm run test --prefix frontend -- syncedAudioEffectSync audioPlaybackBugRepro --run
npm run typecheck --prefix frontend
```
