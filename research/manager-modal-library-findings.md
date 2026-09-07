# Research: Modal, drag-resize, and library persistence patterns for the Manager

**Ticket:** #308 — Research: Modal, drag-resize, and library persistence patterns for the Manager  
**Map:** #306 — Wayfinder map — Animation Manager for Hierarchical Objects  
**Branch:** `research/manager-modal-library`  
**Date:** 2026-09-07  
**Companion:** #307 `research/manager-timeline-clip-findings.md` — lane-per-clip & resize-condense (visualDuration `duration/speed`, bar geometry, `moveClipLayer` ordering)

---

## 1. Scene Tree entry — where to insert "Animation Manager…"

### 1.1 `ScenePanel.tsx` context menu (existing)

- **State** `ScenePanel.tsx:32-36` `ContextMenuState {x,y,nodeId}` + `const [contextMenu, setContextMenu] = useState<ContextMenuState|null>` `ScenePanel.tsx:216`. Closes on outside `click` or `Escape` `ScenePanel.tsx:250-263`.
- **Opener** `handleRowContextMenu` `ScenePanel.tsx:401-408`: `preventDefault`, syncs `useSelectionStore.select(node.id)` if not selected, sets `x: event.clientX, y: event.clientY, nodeId`.
- **Row wiring** `ScenePanel.tsx:150` `onContextMenu={(e)=>onContextMenu(e,node)}` on the `role="treeitem"` button (the whole row, not just the chevron). Works recursively for every `SceneTreeRow` `ScenePanel.tsx:191-208`.
- **Menu DOM** `ScenePanel.tsx:603-649` — fixed `class="context-menu"` at `{left:contextMenu.x, top:contextMenu.y}`, `role="menu"`, `role="menuitem"` buttons, `menu__separator` before z-order items. No portal, no Radix, no focus trap. Items today:
  1. Create Table/Chart/Text/Circle/Group (5) `ScenePanel.tsx:610-623`
  2. `Export Clip Collection…` `ScenePanel.tsx:625-635` — sets `exportCollectionParentId = contextMenu.nodeId`
  3. Separator + `Z_ORDER_ITEMS` (bring forward/backward etc) `ScenePanel.tsx:637-646`
- **Export pattern** `ScenePanel.tsx:536-537` `exportOpen` / `exportCollectionParentId` are sibling modals rendered at bottom `ScenePanel.tsx:656-661`: `<ExportObjectModal open={exportOpen}>` + `<ExportClipCollectionModal open={exportCollectionParentId!==null} parentNodeId={exportCollectionParentId}>`.

**Insertion for Manager** — add one more menuitem between "Create Group" and "Export Clip Collection…" (or grouped with the two export entries behind a separator). Recommended order:

```
Create Table … Create Group (Rig Handle)
— separator —
Animation Manager…
Export Clip Collection…
Export Object…   // today Export Object is a toolbar button, not in menu — keep consistent?
— separator —
Bring Forward / Send Backward …
```

Gist:
```tsx
<button className="menu__item" role="menuitem"
  data-testid="scene-animation-manager"
  onClick={() => { setManagerParentId(contextMenu!.nodeId); setContextMenu(null) }}>
  Animation Manager…
</button>
```

Guard: enable only when `node.children.length>0` (or at least one animated descendant — see §6). If the clicked parent is a leaf or camera/Group-only with no animatable children, show disabled with tooltip "No animatable children" rather than hiding (discoverability). The existing z-order items already set precedent for `disabled={!canApplyZOrder(...)}` `ScenePanel.tsx:642`.

State to add at `ScenePanel.tsx:536-537` neighborhood:
```ts
const [managerParentId, setManagerParentId] = useState<string|null>(null)
// ... render <AnimationManagerModal parentNodeId={managerParentId} open={managerParentId!==null} onClose={()=>setManagerParentId(null)} />
```

Reuses `useEngineEvent` tick and `useSelectionStore` already in scope; modal will need `engine`, `dispatch`, `expandedNodeIds`, and `materialDefinitions` (like `TimelinePanel.tsx:88`).

---

## 2. Canvas hit-test insertion — no context menu exists yet

### 2.1 `canvasSelection.ts` — the hit-test primitive to reuse

- `topmostNodeAt(scene, point, getNodeSize, transformOf, filter)` `canvasSelection.ts:191` and `nodesIntersectingRect(...)` `canvasSelection.ts:242` are the only hit-test entry points. Both are pure functions over `worldTransformOf` + `aabbOf`.
- `CanvasSelection` `canvasSelection.ts:65-482` wires `mousedown` → `cursorToWorld` → `topmostNodeAt` → selection toggle/extend `canvasSelection.ts:153-206`. **No `contextmenu` handling beyond `preventDefault` for ctrl/meta** `canvasSelection.ts:147-151`. Right-click never opens a menu; it is not handled.
- `isIKHandleAt` `canvasSelection.ts:58,111,181` is an optional short-circuit consumed before hit-test — keep for Manager (avoid opening Manager when clicking an IK handle).

### 2.2 `CanvasPanel.tsx` / `Renderer` — no overlay surface

- `CanvasPanel.tsx:21-117` mounts `new Renderer(host, engine, dispatch, realPixi, ...)` onto a `canvas-host` div. No React context menu, no portal, no overlay. `Renderer` owns the `<canvas>` element directly (Pixi), so overlay must live outside the canvas DOM (as a sibling of `canvas-host`, like `CanvasToolbar`).
- No `onContextMenu` listener in `CanvasPanel.tsx` beyond what `CanvasSelection` registers on the canvas element itself.

