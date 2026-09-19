export interface ShortcutEntry {
  readonly keys: readonly string[]
  readonly action: string
  readonly context: string
}

export interface ShortcutSection {
  readonly id: string
  readonly title: string
  readonly entries: readonly ShortcutEntry[]
}

/**
 * View-only catalog of every usable key / key combination in the editor.
 * Manually curated: the central registry (`shortcutRegistry.ts`) covers the
 * global shortcuts, while canvas, audio timeline, animation manager, curve
 * editor and dialogs own scattered `keydown` handlers. Keep this list in sync
 * when adding a handler. Provisional stubs (`Ctrl+N`, `Ctrl+O`) and generic
 * inspector `Enter`-to-commit inputs are intentionally excluded.
 */
export const SHORTCUT_CATALOG: readonly ShortcutSection[] = [
  {
    id: 'general',
    title: 'General',
    entries: [
      {
        keys: ['Ctrl/⌘', 'C'],
        action: 'Copy selection or selected keyframes',
        context: 'Global (not in text inputs)',
      },
      {
        keys: ['Ctrl/⌘', 'V'],
        action: 'Paste selection or keyframes',
        context: 'Global (not in text inputs)',
      },
      {
        keys: ['Ctrl/⌘', 'D'],
        action: 'Duplicate selection or selected keyframes',
        context: 'Global (not in text inputs)',
      },
      {
        keys: ['Delete', 'Backspace'],
        action: 'Delete selection or selected keyframes',
        context: 'Global (not in text inputs)',
      },
      { keys: ['Ctrl/⌘', 'Z'], action: 'Undo', context: 'Global' },
      {
        keys: ['Ctrl/⌘', 'Shift', 'Z'],
        action: 'Redo',
        context: 'Global',
      },
      {
        keys: ['Ctrl/⌘', 'Y'],
        action: 'Redo (alternate)',
        context: 'Global',
      },
      { keys: ['Ctrl/⌘', 'S'], action: 'Save project', context: 'Global' },
      {
        keys: ['Esc'],
        action: 'Exit mesh / bone edit mode, cancel pending bone, close menus and dialogs',
        context: 'Global',
      },
    ],
  },
  {
    id: 'mesh-edit',
    title: 'Mesh edit',
    entries: [
      {
        keys: ['1'],
        action: 'Vertex select mode (Paint tool in Weight Paint)',
        context: 'Mesh editing',
      },
      {
        keys: ['2'],
        action: 'Edge select mode (Smooth tool in Weight Paint)',
        context: 'Mesh editing',
      },
      {
        keys: ['3'],
        action: 'Face select mode (Fill tool in Weight Paint)',
        context: 'Mesh editing',
      },
      { keys: ['4'], action: 'Blur tool', context: 'Weight Paint tool active' },
      { keys: ['5'], action: 'Auto Weights tool', context: 'Weight Paint tool active' },
      { keys: ['E'], action: 'Extrude tool', context: 'Mesh editing' },
      { keys: ['S'], action: 'Subdivide tool', context: 'Mesh editing' },
      { keys: ['M'], action: 'Mirror tool', context: 'Mesh editing' },
      { keys: ['W'], action: 'Weight Paint tool', context: 'Mesh editing' },
      { keys: ['X'], action: 'Mirror axis X', context: 'Mirror tool active' },
      { keys: ['Y'], action: 'Mirror axis Y', context: 'Mirror tool active' },
      {
        keys: ['Delete', 'Backspace', 'D'],
        action: 'Delete selected vertices / edges / faces',
        context: 'Mesh edit canvas',
      },
    ],
  },
  {
    id: 'canvas',
    title: 'Canvas',
    entries: [
      { keys: ['P (hold)'], action: 'Pivot-drag modifier', context: 'Canvas' },
      {
        keys: ['Esc'],
        action: 'Cancel bone drag, exit bone edit, clear pending bone creation',
        context: 'Bone editing / bone creation',
      },
    ],
  },
  {
    id: 'audio-timeline',
    title: 'Audio timeline',
    entries: [
      {
        keys: ['Ctrl/⌘', 'D'],
        action: 'Duplicate selected audio clips',
        context: 'Audio timeline focused',
      },
      {
        keys: ['Delete', 'Backspace'],
        action: 'Delete selected clips or focused prompter part',
        context: 'Audio timeline focused',
      },
      {
        keys: ['Home', 'End'],
        action: 'Move selected clips to start / end',
        context: 'Clips selected',
      },
      {
        keys: ['←', '→'],
        action: 'Nudge selected clips (Shift = larger step)',
        context: 'Clips selected',
      },
      {
        keys: ['↑', '↓'],
        action: 'Trim clip source end, or move focus with no selection',
        context: 'Audio timeline focused',
      },
      { keys: ['Space'], action: 'Play / pause', context: 'Audio timeline focused' },
      {
        keys: [',', '.'],
        action: 'Step one frame backward / forward',
        context: 'Paused, audio focused',
      },
      { keys: ['Ctrl/⌘', '+', '−'], action: 'Zoom in / out', context: 'Audio timeline focused' },
      { keys: ['+', '−'], action: 'Zoom in / out', context: 'Audio focused, no selection' },
      {
        keys: ['S'],
        action: 'Split clip at playhead',
        context: 'Single clip selected, playhead inside clip',
      },
      {
        keys: ['R'],
        action: 'Record focused prompter part (configurable in settings)',
        context: 'Prompter part focused',
      },
      {
        keys: ['Enter'],
        action: 'Start / commit inline edit of prompter part',
        context: 'Prompter chip focused / editing',
      },
      {
        keys: ['Esc'],
        action: 'Cancel edit, close clip and prompter menus',
        context: 'Audio timeline',
      },
    ],
  },
  {
    id: 'animation-manager',
    title: 'Animation manager',
    entries: [
      {
        keys: ['Esc'],
        action: 'Close prompts and menus innermost-first, then the manager',
        context: 'Animation manager open',
      },
      {
        keys: ['Delete', 'Backspace'],
        action: 'Delete selected placement, orphans, or clip instances',
        context: 'Animation manager open',
      },
      {
        keys: ['Enter'],
        action: 'Confirm rename',
        context: 'Rename input focused',
      },
    ],
  },
  {
    id: 'curve-editor',
    title: 'Curve editor',
    entries: [
      { keys: ['Space (hold)'], action: 'Pan (drag while held)', context: 'Curve editor' },
      {
        keys: ['Alt', 'drag'],
        action: 'Break tangents while dragging a tangent handle',
        context: 'Curve editor',
      },
    ],
  },
  {
    id: 'dialogs',
    title: 'Dialogs',
    entries: [
      {
        keys: ['Esc'],
        action: 'Close or cancel dialog (record, waveform, TTS, confirms, pickers, scene menu)',
        context: 'Any dialog open',
      },
      { keys: ['R'], action: 'Start / stop recording', context: 'Record dialog' },
    ],
  },
  {
    id: 'mouse-chords',
    title: 'Mouse + key chords',
    entries: [
      {
        keys: ['Ctrl/⌘', 'click'],
        action: 'Toggle selection',
        context: 'Canvas / curve editor',
      },
      {
        keys: ['Shift', 'click'],
        action: 'Extend / range selection',
        context: 'Canvas / curve editor',
      },
      {
        keys: ['Alt', 'drag'],
        action: 'Alternate drag: pan camera, erase in Weight Paint, invert in Sculpt',
        context: 'Canvas',
      },
      {
        keys: ['Shift', 'drag'],
        action: 'Erase in Weight Paint, invert in Sculpt',
        context: 'Paint / sculpt tools',
      },
      {
        keys: ['Alt', 'Left-drag'],
        action: 'Pan camera (same as Middle-drag)',
        context: 'Canvas',
      },
    ],
  },
]
