# Prototype: Throwaway Animation Manager modal — filtered lanes, clip bar with resize, editor sub-view

**Ticket:** #317 — Prototype: Throwaway Animation Manager modal — filtered lanes, clip bar with resize, editor sub-view
**Map:** #306 — Wayfinder map — Animation Manager for Hierarchical Objects
**Branch:** `research/manager-silhouette`
**Date:** 2026-09-08

---

## What was built

Throwaway branch `research/manager-silhouette` (prototype name `research/manager-loop`) proving the loop:

- **Entry:** `ScenePanel.tsx:30,650` `AnimationManagerModal` wired to context menu `Animation Manager…` (`data-testid="scene-animation-manager"`) between existing Group and `Export Clip Collection…`. Reuses the same fixed `click` + Escape lifecycle as `ScenePanel.tsx:250-263` and `ScenePanel.tsx:536-537` sibling modal state (`managerParentId`).

- **Modal chrome:** Reuses `ExportClipCollectionModal.tsx:154-195` hand-rolled `modal-overlay` pattern (fixed `inset:0`, `rgba(0,0,0,0.5)`, `zIndex:1000`, `role="dialog"` + `aria-label`, backdrop `onClick` + Escape). Scaled up to **big modal** per research finding `research/manager-modal-library` §3: `minWidth:760, maxWidth:960, width:92vw, minHeight:520, maxHeight:88vh`, 2-pane interior (left `TRACK_HEADER_WIDTH=240` headers + right `timeline-scroller`-like time area) reusing `TimelineBody` flex concept.

- **Filtered lanes (`managerRows`):** New derivation `AnimationManagerModal.tsx:managerRows` walking only children of the selected parent (recursive `walkPreOrder`) and keeping nodes where `node.clipInstances.length>0` OR `slide.animation.node(node.id)` has anyAnimated track (`animatablePropertiesOf`, `hasVisibleTrack`, `hasMorphTrack`, `materialTrackParameterKeys`, `shadowTrackKeys`, `hasSymmetryTrack`, circle/dataLabel/table). This is the param-filtered row predicate sketched in `research/manager-modal-library-findings.md` §6 but absent from `timelineTracks.ts:168-258`.

  - Entry is gated in v1 at the modal body rather than the menu (disabled tooltip deferred) — menu always enabled when right-clicking a parent; empty filtered state shows dashed `No animated children` banner explaining the affordance.

- **Lane-per-ClipInstance bar:** Each `node.clipInstances` entry renders one absolute bar on its row (`top: rowIndex*ROW_HEIGHT`, `height: ROW_HEIGHT-8`, `left=start*pps`, `width=visualDuration*pps`) with name only (`clip.name`) — matches ticket and `research/manager-timeline-clip-findings.md` §2. Visual duration computed as `visual = clip.duration / speed` (`clipInstance.ts`, `animationEvaluator.ts:1050`) clamped `Math.max(MIN_VISUAL 0.25, Math.min(raw, slide.duration - startTime))` with `EPS=1e-4` guard for `speed=0` / `duration=0` (rendered as 12px tick).

