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

Run only related tests during development (e.g. `npm run test --prefix frontend -- <pattern> --run`). Full suites run automatically via the `husky` pre-commit hook (`frontend/.husky/pre-commit` → `lint-staged` → `vitest run` / `pytest`); avoid running the entire suite locally unless needed.
