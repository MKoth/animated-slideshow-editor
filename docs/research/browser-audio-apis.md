# Browser Audio APIs for Web Audio Playback, Waveform, and Pitch-Preserving Stretch

**Ticket:** #219 — Research: Browser Audio APIs for Web Audio Playback, Waveform, and Pitch-Preserving Stretch  
**Branch:** `research/browser-audio-apis`  
**Date:** 2026-08-28  
**Status:** Research Complete — decision-ready for Grill: Audio & Prompter Data Model  
**Map:** #218 — per-slide Voice/SFX/Music, embedded WAV, Web Audio shared playhead, server FFmpeg stretch

---

## Executive Summary

| Question | Recommendation |
|---|---|
| **Playback engine** | Raw **Web Audio API** (`AudioContext` + `AudioBufferSourceNode` look-ahead scheduler). Do **not** use `HTMLAudioElement`. Do **not** add **Tone.js**. |
| **Clock sync** | Web Audio hardware clock (`AudioContext.currentTime`) is **leader** for audio; animation evaluator (`playbackStore` rAF) is **follower** for visuals. Use `getOutputTimestamp()` / `currentTime - baseTimestamp` correlation for scrub and `requestAnimationFrame` progress. |
| **Scrub vs preview** | **Two models:** scrub = instant `AudioBufferSourceNode.start(offset)` seeking + analyser freeze; preview = scheduled look-ahead queue against `AudioContext.currentTime`. |
| **Waveform visualization** | **Recording:** `AnalyserNode` (live) + `MediaStreamAudioSourceNode`. **Thumbnails/asset browsing:** **dual generation** — fast frontend `decodeAudioData` peaks for immediate paint + **backend-probed** canonical peaks + duration via `ffprobe`/python `wave` cached in SQLite for export/lesson correctness. |
| **Pitch-preserving stretch** | Keep standing decision: **server FFmpeg `rubberband`** (non-destructive flag + derived asset). Browser WASM (`SoundTouchJS`, `rubberband-wasm`) is viable only for **low-latency preview** if later needed, not as source of truth. GPL licensing blocks commercial bundling of Rubber Band WASM without a paid license. |

---

## 1. Playback: Web Audio vs HTMLAudioElement vs Tone.js

### 1.1 Existing playback model to integrate with

Read against current code:

- `frontend/src/stores/playbackStore.ts:99-165` — `usePlaybackController` drives a single-slide playhead via `requestAnimationFrame` (`tick()`), computing `delta = (performance.now() - lastFrameTimestamp) * playbackSpeed`. Status is `playing | paused | stopped`, times are `Record<string, number>` per slide. Clamping `0..duration` where `duration` comes from `Slide.duration` (`frontend/src/engine/slide.ts:7-8`: `MIN 0.1` .. `MAX 3600`).
- `frontend/src/engine/animationEvaluator.ts:88-132` — `AnimationEvaluator.evaluateNode(slideId, time)` clamps to `[0, slide.duration]` and interpolates keyframes. The node lookup is slide-scoped; multiple slides do not play simultaneously in the current model — one `activePlayback` at a time.

This is a **visual clock** (rAF, `performance.now()`). No audio exists yet. Adding per-slide Voice/SFX/Music lanes means N concurrent buffers per active slide (the 3 fixed tracks, one clip each at a time per standing preference). The playhead must remain single per slide so the evaluator and audio stay coherent.

### 1.2 How Web Audio actually keeps time (primary source)

Per the spec and MDN:

