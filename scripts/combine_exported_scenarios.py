#!/usr/bin/env python3
"""Combine exported scenario Markdown files into one document.

Reads `*/scenario/scenario.md` from the export root, in folder-name order,
and writes `combined-scenarios.md` beside the project export folders.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EXPORTS = ROOT / "backend/exports"


def title_for(markdown: str, folder_name: str) -> tuple[str, str]:
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r"^#\s+(.+?)\s*#*\s*$", line)
        if match:
            title = match.group(1).strip()
            # Demote the source document's title beneath its combined-doc section.
            lines[index] = f"### {title}"
            return title, "\n".join(lines).strip()
    return folder_name, markdown.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exports", type=Path, default=DEFAULT_EXPORTS, help="video exports directory")
    parser.add_argument("--output", type=Path, help="output Markdown path (default: <exports>/combined-scenarios.md)")
    args = parser.parse_args()

    export_root = args.exports.expanduser().resolve()
    output = (args.output or export_root / "combined-scenarios.md").expanduser().resolve()
    sources = sorted(export_root.glob("*/scenario/scenario.md"), key=lambda path: path.parent.parent.name.casefold())

    sections = ["# Combined Scenarios"]
    for index, source in enumerate(sources, start=1):
        markdown = source.read_text(encoding="utf-8").strip()
        if not markdown:
            continue
        title, content = title_for(markdown, source.parent.parent.name)
        sections.extend((f"## Scenario {index:02d} — {title}", "", content))

    if not sources:
        parser.error(f"No exported scenario Markdown files found under {export_root}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n\n---\n\n".join(sections) + "\n", encoding="utf-8")
    print(f"Combined {len(sources)} scenario file(s) into {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
