"""Spec 12 assembly merge gate (issue #428).

Agent project ops stay limited to create-blank-middle,
open-named-intro/outro-read-only, and duplicate-to-assembly-target (no
delete/rename, sources never mutated). The assembly target is a new project
(fresh id, uniquified assembled name, fresh timestamps) from a
duplicate-middle base — preserving prompter settings and clip/script
libraries — ordered intro then middle then outro.

The merge joins the canonical proposal surface (schema validation plus
dry-run in order, explicit accept, runs only on accepted prompter,
calibration, and board versions).
"""

from __future__ import annotations

from typing import Any

ASSEMBLY_STALE_MESSAGE = (
    "merge runs only on fully accepted Stage C, D, and E versions — "
    "accept the narration, calibration, and board scripts first"
)


def assembly_accept_blockers(statuses: dict[str, Any]) -> list[str]:
    """Fixable blockers when any of narration/calibration/board is not accepted."""
    blockers: list[str] = []
    if statuses.get("narration") != "accepted":
        blockers.append(
            "narration (Stage C Prompter fill) is not accepted — "
            "accept it before the merge (assembly reads only the accepted version)"
        )
    if statuses.get("calibration") != "accepted":
        blockers.append(
            "calibration (Stage D) is not accepted — "
            "accept it before the merge (assembly reads only the accepted version)"
        )
    if statuses.get("board") != "accepted":
        blockers.append(
            "board scripts (Stage E) are not accepted — "
            "accept them before the merge (assembly reads only the accepted version)"
        )
    return blockers


def require_accepted_for_merge(statuses: dict[str, Any]) -> None:
    """Raise ValueError with a fixable message unless C+D+E are all accepted."""
    blockers = assembly_accept_blockers(statuses)
    if blockers:
        pending = "; ".join(blockers)
        raise ValueError(f"{ASSEMBLY_STALE_MESSAGE}: {pending}")


def unique_assembled_name(base_name: str, existing_names: list[str]) -> str:
    """Uniquified assembled name: `<base> (assembled)` with numeric suffix."""
    existing = set(existing_names)
    base = (base_name or "").strip() or "Lesson"
    first = f"{base} (assembled)"
    if first not in existing:
        return first
    counter = 2
    while True:
        candidate = f"{base} (assembled {counter})"
        if candidate not in existing:
            return candidate
        counter += 1


def suffix_name(name: str, occurrence: int) -> str:
    """Ordered numeric auto-suffix: first-keeps, later `name (2)`, `name (3)`, …"""
    if occurrence <= 1:
        return name
    return f"{name} ({occurrence})"


def resolve_name_collisions(target_names: list[str], incoming_names: list[str]) -> list[str]:
    """First-keeps with ordered numeric suffix (slides + definition names)."""
    seen: dict[str, int] = {}
    for name in target_names:
        seen[name] = seen.get(name, 0) + 1
    out: list[str] = []
    for name in incoming_names:
        occurrence = seen.get(name, 0) + 1
        seen[name] = occurrence
        out.append(suffix_name(name, occurrence))
    return out


def union_ids_by_id(
    target: list[dict[str, Any]], incoming: list[dict[str, Any]] | None
) -> tuple[list[dict[str, Any]], list[str]]:
    """Union-on-id: same id keeps target, different ids kept separate."""
    ids = {str(entry.get("id")) for entry in target}
    merged = [dict(entry) for entry in target]
    added: list[str] = []
    for entry in incoming or []:
        entry_id = str(entry.get("id", ""))
        if entry_id in ids:
            continue
        ids.add(entry_id)
        merged.append(dict(entry))
        added.append(entry_id)
    return merged, added
