# ADR 0003 — Handles, Pivot, Scale Group, Visibility, and Naming

Date: 2026-09-02
Status: Accepted (grill #13-items)

Context: Canvas today only drags to move; eye toggles do nothing; name duplicates silently; no pivot offset. Items 1,2,8,10,11,12 requested handles/rotate, movable pivot, scaling without breaking animation, animatable boolean visibility, unique vs repeatable names.

Decision: Bounding box shows 8 resize handles (corners uniform, edges axial) + 1 rotation handle 24px above center; Shift locks aspect, Alt scales from center; all respect localPivot. localPivot is normalized offset from bounds center with IDENTITY_PIVOT (0,0)=center, static v1 (not keyframable); changing it recomputes position to keep world stable via Keep World Transform. Scale is not a new component — Scale Group reuses Rig Handle / Group Node (empty Scene Node) as parent; clips stay local and compose via worldTransform. Visible becomes a hold-only animation track (no linear/bezier); eye adds hold keyframe at playhead in anim mode else toggles base. Names split: name = per-slide unique display name (block on duplicate with inline error, not auto-suffix); semanticName = optional repeatable tag for hierarchical clip binding only.

Alternatives: Figma-style corner ring for rotate (rejected: hit-area complexity); pixel pivot (rejected: resolution dependent); dedicated ScaleGroupComponent (rejected: duplicates Group Node); auto-suffix on duplicate (rejected per UX); opacity-based hiding (rejected: leaks render).
