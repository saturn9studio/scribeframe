# ADR 0003: Scribeframe Command and Keymap Layer

## Status

Accepted

## Context

The scribeframe prototype originally handled keyboard shortcuts directly inside
`ModernEditor.handleKeyDown`. That made built-in behavior work, but it left apps
and plugins without a first-class way to register commands or key bindings. Flow
and Longhand need to adapt to the engine's original API surface without cloning
ProseMirror's keymap model.

## Decision

Scribeframe core exposes a command layer made of named `EditorCommand`s,
`EditorKeyBinding`s, and a public `ModernEditor.executeCommand()` API. Keydown
resolution runs app keymaps first, plugin keymaps second, legacy plugin
`handleKeyDown` hooks third, and the built-in editor keymap last. A command that
returns `false` declines handling so later keymaps can still run.

Built-in editing, movement, selection, undo, and redo shortcuts are represented
as named editor commands. Plugins can contribute commands from current plugin
state and bind them through plugin keymaps.

Plugin lifecycle is explicit: plugins may provide `destroy()` cleanup hooks, and
the editor can reconfigure plugins at runtime. Exact plugin instances that remain
installed keep their state; removed plugin instances are destroyed once; added
plugins initialize from the current editor snapshot.

## Consequences

- Apps can override defaults without patching editor internals.
- Plugins can add keyboard-driven behavior while keeping state isolated.
- Existing `handleKeyDown` plugins remain supported during migration.
- Plugins have a cleanup point for cancelling async work and releasing external
  resources.
- Key bindings are string-based and intentionally small for the prototype; more
  advanced contexts or platform-specific keymaps can be added behind the same
  command API later.