**Insertion for Canvas** — add a thin `CanvasContextMenu` component alongside `CanvasPanel` (same level as `CanvasToolbar` `CanvasPanel.tsx:112`) that:

1. Subscribes to `contextmenu` on the canvas element (reuse `cursorToWorld` + `topmostNodeAt` + `getNodeFilter` + `getWorldTransform` from the same context that `CanvasSelection` uses — pass via props or a shared `useCanvasHitTest` hook).
2. On right-click: `event.preventDefault(); const point = cursorToWorld(canvas, camera, clientX, clientY); const hit = topmostNodeAt(scene, point, ...); if (!hit) return; const node = engine.getNode(hit); if (node.children.filter(c=>!c.components.camera).length===0) return;` Then resolve the **parent to manage**: if the hit *is* a parent with children, use `hit`; otherwise use `node.parent?.id` if that parent is a Group/has children. Preference: spec says "right-click a parent node that has children" — so gate on `children.length>0`.
3. Render a `role="menu"` at `clientX/clientY` (same `context-menu` class as ScenePanel for visual parity) with one item: `Animation Manager…` → opens the same `AnimationManagerModal` state as ScenePanel. Share the modal via a global store (`useManagerModalStore`) or lift to `EditorPage` so both entry points converge.

Pitfall: `CanvasSelection` already `preventDefault`s `contextmenu` only when `ctrl/meta` `canvasSelection.ts:148-150`. Extend that handler to emit the Manager menu; or register a separate listener before `CanvasSelection` and stop propagation. Keep gesture reset semantics (`#resetGesture`) — right-click should not start a drag (`event.button!==0` guard `canvasSelection.ts:154` already excludes right-click from selection drag).

Alternative (simpler for v1): **Skip Canvas entry** and ship Scene Tree entry only. Document Canvas as "next — reuse `topmostNodeAt` + this overlay skeleton" so the prototype ticket is not blocked.

---

## 3. Modal overlay pattern — hand-rolled, no Radix Dialog

**Finding: Radix `Dialog` is not used anywhere in `frontend/src`.** `grep -R "Dialog" --include="*.tsx"` hits only `RecoveryDialog`, `MissingAssetsDialog`, `ParentingModeDialog`, and local `*ClipCollectionModal` — all hand-rolled divs.

Two established overlay idioms exist; pick one and stay consistent — **recommended: `modal-overlay` idiom** (used by the export modals the Manager is closest to).

### 3.1 `modal-overlay` idiom (recommended for Manager)

Used by `ExportObjectModal.tsx:124`, `ExportClipCollectionModal.tsx:154`, `ApplyClipCollectionModal.tsx:127,162` (`ParentingModeDialog.tsx:39` similar with class `parenting-mode-dialog__overlay`).

Pattern `ExportClipCollectionModal.tsx:154-195`:
```tsx
if (!open) return null
return (
  <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export Clip Collection"
       style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex',
               alignItems:'center', justifyContent:'center', zIndex:1000}}
       onClick={onClose}>          // backdrop click closes
    <div className="modal"
         style={{background:'var(--color-bg)', borderRadius:8, padding:16,
                 minWidth:460, maxWidth:600, maxHeight:'80vh', overflowY:'auto',
                 border:'1px solid var(--color-border)'}}
         onClick={e=>e.stopPropagation()}>  // content stops propagation
      <h3>…</h3> … <button onClick={onClose}>Cancel</button>
      <button onClick={handleExport} disabled={!canExport}>Export</button>
    </div>
  </div>
)
```

Key traits:
- No portal — fixed overlay appended inline, `zIndex:1000` (same across all three).
- Backdrop handles close via `onClick={onClose}` on overlay; inner modal stops propagation.
- **Esc**: `ParentingModeDialog.tsx:27-34` adds `keydown Escape → onCancel` only when `open`; the export modals rely on backdrop/ Cancel button and do **not** add Escape (gap — fix for Manager). Add `useEffect(() => { if(!open) return; const h=(e:KeyboardEvent)=>e.key==='Escape'&&onClose(); document.addEventListener('keydown',h); return()=>removeEventListener('keydown',h)}, [open,onClose])`.
- **Focus**: no trap, no `autoFocus` management today (ExportObject uses no `autoFocus`; ExportClipCollection uses `autoFocus` on the input `ExportClipCollectionModal.tsx:349`). For a big modal, add initial focus to the first header control and return focus to triggering element on close.

### 3.2 `projects-overlay` idiom (library browsers)

Used by `LibraryBrowser.tsx:63`, `CollectionLibraryBrowser.tsx:58`, `AnimationsPanel.tsx:726,742`, `ProjectsDialog.tsx:112,132,152,172,209`. CSS `frontend/src/index.css:3499-` `.projects-overlay {position:fixed; inset:0; display:flex; alignItems:center; justifyContent:center; background:rgba(0,0,0,0.4); zIndex:???}` → inner `.projects-dialog {background:var(--color-bg-panel); borderRadius:8; maxWidth:600; maxHeight:80vh}`.

Library browsers add search, category select, empty/loading states, delete-confirm nested overlay `CollectionLibraryBrowser.tsx:183-195`, and `notify` toasts — all inside the overlay. Refresh-on-open `CollectionLibraryBrowser.tsx:24-28` (`if(visible) void loadLibrary()`) so the browser never shows a stale in-memory snapshot.