- **Move & resize handles (condense):** Two 6px `ew-resize` handles per bar (`data-testid="clip-bar-handle-left/right"`) reusing `SelectionScaleBox` `timelineComponents.tsx:196-276` visual parity (`width:6, cursor:ew-resize, background:var(--color-accent), opacity:0.7`). Drag loop is `window.pointermove / pointerup / pointercancel` exactly like `keyframeScale.ts:258-347` and `keyframeDrag.ts:232-286`.

  - **Move:** `delta=(curX-startX)/pps`, `newStart=clamp(origStart+delta, 0, duration-visual)` snapping to `rulerTickStep(pps)` when `gridSnapEnabled`. Commits `SetClipInstanceStartTimeCommand`.

  - **Right handle:** `newVisual=clamp(raw - origStart, MIN_VISUAL, duration-origStart)`, `newSpeed=clip.duration / newVisual` clamped `>=EPS`, commit `SetClipInstanceSpeedCommand`. Keeps `startTime`.

  - **Left handle:** Pin right edge (`rightEdge=origStart+origVisual`), `newStart=clamp(snap(raw), 0, rightEdge-MIN_VISUAL)`, `newVisual=rightEdge-newStart`, `newSpeed=clip.duration/newVisual`. Commits `Transaction[SetClipInstanceStartTime, SetClipInstanceSpeed]` so one undo entry (mirrors `TransactionCommand` `transactionCommand.ts:19-58` flattening/nested handling).

  - Persistence via `Internal` `setClipInstanceStartTime`/`setClipInstanceSpeed` (`internal.ts:4352-4362`) emitting `ClipInstance*Changed` — `useEngineEvent` tick re-renders bars; undo via `undoStack.ts` grouped entry for left handle, separate entries for move/right. Speed clamping avoids `duration/0` infinite width (capped to `MAX_VISUAL` via `Math.min(..., slide.duration - start)`).

  - Disabled bars (`!inst.enabled`) dim `opacity:0.5`, `border:dashed`, `cursor:not-allowed`, no drag (`disabled` branch in rendering, matches spec `311`).

- **Inline clip editor sub-view:** Right-click bar → context menu (`role=menu` at `clientX/clientY`) with `Edit` (`data-testid="clip-bar-edit"`), also double-click — instant drill-in (no double-confirm). Sets `editing={clipId,nodeId}` which switches time area to `ClipEditorSubView` reusing `clipChannelRows(clip)` (`timelineTracks.ts:276-292`) — header `Editing <Clip> — <Object>` + `← Back` (`pps` preserved from global store), banner `Edits affect all N uses` (global `ClipDefinition`, no fork; `countClipUses` walks `walkPreOrder`), per-channel diamonds `left: kf.time * pps` (`clipDefinition.ts:163-172` normalized `[0,1]` rendered at `time*pps`), `+ KF` at `t=0.5` via `AddClipKeyframeCommand`, and `+ Add Channel` via `AddClipChannelCommand` with `PickerInline` filtered by `engine.getAnimatableParameters(nodeId)` (standard params only, `clip.hasChannel` disables). Empty clip → `No channels — + Add Channel` with `ParameterPicker`-like inline. `Esc → back → close` mirrors `ParentingModeDialog.tsx:27-34` / `ExportClipCollectionModal.tsx:27`.

---

## What broke (and fixes)

1. **EnginePublic has no `getClipInstance`** — `engine.ts:121-123` only exposes `getClipInstances`. Prototype initially called `engine.getClipInstance` (from `internal.ts:4302`) and `tsc -b` failed. Fixed by helper `engine.getClipInstances(nodeId).find(i=>i.id===instanceId)` in `ClipBar` move/resize and title.

2. **Unused imports/locals flagged by `tsc -b`** — `dispatch` at top-level unused after move logic scoped to `ClipBar`; `gridSnapEnabled`, `ticks`, `duration`, `timeFromClientX` unused in `ClipEditorSubView` signature; dummy `e` param in `PickerInline` effect. Removed/renamed to `contentWidth`-only signature, moved `dispatch` into `ClipBar`, removed dummy.

3. **Title template bug** — `visualDuration.toFixed ? '' : ''` is always truthy. Replaced with proper `instForTitle.startTime.toFixed(2)` via helper.

4. **`walkPreOrder` import** — `frontend/src/engine/sceneNode.ts` re-exports `walkPreOrder`; verified via `ExportClipCollectionModal.tsx:4`.

5. **`useEngineEvent` tick needed** — bars did not re-render after `SetClipInstance*` until tick added. `useEngineEvent(()=>setTick(t+1))` mirrors `ScenePanel.tsx:228-248` pruning pattern, without which right-handle preview persisted as stale inline style until next engine event. Fixed by adding tick; drag preview directly mutates `style.left/width` during move then relies on post-commit tick to reconcile (same as `keyframeScale.ts` preview map pattern).

6. **`Collection verbal` — no collection lane in this prototype** — Ticket scopes this prototype to filtered lanes + clip bar + editor sub-view only; collection lane / vertical stacking / reorder deliberately stubbed (see below). Avoided scope creep.

