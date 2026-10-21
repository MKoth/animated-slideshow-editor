# Scenario Foreign-Word Highlights (LLM) — Follow-up Handoff

Goal: narrator sentences in generated scenario HTML highlight foreign words
with `<strong class="foreign">` spans. The markdown doc is never modified;
detection runs once at Generate time through the same Zen backend as every
other AI request, and the word list is stored beside the HTML for reuse.

## Resolution (2026-10-21)

Root cause was the output token cap, found in the live Responses body:
`status: incomplete`, `output_tokens: 800` = `max_output_tokens: 800` with
`type: reasoning` — the reasoning model spent the whole 800-token budget
thinking and was cut off before emitting any words. Fixed by raising the
endpoint budget to `max(2000, min(row.max_tokens, 4000))`, logging
`incomplete` responses explicitly, and hardening the parser so shredded
API-body residue (`"status":"incomplete"` fragments from the raw-body
fallback) can never become highlight entries. Regenerating the ser/estar
lesson now stores a non-empty `foreignWords` list.

## Current implementation

- `POST /ai/scenarios/markdown/foreign-words` (`backend/app/api/scenario_routes.py:772`,
  schema `AiScenarioForeignWords` in `backend/app/ai/schemas.py`): takes
  `{projectId, conversationId?, text}` where `text` is all narrator sentences
  glued with `\n`. Returns `{words: [...]}`. Writes nothing, creates no
  versions. Missing key → 409; provider failures → 502 with the provider
  status and a body snippet in `detail.message`.
- Mock seam `detect_scenario_foreign_words` (`scenario_routes.py:719`) calls Zen
  non-streaming: structured `{"words": [...]}` call first (`_post_foreign_words_once`,
  `scenario_routes.py:663`), plain-completion retry on HTTP 400 only (some
  models/gateways reject `response_format`). Uses the row's configured
  temperature (a hardcoded 0 was rejected by some models) and
  `min(max_tokens, 800)` with a 180s timeout.
- Parsing is fully defensive (`parse_foreign_words_content`, `:603`): JSON
  object, bare JSON array, `[...]` span scan, then bare-list fallback (lines,
  comma splits, bullets/numbering/backticks/quotes/`**` stripped, ≤8 words,
  ≤120 chars, deduped). Unparseable or empty → `[]`, never an error.
- Frontend `AiScenarioModal.handleGenerate` is async with a `generatingHtml`
  loader state ("Generating HTML…" button). Narrators are glued client-side,
  `store.api.detectForeignWords` is called, failures notify and Generate
  still completes without highlights. The list is stored via
  `withScenarioHtml(section, html, pointer, foreignWords?)` and reused by
  View and the `.zip` download — no extra LLM calls. Frontend matches list
  entries verbatim (case-insensitive whole words/phrases, longest-first) via
  `normalizeForeignWords` / `findForeignSpans` in
  `frontend/src/engine/scenarioChalkRender.ts`; `**marked**` spans still work
  everywhere. Deleted wordlist approach files:
  `frontend/src/engine/englishCommonWords.ts`,
  `frontend/src/engine/scenarioSpanishWords.ts` (both removed from tree).
- Tests: `backend/app/tests/test_scenario_foreign_words.py` (12 tests:
  prompt shape, parser shapes incl. bare lists, round trip, 422/409/502,
  400-fallback, non-retry on 500, empty/non-JSON 200 handling, message
  contents); frontend `aiScenarioGenerate.test.tsx` (+loader, +LLM list,
  +failure path), `scenarioChalkRender.test.ts` (list matching incl.
  longest-first, whole-word, no-nesting, invented-entry exclusion).

## Verified working

- `pytest` full backend suite: 432 passed. `ruff check` + `ruff format --check`
  clean on touched files.
- Frontend `tsc --noEmit`, eslint, prettier clean on touched files; related
  suites green (chalk render 20, generate 7, modal 16, view, download,
  history, doc-comments, all `engine/scenario*` unit files).

## Open problem (resolved — see Resolution above; kept for history)

Against the real provider the endpoint returns `{"words": []}` for narrator
text that plainly contains Spanish (e.g. the ser/estar oak-tree lesson:
"árbol de roble, duradero y sólido", "soy de Texas", "estoy cansado").
No 502 anymore — transport works; the list comes back empty.

Ruled out / already handled, do not re-investigate without new evidence:
- Wordlist/heuristic matching is gone; matching is verbatim LLM-list only.
- Prompt explicitly demands ONLY `{"words": [...]}` verbatim entries.
- Parser now accepts JSON, `[...]` spans, and bare line/comma/bullet lists;
  `**`/quotes/backticks/numbering stripped; deduped and capped.
- 400 → plain retry; temperature = row setting; timeout 180s; empty/non-JSON
  200 → `[]` (not 502).

## Next step (first thing to do)

1. Reproduce once via the UI (Scenario modal → Generate HTML) and read the
   backend terminal. On an empty parse the backend now logs at warning:
   `ai foreign-words parsed 0 words from NNN chars of input; raw model reply: ...`
   (see `scenario_routes.py:762`). That line distinguishes the two remaining
   hypotheses:
   - **Reply is `[]` or prose with no usable words** → the model is not
     following the instruction with this prompt/model. Rewrite the prompt
     (stronger: forbid bullets/prose, demand a bare JSON array, or drop the
     schema and rely on the bare-list parser), or pin temperature 0 for this
     call only if the model accepts it.
   - **Reply contains words but the parser drops them** → extend
     `parse_foreign_words_content` / `_clean_foreign_entry` for the observed
     shape (add a test with the exact raw reply first).
2. Unverified suspicion, touch only with evidence: the Anthropic branch of
   `_structured_inference_payload` (`scenario_routes.py:63`, copied verbatim
   from `app/api/ai.py`) sets `payload["output_config"]`; if Zen's
   `/messages` path expects `output_format` instead, Anthropic-family models
   may silently ignore the schema. Confirm via the logged payload behavior
   or Zen docs before changing it — the 400-fallback already covers a hard
   rejection, not a silent ignore.
3. Do not reintroduce language wordlists, do not touch the markdown format,
   do not add a View-time refetch (View/Download reuse the stored list by
   design; regenerating replaces it).

## Verification for the fix

- Add the observed raw reply as a `parse_foreign_words_content` test case
  (or a prompt-shape test if the prompt changes), run
  `python -m pytest app/tests/test_scenario_foreign_words.py -q` (backend/),
  then regenerate from the ser/estar lesson text above and assert the stored
  `foreignWords` is non-empty and the Preview iframe contains
  `<strong class="foreign">árbol</strong>`.
