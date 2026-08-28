# Research: Local TTS Provider Integration via localhost:8000 — Qwen3-TTS/MLX and Voice Prompts

**Ticket:** #220 — Research: Local TTS Provider Integration via localhost:8000 — Qwen3-TTS/MLX and Voice Prompts  
**Branch:** `research/local-tts-integration`  
**Date:** 2026-08-28  
**Status:** Research Complete — decision-ready for Grill: Audio Timeline + Prompter  
**Map:** #218 — per-slide Voice/SFX/Music, embedded WAV, Web Audio shared playhead, server FFmpeg stretch, TTSProvider abstraction

---

## Executive Summary

| Question | Recommendation |
|---|---|
| **TTS engine for M1 16GB dev machine** | **Qwen3-TTS 0.6B CustomVoice via MLX** (mlx-audio or swift-qwen3-tts) with 4-bit quantization (808 MB). Fits comfortably on M1 16GB with ~2.1 GB peak RAM, sub-realtime synthesis for 1–2 sentence prompt (2–4 s wall time). 1.7B is viable only quantized and is not recommended as default dev model. |
| **Commercial licensing** | Qwen3-TTS is **Apache 2.0** — fully commercial-safe for bundling or proxying. Alternatives Piper (GPL-3.0 on active fork) and Coqui XTTS (CPML non-commercial) are strictly worse licensing. |
| **MLX support** | Production-ready: `Blaizzy/mlx-audio` (Python), `AtomGradient/swift-qwen3-tts` (Swift native), and upstream `QwenLM/Qwen3-TTS` experimental MLX runtime. Python mlx-audio is the lowest-risk backend integration. |
| **Installation footprint** | 0.6B set: ~2.5 GB download (1.8 GB weights + 0.68 GB tokenizer); quantized 4-bit pruned: **808 MB total**. 1.7B set: ~4.6 GB (3.9 GB + 0.68 GB). Acceptable as optional local install, not bundled in repo. |
| **HTTP contract** | `POST /api/tts/generate` on existing FastAPI at :8000 — **JSON in, WAV bytes out** for v1 (single WAV response). Keep streaming as opt-in `Accept: audio/wav` vs `text/event-stream` for v2. Backend **owns the model subprocess** (lazy-loaded singleton, `asyncio.Lock` serialized queue, `asyncio.to_thread` inference). |
| **Provider abstraction** | **Backend owns the engine**, frontend owns `TTSProvider` interface. Frontend `TTSProvider.generate(req): Promise<AudioAsset>` calls `POST /api/tts/generate`; swapping providers = swapping backend impl behind same endpoint (future: `provider` field). Do not put model inference in the browser. |
| **Voice Prompt presets** | Settings-level `voice_prompts` table in SQLite (same DB as `asset_definitions`, `projects`, `materials`), CRUD at `POST/GET/PUT/DELETE /api/voice-prompts`. Shape `{id, title, instruction, language?, voice?}` — extensible without migration pain (JSON `params` column). Shared across slides/projects by `promptId` ref. |
| **Storage vs settings** | **SQLite** over browser settings/localStorage. Presets must survive `.lesson` portability (reference by id, embed optional), be queryable, and participate in backend migrations (`Database._add_missing_columns`). Use settings table ≠ `localStorage` for editor UI ↔ backend sync via `SettingStore` pattern. |
| **TTS output → AudioAsset chain** | Generate → import as `AudioAsset` (`asset_definitions` with `category='audio'`, wav file on disk) → create `AudioClip` on Voice track → link `PrompterPart {audioAssetId, audioClipId, text, promptId}`. Keep non-destructive: original text preserved, multiple `AudioSegments` per part deferred to advanced replacement ticket. |

---

## 1. Qwen3-TTS on Apple Silicon M1 16GB

### 1.1 What Qwen3-TTS is (primary source)

Qwen3-TTS is Alibaba Qwen Team's multilingual TTS family, released 2026-01-22 under **Apache 2.0** [QwenLM/Qwen3-TTS GitHub][1] [LICENSE][2]. Two sizes × three variants share a 12.5 Hz codec (12Hz family is the streaming-optimized track; 25Hz is quality-oriented):

| Variant | Purpose | Languages | Disk (bf16, HuggingFace file listing Aug 2026) |
|---|---|---|---|
| **0.6B-CustomVoice** | 9 preset voices + instruction control | 10 (ZH/EN/JA/KO/DE/FR/RU/PT/ES/IT) | **1.81 GB** weights |
| **0.6B-Base** | 3-sec voice cloning | same 10 | 1.81 GB |
| **1.7B-CustomVoice** | 9 preset voices, higher fidelity | same 10 | **3.83–3.9 GB** |
| **1.7B-Base** | cloning, higher fidelity | same 10 | 3.9 GB |
| **1.7B-VoiceDesign** | voice from text description | same 10 | 3.9 GB |
| **Qwen3-TTS-Tokenizer-12Hz** | required codec | — | **0.68 GB** |

[LocalAI Master measurements Aug 2026][3] and HuggingFace `Qwen/Qwen3-TTS-12Hz-*` listings confirm these sizes.

For this research the relevant variant is **0.6B-CustomVoice** (preset voices + `instruct` style). Base cloning and VoiceDesign are out of scope for v1 voice prompts but should remain accessible via `voice` param later.

### 1.2 Model size, disk, and quantized footprints

| Configuration | Disk total (weights + tokenizer) | Where documented |
|---|---|---|
| 0.6B bf16 (stock, `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` + tokenizer) | **~2.49 GB** (1.81 + 0.68) | LocalAI Master table [3] |
| 0.6B pruned bf16 (AtomGradient vocab + ST-lite) | **~1.5 GB** (36% smaller) | AtomGradient HF page [4] |
| **0.6B pruned 4-bit** (vocab + ST-lite + 4-bit quant) | **808 MB** (67% smaller) | same [4] |
| mlx-community 0.6B 8-bit | **~1–1.5 GB** (est., `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`) | mlx-community listing, mlx-audio docs [5] |
| 1.7B bf16 | **~4.58 GB** (3.9 + 0.68) | LocalAI Master [3] |
| 1.7B C-engine int8 (Talker+CP quantized) | ~2.3 GB resident Talker 1.4 GB (half) | quantization docs [6] |
| C engine mmap bf16 on M1 | Talker 2.8 GB mmap (1.7B only) | performance docs [7] |

**Installation footprint for the dev machine (M1 16GB):**

- Default recommendation (0.6B pruned 4-bit): **808 MB** one-time `huggingface-cli download` or `mlx_audio` auto-download, cached in `~/.cache/huggingface` or `~/.qwen-tts`. Subsequent loads read from disk.
- Stock 0.6B bf16 alternative: 2.49 GB — still trivial on a 16GB machine's SSD.
- 1.7B set: 4.58 GB — acceptable but not needed for 1–2 sentence prompts.

No bundling in the repo; models are **optional local install** gated behind `GET /api/tts/health` (model absent → 503 with install hint).

### 1.3 RAM on M1 16GB — does it fit?

Unified memory is the advantage: GPU shares system RAM, no copy overhead [Ivan Digital Qwen3-ASR/TTS architecture blog][8].

| Configuration | Peak inference RAM | Source |
|---|---|---|
| Original bf16 (2.494 GB disk) | **5.14 GB** | AtomGradient paper Table 5 [9] |
| Original 4-bit | 4.66 GB | same |
| **Pruned bf16** (1.613 GB disk) | **2.81 GB** | same |
| **Pruned 4-bit** (808 MB disk) | **2.13 GB** | same (59% reduction) |
| mlx-audio 0.6B (reported) | **2–3 GB** | mlx-audio README table [5] |
| mlx-audio 1.7B | ~6 GB | same |
| C engine 0.6B bf16 mmap | ~3 GB Talker + ST overhead | C engine docs [7] |
| C engine 1.7B bf16 mmap | ~8 GB | same |

**Verdict for M1 16GB:** 0.6B pruned 4-bit at **2.13 GB peak** fits with ~13 GB headroom for browser + FastAPI + Pixi. Even the heavier mlx-audio 0.6B at 2–3 GB fits. Original 0.6B bf16 at 5.14 GB is tight on 16GB when the browser holds Pixi textures and `decodeAudioData` buffers. **Pin 0.6B quantized for dev; document 1.7B as opt-in for quality-critical generation.**