- `AudioContext.currentTime` is a **hardware timestamp** — monotonically increasing, sample-accurate (`samples / sampleRate`), updated once per render quantum (128 samples ≈ 2.9 ms at 44.1 kHz) and exposed as a double with ~15 decimal digits of precision [MDN `BaseAudioContext.currentTime`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime) [W3C Web Audio 1.1 § currentTime](https://www.w3.org/TR/webaudio-1.1/).
- All scheduled times (`AudioBufferSourceNode.start(when, offset, duration)`, `AudioParam.setValueAtTime`) are **relative to `currentTime`** and processed on the **audio rendering thread**, independent of main-thread stalls (layout, GC, XHR). This is the "Tale of Two Clocks" separation: main-thread timers (`setTimeout`/`rAF`) jitter by tens of ms; the audio thread does not [web.dev *A Tale of Two Clocks*](https://web.dev/articles/audio-scheduling) [IRCAM Scheduling Tutorial](https://ircam-ismm.github.io/webaudio-tutorials/scheduling/timing-and-scheduling.html).
- `AudioContext.baseLatency` + `outputLatency` expose total hardware/OS latency; `getOutputTimestamp()` returns `{ contextTime, performanceTime }` correlation to align visual progress with audible output for video-sync use cases [W3C Web Audio 1.1 § getOutputTimestamp/outputLatency](https://www.w3.org/TR/webaudio-1.1/).

**Implication:** scheduling audio with `setTimeout` or by polling `HTMLAudioElement.currentTime` will drift and click. Scheduling against `AudioContext.currentTime` with a look-ahead window is the production pattern.

### 1.3 Candidate comparison

#### Web Audio API — `AudioContext` + `AudioBufferSourceNode` (recommended)

- **Precision:** Sample-accurate. `start(when)` with `when = currentTime + lookahead` (e.g. 0.1 s) queues buffers on the audio thread; a loose `setInterval(25 ms)` that scans `now .. now+0.1` fills the queue and recovers from missed callbacks [web.dev scheduler pattern](https://web.dev/articles/audio-scheduling).
- **Model for this project:** Per-slide `GainNode` per track (Voice/SFX/Music) → master `GainNode` → `destination`. Each `AudioClip` decodes once to an `AudioBuffer` (via `decodeAudioData`), then each playback creates a fresh `AudioBufferSourceNode` (single-use by spec) sharing that buffer [MDN `AudioBufferSourceNode`](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode). Stop/seek = `source.stop()` + create new node at new offset. Volume/mute/solo/fades = `GainNode.gain` automation (`linearRampToValueAtTime`).
- **Duration support:** 0.1–3600 s is natively supported; long clips stay as a single buffer (WAV 1h stereo 48k ≈ 660 MB decoded — see §2 memory note — so long assets should remain file-backed and decoded on demand or rejected >10 min).
- **Autoplay / resume:** `AudioContext` starts `suspended` until a user gesture; every `play()` must `await ctx.resume()` if needed. No other change.
- **Latency hint:** Create with `{ latencyHint: 'interactive' }` (default) for editor preview, or `'playback'` if mixing for export preview needs lower power.
- **Cost:** Zero extra bundle. Built into every modern browser since ~2021 [MDN Baseline Widely available](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).
- **What we give up:** Slightly more plumbing than `<audio>` (manual buffer fetch + decode + node lifecycle).

#### HTMLAudioElement — rejected

- **Why it exists:** Simple long-form streaming (podcasts, background music) with low memory (progressive decode) and native controls [MDN comparison table, Simplified Media](https://simplified.media/guides/web-audio-api).
- **Why it fails here:**
  - **Timing is main-thread, best-effort** — `currentTime` is a double but driven by the media element's own clock, subject to main-thread jitter and buffering stalls; no `currentTime` correlation to the animation evaluator. Multitrack alignment (Voice+SFX+Music) cannot be kept sample-accurate, and seeking is async (`seeked` event).
  - **No per-sample scheduling** — cannot schedule clip start offsets with sample accuracy, nor automate `GainNode` per-clip fades.
  - **Cannot share the Web Audio clock** — wrapping via `MediaElementAudioSourceNode` is one-way (element is the source) but still inherits the element's buffering/latency. Mixing element time + rAF time + animation evaluator creates three competing clocks.
  - **Codec variability** for direct buffer access; waveform extraction requires a second `decodeAudioData` anyway.
- **Use it only if** we need to preview an hour-long file without decoding it. Not needed for typical Voice lines (seconds to a few minutes) and SFX.

#### Tone.js — rejected (do not add)

- **What it is:** Web Audio framework (v15, MIT, ~14k stars) wrapping `AudioContext` via `standardized-audio-context`, providing `Tone.Player`, `Transport`, scheduling, effects, instruments [Tone.js GitHub](https://github.com/Tonejs/Tone.js/) [npm `tone`](https://www.npmjs.com/package/tone).
- **Bundle cost:** `tone` v15 ships as `build/esm` + webpack `build/Tone.js`; unpacked ~5 MB, built bundle cited ~200–450 kB min+gz depending on imports (entire framework). Even tree-shaken single-file imports still pull `standardized-audio-context`. For an editor that only needs scheduled buffer playback + gain, this is a 10× tax over raw Web Audio. The existing `frontend/package.json` has no `tone` dep and Vite already tree-shakes well — adding it bloats every page load.
- **What it would give us:** `Transport` BPM scheduling, `Tone.Buffer`, `Player.sync()`, effects chain — all designed for musical sequencing, not per-slide A/V sync against a Pixi evaluator.
- **What it would cost in correctness:** Tone wraps the clock but does not solve the sync problem; we would still need our own rAF↔AudioContext correlation and per-slide `GainNode` routing. It adds abstraction over the primitive we need direct control of.
- **Verdict:** Revisit only if we later add a **musical** sequencer (MIDI, BPM-grid composition). For narrated slides, raw Web Audio is simpler, smaller, and more debuggable.

### 1.4 Sync architecture against playbackStore / evaluator

**Standing constraint from #218:** per-slide audio, fixed 3 tracks, one lane each, duration 0.1–3600 s, Web Audio shared playhead.

```
┌─────────────────────────────────────────────────────────┐
│ Audio clock (leader)  ── AudioContext.currentTime      │
│ Visual clock (follower) ── playbackStore tick / rAF    │
└─────────────────────────────────────────────────────────┘

On Play(slideId):
  await audioCtx.resume()
  basePerformanceNow = performance.now()
  baseAudioTime      = audioCtx.currentTime
  For each lane (Voice/SFX/Music):
    for each clip with [offset, offset+duration) overlapping [playhead, slide.duration):
      src = ctx.createBufferSource(); src.buffer = clipBuffer
      src.connect(trackGain).connect(masterGain).connect(ctx.destination)
      src.start(baseAudioTime + (clip.offset - playhead),
                clip.trimStart,
                clip.playDuration)

Per rAF tick:
  visualTime = clamp(playhead + (performance.now() - basePerformanceNow)/1000 * speed)
  audioTime  = audioCtx.currentTime - baseAudioTime + playhead
  // Two options for displayed playhead:
  // A) display = visualTime (simple, but may drift ~10-30 ms vs audible)
  // B) display = lerp(display, audioTime, 0.2) each frame, or use getOutputTimestamp()
  // Prefer B for preview; A suffices for editing when not playing.
  evaluator.evaluateNode(nodeId, display)

On Pause/Stop/Seek:
  Stop all active BufferSourceNodes (they are one-shot)
  On seek: recreate nodes whose clip windows cover new offset (see Scrub model)
```

Why leader/follower this way:

- `AudioContext.currentTime` is hardware-sourced; it does not pause when rAF stalls and remains correct across debugger breakpoints. Using it as leader keeps audible rhythm sample-accurate.
- `playbackStore` already clamps to `slide.duration` and emits `CurrentTimeChanged` for the renderer (`frontend/src/stores/playbackStore.ts:139-177`). Keeper pattern: keep emitting from a single updater (the sync loop) so evaluators don't see competing times.
- `getOutputTimestamp().contextTime` vs `currentTime` difference ≈ `outputLatency`; for most sync we can ignore it and display `currentTime`-based progress, but for **export preview** alignment (so exported frames equal preview), query it every rAF tick per spec guidance.

#### Pitfalls checked (primary source)

- `AudioBufferSourceNode` **single-use** — must create a new node per playback/seek; reusing throws [MDN `AudioBufferSourceNode`](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).
- `currentTime` quantizes to 128-sample blocks (≈2.9 ms) — do not micro-compare for equality; treat as monotonically increasing [IRCAM Scheduling](https://ircam-ismm.github.io/webaudio-tutorials/scheduling/timing-and-scheduling.html).
- Firefox `privacy.reduceTimerPrecision` rounds `currentTime` to 2 ms by default (100 ms with fingerprinting resistance) — tolerable for 60 fps (16 ms frame) but do not use sub-ms equality checks [MDN `BaseAudioContext.currentTime: Reduced time precision`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime).
- `AudioContext` suspended until user gesture — `play()` must handle `ctx.state === 'suspended'` via `resume()` (promise).

### 1.5 Scrub vs Preview model

| Mode | Audio behavior | Visual behavior | Implementation sketch |
|---|---|---|---|
| **Scrub** (timeline drag, `stepFrame` 1/60 s) | **No continuous playback.** On `setCurrentTime`/`stepFrame`, stop any preview nodes, then optionally fire a **short audition blip** (50–120 ms) from the seek offset if the user pauses on a clip (create one-shot `BufferSourceNode` with `start(now, offset, 0.08)`). Analyser frozen. | Evaluator clamped `0..duration` synchronously; Pixi re-renders via existing `SceneRenderer.handleTimeChanged` path. | `playbackStore.setCurrentTime` (`frontend/.../playbackStore.ts:192-199`) already emits `CurrentTimeChanged` synchronously — audio layer subscribes via `subscribeEvents` and debounces 30 ms before firing blip so scrub doesn't spam nodes. |
| **Preview** (spacebar / Play) | **Scheduled playback.** Look-ahead scheduler queues all clips whose windows intersect `[audioTime, audioTime+lookahead]` against `currentTime + delta`. Handles looping (`loopEnabled` in store) by re-queuing with wrapped `clip.offset`. | rAF tick updates `visualTime` and re-evaluates; additionally polls `getOutputTimestamp()` every ~100 ms to correct drift between `performance.now()` delta and `audioCtx.currentTime` delta. | Playback store stays the **single playhead store**; audio sync layer owns the `AudioContext` and nodes but derives `playhead` from the same `currentTimes[slideId]`. On `PlaybackFinished`/`PlaybackLooped` events, audio layer restarts or stops nodes accordingly. |

Do not try to drive audio time from `performance.now()` alone — the two clocks will diverge under load or tab throttling. Always read `audioCtx.currentTime` for audible truth and `performance.now()` only for the visual interpolant.

---

## 2. Waveform / Level Visualization

Two distinct needs that are often conflated:

### 2.1 Live recording visualization (microphone input)

- **Source:** `MediaStream` from `navigator.mediaDevices.getUserMedia({ audio: true })`.
- **Graph:** `MediaStreamAudioSourceNode` → `AnalyserNode` → (optional `GainNode` for monitoring) → `destination` (or not, to avoid feedback). The analyser **passes audio unchanged** while exposing frequency/time data [MDN `AnalyserNode`](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode).
- **Visualization APIs:** `analyser.getByteTimeDomainData(Uint8Array)` for oscilloscope waveform, `getByteFrequencyData` / `getFloatFrequencyData` for spectrum, `getFloatTimeDomainData` for higher-precision waveform [MDN `AnalyserNode` methods](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getByteFrequencyData) [MDN `Visualizations with Web Audio API`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API).
- **Defaults:** `fftSize 2048` → `frequencyBinCount 1024`; suitable for 60 fps level bars. For a prompter level meter, 256–512 suffices and reduces canvas cost.
- **No extra library needed** — raw `AnalyserNode` covers it.

### 2.2 Asset thumbnails & timeline waveforms (peaks generation)

This is the "waveform preview for each audio asset" under #218 § "Waveform thumbnail & audio metadata — storage in SQLite vs derived".

#### Option A — Frontend-derived peaks (`AudioContext.decodeAudioData`)

- **How:** `fetch(url).then(r=>r.arrayBuffer()).then(buf=>ctx.decodeAudioData(buf)).then(ab=>ab.getChannelData(0))` — resampled to `AudioContext.sampleRate`, returns `Float32Array` per channel in `-1..1` [MDN `decodeAudioData`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) [Soledad Penadés guide](https://soledadpenades.com/posts/2024/how-to-get-wave-data-from-file/).
- **Peak reduction:** Downsample to N buckets (e.g. `maxLength 800` for thumbnail, 2000 for timeline zoom). WaveSurfer's `exportPeaks({ maxLength: 8000, precision: 10000 })` is the reference reduction (max abs per bucket) and confirms this path is standard [WaveSurfer `exportPeaks` docs](https://wavesurfer.xyz/docs/peaks/) [WaveSurfer `src/wavesurfer.ts` source](https://github.com/katspaugh/wavesurfer.js/blob/main/src/wavesurfer.ts).
- **Pros:** Zero backend work; instant after upload for small Voice lines (seconds); no `audiowaveform` dep.
- **Cons / foot-guns:**
  - **Memory & decode cost scales with duration:** entire file decoded into PCM up front (stereo 48 kHz 1 h ≈ 660 MB `Float32Array`). Fine for 10 s Voice, catastrophic for imported 60 s music if we decode eagerly at timeline zoom levels.
  - **Resampling is context-dependent:** two contexts at different `sampleRate` return different sample values for the same file [MDN `decodeAudioData` resampling note](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData#description).
  - **Main-thread decode blocks** the UI (promise-based but heavy). 10 MB WAV can stall 100–300 ms on mid phones.
  - **Peaks are ephemeral** — lost on reload unless we persist them; deriving every open would be wasteful.

#### Option B — Backend-probed / pre-decoded peaks

- **How:** On `POST /api/assets` import, probe the file with `ffprobe` (or Python `wave`/`mutagen`/ `soundfile`) to extract **canonical metadata**: `duration`, `sampleRate`, `channels`, `codec`, plus **peaks** at fixed density (e.g. 20 px/s, 8-bit via `audiowaveform -i clip.wav -o clip.json --pixels-per-second 20 --bits 8` — the BBC tool pattern cited by WaveSurfer's pre-decoded peaks guide [WaveSurfer Pre-decoded peaks](https://wavesurfer.xyz/docs/peaks/)). Store `peaks JSON` + metadata in SQLite alongside the asset row; serve as `/api/assets/{id}/peaks`.
- **Pros:**
  - Canonical duration/sampleRate decoupled from the browser's `AudioContext.sampleRate` — **lesson correctness** for export concat and for the "derived asset" stretch model (original duration preserved).
  - Instant thumbnail render: frontend receives peaks with duration and paints without fetching/decoding the audio file at all — the **only path for `MediaElement` backends** and the recommended path for long assets [WaveSurfer Pre-decoded peaks: "Supplying pre-decoded peaks sidesteps [decode]"](https://wavesurfer.xyz/docs/peaks/).
  - Scales to hour-long assets (peaks for 1 h at 20 px/s = 72 k floats — trivial).
  - Durable across reloads and embed-able into `.lesson` if needed (small JSON).
- **Cons:** Requires backend dependency (`ffprobe` or `audiowaveform` binary). Must version peaks when assets are replaced.

#### Decision

**Dual generation, backend is source of truth:**

1. **Immediate paint (frontend):** After upload or `loadAudio` for small clips (< ~30 s), decode in the browser with `decodeAudioData` at a low `sampleRate` (e.g. 8000–11025 Hz for waveform only, not playback) and reduce to 800–2000 peaks. Display instantly; in parallel request `GET /api/assets/{id}/peaks` if available and swap to canonical peaks when they arrive (normalization: peaks in `-1..1`, see WaveSurfer normalizer note).
2. **Canonical store (backend):** Generate on import via Python (`wave`/`soundfile` for WAV, `ffprobe` JSON for mp3/ogg) and stash `duration`, `sampleRate`, `channels`, `peaks` (compressed JSON or `BLOB`) in SQLite. Include `peaks` in `AssetDefinitionOut` or a dedicated endpoint. On `.lesson` export, optionally embed peaks alongside the base64 WAV so offline open renders instantly.

This matches the existing asset pipeline pattern already in `backend/app/api/assets.py` and `app/assets/importer.py` — extend the importer to probe after `ImagePipeline`, not a new server.

Do **not** make thumbnail rendering depend on `AnalyserNode` — it is a real-time node that needs a running graph and `requestAnimationFrame` polling [MDN `AnalyserNode` realtime note](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode). For static thumbnails, pre-decoded peaks + Canvas is correct.

Reference mapper: `SoundTouchNode`/`PhaseVocoderNode` for preview pitch (see §3) connects **between** the source and analyser if the timeline wants a stretched preview waveform overlay — but keep the stored peaks un-stretched.

---

## 3. Pitch-Preserving Time-Stretch

Standing decision from #218 grilling: **server-side FFmpeg RubberBand**, non-destructive flag on `AudioClip`, original `AudioAsset` never destroyed — derived stretched asset created alongside.

This section evaluates browser WASM alternatives **for comparison** (preview-only), as requested.

### 3.1 Server FFmpeg RubberBand (recommended, keep)

- **Filter:** `rubberband=tempo=<0.1..8.0>:pitch=<0.1..8.0>` — high-quality time-stretch / pitch-shift, requires FFmpeg built with `--enable-librubberband` [FFmpeg `rubberband` filter docs](https://ayosec.github.io/ffmpeg-filters-docs/8.1/Filters/Audio/rubberband.html) [FFmpeg By Example — Rubberband](https://ffmpegbyexample.com/examples/749f6u35/timestretch_audio_and_video_using_rubberband_filter/).
- **Typical invocation for Voice stretch to fit slide:**
  ```
  ffmpeg -i voice.wav -filter:a "rubberband=tempo=1.25" -c:a pcm_s16le derived.wav
  # keep original; derived is a new AudioAsset linked from AudioClip.derivedAssetId
  ```
  For pitch-corrected speed where video not involved, omit `setpts`; for timeline preview needing matched video rate, combine `[v]setpts=0.8*PTS` with `[a]rubberband=tempo=1.25`.
- **Quality:** Uses the **Rubber Band Library** (breakfastquay, written in C++) — phase-vocoder + transient handling. The FFmpeg binding is the reference quality bar; `atempo` (WSOLA resampler only) pitch-shifts as a side effect and is audibly inferior above 1.2×.
- **Non-destructive model:** Fits the data model directly — `AudioClip { assetId, trimStart, trimEnd, stretchFactor, preservePitch: true, derivedAssetId? }`. Original WAV stays in `.lesson` embedded library; derived is created server-side, cached, and reference-counted. Undo = clearing `derivedAssetId` + deleting derived file if unreferenced.
- **Latency model:** Seconds for a typical Voice line (network + encode + download). Acceptable because stretch is an **edit-time** operation, not a real-time scrub. Model it like shader recompilation: user drags duration, sees non-stretched preview ( §3.2 fallback), then commits → backend job → swaps buffer.
- **Licensing:** FFmpeg itself is LGPL (or GPL if built with GPL parts); Rubber Band Library is **GPL-2.0+ by default, commercial license required for proprietary distribution** [Breakfast Quay licensing page](https://breakfastquay.com/rubberband/license.html). **Self-hosting FFmpeg on our backend** (localhost:8000 owns the operation) avoids distributing Rubber Band to clients, so GPL distribution obligations do not trigger on the frontend bundle. Only the server operator needs to comply (or buy a commercial server license if distributing a commercial appliance — not our web-only case).
- **Ops cost:** Requires `ffmpeg` + `librubberband` on the host image. Verify at startup with `ffmpeg -filters | grep rubberband`. Fallback to `atempo` with a quality warning if missing (rare — `brew install ffmpeg`, gyan.dev full build, and Ubuntu PPA all ship it [FFmpeg Cookbook — Rubberband presence check](https://ffmpeg-cookbook.com/en/articles/change-video-speed/)).
- **Why we keep it:** Deterministic, highest quality, correct licensing posture for web app, and naturally produces artifacts for export mixing (voice+SFX+Music concat rendered via FFmpeg anyway).

### 3.2 Browser WASM alternatives — evaluation for preview only

| Library | What it is | Bundle / Size | License | Quality / Model |
|---|---|---|---|---|
| **SoundTouchJS** (`@soundtouchjs/core`, `@soundtouchjs/audio-worklet`) | Port of Olli Parviainen's SoundTouch C++ (WSOLA) to TypeScript + `AudioWorklet`. `SoundTouchNode` wraps an `AudioWorkletProcessor` with `pitch`/`pitchSemitones`/`playbackRate` `AudioParam`s; core inlined into processor ~23 kB [SoundTouchJS audio-worklet README](https://github.com/cutterbl/SoundTouchJS/blob/master/packages/audio-worklet/README.md) [npm `@soundtouchjs/audio-worklet`](https://www.npmjs.com/package/@soundtouchjs/audio-worklet) | Core + worklet processor ≈ **23 kB compressed** (processor file self-contained), unpacked ~290 kB. Negligible vs Tone.js. | **MPL-2.0** (moved from LGPL) — **commercial-friendly** (file-level copyleft only; dynamic linking / use in proprietary app is allowed). Good standing. | **WSOLA time-domain** — preserves transients well, artifacts (clicks/repeats) above ~2×. Recommended pattern: drive tempo via `source.playbackRate = x` + match `stNode.playbackRate = x`, let SoundTouch correct pitch only — avoids sample starvation in 128-sample worklet blocks [SoundTouchJS "Why playbackRate for tempo?"](https://www.npmjs.com/package/@soundtouchjs/audio-worklet). Supports offline rendering too. |
| **PhaseVocoder worklet** (`@soundtouchjs/phase-vocoder-worklet` + `stretch-phase-vocoder`) | Alternative stretch stage using FFT phase vocoder (2048 FFT, overlap 2/4/8) as drop-in `PhaseVocoderNode` for SoundTouch. Same `AudioParam` API. [SoundTouchJS phase-vocoder README](https://github.com/cutterbl/SoundTouchJS/blob/master/packages/phase-vocoder-worklet/README.md) | Similar size to SoundTouch worklet + FFT overhead. | Same **MPL-2.0** lineage. | **Frequency-domain** — smoother at extreme ratios (<0.5× or >2×), but smears transients ("phasiness"). Higher CPU (FFT per hop) and `fftSize`-sample startup latency. Trade-off table in docs: WSOLA better for voice; phase vocoder better for pad/music. |
| **RubberBand WASM** (`rubberband-wasm` Daninet, `rubberband-web` delude88) | Emscripten build of the actual Rubber Band Library for the browser (AudioWorklet / Worker). [Daninet `rubberband-wasm`](https://github.com/Daninet/rubberband-wasm) [delude88 `rubberband-web`](https://github.com/delude88/rubberband-web/) | **Large: ~1.4 MB unpacked** (npm `rubberband-web` reports ~600 kB processor + 1.4 MB unpack), far heavier than SoundTouch. | **GPL-2.0-or-later** — **commercial-hostile**: bundling the WASM into our web bundle **is distribution** of GPL code to every client, triggering GPL obligations (must ship source, cannot gate behind proprietary license). Commercial use requires buying a RubberBand commercial license per seat/product [Breakfast Quay licensing](https://breakfastquay.com/rubberband/license.html) [ffmpeg.audio.wasm README: "Please respect ... buy a commercial license"](https://github.com/JorenSix/ffmpeg.audio.wasm/blob/master/README.textile). |
| **ffmpeg.audio.wasm (ffmpeg.wasm + rubberband)** | Full FFmpeg in WASM with RubberBand compiled in. | Multi-MB (ffmpeg.wasm core ~10-20 MB). Impractical for editor load. | LGPL+GPL composite + RubberBand GPL — worst licensing posture. | Quality = server equivalent, but load time and licensing kill it. |
| **Native `playbackRate` + `preservesPitch`** | `HTMLAudioElement.preservesPitch` / `AudioBufferSourceNode.playbackRate` with browser pitch-preservation (WSOLA built-in). | 0 kB | N/A | Browser-dependent, no control over quality params; tempo and pitch are coupled. Not suitable for arbitrary stretchFactor on a clip. Mention for completeness only. |

#### Preview-only pattern if we ever want real-time stretched scrub

```ts
// Only if UX demands latency < 200 ms stretch preview
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
// once:
await SoundTouchNode.register(audioCtx)
// per active source:
const src = ctx.createBufferSource(); src.buffer = voiceBuffer
const st  = new SoundTouchNode(ctx)
src.connect(st).connect(trackGain).connect(masterGain).connect(ctx.destination)
// tempo up 25%: feed samples faster, let ST correct pitch
src.playbackRate.value = 1.25
st.playbackRate.value  = 1.25 // auto pitch-compensates
src.start(at, offset)
```

Keep this behind a feature flag (`previewStretch: 'server-only' | 'wasm'`). **Do not persist WASM-stretched audio** — it's for audition; the committed stretch still goes through server FFmpeg so the `.lesson` embedded WAV remains canonical.

#### Recommendation on WASM

| Decision | Rationale |
|---|---|
| **Keep server as source of truth.** | Quality (RubberBand server = reference), licensing (server-side avoids GPL distribution to clients), and data-model fit (derivedAsset is durable, export-mix friendly). |
| **Allow optional SoundTouchJS WASM for preview only** if Grill later says "instant feedback on duration drag matters". | MPL-2.0 is commercial-safe, bundle is small (~23 kB), and AudioWorklet path is correct (not deprecated ScriptProcessor). Do not add until UX proves latency is a problem — premature. |
| **Do not use RubberBand WASM in the web bundle.** | GPL viral + 1.4 MB cost. If someone insists on RubberBand quality in-browser, the answer is "route through server" or purchase a commercial RubberBand license first. |

---

## 4. Integration Checklist (what the builder actually does)

### Audio engine module

```
frontend/src/audio/
  audioContext.ts        — singleton AudioContext + resume-on-gesture + baseLatency/latencyHint
  audioGraph.ts          — GainNodes per track (Voice/SFX/Music) + master, AnalyserNodes
  audioPlaybackSync.ts   — look-ahead scheduler (25 ms tick, 100 ms lookahead),
                           syncs playbackStore rAF progress ↔ AudioContext.currentTime
  audioBufferCache.ts    — fetch + decodeAudioData cache keyed by assetId, LRU
  audioPeaks.ts          — reduce Float32Array → number[] peaks (max-abs per bucket)
  audioStretch.ts        — POST /api/audio/stretch (tempo,pitch,preservePitch) → derived asset id
```

### Feed into existing stores

- Extend `playbackStore.ts` subscription (`subscribeEvents: 'PlaybackStarted'|'CurrentTimeChanged'|'PlaybackStopped'`) to drive `audioPlaybackSync` (no need to replace rAF — add audio sync as a **side-effect subscriber**, not a second clock).
- Add `audioStore.ts` (Zustand) for per-slide `{ assetId, buffer, duration, peaks }` and per-clip `{ offset, duration, gain, mute, stretchFactor, preservePitch, derivedAssetId }`. Keep `Slide` / `Project` engine types thin — see Map #218 "thin scaffold, no full UI" constraint.
- On slide switch, tear down previous slide's nodes (one-shot semantics).

### Backend

- `backend/app/api/assets.py`: extend `AssetImporter` to probe duration/sampleRate/channels + generate peaks JSON; add `GET /api/assets/{id}/peaks`.
- New `backend/app/api/audio.py`: `POST /api/audio/stretch` — accepts `{ assetId, tempo, pitch, preservePitch }`, runs `ffmpeg -i in -filter:a rubberband=...`, stores derived asset, returns `{ derivedAssetId, duration }`. Run on the existing `uvicorn` on 8000 — no new server on 8765.
- Check `ffmpeg -filters` at boot; log warning if `rubberband` missing.

### Waveform rendering

- Shared `<WaveformCanvas>` that draws from `number[]` peaks (backend or `exportPeaks`-reduced frontend) into a 2D canvas — same component for Asset Panel thumbnails and timeline lane mini-waveforms. Use `WaveSurfer.exportPeaks` reduction logic as reference but do not pull in `wavesurfer.js` (≈50 kB) unless we want its renderer — a 100-line canvas loop suffices.

---

## 5. Trade-off Summary Table

| Axis | Raw Web Audio | HTMLAudioElement | Tone.js | SoundTouchJS WASM | RubberBand WASM | Server FFmpeg RubberBand |
|---|---|---|---|---|---|---|
| **Timing precision** | Sample-accurate (`currentTime`) | Main-thread jitter | Wraps Web Audio — same as raw but extra layer | Real-time worklet | Real-time worklet | Offline, exact |
| **Multi-track sync** | Native (shared clock) | Poor (3 elements drift) | Yes via Transport | Via AudioWorklet graph | Via AudioWorklet graph | Mix-time (FFmpeg concat) |
| **Bundle size** | 0 | 0 | ~200–450 kB gz | ~23 kB processor | ~1.4 MB | 0 (server) |
| **License** | Browser built-in | Browser built-in | MIT | MPL-2.0 ✓ | **GPL-2.0 ✗ for commercial** | Server-side — no client GPL trigger; server ops complies or buys commercial |
| **Waveform/peaks** | `decodeAudioData` + `AnalyserNode` | Needs second decode | Same as raw | N/A | N/A | `ffprobe`/`audiowaveform` durable |
| **Stretch quality** | N/A | `preservesPitch` (weak) | Same as raw | WSOLA (good <2×) | Reference | **Reference** |
| **Latency** | Lookahead 100 ms | Network buffer | Same as raw | <30 ms (worklet 128 samples) | <30 ms | Seconds (edit-time ok) |
| **When to use** | **Always** (our choice) | Only hour-long stream preview | Musical sequencer only | Optional **preview** flag | Avoid | **Committed stretch + export** |

---

## 6. Risks & Open Questions for Grill

1. **Long-asset decode memory** — a 3600 s WAV decoded into Float32Array would OOM most browsers. Need a max-decoded-duration guard (e.g. 600 s) and a `MediaElement` + `MediaElementAudioSourceNode` fallback for longer files, with backend peaks as waveform.
2. **`AudioContext` suspend/resume lifecycle** — backgrounded tabs throttle rAF but audio thread continues; on visibility change, re-sync `basePerformanceNow`/`baseAudioTime`. Test on iOS Safari where `AudioContext` requires explicit `resume()` after `touchend` even if previously resumed.
3. **RubberBand availability on CI/host** — pin Docker base to `ffmpeg` with `--enable-librubberband` (Debian `ffmpeg` package does not always include it; may need `jonathonf/ffmpeg-4` or custom build). Add health check: `GET /health/audio` reports `rubberband: true|false`.
4. **TTS boundary** — standing preference is `TTSProvider` abstracted on localhost:8000, not browser `speechSynthesis`. Keep audio engine agnostic — TTS just produces another `AudioAsset` that enters the same graph.
5. **Undo for stretch** — derived asset lifetime ties to `AudioClip.derivedAssetId` refs; deleting the clip with a derived asset should GC the asset only if no other clip refs it (refcount or mark-and-sweep on save).

---

## 7. Sources (high-trust, primary)

- W3C Web Audio API 1.1 — `currentTime`, `baseLatency`/`outputLatency`, `getOutputTimestamp` — <https://www.w3.org/TR/webaudio-1.1/>
- MDN — `BaseAudioContext.currentTime` (hardware clock, reduced precision) — <https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime>
- MDN — `AudioBufferSourceNode` (single-use, scheduling) — <https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode>
- MDN — `BaseAudioContext.decodeAudioData` (async decode, resampling) — <https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData>
- MDN — `AnalyserNode` + `getByteTimeDomainData`/`getByteFrequencyData` + `AnalyserNode.fftSize` — <https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode>
- MDN — Visualizations with Web Audio API (analyser usage) — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API>
- web.dev — *A Tale of Two Clocks* (look-ahead scheduler: 100 ms lookahead / 25 ms interval, audio vs main thread) — <https://web.dev/articles/audio-scheduling>
- IRCAM — Timing and Scheduling tutorial (render quantum 128 samples, period < lookahead decoupling) — <https://ircam-ismm.github.io/webaudio-tutorials/scheduling/timing-and-scheduling.html>
- MDN — Web Audio API overview (Baseline widely available, modular routing) — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API>
- WaveSurfer.js — Pre-decoded peaks (audiowaveform CLI, 20 px/s 8-bit, `exportPeaks` reduction) — <https://wavesurfer.xyz/docs/peaks/>
- WaveSurfer `src/wavesurfer.ts` — `exportPeaks({ channels, maxLength, precision })` implementation — <https://github.com/katspaugh/wavesurfer.js/blob/main/src/wavesurfer.ts>
- Soledad Penadés — *How to get the wave data from an audio file with Web Audio* (`decodeAudioData` → `getChannelData`) — <https://soledadpenades.com/posts/2024/how-to-get-wave-data-from-file/>
- Tone.js — GitHub / npm — MIT, build size, `standardized-audio-context` dep — <https://github.com/Tonejs/Tone.js/> / <https://www.npmjs.com/package/tone>
- SoundTouchJS — monorepo + `@soundtouchjs/audio-worklet` + `@soundtouchjs/phase-vocoder-worklet` — MPL-2.0, 23 kB processor, WSOLA vs phase-vocoder trade-offs — <https://github.com/cutterbl/SoundTouchJS> / <https://www.npmjs.com/package/@soundtouchjs/audio-worklet>
- RubberBand Library licensing — GPL-2.0+ by default, commercial license required for proprietary apps, iOS/macOS App Store note — <https://breakfastquay.com/rubberband/license.html>
- `rubberband-wasm` (Daninet) / `rubberband-web` (delude88) — 1.4 MB unpacked, GPL-2.0, WASM builds — <https://github.com/Daninet/rubberband-wasm> / <https://github.com/delude88/rubberband-web/>
- `ffmpeg.audio.wasm` — FFmpeg + RubberBand licensing composite — <https://github.com/JorenSix/ffmpeg.audio.wasm/blob/master/README.textile>
- FFmpeg `rubberband` filter docs ( `--enable-librubberband`, `tempo`/`pitch` params ) — <https://ayosec.github.io/ffmpeg-filters-docs/8.1/Filters/Audio/rubberband.html> + <https://ffmpegbyexample.com/examples/749f6u35/timestretch_audio_and_video_using_rubberband_filter/>
- FFmpeg Cookbook — *Pitch-Preserving Speed Change (rubberband)* + availability check — <https://ffmpeg-cookbook.com/en/articles/change-video-speed/>

---

## Appendix — Verified Frontend Touchpoints Read

- `frontend/src/stores/playbackStore.ts` — rAF `tick()`, `performance.now()` delta, per-slide `currentTimes`, `stepFrame(1/60)`, `loopEnabled` wrap.
- `frontend/src/engine/slide.ts` — `Slide.duration` clamped `0.1..3600`, `SlideAnimation` ownership.
- `frontend/src/engine/animationEvaluator.ts` — `evaluateNode(time)` clamps to `slide.duration`, evaluator is pure and re-entrant.
- `frontend/package.json` — no `tone`, no `wavesurfer`, no audio deps yet (clean slate).
- `backend/app/app_factory.py` / `backend/app/api/assets.py` — `AssetImporter` + `AssetLibrary` + `Database` single-process on :8000 (no :8765).
- `docs/research/` — existing convention matched (`{topic}.md` + ticket/branch/date/status header).