**Which to reuse:** Manager is an **editor modal** (create/edit/reorder/validate/export in place), not a read-only browser — so use `modal-overlay`. Mirror sizing but scale up: **big modal** `minWidth:760, maxWidth:960, minHeight:520, maxHeight:88vh, width:92vw` with a 2-pane interior (`left: 260px track headers + right: flex timeline lanes`) reusing `TimelineBody` flex layout (`timeline-tracks` + `timeline-scroller`). Backdrop `rgba(0,0,0,0.5)`, `zIndex:1000`, `role="dialog"` + `aria-label="Animation Manager — <parentName>"`, backdrop click + Escape both close, body scroll-lock optional.

Not needed: Radix, `createPortal`, focus-trap lib. Keep hand-rolled to avoid new dependencies; copy `ExportClipCollectionModal.tsx:150-396` verbatim as scaffold.

### 3.3 Dismiss / notification pattern

- Success: `useNotificationStore.notify(msg)` `ExportClipCollectionModal.tsx:142-144`, `ExportObjectModal.tsx:114`, `AnimationsPanel.tsx:214` — toast, not inline.
- Inline blocking errors: `panel-status--error` + `data-testid` `ExportClipCollectionModal.tsx:241-300` (two variants: no clips vs missing semantic) — reuse for Manager's orphan/missing-semantic banners.
- No global `confirm()` — nested confirm dialog for delete is a second `projects-overlay` `CollectionLibraryBrowser.tsx:183-195` / `AnimationsPanel.tsx:726-738`.

---

## 4. Handle patterns — `ew-resize` + pointer-capture drag

### 4.1 The only handle primitive: `SelectionScaleBox` `timelineComponents.tsx:196-276`

```ts
export interface SelectionScaleBoxProps {
  bounds: {minX,maxX,minY,maxY}
  onScaleStart: (edge:'left'|'right', clientX:number, isAlt:boolean) => void
}
```

Renders an absolute box with two 6 px handles `HANDLE_WIDTH=6` `timelineComponents.tsx:206`:
- Left `left:-3, width:6, height+4, cursor:ew-resize, background:var(--color-accent), opacity:0.7, pointerEvents:auto` `timelineComponents.tsx:238-254`
- Right `right:-3` mirror `timelineComponents.tsx:256-272`
- Box itself `pointerEvents:none, zIndex:9` `timelineComponents.tsx:228` — handles re-enable pointer.
- `data-testid="selection-scale-handle-left/right"` + `data-edge` for tests.

Wired in `TimelineBody.tsx:1844-1851` and `ClipEditBody.tsx:654-661`:
```tsx
<SelectionScaleBox bounds={...} onScaleStart={(edge, clientX, isAlt) =>
  startScale(edge, clientX, isAlt, playheadTime)} />
```

Also `frontend/src/index.css:3052` `.timeline-lane-row__handle {cursor:ew-resize}` and `:3896` audio equivalent — gap between CSS carets and React handlers is bridged by `handleInteraction.ts:546` mapping cursor names to CSS.

### 4.2 The math behind handles: `keyframeScale.ts` + `keyframeDrag.ts`

- **`keyframeScale.ts:258-347` `useKeyframeScale({keyframeRefs,duration,pps,timeFromClientX,dispatch})`** — the resize-condense logic the Manager must adapt.
  - Pivot = `isAlt ? playheadTime : edge==='left' ? maxTime : minTime` `keyframeScale.ts:303`.
  - Factor = `(newEdgeTime - pivot) / (originalEdgeTime - pivot)` `keyframeScale.ts:311`; if `factor<=0` abort (no inversion), clamp `newEdgeTime ∈ [0,duration]` `keyframeScale.ts:310`.
  - Snap: `snapKeyframeTime(raw, {gridEnabled,keyframesEnabled,candidateTimes,pps})` + `clamp(...,0,duration)` `keyframeScale.ts:321-329`.
  - Commit groups by target kind (node/material/morph/shadow) and dispatches `MoveKeyframesCommand` per group via `dispatchKeyframeCommands` `keyframeScale.ts:163-255`. See #307 §2.4 for why clip bar resize must **not** use this path — it maps to `ClipInstance.speed`, not keyframe times.
- **`keyframeDrag.ts:232-286` `useKeyframeDrag({keyframeRefs,duration,pps,timeFromClientX})`** — move loop: `delta = timeFromClientX(event.clientX) - pointerStartTime`, snaps each `originalTime+delta`, clamps, previews, then groups into `MoveKeyframesCommand`s on pointerup. Same snapping candidate collection `keyframeDrag.ts:253-259`.

Both share: store selected ids via `selectedKeyframeIdsOf(useTimelineSelectionStore.getState())`, preview maps (`scalePreview`/`dragPreview`), `window.addEventListener('pointermove/pointerup/pointercancel')` with teardown.

### 4.3 What Manager reuses vs what it invents

**Reuse verbatim:**
- `SelectionScaleBox` for keyframe diamonds inside the clip-editor sub-view (the sub-view is literally `ClipEditBody` embedded).
- `ew-resize` + 6 px handle width + `var(--color-accent)` for bar handles — visual parity.
- `pps`, `scrollTime`, `zoomLevel`, `gridSnapEnabled` from `useTimelineViewStore` for all pixel↔time conversions (`leftPx = time * pps`, `widthPx = visualDuration * pps`).

