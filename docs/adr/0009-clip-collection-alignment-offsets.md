# ADR 0009 — Clip Collection Alignment Offsets

Date: 2026-10-07
Status: Accepted

## Context

Shape editing can shift visible artwork within a child while leaving its scene-node transform unchanged. Collections then apply transform clips to semantic-name matches, and the mismatch can produce unwanted motion at handoffs. Freezing poses adds keyframes to the slide and may interpolate different body parts at different rates.

## Decision

- A Clip Collection may store an X/Y alignment offset per semantic name.
- The offset is added to the evaluated local position while a matching collection clip is active, for the full duration of that member clip.
- Offsets belong to the reusable Clip Collection definition, so all placements and applications of that collection share them.
- Offsets are evaluated as a non-destructive layer; source clip keyframes are not rewritten.
- The Animation Manager exposes X/Y numeric editing and a timeline-time preview so the user can inspect the correction at different points in the motion.

## Alternatives considered

- **Write corrections into clip keyframes**: rejected because it mutates shared clip data and makes the correction harder to revise independently.
- **Freeze poses at collection boundaries**: rejected as the primary alignment tool because it writes slide keyframes and can introduce interpolated motion across independently animated parts.
- **Pivot adjustment**: rejected because a pivot affects rotation/scale origin and does not represent a constant translation of a child throughout a collection animation.

## Consequences

- Older collection JSON remains valid; absent offsets mean no correction.
- Copying/reversing a collection carries its alignment offsets.
- Offset coordinates are local to each semantic-name child and therefore follow the rig hierarchy.
- A Clip Collection Alignment Offset is an additional evaluated layer after time clips and Controls.
