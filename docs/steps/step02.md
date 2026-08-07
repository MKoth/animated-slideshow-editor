# Step 2 – Editor Shell

## Goal

Create the complete editor user interface layout without implementing any editing functionality.

The objective is to establish the application's visual structure and navigation so that every future feature has a dedicated place. After this step, the application should already look like a professional editor, even though most controls are placeholders.

No rendering engine, scene management, or business logic should exist yet.

---

# Success Criteria

At the end of this step:

* ✅ Editor layout is fully implemented.
* ✅ All panels can be resized.
* ✅ Layout persists between application restarts.
* ✅ Theme (light/dark) works.
* ✅ Basic menu system exists.
* ✅ Empty state placeholders are visible.
* ✅ No actual editing functionality exists yet.

---

# Functional Requirements

## Main Layout

Create a desktop-style editor interface.

```
+--------------------------------------------------------------+
| Menu Bar                                                     |
+--------------------------------------------------------------+
| Toolbar                                                      |
+--------------------------------------------------------------+
| Assets | Slides |               Canvas              | Inspector|
|        |        |                                  |          |
|        |        |                                  |          |
|        |        |                                  |          |
|        |        |                                  |          |
+--------------------------------------------------------------+
| Timeline                                                     |
+--------------------------------------------------------------+
| Status Bar                                                   |
+--------------------------------------------------------------+
```

Each area should be implemented as an independent React component.

---

# Menu Bar

Implement a menu bar with placeholder actions.

Menus:

```
File

Edit

View

Assets

AI

Help
```

Menu items should currently display a simple notification such as:

```
Not implemented yet.
```

---

# Toolbar

Create a toolbar containing placeholder buttons.

Suggested buttons:

```
New Project

Open

Save

Undo

Redo

Play

Pause

Stop

AI Assistant
```

Buttons are disabled except for displaying placeholder messages.

---

# Left Sidebar

The left side should contain two tabs.

```
Assets

Slides
```

Each tab displays placeholder content.

Example:

```
Assets

No assets imported.
```

```
Slides

No slides created.
```

---

# Center Panel

The center panel represents the future Pixi canvas.

Currently display:

```
Canvas Placeholder

Renderer not initialized.
```

Include:

* checkerboard background
* centered placeholder message
* canvas border

No Pixi integration yet.

---

# Right Sidebar

Inspector panel.

Display:

```
Inspector

Nothing selected.
```

Later this panel will contain property editors.

---

# Bottom Timeline

Reserve space for timeline.

Display:

```
Timeline

No animation loaded.
```

No timeline functionality yet.

---

# Status Bar

Bottom status bar.

Display:

```
Ready

Backend Connected

Zoom: 100%

FPS: --
```

Values may be static placeholders.

---

# Layout System

The user should be able to resize:

* left sidebar
* slides/assets divider (if vertical split is introduced later)
* inspector
* timeline

Use a proper docking/split layout library or split panes.

Minimum sizes should be enforced.

---

# Responsive Behavior

The editor targets desktop usage.

Minimum supported width:

```
1400 px
```

Below this width:

Display a message indicating that the editor is intended for larger screens.

Mobile support is not required.

---

# Theme

Implement theming.

Support:

* Light
* Dark

Theme selection should persist.

---

# Application State

Introduce an application-level state store.

Only UI state is required.

Examples:

```
Current theme

Panel sizes

Visible panels

Selected sidebar tab
```

No project state yet.

---

# Keyboard Shortcuts

Register shortcuts.

Implementation may simply show notifications.

Suggested shortcuts:

```
Ctrl+N

Ctrl+O

Ctrl+S

Ctrl+Z

Ctrl+Y

Delete

Space
```

No actual functionality yet.

---

# Notifications

Introduce a global notification system.

Examples:

```
Coming soon

Project saved

Backend unavailable
```

Only placeholder messages are needed for now.

---

# Routing

Create initial application routing.

Example:

```
/

Editor
```

Future routes may include:

```
Settings

About

Asset Playground
```

Only the editor route is implemented.

---

# Component Structure

Suggested high-level React components:

```
App

EditorPage

EditorLayout

MenuBar

Toolbar

LeftSidebar

AssetsPanel

SlidesPanel

CanvasPanel

InspectorPanel

TimelinePanel

StatusBar
```

Each component should remain focused on a single responsibility.

---

# Testing

Create UI tests verifying:

* Editor renders successfully.
* Theme switching works.
* Sidebar tabs switch correctly.
* Layout resizing updates state.
* Status bar renders.

Business logic tests are not required.

---

# Manual Verification Checklist

## Layout

* Editor opens successfully.
* All panels are visible.
* No overlapping elements.
* Resize behaves correctly.

---

## Menu

* Menus open.
* Clicking items shows placeholder notification.

---

## Toolbar

* Buttons render correctly.
* Placeholder notifications appear.

---

## Theme

* Switch between light and dark themes.
* Restart application.
* Theme remains selected.

---

## Panels

Assets tab:

```
No assets imported.
```

Slides tab:

```
No slides created.
```

Inspector:

```
Nothing selected.
```

Timeline:

```
No animation loaded.
```

Canvas:

```
Renderer not initialized.
```

---

## Shortcuts

Press:

```
Ctrl+S

Ctrl+O

Ctrl+N
```

Notifications appear.

---

## Backend

Status bar displays backend status correctly.

---

# Deliverables

After Step 2, the application should resemble a professional editor with:

* Complete desktop layout
* Menu system
* Toolbar
* Sidebar tabs
* Canvas placeholder
* Timeline placeholder
* Inspector placeholder
* Status bar
* Theme support
* Keyboard shortcuts
* Notification system
* Resizable panels
* Persisted UI preferences

No editing, rendering, project management, or animation functionality should exist yet.

---

# Definition of Done

Step 2 is complete when:

* The application opens directly into the editor layout.
* Every planned editor area is represented by a dedicated component.
* Users can explore and resize the interface naturally.
* UI preferences (theme, panel sizes, selected tabs) persist across restarts.
* The shell is stable enough that future steps can focus on implementing functionality inside existing panels rather than changing the overall layout.