**New (bar-level):**
- **Clip/collection bar handles** are not `SelectionScaleBox` — they live on each bar, not on a selection bounds. Need a `ClipBarHandles` component: two absolutely-positioned 6 px divs on `left:0` / `right:0` of the bar, `cursor:ew-resize`, `onPointerDown(e){ e.preventDefault(); e.stopPropagation(); onResizeStart(barId, edge, e.clientX) }` — adapted from `SelectionScaleBox.tsx:216-219`. Bars also need a **move handle** (center drag, `cursor:grab` → `grabbing`) similar to audio clips `AudioTimelineBody.tsx:2276-2811` and `WaveformEditorModal.tsx:1180-1248` (same handle pattern but for clip instances).
- **Bar resize math** maps to §2.4 of #307: `newVisual = clamp(raw - startTime, MIN_VISUAL, slide.duration - startTime)` or capped at `MAX_VISUAL_DURATION` for frozen; then `instance.speed = clip.duration / newVisual` (guard `speed< EPS → clamp`). Left handle also drives `startTime = clamp(raw, 0, startTime+visualDuration - MIN_VISUAL)`, recomputing `speed` from remaining width. Collection resize propagates same factor to members (iterate bindings, apply `speed *= factor` or recompute from own `visualDuration` ratio when heterogeneous).
- **Collection vertical stacking** — when `visualRect` overlap horizontally, allocate lanes greedily sorted by `startTime`, `lane = first non-overlapping row` (lower takes control). Store order as `clipInstances` array order; lower lane = later in array = last-wins evaluation `animationEvaluator.ts:1050-1053`. Reorder via drag up/down changes array index.

No Radix Slider — all resize is pointer-captured `window.pointermove / pointerup` exactly like `keyframeScale.ts:284-343`.

---

## 5. Persistence / portability — Reusable Object is the source of truth

### 5.1 `ReusableObject` `.lesson_object` — shape `reusableObject.ts:1-221`

```ts
interface ReusableObjectJSON {
  version: number          // 1  reusableObject.ts:3
  name: string
  description?: string
  rootId: string
  nodes: readonly NodeJSON[]                 // subtree + auxiliary ghosts
  animation?: SlideAnimationJSON             // filtered to nodeIds
  library?: LessonLibraryJSON                // {assets,materials,shaders,data_sources,clips,clipCollections}
  ikChains?: IKManagerJSON
  constraints?: ConstraintManagerJSON
}
```

- **Validation** `validateReusableObject(json)` `reusableObject.ts:20-220`: checks `version===1`, `name` non-empty, `rootId` in `nodes`, exactly one root with `parentId:null`, no cycles (`steps>nodes.length` guard `reusableObject.ts:117-135`), per-node `semanticName` must be non-empty if present `reusableObject.ts:81-85`, per-library `clips[].duration>=0`, `clipCollections[].bindings` is object, and crucially **clip instance bindings must reference library.clips** `reusableObject.ts:177-201` (`clipIds.has(inst.clipId)` else `Clip instance references unknown clip id`).
- **Export** `Engine.exportReusableObject(rootId,name,description)` `internal.ts:*` (see `reusableObject.test.ts:168`): snapshots
  - `nodes` = `walkPreOrder(root).map(n=>n.toJSON())` plus IK ghost/pole nodes when a chain is intersected `reusableObject.test.ts:196-249`, filtered `animation` nodes `internal.ts:3134-3135` `fullAnim.nodes.filter(n=>nodeIds.has(n.nodeId))`.
  - `library` = merged `embeddedAssets/Materials/Shaders/DataSources` plus **filtered** `clips` and `clipCollections` that are actually referenced by the subtree (not whole project). The portable file tests show `library.assets` includes the mesh's `assetInstance` asset `reusableObject.test.ts:179`, `library.materials` `reusableObject.test.ts:180`, `library.clips.length>=2` `reusableObject.test.ts:181`, `library.clipCollections.length===1` `reusableObject.test.ts:182`.
  - `library.clipCollections` mirrors `LessonJSON.library.clipCollections` shape — `clipCollectionManager.ts:8-83` owns the collection set but the filtered set is written by the reusable-object builder, not by `lessonSerializer.ts`.
- **Import** `Engine.importReusableObject(obj)` `reusableObject.test.ts:336-369`: **remaps every id** — new `nodeIds`, `clipIds`, `collectionIds` — snapshots definitions (`embedAsset/Material`), rewrites `clipInstances[].clipId` and `collection.bindings[semantic]→newClipId`, verifies `sourceNodeId` remap. Drop-in is parented under active slide root.

**Lesson portability** `lessonSerializer.ts:36-127` carries the same library split:

```ts
export function toLessonJSON(project, clips, clipCollections): LessonJSON {
  return {
    version: LESSON_VERSION (2)  lessonSerializer.ts:37
    project: {id,name,description,author,createdAt,modifiedAt,settings}
    slides: project.slides.map(s=>s.toJSON())
    ...(clips?.length ? {clips: clips.map(c=>c.toJSON())} : {})
    ...(clipCollections?.length ? {clipCollections: c.map(c=>c.toJSON())} : {})
    ...(library ? {library} : {}) // embedded assets/materials/shaders/dataSources
  }
}
```

