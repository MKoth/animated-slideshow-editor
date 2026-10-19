# Research: fixed mandatory chalk theme (issue #452, map #451)

## Recommendation (one line)

Headings **Cabin Sketch 700**, body/handwriting **Kalam 400/700**, both SIL OFL 1.1,
self-hosted as subsetted `woff2` via `@font-face` from `assets/fonts/`; all other
typography falls back to `cursive, system-ui`. Tokens + CSS below lock identical
offline rendering of the portable `index.html`.

## 1. Font candidates

| Role | Font | Designer | License (verified) | Weights / subsets | Why |
|---|---|---|---|---|---|
| Headings, table headers | Cabin Sketch | Impallari Type | OFL 1.1 (`fonts/ofl/cabinsketch/OFL.txt` in `google/fonts`) | 400 + 700, `latin` (`METADATA.pb`) | Sketchy chalk-outline display face; Bold reads at slide sizes |
| Body, narrator, table cells | Kalam | Indian Type Foundry | OFL 1.1 (`fonts/ofl/kalam/OFL.txt`) | 300/400/700, `latin` + `latin-ext` (`METADATA.pb`) | Handwriting with 3 weights (Light/Regular/Bold); `latin-ext` covers ES/DE diacritics the lesson scripts use |
| Alt-name accents / fallback hand | Shadows Into Light (alt) | Kimberly Geswein | OFL 1.1 (`fonts/ofl/shadowsintolight/OFL.txt`) | 400 only, `latin` | Single weight → body fallback only, not primary |

Runner-up rejected as primary: Shadows Into Light has one weight and no `latin-ext`;
keep it as optional accent face or drop it to save bytes.

## 2. License + woff2 embeddability

- OFL 1.1 Permission & Conditions (primary source: the three `OFL.txt` files above)
  grant `use, study, copy, merge, embed, modify, redistribute`; §2 allows bundling
  with software provided each copy carries the copyright notice + license text.
- OFL Definitions explicitly count `changing formats` as a permitted Modified
  Version → converting the repo TTFs to `woff2` (e.g. `fonttools`) is licensed.
- Consequence for the `.zip`: ship `assets/fonts/*.woff2` + `assets/fonts/OFL.txt`
  (one copy per family, attribution headers intact). Unmodified files keep their
  Reserved Font Names (`"Cabin"`, `"Cabin Sketch"`); if the pipeline subsets or
  converts, that is a format-change Modified Version, still OFL, names unchanged.
- No Google-Fonts CDN `<link>` in the export: offline `file://` must not depend
  on `fonts.googleapis.com` / `fonts.gstatic.com` (blocked offline, also a
  tracking/portability liability). CDN allowed only in the online preview.

## 3. Palette tokens (on blackboard)

Background `--board: #20302A` (dark slate-green). All pairs computed locally
against WCAG relative-luminance (AA body ≥ 4.5):

| Token | Value | Use | Contrast on `--board` |
|---|---|---|---|
| `--chalk` | `#F4F1E8` | body text, headings, table text | 12.25 (AAA) |
| `--chalk-dim` | `#C9CFC4` | secondary / narrator voice | 8.70 (AAA) |
| `--chalk-yellow` | `#F2D98C` | accent 1, highlights | 9.94 |
| `--chalk-pink` | `#F2A9C4` | accent 2 | 7.41 |
| `--chalk-blue` | `#A9CDF2` | accent 3, links | 8.37 |
| `--chalk-green` | `#A8D5A2` | accent 4 / success | 8.37 |
| `--chalk-orange` | `#F2B880` | accent 5 / warnings | 7.87 |
| `--board-line` | `rgba(244,241,232,.55)` | borders, table rules, chalk dividers | decorative (≥3:1 not required; text still uses `--chalk`) |
| `--board-erase` | `rgba(244,241,232,.08)` | smudge wash under headings | decorative |

Rule: body/table text uses `--chalk` or `--chalk-dim` only; accent hues mark
voice/role chips and highlights, never sole carriers of meaning (print-safe).

## 4. Texture / noise without external assets

- No external images, no CDN. Blackboard grain = inline SVG `feTurbulence`
  data-URI overlay (`opacity ~.05`) + a second large-radius radial-gradient
  vignette; both are code, travel inside `index.html`.
- Chalk stroke effect = `text-shadow: 0 0 1px currentColor` plus
  `letter-spacing: .01em`; borders get `border-radius: 255px 15px 225px 15px/15px 225px 15px 255px`
  (hand-drawn wobble) — pure CSS, no assets.
- `prefers-reduced-motion` disables any chalk-draw animation; static page is
  the default (interactivity scope is a separate ticket).

## 5. CSS constraints for identical offline rendering

1. Single self-contained `index.html` + relative `assets/` dir; no absolute
   paths, no `http(s):` URLs, no `@import` of remote CSS.
2. Fonts: `@font-face` with `font-display: swap`, `src: url(assets/fonts/….woff2)
   format('woff2')`, `unicode-range: U+0000-00FF,U+0100-024F` (latin/latin-ext
   subset at build time); stack
   `--font-head: 'Cabin Sketch', 'Kalam', cursive;`
   `--font-body: 'Kalam', 'Shadows Into Light', cursive, system-ui;`
3. Lock metrics: `line-height` ≥ 1.5 body / 1.2 headings, `max-width: 70ch`
   column, table `border-collapse` with `--board-line` rules — no dependency
   on system-font metrics for layout.
4. Color-scheme lock: `color-scheme: only light` is wrong here — set
   `:root { color-scheme: dark; }` so form/scrollbar widgets match; never use
   `CanvasText`/`currentColor`-against-UA defaults for chalk colors (hard-code
   the tokens so forced-colors/print don't shift them).
5. Print: `@media print { background: #fff; color: #000; fonts: system serif;
   hide grain overlay }` — ink-safe fallback; screen theme untouched.
6. Validation gate (spec, not impl): export test opens `index.html` with
   network disabled (`file://`), asserts zero failed requests, screenshots
   match the online preview pixel-diff threshold, and `assets/fonts/OFL.txt`
   exists per family.

## Sources

- `https://github.com/google/fonts` `ofl/cabinsketch/{OFL.txt,METADATA.pb}`,
  `ofl/kalam/{OFL.txt,METADATA.pb}`, `ofl/shadowsintolight/{OFL.txt,METADATA.pb}`
  (license + weights + subsets; fetched 2026-10-19)
- Contrast ratios computed locally via WCAG relative-luminance script
  (values in §3 table)