---

## Drag / scale math

Constants: `MIN_VISUAL=0.25` (from spec `311` `FRAME_STEP 0.5` but test expects 0.25), `EPS=1e-4`, `BASE_PPS=100`, `pps=BASE_PPS*zoomLevel`.

### Visual duration

```
visualDuration = clip.duration > 0 && instance.speed > EPS ? clip.duration / instance.speed : (clip.duration || 7)
visualDuration = clamp(visualDuration, MIN_VISUAL, slide.duration - instance.startTime)
leftPx  = instance.startTime * pps
widthPx = visualDuration * pps   // rendered as max(12, widthPx) for zero-duration ticks
```

Matches `internal.ts:4298` / `animationEvaluator.ts:4298,1050` — `u=clamp((t-start)*speed/duration,0,1)` → window `[start, start+duration/speed)`. `speed=0` would be infinite width — clamp via `EPS` and `Math.min(..., slide.duration - start)` caps at slide end (evaluator holds last keyframe past `start+visual`).

### Move (whole bar)

```
delta     = (clientX - startX) / pps
newStart  = origStart + delta
if gridSnapEnabled: newStart = round(newStart / step) * step   // step = rulerTickStep(pps)
newStart  = clamp(newStart, 0, duration - origVisual)
preview: bar.style.left = newStart * pps
commit: SetClipInstanceStartTimeCommand {nodeId, instanceId, startTime: toFixed(3)}
```

One undo entry. Snap candidates limited to grid for prototype (research recommends also `otherEdges` + `playhead` at 5px via `snapKeyframeTime` `timelineSnapping.ts:62-78`); deferred to full build.

### Resize right (trailing edge, pivot=start)

```
raw       = timeFromClientX(clientX)   // scrollTime + (clientX - rect.left)/pps
newVisual = clamp(raw - origStart, MIN_VISUAL, duration - origStart)
if newVisual <= EPS: abort
newSpeed  = clip.duration / newVisual   // non-destructive, sharing-safe
clamped   = max(newSpeed, EPS)
bar.style.width = max(12, newVisual*pps)
commit: SetClipInstanceSpeedCommand {speed: toFixed(4)}
```

Keeps `startTime`. Definition untouched — sharing safe (vs mutating `ClipDefinition.duration` which would affect all instances, see findings `research/manager-timeline-clip-findings.md` §2.4 option A recommended).

### Resize left (leading edge, pivot=rightEdge)

```
rightEdge = origStart + origVisual
newStart  = snap(raw)    // gridSnap if enabled
newStart  = clamp(newStart, 0, rightEdge - MIN_VISUAL)
newVisual = rightEdge - newStart
newSpeed  = clip.duration / newVisual
commit: Transaction[ SetClipInstanceStartTime{newStart}, SetClipInstanceSpeed{newSpeed} ]
preview: bar.style.left = newStart*pps; bar.style.width = newVisual*pps
```

Both fields change atomically; Transaction flattens to one undo entry. Left handle therefore moves `startTime` + `speed` pinning right edge (common DAW beheavior, spec `311`). Alternative "stretch-from-start" would be a move, not a resize — spec locks leading-edge resize to Transaction.

### Snap & clamp notes

- `MIN_VISUAL 0.25s` prevents 0-width bars (rejected `speed>=1e-4` guard in `clipInstanceFromJSON:62-67` validation).
- Zero-duration clip (`clip.duration===0`) evaluator skips it (`continue` `animationEvaluator.ts:1050`); bar still rendered as 12px tick so it stays reorderable (spec `311`).
- `speed===0` frozen at first keyframe — prototype rejects resize that would produce `speed<EPS` (maps to `enabled=false` in full build).

---

## Stacking / reorder stub expectations (not built in this prototype)

The ticket intentionally isolates the filtered lane + bar + editor loop; collection lane stacking and drag-reorder are **stubbed** for the follow-on tickets (`315`, `handoff`):

