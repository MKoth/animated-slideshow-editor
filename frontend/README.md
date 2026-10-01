# AI Slideshow Editor — Frontend

React 19 + TypeScript (strict) + Vite editor shell.

See the [repository README](../README.md) for requirements, installation, and run instructions.

## Scripts

```bash
npm run dev           # start the dev server (port 5173)
npm run build         # typecheck + production build
npm run preview       # preview the production build
npm run lint          # ESLint
npm run typecheck     # TypeScript strict
npm run format        # Prettier (write)
npm run format:check  # Prettier (check only)
npm test              # Vitest (single run)
npm run test:watch    # Vitest (watch)
npm run test:e2e      # Playwright browser tests
npm run test:perf      # Browser performance probes
npm run test:perf:prod # Build, then probe the production preview
```

## Browser performance tests

The performance suite drives the real editor in Chromium and records frame
intervals, long tasks, JS heap/task-duration metrics, and outstanding animation
frame callbacks across repeated Play/Stop cycles. It writes a JSON report under
`test-results/` and attaches it to the Playwright result; it does not use a
machine-specific FPS budget by default.

Install the browser once:

```bash
npx playwright install chromium
```

Start the backend (`uv run uvicorn app.main:app --reload` from `backend/`), then
run a test against a saved project:

```bash
PERF_PROJECT_ID=<project-id> npm run test:perf
```

The test starts Vite automatically and reuses an already-running dev server.
Find saved project IDs at `http://localhost:8000/api/projects`. By default it
plays to 8.5 seconds for four cycles in Dope Sheet view. Adjust the run with
`PERF_CYCLES`, `PERF_STOP_AT_SECONDS`, `PERF_VIEW_MODE=curveEditor`, and
`PERF_MESH_VISIBLE=0` to isolate the Mesh overlay; use `PERF_HEADLESS=0` for a
headed Chromium run. `PERF_SHADOWS=0` strips every `shadowEffect` from the
project response in flight (the saved project is never modified) to isolate the
shadow pipeline. The report includes an idle
baseline and the WebGL renderer when available. Use `PERF_BACKEND_URL` when the
backend is not at `http://localhost:8000` (also set `VITE_BACKEND_URL` for the
Vite proxy). `PERF_CPU_PROFILE=1` adds sampled top JavaScript functions for the
first and last cycle; profiling adds overhead, so use it diagnostically rather
than as a clean timing run. `PERF_HEAP_PROFILE=1` adds sampled allocation
stacks; `PERF_FORCE_GC_AFTER=1` records retained heap after a diagnostic GC.
`PERF_MAX_P95_DEGRADATION_MS` enables a red-capable cycle-to-cycle frame-gap
assertion. `test:perf:prod` compares production-build performance against the
dev-server run using the same saved project.