Note on AtomGradient's measurement machine: M-series 36 GB unified, temperature=0.9, top-k=50; RTF ~0.68 for both pruned bf16 and 4-bit [9]. Numbers transfer to M1 16GB proportionally — the pruning pipeline is language-agnostic (English dict used) but generalizes via dictionary union.

### 1.4 Latency for 1–2 sentence prompt

A 1–2 sentence prompt at typical narration speed is **~5–10 s of audio** (~12–15 words per sentence, ~150 wpm). Latency = time to first packet (TTFA/streaming) + real-time factor (RTF) for full utterance.

**Server GPU baseline (authoritative, vLLM V0 backend, torch.compile + CUDA Graph):**

| Model | Concurrency | TTFA (first packet) | Steady TPP | RTF |
|---|---|---|---|---|
| 0.6B-12Hz | 1 | **93 ms** + 4 ms = **97 ms** | 19 ms | 0.288 |
| 1.7B-12Hz | 1 | 97 + 4 = **101 ms** | 21 ms | 0.313 |
| 0.6B-25Hz | 1 | 113 + 25 = 138 ms | 50 ms | 0.234 |

Source: Qwen3-TTS technical report table (arXiv 2601.15621 extract) [10].

**Apple Silicon (the relevant number for this ticket's M1 16GB dev machine):**

Three independent measurement stacks:

1. **Swift MLX (AtomGradient swift-qwen3-tts):** RTF **~0.55–0.8×** on M2 Max, peak ~2.4 GB, load ~2.5 s [4]. For 5 s audio: ~2.8–4.0 s wall time, after ~2.5 s load on cold start.
2. **Python mlx-audio (Blaizzy):** Reported "RAM 3 GB Lite / 6 GB Pro", RTF broadly similar to Swift stack, streaming batch RTF ~0.7 [5].
3. **C engine (gabriele-mastrapasqua/qwen3-tts, pure C + BLAS + NEON/SDOT, most detailed M1 numbers):**

| M1 8-core 16GB, 4 threads | 0.6B bf16 | 0.6B **int8** | 0.6B **int4** | 1.7B bf16 | 1.7B int8 | 1.7B quant-mixed |
|---|---|---|---|---|---|---|
| CLI short (~4 s audio) | 1.37–1.71× | **0.90×** | **0.51×** | 4.1–4.4× | 3.69× | 1.53× |
| CLI long (~14 s audio) | 1.29–1.32× | **0.80×** | — | 1.97–2.11× | 2.15× | — |
| Streaming TTFA short | 0.96 s | **0.46 s** | — | — | — | — |
| Streaming TTFA long | — | **0.50 s** | — | — | — | — |
| HTTP server warm | 1.33× | **0.88×** | — | — | — | — |

Source: C engine performance + quantization docs, measured 2026-07 on M1 [7][6].

Per-component breakdown explains the gap: Code Predictor does 15 sequential autoregressive passes per frame (~60–76 ms/frame on M1 bf16), prefill ~1.0–1.6 s, decoder overlapped 512 ms drain [7]. The official Python PyTorch stack is 3–4× slower on same hardware (RTF 4.5–5.8 on Ryzen 9 vs 1.3–1.7 on M1 via C engine) — use quantized MLX or C engine, not stock PyTorch, on M1.

**Translated to 1–2 sentence UX:**

| Prompt size | Audio length (est.) | M1 0.6B **int8** wall time | M1 0.6B **bf16** wall | Swift MLX est. | UX implication |
|---|---|---|---|---|---|
| 1 sentence (~12 words, ~4–5 s audio) | 4–5 s | **~3.6–4.5 s** (RTF 0.9) | ~6–8 s | ~3.2–4.0 s | Show progress indicator; poll or stream. Not instant, acceptable for edit-time. |
| 2 sentences (~25 words, ~10 s) | ~10 s | **~8 s** (RTF 0.8) | ~13 s | ~7 s | User waits one slide-transition duration. |
| First audio chunk | 320 ms packet | **0.46 s** TTFA streaming | 0.96 s | 97 ms on server GPU | Streaming would cut perceived latency ~50%; defer to v2. |

**Recommendation:** Document upfront that M1 0.6B generation is **edit-time, not real-time**. Do not promise sub-second full generation on CPU/M1. Offer streaming as a fast-follow: 0.46 s TTFA with int8 already makes a cancellable progress UX practical. Warm server mode (embedding cache + persistent buffers + decoder overlap) saves ~14–38% [7].

### 1.5 MLX support — maturity assessment

| Stack | Repo | Language | Models covered | Quant | Status for this ticket |
|---|---|---|---|---|---|
| **mlx-audio** (Blaizzy) | `Blaizzy/mlx-audio` | Python | Qwen3-TTS all variants, 3/4/6/8-bit | Yes (8-bit etc.) | **Recommended backend path.** OpenAI-compatible REST API, `mlx_audio.tts.generate --model mlx-community/... --voice Vivian`, clean `load_model()` Python API, active. |
| **swift-qwen3-tts** (AtomGradient) | `AtomGradient/swift-qwen3-tts` | Swift | Qwen3-TTS 0.6B/1.7B via MLX Swift, pruned checkpoints | 4-bit + pruning pipeline + paper | Production Swift package, `Qwen3TTSEngine` with `generate(text:voice:)`, streaming API, peer-reviewed compression paper + HF pruned weights. Alternative if team prefers Swift service. |
| **QwenLM official MLX runtime** | `QwenLM/Qwen3-TTS` `[mlx]` extra | Python | 12Hz CustomVoice + 12Hz Base (`x_vector_only_mode=True` for 0.6B Base) | via mlx-lm | **Experimental** — narrower than PyTorch runtime (`instruct` not supported, deterministic `do_sample=False` fastest, prompt extraction hybrid PyTorch+MLX). Validated for `non_streaming_mode=True`. Not recommended as primary until merged to parity. |
| **mlx-tts-server** (realAllenSong) | `realAllenSong/mlx-tts-server` | Python | wraps mlx-audio | via mlx-audio | Thin OpenAI-compatible wrapper (`mlx-tts serve ... --port 8000`). Could power `POST /audio/speech` compat shim; not needed if we own FastAPI directly. |
| **C engine** (gabriele-mastrapasqua) | `gabriele-mastrapasqua/qwen3-tts` | C | 0.6B + 1.7B, mmap, int8/int4 SDOT | int8/int4 native SDOT | Fastest-measured M1 bf16→int8 win, but C binary + HTTP server is a second process to manage. Reference for latency ceiling only; not the integration path. |

All share the same `mlx-community/Qwen3-TTS-12Hz-*bf16/8bit` weights. MLX itself is Apple Silicon-only by design — no Intel/AMD, no Linux/Windows.

**Installation on M1 (expected dev flow, verified against mlx-audio, suckerfish/qwen3-tts-mlx, and louis mlx-tts-studio repos):**

```bash
# isolated env — Python 3.11–3.12, uv recommended
uv venv --python 3.12 .venv-qwen
source .venv-qwen/bin/activate
pip install mlx-audio
# or: pip install -U "qwen-tts[mlx]"  for official experimental runtime

# model fetch (cached, not repo-bundled)
huggingface-cli download mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
# or pruned: AtomGradient/Qwen3-TTS-0.6B-CustomVoice-4bit-pruned-vocab-lite
```

### 1.6 Alternatives — when Qwen3-TTS is not the right pick

| Engine | Params / Size | Speed | RAM | Quality (MOS / community) | Clone | License | Best for | Why not default here |
|---|---|---|---|---|---|---|---|---|
| **Qwen3-TTS 0.6B** | 0.6B, 0.8–2.5 GB disk | ~0.5–1.7× RTF on M1 (quantized) | 2.1–5.1 GB | WER SOTA (0.77–1.24 on Seed-TTS) | Yes (Base, 3 s) | **Apache 2.0** ✅ | Primary pick — streaming, multilingual 10 langs, preset + clone + instruct, commercial-safe | — |
| **Piper** (rhasspy/OHF-Voice) | ~15M VITS, **40–130 MB/voice** | **180× real-time on CPU** (10 s in 55 ms), RTF 0.12 on Pi5 | **100–300 MB** | Good/clean but robotic, MOS 3.4 | No | **GPL-3.0** on active fork `OHF-Voice/piper1-gpl` (original MIT archived 2025-10) ⚠️ copyleft | Tiny edge devices, sub-100 ms latency, 47 langs, offline kiosks | No cloning, no streaming, GPL-3.0 viral if bundled in closed source, quality floor below Qwen |
| **Coqui TTS XTTS v2** | ~0.5B, ~2 GB weights, 3–5 GB Docker | ~0.2× RTF on CPU, ~3–5× RTF on GPU | 1–4 GB, ~2 GB VRAM | MOS 4.1, very natural | Yes (6 s, 17 langs) | **CPML non-commercial** ❌ (company shut Jan 2024, no commercial license for sale) | Personal projects where cloning in 17 langs outweighs license | Non-commercial, community fork only, GPU-recommended, deprecated quality vs Qwen/Fish |
| **Kokoro-82M** | 82M, **80 MB INT8 ONNX** | <1× RTF on CPU and Pi 4 | <1 GB | Surprisingly natural for size | No (54 built-in voices, ~9 langs) | **Apache 2.0** ✅ | Ultra-light CPU narration, edge | English-focused, no clone, no streaming, quality disconnected from prompt expressiveness |
| **Fish Audio S2 Pro / OpenAudio S1-mini** | 4.4B, ~8–12 GB VRAM | ~GPU only | ~12 GB | High (13 langs cloned) | Yes (10–30 s) | S2 mini **CC-BY-NC-SA-4.0 non-commercial** ❌ | High-quality research | Non-commercial, GPU-heavy, no MLX |
| **Chatterbox (Resemble, 0.5B)** | 0.5B, 4–6 GB | CPU capable | 4–6 GB | Vendor claims 65.3% prefer over ElevenLabs | Yes (~5 s, 23+ langs) | **MIT** ✅ | Quality + permissive license | GPU-recommended, not MLX, heavier than Kokoro for narration fallback |

Tone-of-measure: Piper at 180× RTF vs Qwen 0.6B int8 at 0.5–0.9× RTF on same M1 is ~200–360× slower per second of audio — but Qwen's quality (WER/MOS) is in a different tier. For Voice prompts (educational narration needing natural prosody and 10-language coverage), quality dominates; Piper is a viable **fallback** for a future "fast draft" mode, not the primary.

**License note checked to primary source:** QwenLM repo `LICENSE` is verbatim Apache 2.0 [2]. The Apache 2.0 grant allows commercial use, modification, and distribution with no copyleft — unlike Piper's current GPL-3.0 fork (commercially usable but triggers source-disclosure on distribution when linked/bundled) and Coqui's CPML (non-commercial, no vendor to buy out). Kokoro and Chatterbox share the same permissive posture but lack the voice-prompt expressiveness needed here.

---

## 2. HTTP Contract via localhost:8000

### 2.1 Current backend shape (read against code)

Checked `backend/app/main.py` and `backend/app/app_factory.py:1-65`:

```python
# backend/app/main.py
from app.app_factory import create_app
app = create_app()

# backend/app/app_factory.py
app = FastAPI(title="AI Slideshow Editor Backend")
app.state.settings = load_settings()
app.state.database = Database(settings.database_url)  # sqlite:///{data_dir}/library.db
app.state.asset_importer = AssetImporter(database, storage, ImagePipeline(max_upload_bytes))
app.state.asset_library = AssetLibrary(database, storage)
app.state.material_library = MaterialLibrary(database)  # seeded
app.state.shader_library = ShaderLibrary(database)     # seeded
app.state.project_library = ProjectLibrary(database)
app.state.clip_library = ClipLibrary(database)          # seeded
app.include_router(health.router)          # GET /health
app.include_router(ping.router)
app.include_router(assets.router, prefix="/api")      # POST /api/assets, GET /api/assets, etc.
app.include_router(materials.router, prefix="/api")
app.include_router(shaders.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(clips.router, prefix="/api")
app.mount("/api/assets/originals", StaticFiles(...))
app.mount("/api/assets/thumbnails", StaticFiles(...))
database.init_schema()  # Base.metadata.create_all + _add_missing_columns ALTER TABLE
```

Key findings:

- Single FastAPI process on **:8000** (no :8765; `browser-audio-apis` research already confirmed this [11]).
- Pydantic v2 + SQLAlchemy 2.0, SQLite with `check_same_thread=False`, `Database.session()` per request, `Base` central in `app/model.py`.
- `Settings` from `backend/app/config.py` (frozen dataclass): `frontend_url`, `development_mode`, `data_dir` (`backend/var` default), `database_url`, `max_upload_bytes` (20 MB default).
- Asset import already owns the pattern we will reuse for audio: `POST /api/assets` → `AssetImporter.import_uploads(Upload[filename, content, category])` → `session.add(AssetDefinition)` + `AssetStorage.save_original/save_thumbnail`, rollback on error deletes written files. See `app/assets/importer.py:32-61`, `app/assets/model.py:15-41`, `app/assets/schemas.py:21-50`, `app/assets/storage.py:30-41`.
- Static serving of assets via `StaticFiles` mounts — audio can reuse the same (`/api/assets/originals/{id}.wav`).
- No existing `/tts/*` or `/audio/*` routes, no model lifecycle, no queue.

The minimal viable backend change is therefore **additive only**: new table, new router, new service, no breaking change to existing routes or `app_factory` semantics.

### 2.2 Proposed contract

#### Endpoint

```
POST /api/tts/generate
Content-Type: application/json
Accept: audio/wav  (v1 default) | application/json  (metadata) | text/event-stream (v2 streaming)
```

**Why `/api/tts/generate` not `/tts/generate`:** matches existing prefix convention (`/api/assets`, `/api/materials`, `/api/shaders`, `/api/clips`). Cross-check `app_factory.py:54-59`. Issue 220 wrote `POST /tts/generate` — translate to `/api/tts/generate` in spec.

#### Request (v1)

```json
{
  "text": "Hola, ¿cómo estás?",          // required, 1–2000 chars (trim, reject empty)
  "promptId": "warm-teacher-v1",          // optional, FK → voice_prompts.id; if set, instruction merged server-side
  "language": "es",                       // optional, enum: auto|zh|en|ja|ko|de|fr|ru|pt|es|it|zh-sichuan|zh-beijing — default "auto"
  "voice": "Serena",                      // optional, one of 9 CustomVoice speakers (Aiden, Ryan, Serena, Vivian, Sohee, Ono_anna, Uncle_fu, Eric, Dylan); maps to OpenAI aliases alloy→Aiden etc. if we shim mlx-tts-server
  "instruction": "speak warmly, slow",    // optional override/extension of promptId's instruction; empty = prompt only
  "format": "wav",                        // optional, default "wav" (24 kHz mono s16le pcm — Qwen output)
  "sampleRate": 24000                     // optional, default 24000; reject unsupported
}
```

Full TypeScript equivalent (frontend):

```ts
interface TTSGenerateRequest {
  text: string
  promptId?: string        // voice_prompts.id
  language?: 'auto'|'zh'|'en'|'ja'|'ko'|'de'|'fr'|'ru'|'pt'|'es'|'it'
  voice?: string           // CustomVoice speaker; null = model's default for prompt
  instruction?: string     // freeform style direction
  format?: 'wav'
  sampleRate?: 24000
}
```

`language` and `voice` are explicitly flagged as **future-extensible** (see §4.2) — they travel through the same request but are optional for prompt-preset CRUD. A prompt with no language/voice is still valid; the backend picks defaults.

#### Response (v1 — WAV bytes)

*Success (200):*

```
HTTP/1.1 200 OK
Content-Type: audio/wav
Content-Length: <bytes>
X-Audio-Duration: 4.32
X-Audio-Sample-Rate: 24000
X-TTS-Prompt-Id: warm-teacher-v1
X-TTS-Model: mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
```

Body: raw WAV bytes (`pcm_s16le`, 24 kHz mono — the Qwen codec's native rate [4]). `Content-Disposition: inline` optional if browser download.

Alternative JSON envelope (if client sends `Accept: application/json`):

```json
{
  "audioBase64": "<base64 wav>",
  "duration": 4.32,
  "sampleRate": 24000,
  "format": "wav",
  "promptId": "warm-teacher-v1",
  "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
  "assetId": null
}
```

Choose bytes for `ApiClient` `fetch`→`arrayBuffer()` and direct cache; base64 only for `.lesson` embedding (already the pattern for `EmbeddedAssetJSON.data` in `engine/json.ts:165-172`).

#### Response (v2 — streaming, deferred)

```
GET/POST /api/tts/generate?stream=true
Accept: text/event-stream
```

Server emits `data: {"chunk": <base64 pcm>, "seq": 0}` or binary frames (320 ms packets per Qwen 12Hz 4-token grouping [10]) until `event: done` with `{duration, wavUrl}`. Not required for v1; keep contract forward-compatible by reserving `stream` query param.

#### Errors

| Status | When | Body |
|---|---|---|
| 400 | `text` empty / too long / `language` unknown / `voice` unknown | `{"detail": "text must be 1..2000 chars: got 0"}` |
| 404 | `promptId` not found | `{"detail": "prompt warm-teacher-v1 not found"}` |
| 422 | Pydantic validation (e.g. `sampleRate` unsupported) | `{"detail": [{"loc":["body","sampleRate"],"msg":"..."}]}` |
| 503 | Model not loaded / not installed | `{"detail":"TTS model not installed. Run: huggingface-cli download mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"}` — `GET /api/tts/health` also reports `{"status":"ready|not_installed|loading","model":"...","quantization":"8bit"}` |
| 429 | Queue full (if bounded) | `{"detail":"TTS busy, try again"}` |
| 500 | Synthesis failure | `{"detail":"synthesis failed: <truncated>"}`, logged server-side |

Frontend maps 503 → install CTA, 429/500 → retry with backoff, 400 → inline validation.

### 2.3 Backend ownership and minimal change

**Own the model process in the backend, do not proxy to a second daemon.**

Rationale: standing decision "localhost:8000 is the hop" (issue 220) and map #218 "Audio backend extends localhost:8000 (no new server on 8765)" already decided against a sidecar on another port. The backend process is the only owner of `data_dir` and SQLite.

**Lifecycle (singleton, lazy):**

```python
# backend/app/tts/service.py (new)
class TTSService:
    def __init__(self, settings: Settings) -> None: ...
    async def ensure_loaded(self) -> None:
        # asyncio.Lock guarded, first POST triggers:
        #   from mlx_audio.tts.models.qwen3_tts import load_model
        #   self._model = load_model("mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit")
        # raise 503 on ImportError with hint
    async def synthesize(self, req: TTSGenerateIn) -> TTSArtifact:
        await self.ensure_loaded()
        # run in threadpool: asyncio.to_thread(self._model.generate, ...)
        #   returns bytes (WAV), duration, sample_rate
```

Mounted as `app.state.tts_service = TTSService(settings)` in `AppFactory.create()` (same position as `asset_library`, after `database.init_schema()`). Router at `backend/app/api/tts.py` injects via `request.app.state.tts_service`.

**Queue and backpressure:**

- Single `asyncio.Lock` serializes synthesis — Qwen's Code Predictor is sequential per-frame [7]; concurrency on one M1 does not help throughput and increases peak RAM.
- Optionally, `asyncio.Semaphore(1)` + `asyncio.Queue` with maxsize 3 → 429 on overflow; `Retry-After: 2` header.
- `asyncio.to_thread` keeps the event loop responsive (do not block `uvicorn`).
- No Celery/RQ — out of scope for edit-time operation. If later needed for long audiobook batch, upgrade path is a DB-backed `tts_jobs` table with polling (`POST /api/tts/jobs`, `GET /api/tts/jobs/{id}`), not introduced in v1.

**Import as asset (atomic with synthesis):**

After bytes are produced, reuse the existing asset pipeline path but for audio:

```python
artifact = await tts_service.synthesize(req)
# 1) write WAV to storage:  audio/<uuid>.wav  (extend AssetStorage with audio_dir)
# 2) insert AssetDefinition(category='audio', width=0, height=0, duration, sample_rate)
#    or a dedicated AudioAsset table — see §6
# 3) return wav bytes + X-Audio-Duration
# Alternative: return bytes first, let frontend POST /api/assets for persistence
#   — prefer backend persistence so the DB and file stay consistent
```

Atomicity: same rollback pattern as `AssetImporter.import_uploads` — on DB failure, `storage.remove()` the written file.

**Health / OpenAPI:**

- Add `GET /api/tts/health` and `GET /api/tts/voices` (list 9 CustomVoice speakers + their OpenAI alias map).
- FastAPI auto-generates OpenAPI at `http://localhost:8000/docs` and `http://localhost:8000/openapi.json` — the existing contract already does this; TTS routes appear there without extra wiring.

**What not to do:**

- Do not spawn `mlx-tts serve --port 8000` as a second process listening on 8000 — port conflict; we extend the existing `uvicorn` instead.
- Do not shell out to `ffmpeg` for TTS — Qwen's vocoder is PyTorch/MLX, not an `ffmpeg` filter (only time-stretch uses `rubberband` [11]).
- Do not implement browser-side inference (WebAssembly of a 0.6B transformer is impractical and lacks MLX).

### 2.4 WAV bytes vs streaming — position

**v1: WAV bytes.** Simpler for `ApiClient` (existing `get`/`post` return `Response.json()`; new `postWav` returning `ArrayBuffer` is one addition), simpler for import-as-asset (one write), simpler for `.lesson` embedding (one base64). Typical 1–2 sentence latency 2–5 s on M1 means a single awaitable promise with progress UI is acceptable.

**v2: streaming.** Reserved for when wall time exceeds ~5 s or when editor wants cancellable partial playback (TTFA 0.46 s [7] becomes valuable). Implement as SSE or chunked `audio/wav` with `Transfer-Encoding: chunked`; frontend appends to `AudioBuffer`. Keep `TTSProvider.generate` returning `Promise<AudioAsset>` — streaming is an internal transport detail, the contract still resolves to a finalized asset.

---

## 3. TTSProvider Interface Shape

### 3.1 Where the abstraction lives

| Layer | Owns | File (proposed) | Why |
|---|---|---|---|
| **Backend** | Model, queue, synthesis, file + DB persistence, health | `backend/app/tts/service.py`, `backend/app/api/tts.py` | 8000 is the hop; secrets, weights, GPU/MLX access never in browser. |
| **Frontend** | `TTSProvider` interface + `LocalTTSProvider` concrete + prompt store | `frontend/src/audio/ttsProvider.ts`, `frontend/src/api/ttsApi.ts`, `frontend/src/stores/voicePromptStore.ts` | Provider swapping stays a frontend strategy choice; `ApiClient` remains transport. Mirrors existing `assetsApi.ts`/`clipsApi.ts`/`materialsApi.ts` pattern where API classes wrap `ApiClient` and stores wrap API. |
| **Engine** | `AudioAsset`, `AudioClip`, `PrompterPart` types + JSON | `frontend/src/engine/audio.ts`, `frontend/src/engine/json.ts` | Same as `embeddedAsset.ts` + `json.ts:165-172` — engine owns the model, stores own the persistence. |

We explicitly place the interface on the **frontend**, not as a backend abstraction. Reason: the editor already treats all backend access through `ApiClient` subclasses (`AssetsApi`, `ClipsApi`, `ProjectsApi`, `HealthApi` at `frontend/src/api/*`). A `TTSProvider` that wraps `TtsApi` is isomorphic to those. A backend provider abstraction would duplicate the frontend swap point — useful only if the backend itself needs to swap between Qwen and Piper behind one endpoint, in which case a `provider` enum on the request body (see §2.2) is the narrower change.

### 3.2 Interface

```ts
// frontend/src/audio/ttsProvider.ts
export interface TTSRequest {
  text: string
  promptId?: string
  language?: string   // extensible; default "auto"
  voice?: string       // extensible; CustomVoice speaker
  instruction?: string // freeform style, merged with prompt's instruction
}

export interface AudioAsset {
  readonly id: string
  readonly name: string
  readonly originalUrl: string   // /api/assets/originals/<id>.wav
  readonly duration: number      // seconds, from backend probe
  readonly sampleRate: number    // 24000
  readonly format: 'wav'
  readonly promptId?: string
  readonly createdAt: string     // ISO
}

export interface TTSProvider {
  /** Synthesize text → persisted AudioAsset (backend owns file + DB row). */
  generate(request: TTSRequest): Promise<AudioAsset>

  /** Optional: health probe; default impl calls GET /api/tts/health. */
  health?(): Promise<{ status: 'ready'|'loading'|'not_installed'; model?: string }>

  /** Optional: list voices for UI; default impl calls GET /api/tts/voices. */
  listVoices?(): Promise<readonly string[]>
}
```

Concrete:

```ts
// frontend/src/api/ttsApi.ts
export class TtsApi {
  constructor(private readonly client: ApiClient) {}
  async generateWav(req: TTSGenerateRequest): Promise<{ wav: ArrayBuffer; duration: number }>
  async health(): Promise<TtsHealth>
  async listVoices(): Promise<string[]>
}

// frontend/src/audio/localTTSProvider.ts
export class LocalTTSProvider implements TTSProvider {
  constructor(private readonly ttsApi: TtsApi, private readonly assetsApi: AssetsApi) {}
  async generate(req: TTSRequest): Promise<AudioAsset> {
    // 1) POST /api/tts/generate → ArrayBuffer
    // 2) either: backend already persisted → return AssetDefinition mapped to AudioAsset
    //    or: POST /api/assets with File(blob) for persistence
    // 3) return AudioAsset
  }
}
```

`ApiClient` needs one addition (`postWav` → `ArrayBuffer`) alongside existing `post`, `postForm`, `get`, `put`, `delete` at `frontend/src/api/apiClient.ts:1-70`:

```ts
async postForWav(path: string, body: string): Promise<{ buffer: ArrayBuffer; headers: Headers }> {
  const response = await this.request(path, {
    method: 'POST',
    body,
    headers: { Accept: 'audio/wav', 'Content-Type': 'application/json' },
  })
  return { buffer: await response.arrayBuffer(), headers: response.headers }
}
```

### 3.3 Error shape and retry

`TTSProvider.generate` rejects with `ApiError` (already at `frontend/src/api/apiClient.ts:4-15`):

```ts
try {
  const asset = await provider.generate({ text, promptId })
} catch (e) {
  if (e instanceof ApiError) {
    if (e.status === 503) showInstallHint(e.detail)
    else if (e.status === 429) await retryAfter(e)
    else showTtsError(e.detail)
  }
}
```

The UI layer (per-part generation dialog) owns retry; the provider is stateless. Queueing is backend-global so the store should also expose `isGenerating: boolean` and `lastError: string | null` via `voicePromptStore`.

### 3.4 Swapping providers (future)

```ts
// later:
export type TTSProviderKind = 'local-qwen' | 'local-piper' | 'cloud-elevenlabs'
export function createTTSProvider(kind: TTSProviderKind, client: ApiClient): TTSProvider {
  switch (kind) {
    case 'local-qwen': return new LocalTTSProvider(new TtsApi(client))
    case 'local-piper': return new PiperTTSProvider(new TtsApi(client))
    // ...
  }
}
```

Backend can keep a single endpoint and dispatch by `body.provider ?? 'qwen'` — no new routes per provider. The instruction notes `voice`/`language` extensibility is the correct seam for this, not a new endpoint.

---

## 4. Voice Prompt Presets Model

### 4.1 Shape

Issue 220 specifies `{id, title, instruction}`. Extend to `{id, title, instruction, language?, voice?, createdAt, updatedAt}` with an extensible `params` JSON column for later fields without migrations.

Backend SQLAlchemy (new `backend/app/voice_prompts/model.py`):

```python
class VoicePrompt(Base):
    __tablename__ = "voice_prompts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid4
    title: Mapped[str] = mapped_column(String(120), nullable=False)  # display name, 1..120 chars
    instruction: Mapped[str] = mapped_column(Text, nullable=False, default="")  # freeform style direction
    language: Mapped[str | None] = mapped_column(String(20), nullable=True)  # nullable extensible
    voice: Mapped[str | None] = mapped_column(String(60), nullable=True)     # nullable extensible
    params: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)  # future: speed, emotion, etc.
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
```

Pydantic schemas (`backend/app/voice_prompts/schemas.py`):

```python
class VoicePromptOut(BaseModel):
    id: str; title: str; instruction: str
    language: str | None = None; voice: str | None = None
    params: dict = {}
    created_at: datetime; updated_at: datetime

class VoicePromptCreateIn(BaseModel):
    title: str  # 1..120, strip
    instruction: str = ""  # 0..2000
    language: str | None = None
    voice: str | None = None
    params: dict = {}

class VoicePromptUpdateIn(BaseModel):
    title: str | None = None; instruction: str | None = None
    language: str | None = None; voice: str | None = None
    params: dict | None = None
```

Frontend type mirrors it (`frontend/src/stores/voicePromptStore.ts` + `frontend/src/api/voicePromptsApi.ts`):

```ts
export interface VoicePrompt {
  readonly id: string
  readonly title: string
  readonly instruction: string
  readonly language?: string | null
  readonly voice?: string | null
  readonly params: Readonly<Record<string, unknown>>
  readonly createdAt: string
  readonly updatedAt: string
}
```

### 4.2 Sharing, CRUD, and extensibility

- **CRUD:** `POST /api/voice-prompts`, `GET /api/voice-prompts`, `GET /api/voice-prompts/{id}`, `PUT /api/voice-prompts/{id}`, `DELETE /api/voice-prompts/{id}`. All JSON. No file upload. Follows `app/api/clips.py` and `app/api/materials.py` patterns (router prefix `/api`, `request.app.state.*_library` injection).
- **Sharing across slides:** Prompts are **settings-level, not per-slide**. Same as life of `AssetDefinition` — one row, referenced by id from any slide's `PrompterPart.promptId`. Deleting a prompt that is still referenced by parts: **reject with 409** (`{detail: "prompt still referenced by 3 parts"}`) or **soft-delete + keep row**; recommend 409 for v1 (explicit, no dangling FK — SQLite `ForeignKey` not yet used in `app/model.py`).
- **Extensibility for language/voice:** Two design options considered:
  1. **Columns** `language`, `voice` (nullable) + `params JSON` overflow — chosen. Queries and filters are simple (`WHERE voice = 'Serena'`), migrations via `Database._add_missing_columns` already handle nullable additions [database.py:25-44].
  2. **Pure JSON** `params: {language, voice}` — avoids DDL but loses indexed query and Pydantic validation per-field. Reject.
  Add columns `language`, `voice` now as nullable so they are present without migration churn; future fields (e.g. `speed`, `emotionIntensity`, `seed`) go in `params` until promoted to columns if they need indexing.
- **Instruction semantics:** `instruction` is the freeform style prompt ("speak warmly, like a kindergarten teacher, slightly slower"). On `POST /api/tts/generate`, resolution order: `body.instruction ?? (prompt.instruction + " " + body.instruction)` — merging is server-side, prompt is source of truth. `language`/`voice` resolution similarly: `body.language ?? prompt.language ?? "auto"`.
- **Seeding:** Provide 3–5 seeded presets in the same pattern as `MaterialLibrary.ensure_seeded` and `ClipLibrary.ensure_seeded` — e.g. "Warm Teacher" (`instruction: "warm, clear, slightly slower than normal"`), "Energetic Narrator", "Calm Explainer". Seeding keeps the generation dialog useful on first run.
- **Validation:** `title` 1..120 chars, unique? Not enforced globally — allow duplicates; `id` is the key. `instruction` 0..2000 chars. `language` must be in allowed set if present; `voice` must be in `GET /api/tts/voices` list if present.

### 4.3 Frontend store pattern

Follow existing store conventions (`clipLibraryStore.ts`, `materialLibraryStore.ts`, `projectBrowserStore.ts`):

```ts
// frontend/src/stores/voicePromptStore.ts
export const useVoicePromptStore = create<State>((set) => ({
  prompts: [] as VoicePrompt[],
  isGenerating: false,
  lastError: null as string | null,
  load: async () => { set({ prompts: await voicePromptsApi.list() }) },
  create: async (input) => { const p = await voicePromptsApi.create(input); set(s => ({ prompts: [...s.prompts, p] })) },
  update: async (id, patch) => { ... },
  remove: async (id) => { await voicePromptsApi.delete(id) ... }
}))
```

No `localStorage` mirroring needed — prompts live in SQLite and are loaded on app init (same as `MaterialLibrary` load).

---

## 5. Prompt Presets Storage — SQLite vs Settings

### 5.1 Why SQLite (recommendation)

| Axis | SQLite (`backend/var/library.db`) | Browser settings (`localStorage` / `Project.settings`) |
|---|---|---|
| **Portability via `.lesson`** | Referenceable by `promptId` across machines if we embed prompts in `LessonLibraryJSON` (see §6); project file remains single JSON | `localStorage` is per-browser, lost on another machine; `Project.settings` bloats project JSON with UI-level data |
| **CRUD & query** | Filter/sort by `voice`/`language`, joins against `projects`/`tts_jobs` later; reuse `Database.session()` pattern | No query, no cross-tab consistency, no server validation |
| **Migration** | `Database.init_schema()` + `_add_missing_columns` already handles nullable column additions safely [database.py:18-44] | `Project.settings` is untyped `Record<string, unknown>` — migration is ad-hoc via frontend code |
| **Existing precedent** | `AssetDefinition`, `MaterialDefinition`, `ShaderDefinition`, `ProjectRow`, `ClipDefinition` all in same DB and same `Base` — prompts belong there | Only UI prefs (theme, panel sizes) persist in `localStorage` per Spec 01 R29 — intentionally not domain data |
| **Per-project vs global** | Prompts are global settings-level by standing decision (issue 220) — easiest to model as a global table, not per-project blob field; future project-level overrides can add `project_prompts` join table without rewriting | Global `localStorage` cannot be inspected server-side; `Project.settings` would scope prompts per-project incorrectly |
| **Backend ownership** | TTS synthesis reads `prompt.instruction` server-side without trusting client JSON; sanitized once on write | Client-trusting flow, duplication risk |

**Decision:** **SQLite `voice_prompts` table** via `app/voice_prompts/model.py` + `library.py` + `schemas.py` + `api/voice_prompts.py`, registered in `app_factory.py` after `clip_library`. The standing decision "prompt presets are settings-level" (issue 220) is interpreted as **global SQLite table behind settings-flavored endpoints**, not `localStorage`.

### 5.2 `.lesson` portability for prompts

Presets are not embedded by default (global state). On export, two options:

1. **Reference-only (v1):** `.lesson` stores `PrompterPart.promptId` only. Opening on a machine without that prompt: show warning and fall back to raw `text` synthesis; prompt can be re-created manually. Cheapest, no bloat.
2. **Snapshot embed (future):** Extend `LessonLibraryJSON` with `voicePrompts?: VoicePromptJSON[]` (same shape as `assets`/`materials` snapshot in `frontend/src/engine/json.ts:236-242`). On open, `embedPrompt()` mirrors `Project.embedAsset()` — store snapshot, do not re-enter global table. Deferred until prompts carry non-trivial data (few hundred bytes each — negligible vs WAV base64).

Do not embed prompt content in `Project.settings` — it couples editing metadata to project versioning unnecessarily.

### 5.3 Comparison to asset-panel pattern for audio

Audio prompts follow the same lifecycle distinction as images: definitions (here, `VoicePrompt`) are reusable and immutable-ish; instances (`PrompterPart` + `AudioAsset` + `AudioClip`) belong to a slide/project and override per-use params (here, per-part `text` + transient `instruction` delta).

---

## 6. TTS Output Becomes AudioAsset + AudioClip + PrompterPart — Link

### 6.1 Entities (map from #218 + browser-audio-apis research)

| Entity | Owner | What it is | Current status |
|---|---|---|---|
| **AudioAsset** | Backend SQLite + filesystem (`assets/originals/<id>.wav`) + `.lesson` embed | Immutable reusable audio: `id, name, originalFilename, importDate, fileSize, duration, sampleRate, channels, format, peaks?` | Not yet in `engine/json.ts`; modeled on `AssetDefinition` + `AssetDefinitionOut` [assets/model.py:15, schemas.py:52] |
| **AudioClip** | Slide-scoped, alongside `ClipDefinition`/`ClipInstance` but for audio timeline | Schedule on a track: `id, assetId, offset, trimStart, trimEnd, gain, mute, stretchFactor, preservePitch, derivedAssetId?` | `browser-audio-apis` research defines `AudioClip { assetId, trimStart, trimEnd, stretchFactor, preservePitch, derivedAssetId? }` [11 §2.2] |
| **AudioTrack** | Slide-scoped | Fixed 3 tracks: `Voice | SFX | Music` (Map #218 standing decision) | Spec-level only |
| **PrompterPart** | Slide-scoped, owned by `Slide` | Text chunk with decoupled narration state: `id, text, promptId?, audioAssetId?, audioClipId?, audioSegmentIds?[]` | New; no existing code — this research proposes shape |
| **Prompter** | Slide-scoped | Ordered list `parts: PrompterPart[]` | New |

### 6.2 Proposed engine types and JSON

Extend `frontend/src/engine/json.ts` alongside existing `NodeJSON`/`SceneJSON`/`ClipJSON` families, and add to `LessonLibraryJSON` + `SlideJSON`:

```ts
// engine/json.ts additions
export type AudioAssetJSON = {
  readonly id: string
  readonly name: string
  readonly originalFilename: string
  readonly importDate: string
  readonly fileSize: number
  readonly duration: number        // seconds, precise
  readonly sampleRate: number      // 24000
  readonly channels: number        // 1 (mono)
  readonly format: 'wav'
  readonly peaks?: readonly number[]  // optional, 800 floats — see browser-audio-apis §2.2
}

export type PrompterPartJSON = {
  readonly id: string
  readonly text: string
  readonly promptId?: string       // FK → VoicePrompt
  readonly audioAssetId?: string   // FK → AudioAsset, set after generation
  readonly audioClipId?: string    // FK → AudioClip on Voice track
  readonly status: 'idle' | 'generating' | 'ready' | 'error'
  readonly error?: string
  // deferred: audioSegmentIds for word-level replacement ticket
}

export type PrompterJSON = {
  readonly parts: readonly PrompterPartJSON[]
}

export type SlideJSON = {
  // ...existing
  readonly prompter?: PrompterJSON
  readonly audioTracks?: readonly AudioTrackJSON[]  // Voice/SFX/Music
}

export type LessonLibraryJSON = {
  // ...existing
  readonly assets?: readonly EmbeddedAssetJSON[]  // audio WAVs reuse EmbeddedAsset with mimeType audio/wav
  // or: readonly audioAssets?: readonly EmbeddedAudioAssetJSON[]  // if splitting image vs audio
  readonly voicePrompts?: readonly VoicePromptJSON[] // optional snapshot — see §5.2
}
```

Backend: either extend `AssetDefinition` with `category='audio'` and nullable `width/height` (reusing the existing asset pipeline) or add a dedicated `audio_assets` table by analogy to `app/assets/model.py`. Reusing `AssetDefinition`:

- Pros: `GET /api/assets?category=audio`, existing `StaticFiles` mount, `EmbeddedAssetJSON` already handles `data: base64` + `mimeType` [json.ts:166-172], zero new mounts.
- Cons: `width/height/aspect_ratio` become 0 for audio; add `duration/sample_rate` columns (nullable, handled by `_add_missing_columns` [database.py:32-44]).
- Alternative: `backend/app/audio/model.py` with its own table — cleaner types, but duplicates storage and `library.py` boilerplate. **Recommend reuse first, split later if audio accumulates distinct fields (peaks, waveform version).**

For correctness, the `browser-audio-apis` research already proposes the waveform split: backend-probed `duration/sampleRate/peaks` cached in SQLite + `GET /api/assets/{id}/peaks`, frontend `decodeAudioData` fast path for immediate paint [11 §2.2]. Adopt that for WAV assets without modification.

### 6.3 Generation flow (link across the three entities)

```mermaid
sequenceDiagram
  participant UI as Prompter Part UI
  participant TP as TTSProvider (frontend)
  participant BE as FastAPI :8000
  participant TTS as TTSService (mlx-audio)
  participant DB as SQLite + Storage

  UI->>TP: generate({text, promptId, instruction, language, voice})
  TP->>BE: POST /api/tts/generate {text, promptId,...}
  BE->>TTS: ensure_loaded(); asyncio.to_thread(generate)
  TTS-->>BE: bytes wav, duration, sampleRate
  BE->>DB: write assets/originals/<uuid>.wav, insert audio asset row, commit
  BE-->>TP: 200 audio/wav (bytes) + X-Audio-Duration + X-Asset-Id
  TP->>DB: (no second write; BE already persisted)
  TP-->>UI: AudioAsset {id, duration, originalUrl}
  UI->>Engine: create AudioClip {assetId, offset=nextFreeOnVoiceTrack, trimStart=0, trimEnd=duration}
  UI->>Engine: link PrompterPart {audioAssetId=asset.id, audioClipId=clip.id, status='ready'}
  UI->>Lesson: embedAssetSnapshot(asset) so .lesson is self-contained
```

Notes:

- `offset` for the Voice `AudioClip` is assigned by the engine's track occupancy query (next free gap on Voice lane) — no prompt-provided timing. Duration splitting (proportional-char) for multi-part Slides is handled at command time ("extend + optionally shift downstream" single-slide command, standing decision).
- `AudioClip` scheduling reuses the audio engine contract `audioClip {assetId, trimStart, trimEnd, stretchFactor, preservePitch, derivedAssetId?}` already specced [11 §2.2]; TTS output enters that graph unchanged.
- `.lesson` embedding: call `Project.embedAsset()` with the new `EmbeddedAsset {id, name, data: base64wav, mimeType: audio/wav}` — the same codepath that handles image assets, no new packaging code. On import, `ProjectLibrary.upsert` handles the blob verbatim.
- **Queue feedback:** UI shows per-part `status: 'generating'` spinner; `voicePromptStore.isGenerating` guards duplicate submits; error string maps to `ApiError.detail`.
- **Non-destructive:** Original `text` never overwritten; regenerating replaces `audioAssetId`/`audioClipId` but not `text`. History is via undo stack (single transaction for `GenerateTTS` command that creates asset+clip+part link — matches "One proposal becomes one Undo transaction" pattern from spec 08, deferred per P8-1).

### 6.4 Deferred: multi-segment parts

The "arbitrary word selection → split into [recorded][TTS][recorded] with multiple `AudioSegments` per part" ticket is explicitly deferred. The `PrompterPart` shape leaves room: add `audioSegmentIds: string[]` later where each `AudioSegment {assetId, clipId, range: [start,end]}` maps a text range to audio. For v1, one part = one asset = one clip — no segmentation.

### 6.5 Asset panel reuse

By storing TTS output as `AssetDefinition` with `category='audio'` (or `AudioAsset` sibling), the existing Asset Panel pattern extends with an Audio section (`AssetType audio`, waveform preview) per standing decision "extend existing Asset Panel with Audio section (AssetType audio, waveform preview)" (Map #218). No second browser.

---

## 7. Risks, Caveats, and Open Questions for Grill

1. **1.7B not a dev default** — M1 16GB can *technically* host 1.7B (3.9 GB weights, ~6 GB peak) but leaves little headroom and is 2–4× slower (RTF 2–4 bf16, 1.5 int8 [7]). Document 1.7B as opt-in behind `TTS_MODEL=Qwen3-TTS-12Hz-1.7B-CustomVoice` env var.
2. **Cold load ~2.5 s + first generation 4–8 s** — must be gated behind a warm-up call (`ensure_loaded` triggered by `GET /api/tts/health` on app mount, not lazily on first user click). Show install CTA via 503 `detail` if missing.
3. **`instruct` on MLX experimental path is not supported** — upstream notes `Qwen3TTSMLXModel` lacks `generate_custom_voice(..., instruct=...)` [mlx runtime README]. Use `mlx-audio` Python path to keep instruction control; verify `instruction="warm, slow"` round-trips before claiming it.
4. **blx-audio `4-bit` vs HF `pruned 4-bit` mismatch** — mlx-community ships `*Model-8bit`, AtomGradient ships `*Model-4bit-pruned-vocab-lite`; picking either changes disk and RAM. Pin one (recommend mlx-community 8-bit, 2–3 GB, simplest) and leave pruned 4-bit as power-user tradeoff (smaller but bespoke weights).
5. **Long `.lesson` embed cost** — a 10 s 24 kHz mono WAV is ~480 kB raw, ~640 kB base64. Ten slides × 3 parts × 10 s ≈ 14 MB lesson — acceptable. Hundred parts at 30 s each would bloat; later add "reference-only export" toggle.
6. **SQLite migration discipline** — `Database._add_missing_columns` only backfills nullable, non-unique columns [database.py:47-56]. Mark `duration/sampleRate` on `asset_definitions` nullable to use that path; otherwise write an explicit `ALTER TABLE` + backfill migration.
7. **Rate-limit UX** — single `asyncio.Lock` means second concurrent `POST /api/tts/generate` waits. Frontend should disable Generate while `isGenerating` and show queue depth; do not fan-out multiple parallel synthesis requests for one slide.

---

## 8. Trade-off Summary

| Decision | Option A (recommended) | Option B | Why A |
|---|---|---|---|
| **Model** | 0.6B CustomVoice | 1.7B | 0.6B fits 16GB (2.1 GB peak), sub-realtime int8, 808 MB disk; 1.7B is 4.6 GB + 2–4× slower |
| **Runtime** | `Blaizzy/mlx-audio` Python | C engine / official MLX / Swift | Python most mature, `supports voice cloning + instruct`, pip installable, `Asyncio.to_thread` friendly |
| **HTTP** | Backend singleton, `POST /api/tts/generate → audio/wav` | Proxy to `mlx-tts serve` on :8000 sidecar | Single process, no port conflict, reuses asset pipeline rollback |
| **Streaming** | Defer to v2 | v1 SSE | v1 2–5 s wait is edit-time, WAV bytes simpler for `ApiClient` + `.lesson` embed |
| **Provider seam** | Frontend `TTSProvider` wraps `TtsApi` | Backend strategy | Mirrors existing `AssetsApi`/`ClipsApi` pattern; backend swap is just `provider` field |
| **Prompts storage** | SQLite `voice_prompts` table | `localStorage` / `Project.settings` | Global, queryable, migrates, survives portability — matches `asset_definitions` precedent |
| **Output link** | AudioAsset (reuse `AssetDefinition` category=audio) + AudioClip (Voice lane) + PrompterPart (text+asset+clip) | New audio system parallel to assets | Reuses `StaticFiles`, `EmbeddedAssetJSON`, `.lesson` snapshot, waveform/peaks code |

---

## 9. Integration Checklist (what the builder actually does)

```
backend/app/tts/
  service.py          — TTSService (load_model lazy, asyncio.Lock, to_thread synthesize → bytes+duration)
  model_ext.py        — AudioAsset columns (or reuse asset_definitions with duration/sampleRate)
  schemas.py          — TTSGenerateIn/Out, TtsHealthOut, VoicePrompt schemas

backend/app/voice_prompts/
  model.py            — VoicePrompt SQLAlchemy (id, title, instruction, language?, voice?, params JSON, timestamps)
  schemas.py          — VoicePromptOut/CreateIn/UpdateIn
  library.py          — VoicePromptLibrary (list/get/create/update/delete, ensure_seeded)
  # alternative: collapse voice_prompts into backend/app/tts/ if reviewers prefer fewer modules

backend/app/api/
  tts.py              — POST /api/tts/generate, GET /api/tts/health, GET /api/tts/voices
  voice_prompts.py    — CRUD /api/voice-prompts

backend/app/app_factory.py — mount new routers, app.state.tts_service, app.state.voice_prompt_library
backend/app/assets/storage.py — ensure audio_dir (assets/audio/) or reuse assets/originals
backend/pyproject.toml — add mlx-audio? No — make it optional: extra = [tts]; docs instruct pip install -e ".[tts]"

frontend/src/api/
  ttsApi.ts           — TtsApi (health, listVoices, generateWav via postForWav)
  voicePromptsApi.ts  — VoicePromptsApi (list/get/create/update/delete)

frontend/src/audio/
  ttsProvider.ts      — TTSProvider interface + TTSRequest + AudioAsset
  localTTSProvider.ts — LocalTTSProvider implements TTSProvider via TtsApi (+ optional assetsApi persist)

frontend/src/stores/
  voicePromptStore.ts — Zustand store for prompts + isGenerating/lastError

frontend/src/engine/
  audio.ts            — AudioAsset, AudioTrack, AudioClip types (or extend existing)
  json.ts             — PrompterPartJSON/PrompterJSON/AudioAssetJSON + LessonLibrary voicePrompts
```

Seed PR checklist mirrors `backend/app/materials/library.py` ensure_seeded.

---

## 10. Sources (high-trust, primary)

- QwenLM/Qwen3-TTS GitHub — model release, Apache 2.0, sizes, streaming architecture, 97 ms first-packet, 12Hz codec, FlashAttention, vLLM Omni — [1](https://github.com/QwenLM/Qwen3-TTS) / [2](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE)
- HuggingFace Qwen org — `Qwen/Qwen3-TTS-12Hz-*CustomVoice/Base/VoiceDesign` listings — <https://huggingface.co/Qwen>
- LocalAI Master Aug 2026 — disk sizes (1.81 GB 0.6B, 3.9 GB 1.7B, 0.68 GB tokenizer), CUDA-only note, 8 GB VRAM floor — [3](https://localaimaster.com/blog/qwen3-tts-local-setup)
- AtomGradient HuggingFace — `Qwen3-TTS-0.6B-CustomVoice-bf16-pruned-vocab-lite` (1.5 GB) + `Qwen3-TTS-0.6B-CustomVoice-4bit-pruned-vocab-lite` (808 MB, 67% smaller) + swift-qwen3-tts MLX Swift package, MLX RTF ~0.8, peak 2.4 GB — [4](https://huggingface.co/AtomGradient/Qwen3-TTS-0.6B-CustomVoice-bf16-pruned-vocab-lite) / paper PDF
- AtomGradient swift-qwen3-tts compression paper — 2.35 GB→770 MB (67%), vocab 151,936→47,427 (69%), peak 5.14→2.13 GB (59%), Table 5 — [9](https://atomgradient.github.io/swift-qwen3-tts/paper.pdf)
- Qwen3-TTS technical report (arXiv 2601.15621 excerpt) — dual-track LM, 12.5 Hz 16-codebook, first-packet table 0.6B 97 ms / 1.7B 101 ms, streaming architecture per-packet 320 ms — [10](https://arxiv.org/pdf/2601.15621)
- Qwen3-ASR/TTS Swift blog — 12.5 Hz token rate (80 ms/token), MLX Swift package, batch RTF ~0.55 on M2 Max — [8](https://blog.ivan.digital/qwen3-asr-swift-on-device-asr-tts-for-apple-silicon-architecture-and-benchmarks-27cbf1e4463f)
- Blaizzy/mlx-audio GitHub — MLX TTS on Apple Silicon, Qwen3-TTS support matrix, 8-bit/4-bit/6-bit quant, OpenAI REST — [5](https://github.com/Blaizzy/mlx-audio) / <https://github.com/Blaizzy/mlx-audio/blob/main/README.md>
- suckerfish/qwen3-tts-mlx — MLX 0.6B ~1.5 GB vs 1.7B ~4.5 GB sizing — <https://github.com/suckerfish/qwen3-tts-mlx>
- QwenLM Qwen3-TTS MLX README (official experimental) — `Qwen3TTSMLXModel`, `do_sample=False`, `x_vector_only_mode=True` for 0.6B Base, instruct unsupported — <https://github.com/odiak/Qwen3-TTS-MLX> / <https://github.com/QwenLM/Qwen3-TTS/blob/main/README.md#mlx>
- gabriele-mastrapasqua/qwen3-tts C engine — M1 16GB benchmarks (0.6B bf16 RTF 1.3–1.7, int8 RTF 0.69–0.90, int4 RTF 0.51; 1.7B RTF 2–4; TTFA streaming 0.46 s int8; perf/quantization docs) — [7](https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/main/docs/performance.md) / [6](https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/main/docs/quantization.md)
- mlx-community HuggingFace — `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` etc. listing — <https://huggingface.co/mlx-community>
- realAllenSong/mlx-tts-server + pypi `mlx-tts-server` — OpenAI-compatible serve on :8000, voice alias map (alloy→Aiden) — <https://github.com/realAllenSong/mlx-tts-server>
- Toolkit alternative benchmarks — Piper 40–130 MB/voice, 100–300 MB RAM, 180× RTF, GPL-3.0; Coqui XTTS CPML non-commercial, 1–4 GB RAM; Kokoro/others — [Piper vs Coqui sumguy 2026-02-06](https://sumguy.com/piper-coqui-tts/), [TextToLab open-source TTS 2026-06-03](https://texttolab.com/blog/open-source-text-to-speech), [LocalAI Master best-local-tts 2026-06-20](https://localaimaster.com/blog/best-local-tts-models)
- Backend source read — `backend/app/main.py`, `backend/app/app_factory.py:1-65`, `backend/app/config.py:1-26`, `backend/app/database.py:1-56`, `backend/app/model.py:1-5`, `backend/app/assets/model.py:15-41`, `backend/app/assets/schemas.py:21-50`, `backend/app/assets/importer.py:32-61`, `backend/app/assets/storage.py:30-41`, `backend/app/projects/model.py:1-21`, `backend/app/clips/schemas.py:36-85` (structure, SQLite `create_all` + `_add_missing_columns`, `StaticFiles` mounts, `ApiClient`-adjacent patterns)
- Frontend source read — `frontend/src/api/apiClient.ts`, `frontend/src/api/assetsApi.ts`, `frontend/src/api/clipsApi.ts`, `frontend/src/engine/json.ts:147-332`, `frontend/src/engine/project.ts`, `frontend/src/engine/slide.ts`, `frontend/src/stores/*` (existing ApiClient/Store layering to mirror)
- Prior research file — `docs/research/browser-audio-apis.md` — Web Audio shared playhead, server FFmpeg rubberband, AudioClip shape, waveform peaks dual generation — [11](browser-audio-apis.md)
- GitHub issue #220 body + #218 Map context — per-slide audio, localhost:8000 hop, TTSProvider, voice prompt presets — <https://github.com/MKoth/animated-slideshow-editor/issues/220> / <https://github.com/MKoth/animated-slideshow-editor/issues/218>

[1]: https://github.com/QwenLM/Qwen3-TTS
[2]: https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE
[3]: https://localaimaster.com/blog/qwen3-tts-local-setup
[4]: https://huggingface.co/AtomGradient/Qwen3-TTS-0.6B-CustomVoice-bf16-pruned-vocab-lite
[5]: https://github.com/Blaizzy/mlx-audio
[6]: https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/main/docs/quantization.md
[7]: https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/main/docs/performance.md
[8]: https://blog.ivan.digital/qwen3-asr-swift-on-device-asr-tts-for-apple-silicon-architecture-and-benchmarks-27cbf1e4463f
[9]: https://atomgradient.github.io/swift-qwen3-tts/paper.pdf
[10]: https://arxiv.org/pdf/2601.15621
[11]: browser-audio-apis.md

---

## Appendix — Verified Backend Touchpoints Read

- `backend/app/app_factory.py` — `FastAPI(title=…)`, `Database(database_url)` with `init_schema()`, `AssetStorage(data_dir)`, seeded `MaterialLibrary`/`ShaderLibrary`/`ClipLibrary`, routers under `prefix="/api"`, `StaticFiles` for `assets/originals|thumbnails`, `create_app()` factory.
- `backend/app/config.py` — frozen `Settings(data_dir: Path, database_url: str, max_upload_bytes: int)` from env `DATA_DIR` / `DATABASE_URL`, default `backend/var` and `sqlite:///var/library.db`.
- `backend/app/database.py` — `create_engine(..., check_same_thread=False)`, `Base.metadata.create_all`, `_add_missing_columns` via `inspector.get_columns` + `ALTER TABLE ADD COLUMN` for nullable non-unique columns; non-nullable only if `column.default` present.
- `backend/app/model.py` — single `Base(DeclarativeBase)` central.
- `backend/app/assets/model.py` — `asset_definitions` with `id, name, category, tags, ai_description, width, height, file_size, aspect_ratio, original_path, thumbnail_path` and strict `CheckConstraint` on `ASSET_CATEGORIES`.
- `backend/app/assets/importer.py` — transactional `import_uploads(Upload[filename,content,category])` → `validate_category` → `ImagePipeline.inspect` → `save_original/save_thumbnail` → `session.add` → `session.commit` with file-cleanup rollback.
- `backend/pyproject.toml` — `fastapi>=0.115`, `uvicorn`, `sqlalchemy>=2.0`, `pillow`, `python-multipart`; no TTS deps yet — fits `optional-dependencies[tts]` proposal.
- `frontend/src/api/apiClient.ts` — `ApiClient` with `get/post/put/postForm/putForm/delete`, `ApiError(status, path, detail)`, `fetch` + `response.json()`; needs `postForWav` addition.
- `frontend/src/engine/json.ts` — `EmbeddedAssetJSON {id,name,data:mime,metadata}`, `LessonLibraryJSON {assets,materials,shaders,data_sources,clips}`, `SlideJSON`, `NodeJSON` — extension points marked.
- `docs/research/browser-audio-apis.md` — `AudioClip {assetId,trimStart,trimEnd,stretchFactor,preservePitch,derivedAssetId?}`, dual waveform peaks (frontend `decodeAudioData` + backend `ffprobe`/`wave` SQLite cache), RubberBand server pattern.
