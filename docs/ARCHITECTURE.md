# Scribeframe Architecture

## Goals

The engine is a small TypeScript editor runtime for writing apps. It owns
document state, input, rendering, plugins, and widget lifecycle without depending
on document formats. Markdown support is demonstrated through example adapter
code outside the core package source, not hardcoded into the runtime.

## Layers

1. **Display document model**: immutable paragraphs and UTF-16 positions.
2. **Transactions**: typed steps that transform documents and selections.
3. **Syntax provider boundary**: optional providers attach opaque syntax
   snapshots to editor state; the core does not know parser or projection
   details.
4. **Commands and keymaps**: named commands plus app, plugin, and default key
   bindings for keyboard-driven behavior.
5. **History**: editor-owned undo/redo stacks over normalized document,
   selection, and active syntax snapshots.
6. **Plugins**: isolated state slices, explicit teardown, runtime
   reconfiguration, plus pure decoration/widget output.
7. **Renderer**: virtualized DOM output, virtual caret, selection painting,
   scrolling geometry, and widget mount/update/destroy.
8. **Input manager**: focus-proxy textarea, keyboard editing, clipboard, and
   pointer-to-position mapping.
9. **Example integrations**: demo code can provide syntax providers, projections,
   decorations, and widgets for Markdown or any other format by using the public
   engine API.

Core dependencies flow downward and never import adapter modules. Plugins can
describe output and request transactions through typed contexts, but they do not
own DOM nodes or editor internals.

## Syntax providers and example integrations

The editable document is plain editor text. Core selection, cursor movement,
renderer measurement, and transactions stay in document coordinates. A
`SyntaxProvider` can attach an opaque `SyntaxSnapshot` to editor state and is
called only when document text changes. Selection-only transactions reuse the
existing snapshot.

The demo Markdown adapter is one provider implementation. It lives under
`demo/src/markdown`, imports the core through the public `@saturn9/scribeframe`
barrel, treats document text as Markdown source, builds an identity source map,
and parses that text with the dev-only `@saturn9/markoffset` dependency. Parser
token offsets are mapped back to document ranges before demo plugins turn them
into decorations, widgets, extension instances, or commands. Host applications
that need richer persistence/display mappings can provide their own adapters
without changing core.

Published core exports do not include a Markdown subpath and runtime consumers do
not install `@saturn9/markoffset` unless they choose a Markdown integration.

## History

Undo and redo are owned by the editor runtime, not by plugins or the renderer.
Text-changing dispatches record a bounded history entry after plugin
normalization so undo restores the same document, selection, and provider syntax
snapshot that the user saw. Selection-only transactions are not recorded.
Undo/redo restores notify plugins through the same apply path, emit change
notifications, and do not record themselves as new history entries. The redo
stack is cleared when a new text-changing transaction follows an undo.

History entries are batched with explicit editor-origin metadata. Continuous
typing coalesces into natural undo units, with whitespace, cursor movement, and
timeout boundaries closing the active batch. Contiguous Backspace and Delete
runs batch independently. Repeated edits from the same widget coalesce into a
widget-local undo unit without merging into surrounding editor typing.
Paste-like programmatic replacements, Enter, selected range replacement, cut,
and widget deletion are explicit boundary entries so they undo as complete user
actions rather than merging into surrounding typing.

Host applications can call `clearHistory()` when changing editor context without
using `setContent()`. `setContent()` resets history automatically because it
represents an external document replacement, such as switching files, rather
than an undoable user edit.

## Commands and keymaps

Keyboard behavior is routed through named editor commands. Apps can provide
custom commands and key bindings through `ModernEditorOptions`, and plugins can
provide commands plus plugin-scoped keymaps from current plugin state. Keydown
resolution is ordered from most specific to most general: app keymap, plugin
keymaps, legacy plugin `handleKeyDown`, then the built-in editor keymap.

Built-in commands cover selection, movement, word movement, deletion, line
breaks, undo, and redo. A command returns `false` to decline handling, allowing
later keymaps to run. This keeps default behavior configurable without exposing
DOM events or editor internals as the primary extension API.

## Widget lifecycle