Parsing helpers `lessonSerializer.ts:39-67` resolve top-level **and** library fallbacks:
```ts
parseClipsFromLessonJSON(json): ClipDefinition[] { clips = json.clips ?? json.library?.clips }
parseClipCollectionsFromLessonJSON(json): ClipCollection[] { collections = json.clipCollections ?? json.library?.clipCollections }
```

Validation `lessonSerializer.ts:163-209` plus `validateClipReferencesInJSON` `lessonSerializer.ts:988-1024` / `validateClipCollectionReferencesInJSON` `lessonSerializer.ts:1027-1078` enforce: every `node.clipInstances[].clipId` must be in the parsed clip set, and every `collection.bindings[semantic] -> clipId` must be known, with duplicate-id/name checks.

### 5.2 `clipCollectionManager.ts` / `clipCollection.ts`

- `ClipCollectionManager` `clipCollectionManager.ts:4-83`: `Map<string,ClipCollection>`, `createCollection(name,bindings,sourceNodeId)` allocates `newClipCollectionId()`, emits `ClipCollectionCreated`, `deleteCollection` emits `ClipCollectionRemoved`, `renameCollection` emits `ClipCollectionRenamed`, `setBindings` replaces the whole map entry (copy trick) and emits `ClipCollectionBindingsChanged`. No persistence of its own — lifecycle is via `Engine.openProject` / `toLessonJSON` / `lessonSerializer`.
- `ClipCollection` `clipCollection.ts:9-117`: `id, name, bindings: Map<semanticName,clipId>, sourceNodeId?`. The **portable file** variant `.clip_collection` built in `AnimationsPanel.tsx:197-214` is a different envelope:
  ```json
  {format:"animated-slides-clip-collection", version:1, name, bindings, clips:[ClipJSON,...]}
  ```
  Downloaded via blob `AnimationsPanel.tsx:203-214` and reimported in `AnimationsPanel.tsx:216-259`. Keep both: `.clip_collection` for clip-only sharing; `.lesson_object` for subtree+clips+collections self-contained.

### 5.3 `clipLibraryStore.ts` / `clipCollectionLibraryStore.ts` — backend-backed shared library

Both are `zustand` stores over `clipsApi` / `clipCollectionsApi` (`frontend/src/api/*Api.ts`) persisted to backend SQLite `asset_definitions` / `clipCollections` tables.

- **`clipLibraryStore.ts:1-253`** (clips):
  - State `definitions, loaded/loading, error, unavailable, selectedId, libraryBrowserVisible` `clipLibraryStore.ts:66-73`.
  - `dispatchRef` `clipLibraryStore.ts:92-99` is injected by `AnimationsPanel.tsx:64` `initClipLibraryStore(dispatch)` — so project commands go through the same `CommandDispatcher`.
  - `loadLibrary()` `clipLibraryStore.ts:110-128` uses `requestSeq` guard for race, `clipsApi.listClips()`, sets `loaded/unavailable/error`. No auto-refresh-on-open (loads once when `!loaded` `AnimationsPanel.tsx:66-68`).
  - `saveToLibrary(clip, overwriteEntryId)` `clipLibraryStore.ts:130-157` via `clipsApi.createClip/updateClip` with `clipToCreateInput(clip)` `clipLibraryStore.ts:35-45` (copies `params/channels/channelAnimations`). On overwrite, `replaceDefinition` `clipLibraryStore.ts:28-32`.
  - `importClipFromLibrary(entry)` `clipLibraryStore.ts:203-209` dispatches `ImportClipCommand({entry})` via `dispatchRef`.
  - `deleteClip(clipId, engine)` `clipLibraryStore.ts:241-252` blocks if `engine.isClipReferenced(clipId)` `clipLibraryStore.ts:242` — precedent for Manager's validation message shape.
- **`clipCollectionLibraryStore.ts:1-326`** (collections):
  - Similar but **self-contained**: `collectionToCreateInput(collection, engine)` `clipCollectionLibraryStore.ts:25-68` snapshots referenced clips into `clips: Record<string,unknown>[]` alongside `bindings` — `ExportClipCollectionModal.tsx`/`AnimationsPanel.tsx` rely on this to make imports work without the clip library.
  - `saveToLibrary(collection, overwriteEntryId, engine)` `clipCollectionLibraryStore.ts:126-186` handles duplicate-id fallback 409 → update `clipCollectionLibraryStore.ts:142-164`.
  - `importCollectionFromLibrary(entry, engine)` `clipCollectionLibraryStore.ts:205-315` is the richest: tries embedded `entry.clips` first (imports via `ImportClipCommand` per `oldId`, remapping `clipIdMap` `clipCollectionLibraryStore.ts:205-268`), then falls back to legacy backend fetch `clipsApi.getClip` per binding `clipCollectionLibraryStore.ts:269-298`. Errors are surfaced via `set({error})` and `notify`.
  - Refresh-on-open `CollectionLibraryBrowser.tsx:24-28` (`if(visible) void loadLibrary()`) differs from clips — copy that for Manager collection sections.

### 5.4 Library Objects tab / `.lesson_object` I/O path

- Objects are not a separate store — they live as **assets with `category='object'`**. `ExportObjectModal.tsx:99-112` double-writes: (a) blob download `safeName.lesson_object` via `URL.createObjectURL` `ExportObjectModal.tsx:91-97`, (b) `assetsApi.uploadAssets([file], ['object'])` + `loadLibrary()` refresh `ExportObjectModal.tsx:101-107`. The import counterpart is in `ObjectsPanel.tsx` (not listed but follows same `assetLibraryStore` load by `category` filter).
- `backend/app/assets/importer.py:94-100` preserves object metadata (`name, description, node count`) for filtering; `frontend/src/engine/reusableObject.ts:141-143` includes `library.clips/clipCollections` arrays so `.lesson_object` is self-contained exactly like `.lesson` but subtree-scoped.

