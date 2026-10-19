# Research: portable .zip packaging for HTML + assets (ticket #453, map #451)

Branch: `research/zip-packaging` · Map #451 · Ticket #453 — throwaway, spec input only.

## Recommendation

**Use [`fflate`](https://github.com/101arrowz/fflate) (latest 0.8.3, MIT, ~8 kB) over JSZip (3.10.2, MIT-or-GPL, ~100 kB+).**
Why: zero-dependency, ships its own TS types (JSZip needs `@types/jszip`),
first-class ESM browser entry (`fflate/browser`, sync + async `zip`/`zipSync`),
and an order of magnitude smaller — relevant because the zip builder ships to
every editor user but runs only on export click. JSZip's nicer API
(`zip.file(name, blob)`, streaming `generateAsync`) does not outweigh size +
dual-license friction. No zip library is in use today (verified:
`frontend/package.json` deps + lockfile grep — only false positive is
`research/morph-brush`).

## Reuse points in current code

| Existing code | Reuse for .zip |
|---|---|
| `frontend/src/app/lessonTransfer.ts:63-71` `downloadLessonCopy` — `Blob` + `URL.createObjectURL` + anchor `download` + `revokeObjectURL` | Same tail for the `.zip` Blob (`application/zip`); only the filename changes (`${project.name}.zip`). Failure path already has a precedent (`DOWNLOAD_FAILED_MESSAGE` + `notificationStore`). |
| `frontend/src/app/assetSnapshot.ts` — `ensureReferencedEmbedded` / `fetchImageBytes` (fetch → base64, chunked `btoa`) | Guarantee step before zipping: referenced scenario visuals must be embedded first, exactly as `.lesson` download does. Embedded form is base64 (`EmbeddedAsset { id, name, data, mimeType }`, `frontend/src/engine/embeddedAsset.ts`) — decode with `Uint8Array.from(atob(data), c => c.charCodeAt(0))` (chunked for large assets) into zip entries. |
| `frontend/src/api/assetsApi.ts:14` `AssetDefinition` (`original_filename`, `mimeType`, `name`) | Source of truth for file extensions + MIME when naming zip entries. |
| `frontend/src/engine/export.ts` (video export descriptors) | Untouched — out of scope per map; .zip is a separate client-side builder, no FFmpeg involvement. |

## Proposed layout + naming

```
<project-name>.zip
├── index.html            # generated chalk HTML, self-contained except assets/
├── assets/
│   ├── <alt-name>.<ext>  # one file per visual, keyed by MD alt-name
│   └── fonts/
│       └── <font>.woff2  # offline font subset/files, no CDN refs
└── manifest.json         # alt-name → file map + generator version (port contract)
```

- **Alt-name filename mapping:** the MD step template carries one alt-name per
  visual (map #451 Notes). Slug it (`lowercase, [^a-z0-9]+ → -`) for the
  filename, keep the original alt-name as key in `manifest.json`
  (`{ "altName": "hero-castle", "file": "assets/hero-castle.png", "mime": "image/png" }`).
  Collisions (two visuals slug to same name) get a numeric suffix; the manifest
  is the disambiguator the external app reads — never the raw filename.
- **Relative-path rule:** `index.html` references only `assets/...` relative
  paths, no absolute URLs, no `original_url`/thumbnail URLs. Verify by
  string-scan for `http://`, `https://`, `//` in `src|href|url(` before zipping.
- **Offline-font rule:** no Google Fonts / CDN `<link>`; embed woff2 under
  `assets/fonts/` with `@font-face` relative `src:`. Chalk theme fixes one
  mandatory font (choice still open on the map), so a single subset file keeps
  the zip small.
- **Port contract for the external app:** `manifest.json` (`version`,
  `altName → file`, `entry: "index.html"`) is the stable surface; folder names
  (`assets/`, `assets/fonts/`) are fixed by spec, filenames inside are not.

## Limits + edge cases

- **Size:** v1 images only (prompt-briefs + uploads, no T2I). Base64 inflates
  embedded bytes ~33%; decode to raw bytes before adding to the zip. fflate
  DEFLATE on PNG/JPEG gains little (~0-5%) — set level 0/store for already
  compressed media, compress only `index.html`/`manifest.json`. Practical cap:
  warn above ~100 MB total (browser RAM + single Blob), block above ~500 MB.
- **Main-thread jank:** `zip()` async variant or chunked `zipSync` in a worker
  for large packs; `fetchImageBytes` already yields to the event loop per chunk
  (`assetSnapshot.ts:185`) — mirror that pattern.
- **Double-click open:** `file://` forbids `fetch()`/modules — `index.html`
  must work with plain `<img src="assets/...">` + inline `<style>`, no JS
  module imports, no runtime fetches.
- **Blocking checklist interplay:** missing HTML assets per alt-name stay a
  blocking checklist (map Notes) — the zip builder refuses to run until every
  alt-name resolves to an embedded asset, so the zip never ships broken refs.
- **Security:** sanitize `original_filename` (strip `../`, control chars);
  authoritative name is the slugged alt-name, not user upload names.

## Open for spec (not decided here)

Chalk font choice + subset tool; `.lesson` JSON section holding the MD/HTML
(map "Not yet specified"); exact `manifest.json` schema versioning.