Widgets are immutable render descriptions keyed by plugin-scoped `WidgetKey`s.
The renderer owns host elements and calls `mount`, `update`, and `destroy`.
Consumers should not keep global DOM registries or query the document to recover
existing widget roots.

## Plugin lifecycle

Plugins are initialized from an editor snapshot and receive every transaction
through `apply`. Plugins can expose commands/keymaps, pure render output,
normalization steps, and an optional `destroy` hook. `destroy` receives the latest
plugin state and editor snapshot so plugins can cancel async work and release
external resources without reaching into editor internals.

`ModernEditor.setPlugins()` reconfigures the plugin list at runtime. Plugin
state is keyed by `PluginId` object identity, so factories can return fresh
plugin objects while preserving state by reusing the same exported id. When a
plugin object changes for a retained id, the slot rebinds to the new behavior
without re-running `init`. Duplicate ids in a plugin list are rejected before the
editor mutates plugin state. Removed plugin ids are destroyed once, and newly
added ids are initialized against the current editor snapshot. Editor
`destroy()` is idempotent and destroys installed plugins before tearing down the
renderer. Destroy also removes root, input-proxy, and document drag listeners so
retained DOM nodes cannot keep mutating editor state after unmount.

Transaction metadata keys are also identity-based. The human-readable key name is
for diagnostics; two keys with the same name do not overwrite each other unless
callers reuse the same key object.

## Scrolling and virtualization

The renderer owns explicit scrolling APIs. Host apps can ask the editor to
reveal a document position, reveal the current selected span, select a range
with optional reveal behavior, or scroll to a document fraction for
minimap-style tools. Geometry is expressed in terms of explicit engine
`Position` and `Range` values.

Rendering is virtualized when the scroll container has a measurable viewport.
The renderer keeps a visible paragraph window with configurable overscan and
uses spacer blocks to preserve total document height. Widgets are mounted only
while their covered paragraph is in the rendered window, and the same
renderer-owned lifecycle destroys offscreen widget hosts. If the focused widget
virtualizes out, focus returns to the editor input proxy because the focused
widget DOM is no longer live.

The editor root owns the accessible textbox semantics for the whole surface:
`role="textbox"`, `aria-multiline="true"`, configurable `aria-label`,
synchronized `aria-readonly`, and a focusable `tabindex`. Visual selection and
caret overlays are marked `aria-hidden` because the engine's internal selection
state is authoritative. Destroying an editor removes renderer-owned DOM and
restores pre-existing host accessibility attributes and editor classes.

## Input correctness

The focus-proxy textarea is a transient input buffer, not a document mirror.
Cancelable `beforeinput` events are the authoritative path for text insertion,
line breaks, paste-style insertion, and content deletion. The `input` event
remains a fallback for browser paths that do not expose a cancelable
`beforeinput`. IME composition text stays in the proxy buffer and is committed
only on `compositionend`; editing shortcuts and deletion keys are ignored while
composition is active.

Horizontal movement and deletion are grapheme-aware by default and support
word-granularity commands through the platform word modifier (`Alt`/`Option`, or
`Ctrl` where appropriate). Word deletion is recorded as an undo boundary so a
whole-word edit undoes as one user action.
Line-boundary movement resolves through renderer geometry so Home/End stay on the
current visual line when text soft-wraps, with paragraph-boundary fallback when
geometry is unavailable. Document-boundary shortcuts target the first and last
document positions directly.

Clipboard operations use display text. Copy writes the selected display range as
`text/plain`; cut writes the same text and records the deletion as a boundary
history entry. Paste inserts plain text as a boundary entry and clears redo like
any other new edit. HTML-only paste is suppressed rather than delegated to the
hidden browser textarea. In read-only mode, paste is always suppressed, cut
behaves like copy without mutating the document, and the input proxy buffer is
cleared.

The browser validation harness runs against the demo app with Playwright. Install
browser binaries with `npm run browser:install --workspace=@saturn9/scribeframe`,
then run `npm run browser:test --workspace=@saturn9/scribeframe`. It exercises
real Chromium and WebKit keyboard input, undo/redo, read-only suppression, widget
edits, and Chromium native clipboard paste. True OS IME candidate-window behavior
still requires platform validation outside headless automation.
