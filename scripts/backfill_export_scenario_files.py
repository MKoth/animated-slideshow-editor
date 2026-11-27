#!/usr/bin/env python3
"""Backfill missing scenario files into existing video-export folders.

Dry-run by default. Pass --apply to copy files; existing destination files are
never overwritten. Reads project blobs and asset metadata from library.db.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "backend/var/library.db"
EXPORTS = ROOT / "backend/exports"
THEME = ROOT / "frontend/public/scenario-theme"


def asset_keys(markdown: str) -> list[str]:
    keys: list[str] = []
    for match in re.finditer(r"!\[[^\]]*\]\(\s*asset:([^)\s]+)\s*\)", markdown):
        key = match.group(1).strip().lower()
        if key and key not in keys:
            keys.append(key)
    return keys


def slug(key: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", key)).strip("-") or "visual"


def srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{whole_seconds:02},{millis:03}"


def build_chapters(slides: list[dict], export_slides: dict) -> list[dict]:
    chapters = []
    offset = 0.0
    for slide in slides:
        entry = export_slides.get(slide.get("id"))
        if not entry:
            continue
        duration = float(entry.get("duration", slide.get("duration", 0)))
        if duration <= 0:
            continue
        chapters.append({
            "index": len(chapters) + 1,
            "slideId": slide["id"],
            "title": entry.get("name", slide.get("name", "")),
            "start": offset,
            "duration": duration,
        })
        offset += duration
    return chapters


def build_subtitles(slides: list[dict], chapters: list[dict]) -> str:
    slides_by_id = {slide.get("id"): slide for slide in slides}
    cues = []
    offset = 0.0
    for chapter in chapters:
        slide = slides_by_id.get(chapter["slideId"], {})
        prompter = slide.get("prompter") or {}
        for part in prompter.get("parts", []):
            text = str(part.get("text", "")).strip()
            if not text:
                continue
            start = offset + float(part.get("startTime", 0))
            end = offset + float(part.get("endTime", part.get("startTime", 0)))
            cues.append({"text": text, "start": start, "end": max(start, end)})
        offset += chapter["duration"]

    # Match the export cue overlap rule: a later cue takes over when it
    # begins before this cue ends and extends beyond this cue's end.
    for index, cue in enumerate(cues):
        takeover = next((item for item in cues[index + 1:] if item["start"] < cue["end"] < item["end"]), None)
        if takeover:
            cue["end"] = max(cue["start"], takeover["start"])

    blocks = []
    for index, cue in enumerate(cues, start=1):
        blocks.append(
            f"{index}\n{srt_timestamp(cue['start'])} --> {srt_timestamp(cue['end'])}\n{cue['text']}"
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write missing files (default is dry-run)")
    parser.add_argument("--exports", type=Path, default=EXPORTS, help="export folder root")
    args = parser.parse_args()

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    projects = db.execute("SELECT id, blob FROM projects").fetchall()
    assets = {
        row["id"]: row
        for row in db.execute(
            "SELECT id, original_filename, original_path, mime_type FROM asset_definitions"
        )
    }
    created = 0
    skipped = 0
    planned = 0

    for project in projects:
        project_id = project["id"]
        export_dirs = [p for p in args.exports.glob(f"*--{project_id}") if p.is_dir()]
        if not export_dirs:
            continue
        data = json.loads(project["blob"])
        scenario = data.get("scenario") or {}
        markdown = scenario.get("currentMarkdown") or ""
        html = scenario.get("lastHtml") or ""
        if not markdown and not html:
            continue

        # Existing scenario renders use assets/board-tile.png. Keep the image
        # physically beside index.html and make that URL resolve beside it.
        html = html.replace("assets/board-tile.png", "board-tile.png")
        source_files: dict[str, Path] = {}
        board_tile = THEME / "board-tile.png"
        if "board-tile.png" in html and board_tile.is_file():
            source_files["board-tile.png"] = board_tile
        for font in ("crayon-libre-regular.woff2", "crayon-libre-italic.woff2"):
            source = THEME / "fonts" / font
            if f"assets/fonts/{font}" in html and source.is_file():
                source_files[f"assets/fonts/{font}"] = source

        bindings = scenario.get("bindings") or {}
        keys = asset_keys(markdown)
        filenames: dict[str, str] = {}
        used: set[str] = set()
        for key in keys:
            asset_id = bindings.get(key)
            asset = assets.get(asset_id)
            if not asset:
                continue
            asset_path = ROOT / "backend/var" / asset["original_path"]
            suffix = Path(asset["original_filename"] or asset_path.name).suffix.lower() or ".png"
            name = f"{slug(key)}{suffix}"
            base, ext = Path(name).stem, Path(name).suffix
            index = 2
            while name in used:
                name = f"{base}-{index}{ext}"
                index += 1
            used.add(name)
            filenames[key] = name
            if asset_path.is_file() and f"assets/{name}" in html:
                source_files[f"assets/{name}"] = asset_path

        for export_dir in export_dirs:
            target_dir = export_dir / "scenario"
            files: dict[str, bytes | Path] = {}
            if markdown:
                files["scenario.md"] = markdown.encode("utf-8")
            if html:
                files["index.html"] = html.encode("utf-8")
            files.update(source_files)
            export_manifest_path = export_dir / "export-manifest.json"
            export_manifest = json.loads(export_manifest_path.read_text(encoding="utf-8")) if export_manifest_path.is_file() else {}
            export_slides = export_manifest.get("slides") or {}
            chapters = build_chapters(data.get("slides", []), export_slides)
            if export_slides and not (export_dir / "chapters.json").exists():
                files["chapters.json"] = (json.dumps(chapters, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            if export_slides and not (export_dir / "subtitles.srt").exists():
                files["subtitles.srt"] = build_subtitles(data.get("slides", []), chapters).encode("utf-8")
            for relative, content in files.items():
                target = (export_dir / relative) if relative in {"chapters.json", "subtitles.srt"} else (target_dir / relative)
                if target.exists():
                    skipped += 1
                    continue
                planned += 1
                print(f"{'COPY' if args.apply else 'WOULD COPY'} {target}")
                if args.apply:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if isinstance(content, Path):
                        shutil.copyfile(content, target)
                    else:
                        target.write_bytes(content)
                    created += 1

    print(f"Created {created} file(s)." if args.apply else f"Would create {planned} file(s).")
    print(f"Skipped existing files: {skipped}.")
    if not args.apply:
        print("Dry run only. Re-run with --apply to write files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