- **Need:** When multiple `ClipInstance` bars on the same per-object lane overlap horizontally, allocate lanes greedily sorted by `startTime` (`sort by startTime, pack into minimum tracks where start >= lastEnd else new track`) — classic DAW lane packing. Today `ClipBar` renders all bars on the same `rowIndex` line with `position:absolute` overlap (no stacking). Full build must introduce `stackClipLanes(instances: ClipInstanceView[])` helper (see `research/manager-timeline-clip-findings.md` §3.3) returning `yOffset/trackIndex` and map to `top: rowBase + track*gap`, `zIndex = arrayIndex` (lower = later `arrayIndex` = higher `zIndex` last-wins via `animationEvaluator.ts:1050-1053`). Greedy interval partitioning gives minimal tracks; lower takes control.

- **Collection lane analogue:** Collection Lane is a single bar on parent's top collection section with hidden internals (tooltip), stretch via uniform `speed` factor `newSpeed=oldSpeed*oldVisual/newVisual` iterating bindings (spec `315`). Same stacking rule — overlapping collection lanes pack vertically, lower wins (`collectionPlacements[]` order + `node.clipInstances` order per `moveClipLayerCommand.ts:1-58` and `internal.ts:4338-4350`). This prototype does not render collections at all (only `clipInstances`); collection UI is deferred.

- **Reordering:** 2-axis drag persisting `node.clipInstances` order + new `collectionPlacements[]` order. Spec `315` expects: drag up/down changes `moveClipLayer` array index (vertical), drag left/right changes `startTime`. Drop that crosses another bar's vertical slot should translate to intra-node `moveClipLayer`. Stub expectation: after stacking, `onReorder(nodeId, instanceId, newIndex)` dispatch `MoveClipLayerCommand` (`moveClipLayerCommand.ts:43` bounds check) and re-stack. Cross-node moves via `assignClipInstance` not primitive (use collection broadcast or `CopyClipInstanceCommand`).

- **Zero-offsets v1:** Collection members today keep `startTime` offsets relative to slide (derived max visual zero-offsets deferred). Full build must reconcile `ClipCollection.bindings` `semanticName → clipId` with member `startTime` offsets (see ADR 0006) — not needed for this bar prototype.

- **Persistence:** Stacking is derived state (no storage), order is `clipInstances` array order; lower lane = later index = last-wins. Theme for collection lane pending grilling ticket `315`.

Test hooks left for full build: `data-testid="manager-lane-{nodeId}"`, `data-testid="clip-bar-{instanceId}"`, `data-testid="clip-bar-handle-left/right-{instanceId}"`, `data-testid="clip-editor-subview"` etc., already in prototype for `timelineComponents.tsx` parity.

---

## How to run (throwaway)

```bash
git checkout research/manager-silhouette
npm install --prefix frontend
npm run dev --prefix frontend  # vite
# Create a project, add a Rig Handle group with 2 children, add keyframes to each child or assign clips via Inspector → Animations, then Scene Tree → right-click parent → Animation Manager… → draggable bars → right-click bar → Edit → channel diamonds → + KF (saves under ClipDefinition, re-renders).
```

Do not merge to `main`. Evidence for handoff to ready-for-agent tickets.

---

## References

- Entry: `frontend/src/components/panels/ScenePanel.tsx:30,603-649,650` + `CanvasSelection` hit-test `canvasSelection.ts:191` (deferred canvas parity per findings §2.2).
- Modal: `frontend/src/components/panels/ExportClipCollectionModal.tsx:154-195` overlay idiom, `ParentingModeDialog.tsx:27-34` Escape.
- Handles: `frontend/src/components/panels/timelineComponents.tsx:196-276` `SelectionScaleBox`, `frontend/src/components/panels/keyframeScale.ts:258-347` factor/pivot math.
- Clip eval: `frontend/src/engine/clipInstance.ts:5-80`, `frontend/src/engine/internal.ts:4298-4362`, `frontend/src/engine/animationEvaluator.ts:1050-1053`.
- Tracks: `frontend/src/components/panels/timelineTracks.ts:276-292` `clipChannelRows`, `frontend/src/components/panels/ClipEditBody.tsx:46-688` edit body.
- Transaction: `frontend/src/engine/commands/transactionCommand.ts:19-58`.