### 5.5 `semanticName` validation precedent (blocking)

The canonical blocking implementation is `ExportClipCollectionModal.tsx:54-115`:

```ts
const preview = useMemo(() => { // ExportClipCollectionModal.tsx:54-100
  for (const node of walkPreOrder(parent)) {
    if (node.clipInstances.length>0) {
      hasClip = true
      if (!sem || sem.trim()==='') missing.push({id,name,clipIds})
    }
  }
  // bindings preview: first per semantic with clipInstances[0].clipId
}, [engine, effectiveParentId])

const blockingError = (() => {
  if (!preview.hasClip) return `No clips found in hierarchy…`
  if (preview.missing.length>0) return `Cannot export: ${missing.length} node(s) with clips have no Semantic Name: ${names.join(', ')}…`
  if (preview.bindings.length===0) return `No exportable bindings…`
  return null
})()

const canExport = Boolean(engine && effectiveParentId && name.trim() && preview && !blockingError)
```

Surface `ExportClipCollectionModal.tsx:240-301`:
- Missing nodes rendered as `role="alert" data-testid="clip-collection-missing-semantic"` with per-node select buttons `ExportClipCollectionModal.tsx:265-282` that `useSelectionStore.select(m.id) + notify(...)` to guide fix-up, plus hint `Set Semantic Name in Inspector → General → Semantic Name (e.g. left_hand)` `ExportClipCollectionModal.tsx:292-298`.

