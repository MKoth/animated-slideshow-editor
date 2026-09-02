# ADR 0006 — Clip Extraction, Hierarchical Clips, and Reusable Objects

Date: 2026-09-02
Status: Accepted (grill #13-items)

Context: Engine has Animation Clip (normalized 0..1) and ClipInstance, but no way to derive clips from authored node keyframes, no hierarchy binding, and no reusable subtree library. User’s rig workflow — weight-paint, FK/IK animate, many node keyframes — needs “select keyframes → Add to clip” and hierarchical export/apply by semantic name, plus exporting any subtree as shareable object.

Decision: Clip extraction (“Add to clip”) copies selected node keyframes for uniform-six + visible + circle angles, normalizing time as (t - selStart)/selDuration and value to normalized space, appending channels to new or existing ClipDefinition (Transaction, originals stay). Right-click on timeline selection adds “Add to clip” modal (existing vs new). Clip Collection (alias Rig Animation / Hierarchical Clips) is a map semanticName → clipId owned by a parent node or library entry; hierarchical export walks parent subtree collecting each node’s clipInstances and builds collection; apply walks target subtree broadcasting each clip to every node matching semanticName. Reusable Object serializes an entire subtree (SceneNodes, descendants, bones, IK handles/poles, meshes/circles, materials, clipInstances, semanticNames) into .lesson_object JSON (same Library snapshot shape as .lesson library assets); stored both as file download and as “Objects” library tab (backend table or SQLite category=object). Import copies subtree into active slide with new ids and snapshots definitions into Project.embeddedAssets.

Alternatives: Move not copy keyframes (rejected: destructive); single merged global clip by path (rejected: cannot reuse per-limb); file-only without library or library-only without file (rejected: need both); prefab by reference not copy (rejected: would break snapshot self-containment).
