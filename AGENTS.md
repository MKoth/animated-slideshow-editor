## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on github.com/MKoth/animated-slideshow-editor, used via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical GitHub labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Implementation contract

The 12 phase specs on github.com/MKoth/animated-slideshow-editor are the implementation contract, indexed by the Spec index issue (https://github.com/MKoth/animated-slideshow-editor/issues/21).

### Interactive decisions

When presenting design choices or multiple-option decisions to the user, always use the `question` tool instead of listing options as plain text. This gives the user clickable UI to answer and produces structured results.

### Testing

Run only related tests during development (e.g. `npm run test --prefix frontend -- <pattern> --run`). The `husky` pre-commit hook runs `lint-staged` → `vitest run` / `pytest` over the staged files, so it does not exercise the whole suite; avoid running the entire suite locally unless needed.

The full frontend suite has a known OOM: `frontend/src/tests/meshGenerationSection.test.tsx` exhausts its vitest worker, so the tail of its tests never run and the run exits 1 with `Worker exited unexpectedly`. It reproduces on `main` and in isolation (a larger heap only delays it) — judge a full-suite run by its failures, not its exit code. The tally survives the crash: `npm run test --prefix frontend -- --run --reporter=json --outputFile=/tmp/vitest.json`, green when `numFailedTests` is 0.