Manager must reuse this pattern verbatim for both **collection creation** (subset of clips → collection) and **object export** (full subtree). Add a second banner for **orphan keyframes** (keyframes whose owning node/property has no clip that covers them, or stray keyframes outside any clip's normalized range) — same `panel-status--error` + inline list, but allow non-blocking warning if spec allows orphan-param view.

The JSON-level validation `lessonSerializer.ts:1027-1078` is the persistence guard — even if UI allows saving, `validate()` will reject a `.lesson_object` whose `library.clipCollections[x].bindings[semantic]` points at an unknown `clips[y].id`.

---

## 6. Timeline filtering precedent — where Manager's predicate plugs in

### 6.1 Existing filtering: all expansion, no filtering

`timelineTracks.ts:142-258` has **zero filter predicate** today. `timelineRows(scene, expandedNodeIds, materialDefinitions)` `timelineTracks.ts:168-258`:

- Seeds `trackRows(scene)` `timelineTracks.ts:142-162`: pre-order walk from `scene.root` (skip cameras), depth `0…`, plus `scene.camera` at `depth:1` appended last.
- For each entry, if `expandedNodeIds[entry.node.id]===true` `timelineTracks.ts:189`, pushes subtracks in fixed order (see #307 §1.1): `animatablePropertiesOf(node)` `timelineTracks.ts:190-191` → `visibleSubtrack` → mesh `morph/symmetry` → `materialParametersOf(node,defs)` `timelineTracks.ts:198-199` → `chart.dataLabels` → `CIRCLE_ANIMATABLE_PROPERTIES` → group `shadowEffect` (auto vs manual filtered via `SHADOW_*_PROPERTIES`) `timelineTracks.ts:222-253`.
- No predicate takes `slide.animation` into account — every property for an expanded node is shown even with no keyframes. `sceneHasObjects(scene)` `timelineTracks.ts:260` is the only culling helper (root children existence).
- `AnimationsPanel.tsx:165-167` and `LibraryBrowser.tsx:42-47` / `CollectionLibraryBrowser.tsx:32-34` / `AssetsPanel.tsx:511-528` all use the same one-liner predicate pattern for their search bars:
  ```ts
  const filtered = definitions.filter(d => !search.trim() || d.name.toLowerCase().includes(search.trim().toLowerCase()))
  ```
  With optional `categoryFilter` `LibraryBrowser.tsx:44-45`. No debouncing.

**Manager needs a true animated-children predicate** (#306 Notes: "Modal shows only children that have animation, and only animated parameters"). Scaffold:

```ts
// frontend/src/components/panels/manager/managerRows.ts
export function managerRows(parentId: string, engine: EnginePublic): ManagerRow[] {
  const slide = engine.getActiveSlide()!  // caller ensures
  const parent = engine.getNode(parentId)
  const nodes = [...walkPreOrder(parent)].filter(n => n.id !== parentId && !n.components.camera)

  const hasAnimation = (node: SceneNode): boolean => {
    const anim = slide.animation.node(node.id)
    if (!anim) return node.clipInstances.length>0
    return (
      anim.tracks.length>0 ||
      (anim.materialTracks?.length ?? 0) > 0 ||
      anim.visibleTrack?.keyframes.length > 0 ||
      anim.morphTrack?.keyframes.length > 0 ||
      (anim as any).shadowTracks?.size > 0 ||
      (anim as any).circleTracks?.length > 0 ||
      node.clipInstances.length > 0
    )
  }
  const filteredNodes = nodes.filter(hasAnimation)

  // For each kept node, keep only animated params (query animation entry + clip coverage)
  // Mirror timelineTracks.ts:190-253 but gate each push on anim.tracks.some(t=>t.property===prop)
  // Bones are excluded by the kind==='bone' guard timelineTracks.ts:178-185 — replicate.
}
```

Alternatives: query `engine.getKeyframes(nodeId, property).length>0` per property (cheaper than anim inspection, already used in `TimelineBody.tsx:319-352` for selection items). Or use `animation.hasTrack(nodeId, property)` if added.

For **orphan-param view** (§5.5), invert: `nodes with keyframes that are not covered by any ClipInstance on that node/property`. For **clip view**, emit one row per `ClipInstance` (not per property) — `sceneNode.ts:50,73` is the source `node.clipInstances: readonly ClipInstance[]`, ordered as the evaluation stack `animationEvaluator.ts:1050` last-wins. For **collection view**, emit one header row per `ClipCollection` bindings that intersect the subtree semantics, then member clip rows underneath (filtered to those whose `semanticName` is in `collection.bindings`).

Keep `BoneTrackEntry` out of the Manager unless spec says bones animate (today bones have only `length`, not animatable, and `timelineTracks.ts:178-185` pushes a distinct `kind:'bone'` row with no property expansion).

---

## 7. Summary of insertion points & reuse checklist

| Slice | Insert / reuse | Files to touch |
|-------|----------------|----------------|
| **Scene entry** | Add `Animation Manager…` `menu__item` to `ScenePanel.tsx:603-649` context menu; new `managerParentId` state + `<AnimationManagerModal>` mount at `ScenePanel.tsx:656-661` | `ScenePanel.tsx:32-36,150,216,401-408,536-537,603-663` |
| **Canvas entry** | Add `CanvasContextMenu` sibling to `CanvasPanel.tsx:109-117` using `topmostNodeAt`/`cursorToWorld`/`getWorldTransform`/`getNodeFilter` from `canvasSelection.ts:147-206,191,242`; resolve parent-with-children; open shared modal state | `CanvasPanel.tsx:17-118`, `canvasSelection.ts:14,58,65-151,191,242,412-425` |
| **Modal shell** | Copy `ExportClipCollectionModal.tsx:154-195` `modal-overlay` scaffold; scale to big modal `minWidth:760, maxWidth:960, maxHeight:88vh`; `role=dialog aria-modal` + backdrop `onClick` + `Escape` via `ParentingModeDialog.tsx:27-34`; header with view tabs (Collections / Clips / Orphans / Editor) | `ExportClipCollectionModal.tsx:14,150-396`, `ExportObjectModal.tsx:124-161`, `ApplyClipCollectionModal.tsx:160-175`, `ParentingModeDialog.tsx:39-45`, `frontend/src/index.css:3499` |
| **Timeline & scroll sync** | Reuse `timelineViewStore` `pps/scrollTime/zoomLevel` + `TimelineBody` two-pane layout `timeline-tracks` + `timeline-scroller` + `TrackRow`/`KeyframeMarker` + `ROW_HEIGHT=28` `TRACK_HEADER_WIDTH=240` | `TimelinePanel.tsx:88`, `TimelineBody.tsx:228-250,1031-1070,1061-1364`, `timelineTracks.ts:17-18,90-100,168-258`, `timelineViewStore.ts` |
| **Filtered predicate** | New `managerRows.ts` filtering `walkPreOrder(parent)` by `slide.animation.node(nodeId)` / `engine.getKeyframes` / `clipInstances.length>0`; only animated params; exclude `bone` kind | `timelineTracks.ts:142-258`, `TimelineBody.tsx:319-352`, `internal.ts:3134`, `sceneNode.ts:50` |
| **Handles** | Reuse `SelectionScaleBox` `timelineComponents.tsx:196-276` for sub-view; new `ClipBarHandles` (6 px, `ew-resize`, center grab) per bar + `useClipBarDrag/Scale` modeled on `keyframeScale.ts:258-347` / `keyframeDrag.ts:232-286` but targeting `ClipInstance.startTime/speed` | `timelineComponents.tsx:196-276`, `keyframeScale.ts:258-347`, `keyframeDrag.ts:232-286`, `frontend/src/index.css:3052,3896` |
| **Clip resize math** | Drive `instance.speed = clip.duration / newVisualDuration`, `visualDuration = duration / speed` per `animationEvaluator.ts:1050-1053`; collection resize propagates factor to members (iterate `collection.bindings`) | `clipInstance.ts:14-29,42-80`, `clipDefinition.ts:56-65,238-248`, `animationEvaluator.ts:397-400,425-428,502-506,566-570,1050-1053,1147-1150`, `reusableObject.test.ts` §2.4 |
| **Validation** | Copy `ExportClipCollectionModal.tsx:54-115` preview → `hasClip`/`missing`/`bindings` → `blockingError` → `panel-status--error` with select-to-fix buttons; add orphan banner (non-blocking unless spec says else) | `ExportClipCollectionModal.tsx:54-115,240-301`, `lessonSerializer.ts:1027-1078`, `reusableObject.ts:81-85,177-201` |
| **Portability** | Export = `Engine.exportReusableObject(rootId,name,desc)` → `{version:1, name, rootId, nodes, animation, library:{clips,clipCollections,assets,materials,…}, ikChains}` `reusableObject.ts:5-15` minus global ids (remapped on import `reusableObject.test.ts:336-369`); Library clip-collection is self-contained `clips[]+bindings` `clipCollectionLibraryStore.ts:25-68` | `reusableObject.ts:1-221`, `internal.ts:3134-3135`, `lessonSerializer.ts:39-67,88-120`, `clipCollectionManager.ts:4-83`, `clipCollectionLibraryStore.ts:25-68,126-315`, `clipLibraryStore.ts:130-157` |
| **Library** | `AnimationsPanel.tsx:64-68` `initClipLibraryStore(dispatch)` + `initClipCollectionLibraryStore(dispatch)`; `CollectionLibraryBrowser.tsx:24-28` refresh-on-open; `LibraryBrowser.tsx:32-34` search predicate; `ExportObjectModal.tsx:100-107` double-write (download + `assetsApi.uploadAssets([file],['object'])`) | `AnimationsPanel.tsx:64-68,165-167,216-259,726-742`, `CollectionLibraryBrowser.tsx:24-28,32-34,58-195`, `LibraryBrowser.tsx:42-47,63-176`, `ExportObjectModal.tsx:99-112` |

---

## 8. Not yet specified — deferred to prototype/spec tickets

- Validation wording & recovery for orphan keyframes vs missing `semanticName` in the modal (banner content, inline fix buttons, auto-fix suggestions). Precedent §§3.3/5.5 is blocking for missing semantic, no precedent for orphans.
- Which order array owns collection vs clip layering and how undo groups (single `TransactionCommand` vs per-instance commands; whether collection lane order is a separate persisted array or derived from member instance order).
- Where assignments live for objects that embed many collections — UI surface after import (dropdown vs Manager section vs `AnimationsPanel` collections list) and how `clipCollectionLibraryStore.importCollectionFromLibrary` `clipCollectionLibraryStore.ts:205-315` clashes with many embedded collections.
- Exact handle semantics: left vs right resize effect on `startTime` vs `speed` vs `ClipDefinition.duration`; whether `speed===0` freezes vs disables (`enabled=false`) and how the bar renders `duration/0` (cap width).
- Keyboard & accessibility for bars/collections (focus ring, arrow reorder, Escape hierarchy: handle drag > modal > context menu).
- Canvas entry scope — include only `Group` parents (`isGroupNode`) vs any parent with children; interaction with `isIKHandleAt` `canvasSelection.ts:181-183` and `boneCreation`/`meshEdit` editing modes `canvasSelection.ts:158-166`.

## References

- `frontend/src/components/panels/ScenePanel.tsx:32-36,150,216,250-263,401-408,536-537,603-661`
- `frontend/src/pixi/renderer/canvasSelection.ts:14,58,65-151,153-206,191,242,412-425`
- `frontend/src/components/panels/CanvasPanel.tsx:17-118`
- `frontend/src/components/panels/ClipExtractionModal.tsx:137-156` (backdrop variant with `clip-extraction-modal__backdrop`)
- `frontend/src/components/panels/ExportClipCollectionModal.tsx:14,54-115,150-396` (blocking `semanticName` validation + `modal-overlay` scaffold)
- `frontend/src/components/panels/ExportObjectModal.tsx:99-112,124-161` (double-write `.lesson_object`)
- `frontend/src/components/panels/CollectionLibraryBrowser.tsx:24-28,32-34,58-195` (refresh-on-open, `projects-overlay`)
- `frontend/src/components/panels/LibraryBrowser.tsx:32-47,63-176` (search predicate `libraryBrowserVisible`)
- `frontend/src/components/panels/timelineComponents.tsx:196-276` (`SelectionScaleBox`, 6 px `ew-resize` handles)
- `frontend/src/components/panels/keyframeScale.ts:258-347` (scale session pivot/factor/snap/commit); `frontend/src/components/panels/keyframeDrag.ts:232-286` (drag delta + group commit)
- `frontend/src/components/panels/AnimationsPanel.tsx:64-68,165-167,197-214,216-259,726-742` (library init, portable `.clip_collection`, confirm dialogs)
- `frontend/src/engine/reusableObject.ts:1-221` (version 1, `library{clips,clipCollections}` cross-ref guard `reusableObject.ts:177-201`)
- `frontend/src/engine/clipCollectionManager.ts:4-83` (bindings `Map<semanticName,clipId>`)
- `frontend/src/engine/lessonSerializer.ts:37-67,88-120,163-209,988-1078` (`LessonJSON.library`, `parseClips*`, validation)
- `frontend/src/stores/clipLibraryStore.ts:28-32,35-45,66-73,92-99,110-128,130-157,203-209,241-252` (store shape, `dispatchRef`, `saveToLibrary`/`importClipFromLibrary`)
- `frontend/src/stores/clipCollectionLibraryStore.ts:25-68,126-186,205-315` (self-contained `clips[]` snapshot, `importCollectionFromLibrary` remap + legacy fallback)
- `frontend/src/components/panels/timelineTracks.ts:17-18,90-100,142-258,260,276-292` (row union, `timelineRows` builder, no filter)
- `frontend/src/components/panels/TimelineBody.tsx:228-250,319-352,1031-1070,1061-1364,1844-1851` (`pixelsPerSecond`, `SelectionScaleBox` wiring)
- `frontend/src/pixi/renderer/handleInteraction.ts:546` (`ew-resize` cursor map)
- `frontend/src/components/projects/ProjectsDialog.tsx:112-278` (`projects-overlay` / `projects-dialog` CSS)
- `CONTEXT.md` vocabulary; `docs/adr/0006-*`, `docs/adr/0008-morph-clip-collection-reusable-object-portability.md`

