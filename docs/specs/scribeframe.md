# Scribeframe Specification

## Overview

A custom text editor engine to replace ProseMirror. It targets the two known
runtimes (Electron/Chromium and Tauri/WebKit) rather than the full browser
matrix, and adopts a modern input model where a hidden textarea captures user
input while the editor owns its rendering layer completely.

This document is a high-level design. Each component will be refined into its
own detailed spec before implementation.

## Goals

- **Modern input model**: capture keyboard, clipboard, and IME input through a
  controlled surface (hidden textarea) rather than relying on contenteditable
  to drive the document model.
- **Transaction-based document model**: all mutations go through transactions,
  enabling undo/redo, plugin interception, and collaborative editing
  foundations.
- **Format-agnostic editing**: core editing uses a simple display document and
  exposes syntax-provider hooks. Markdown persistence, source maps, and parser
  integration live in demo/example adapter code, not in the core package.
- **Decoration system**: first-class support for inline style decorations (for
  syntax rendering) and node decorations (for UI widgets like the
  image editor and code block editor).
- **Plugin system**: replaces ProseMirror's plugin API; each plugin owns a
  state slice, can intercept transactions, and contributes decorations.
- **Type-safe and composable**: TypeScript throughout; no `any`.

## Non-Goals (v1)

- Collaborative editing / CRDT (architecture should not preclude it).
- Mobile / touch input.
- Advanced assistive technology affordances beyond stable textbox semantics,
  keyboard navigation, and read-only state reflection.
- Rich schema (no marks, no complex node types — document model mirrors the
  current `doc → paragraph → text` structure).

---

## Main Components

### 1. Display Document Model

The editor's canonical mutable state is a **display document**, not a rich AST.
The core document stores plain paragraphs; format-specific syntax and semantic
roles are derived by adapters and plugins.

The current display schema is intentionally minimal and stays that way:

```
DisplayDocument
  Paragraph
    Text (string)
```

Widget identity and semantic roles do not live on paragraph attributes. Widgets
are derived from plugin-provided extension instances, and whole-paragraph
presentation comes from block decorations.

All display positions and render decoration ranges use **UTF-16 code unit
offsets**, matching JavaScript strings and DOM `Range` APIs. User-facing
navigation and deletion operate on grapheme clusters (for emoji, accents, and
composed characters) using `Intl.Segmenter` when available, but stored
positions remain UTF-16 offsets. Display absolute offsets count display
paragraph boundaries as a single `\n`.

Display text is the coordinate space for selections, cursor movement, edit
transactions, renderer measurement, spellcheck/search/current-sentence ranges,
and widget focus/replacement commands. Format-specific source text, such as
Markdown, is an adapter projection used for persistence, copy/export, and
parser-backed syntax outside the core package.

#### Example Markdown adapter projection

Projection is adapter-level code, not a required core engine dependency. The
core exposes display documents, transactions, and syntax-provider hooks; the demo
Markdown adapter uses those hooks to parse Markdown and map parser offsets back
to editor ranges.

The demo intentionally uses an identity projection: the document text the user
edits is the Markdown source the parser receives. This keeps the open-sourceable
engine demo simple and avoids codifying Flow/Longhand-specific display
normalization behavior. Applications that want a different relationship between
editable text and persisted source can provide their own projection layer outside
the core package.

The adapter projection still produces a source map, even when that map is
identity-based:

```ts
type DisplayOffset = number;
type MarkdownOffset = number;

interface TextProjection {
    readonly displayText: string;
    readonly markdownText: string;

    displayToMarkdown(offset: DisplayOffset): MarkdownOffset;
    markdownToDisplay(offset: MarkdownOffset, bias?: -1 | 1): DisplayOffset;
    displayRangeToMarkdown(range: DisplayRange): MarkdownRange;
    markdownRangeToDisplay(range: MarkdownRange): DisplayRange;
}
```

The source map boundary is still important: parser-backed decorations, widgets,
and extension instances should consume mapped ranges rather than assuming a
specific persistence format. Non-identity projections can use the same shape,
including bias-aware mapping around inserted source-only characters, but those
rules belong to the host application's adapter.

**Key decisions to resolve in detailed spec:**
- Representation: persistent data structure (e.g. finger tree / rope) vs.
  simple immutable array of paragraphs. Given the flat schema, an immutable
  array of paragraph records is likely sufficient and much simpler.

### 2. Syntax Providers

Core syntax state is deliberately opaque:

```ts
interface SyntaxSnapshot {
    readonly kind: string;
    readonly version: number;
}

interface SyntaxProvider {
    create(doc: DisplayDocument): SyntaxSnapshot;
    update(
        previous: SyntaxSnapshot,
        doc: DisplayDocument,
        displayChanges: readonly DisplayChange[],
    ): SyntaxSnapshot;
}
```

The default provider returns a neutral `"none"` snapshot. Core editor code stores
and restores that snapshot for plugin contexts and history, but it does not read
parser tokens, source maps, Markdown offsets, or adapter-specific fields.

#### Example Markdown syntax provider

The demo Markdown adapter uses `@saturn9/markoffset` as its syntax service. The
parser is optimized for tokens and incremental reparsing; HTML rendering is not
part of the editor pipeline.

```ts
interface MarkdownSyntaxSnapshot extends SyntaxSnapshot {
    readonly kind: "markdown";
    readonly projection: TextProjection;
    readonly parserState: ParseState;
    readonly tokens: readonly SyntaxToken[];
}
```

Parser tokens use Markdown source offsets. Before they reach the renderer or
adapter plugins, they are compiled through the projection map into display
ranges:

```ts
interface SyntaxTokenView<TData = unknown> {
    readonly kind: string;
    readonly sourceRange: MarkdownRange;
    readonly displayRange: DisplayRange;
    readonly data: TData;
    readonly children?: readonly SyntaxTokenView[];
}
```

Adapter syntax snapshots are updated as part of the transaction pipeline:

1. Selection-only transactions keep the current syntax snapshot.
2. Document-changing transactions produce a new display document and a display
   change set.
3. The Markdown projection layer produces the next source and, when possible, a
   `Change` suitable for `@saturn9/markoffset` incremental reparse.
4. If the projection cannot cheaply produce a single correct source change, or
   parser metadata requires it, the adapter performs a full parse.
5. The resulting tokens become the new `MarkdownSyntaxSnapshot`.

The correctness invariant is mandatory:

```ts
incrementalSyntaxAfter(transaction) === fullParse(project(displayDocAfter))
```

The provider may start with a full projection + full parse on every
document-changing transaction, then replace that with projection-aware
incremental reparsing once the mapping tests are in place. The core public API
does not expose that implementation detail.

Markdown syntax snapshots are the source for Markdown syntax decorations,
code/image/highlight/comment/review extension instances, table of contents and
heading navigation, format-aware copy/export, and future linting integrations.

### 3. Transaction System

The primary API for all document mutations. A transaction is a value that
accumulates a set of steps (insertions, deletions, selection changes, attr
updates) and is dispatched atomically.

```
Transaction
  steps: Step[]
  selectionBefore: Selection
  selectionAfter: Selection
  meta: TransactionMetaStore
```

Transaction metadata is type-safe. Plugins that need metadata define typed keys
instead of writing arbitrary values into an untyped map:

```ts
interface TransactionMetaKey<M> {
    readonly name: string;
}

interface TransactionMetaStore {
    get<M>(key: TransactionMetaKey<M>): M | undefined;
    set<M>(key: TransactionMetaKey<M>, value: M): TransactionMetaStore;
}
```

Plugins may participate in the transaction pipeline through engine-owned hooks,
but the API does not need to be compatible with ProseMirror. Flow and Longhand
will adapt to this engine's original API surface.

Document-changing steps should record enough display-space change information
for syntax providers and adapters:

```ts
interface DisplayChange {
    readonly from: DisplayOffset;
    readonly to: DisplayOffset;
    readonly insert: string;
}

interface Transaction {
    readonly displayChanges: readonly DisplayChange[];
}
```

The transaction remains the unit for plugin state updates, syntax updates,
history recording, and render scheduling.

**Key decisions to resolve:**
- Step types needed for v1: `replaceText`, `setSelection`, `setNodeAttr`,
  `insertParagraph`, `deleteParagraph`. Richer step types (like
  `replaceRange`) can follow.
- Transactions are synchronous in v1. Async work, such as spellcheck, runs
  outside the dispatch pipeline and dispatches a follow-up transaction with
  typed metadata or plugin state results when ready.

### 4. Input Manager

The component that owns the gap between raw browser events and the
transaction system. This is the core architectural departure from ProseMirror.

**Architecture:**
- A **focus proxy `<textarea>`** receives browser focus and captures keyboard
  input, clipboard events, and IME composition. It is visually hidden
  (`opacity: 0`, no visible text) but absolutely positioned at the visual
  caret while the editor is focused; it must not live off-screen during input
  because the OS uses its location for IME candidate windows.
- The textarea is a transient input buffer, not a mirror of the document. It is
  normally reset after each handled event. During IME composition it contains
  the browser-managed composition text until `compositionend`, after which the
  committed text is converted to a transaction and the buffer is cleared.
- A **virtual caret** is rendered by the Renderer component; the textarea
  position is kept in sync with the visual caret so the OS positions IME
  candidate windows correctly.
- **Clipboard** (cut/copy/paste) is handled via `ClipboardEvent` on the
  textarea; app or adapter paste hooks may convert HTML to display text before
  insertion.

**Events handled:**
- `keydown` — navigation (arrow keys, word-modified arrows, Home/End, Page
  Up/Down), deletion (Backspace, Delete, word-modified deletion), and command
  shortcuts (Ctrl/Cmd combinations).
- `beforeinput` / `input` — cancelable `beforeinput` is the authoritative path
  for character insertion, line breaks, paste-style insertion, and native delete
  requests; `input` remains the fallback for non-cancelable or unsupported
  browser paths.
- `compositionstart` / `compositionupdate` / `compositionend` — IME
  composition handled explicitly: keep the in-progress composition string in
  the proxy buffer, ignore editing shortcuts while composing, and commit only on
  `compositionend`.
- `paste` — read `text/plain`, strip formatting or invoke an adapter/app paste
  hook later, then insert display text as a boundary undo entry.
- `cut` / `copy` — write the selected display text to the clipboard as
  `text/plain`; cut deletes as a boundary undo entry when the editor is mutable.

The editor's internal `Selection` remains authoritative for all document
selection ranges. The textarea's native `selectionStart` / `selectionEnd` apply
only to the transient buffer or active composition text; they do not attempt to
mirror arbitrary document ranges.

Read-only mode suppresses paste and native mutation defaults. Copy remains
available, and cut provides clipboard text without deleting document content.

**Validation coverage:**
- After `npm run browser:install --workspace=@saturn9/scribeframe`,
  `npm run browser:test --workspace=@saturn9/scribeframe` runs Playwright
  coverage against the demo in Chromium and WebKit for real keyboard input,
  undo/redo, read-only suppression, and widget edits.
- The same suite covers native clipboard paste in Chromium. WebKit clipboard
  permissions and true OS IME candidate-window behavior still need targeted
  platform validation outside headless automation.

### 5. Command and Keymap System

Keyboard-driven behavior is expressed as named commands:

```ts
interface EditorCommand {
    readonly name: string;
    run(context: EditorCommandContext): boolean;
}

interface EditorKeyBinding {
    readonly key: string;      // e.g. "Mod+Z", "Alt+ArrowRight"
    readonly command: string;
}
```

`ModernEditor.executeCommand(name)` runs a command directly. Keydown resolution
tries app keymaps, plugin keymaps, legacy plugin `handleKeyDown`, then the
built-in editor keymap. If a command returns `false`, the key binding is treated
as declined and later keymaps can still handle the event.

The built-in command set covers undo/redo, select all, grapheme and word
movement, line-boundary movement, line breaks, and deletion. Editing commands are
read-only aware; navigation and selection commands continue to work in read-only
mode.

### 6. Renderer

Takes `(document, decorations, selection)` and produces DOM output. Decoupled
from the input layer — it is a pure function of its inputs.

**Architecture:**
- Renders into a container `<div>` (not `contenteditable`).
- The host container owns the accessible textbox contract: `role="textbox"`,
  `aria-multiline="true"`, configurable `aria-label`, synchronized
  `aria-readonly`, and focusability through `tabindex`.
- Each paragraph becomes a `<div>` or `<p>`; text content is split at
  decoration boundaries into `<span>` elements carrying the relevant CSS
  classes and data attributes.
- Extension instances render widget hosts that the renderer mounts with
  application-provided components.
- Virtual selection and caret layers are visual-only and hidden from assistive
  technology; the focus-proxy textarea carries its own label and read-only
  state but remains a transient input buffer.
- Uses a lightweight DOM diffing/patching pass on each render to avoid
  full re-renders; alternatively, uses React as the reconciler if the
  performance profile is acceptable.

**Key decisions to resolve:**
- React reconciler vs. custom DOM patching. React is already in the tree
  (Longhand is React + Tauri) and simplifies widget embedding, but introduces
  a render cycle. Direct DOM patching is faster but more code.
- How the virtual caret (blinking cursor bar) is positioned absolutely over
  the rendered text. Requires measuring character offsets — either via
  `Range.getBoundingClientRect` on a temporary selection, or by maintaining
  a character-width cache.

### 7. Selection Manager

Maintains the editor's authoritative selection state as an internal value,
independent of the DOM selection API.

```
Selection
  anchor: Position    // where selection started
  head: Position      // where selection currently ends (may be before anchor)

Position
  paragraph: number   // index into doc.paragraphs
  offset: number      // UTF-16 code unit offset within the paragraph's text
```

Responsibilities:
- Convert between `Position` and absolute character offsets (for the
  decoration layer).
- Sync from DOM: on mouse click/drag, read `document.getSelection()`, map
  to internal positions, dispatch a `setSelection` transaction.
- Sync to input proxy: after each render, position the textarea element at the
  visual head of the internal selection so IME windows and native input affordances
  appear in the right place. Do not mirror document selection into the
  textarea's `selectionStart` / `selectionEnd`; those offsets only describe the
  textarea's transient buffer.
- Tear down root pointer handlers, input-proxy handlers, and any active document
  drag handlers during `destroy()` so stale DOM nodes cannot intercept events or
  mutate a destroyed editor.

### 8. Decoration and Widget System

Extensions contribute render output as immutable values. The renderer owns all
DOM lifecycle; plugins describe what should exist, but never hold DOM nodes or
React roots directly.

Three output kinds cover the current editor features and future annotation work:

Shared output types:

```ts
interface DisplayRange {
    from: Position;
    to: Position;
}

interface MarkdownRange {
    from: number;
    to: number;
}

type PluginName = string;
type WidgetKey = `${PluginName}:${string}`;
type EditorDecoration =
    | InlineDecoration
    | AnnotationDecoration;
```

**Inline decorations** — apply attributes to a display character range:
```ts
interface InlineDecoration {
    from: number;   // display absolute character offset
    to: number;
    attrs: Record<string, string>;  // class, data-*, etc.
}
```
Used for syntax highlighting (bold, italic, headings, links, ...),
spellcheck underlines, search matches, current sentence, and review suggestion
diff styling.

**Annotation decorations** — attach semantic data and actions to a range:
```ts
interface AnnotationDecoration<TData = unknown> {
    key: WidgetKey;
    from: number;
    to: number;
    kind: "comment" | "review-suggestion" | "spellcheck" | string;
    data: TData;
    className?: string;
}
```
Used for comments, review suggestions, spellcheck diagnostics, and other
range-backed features that need context menus, side-rail markers, or actions.
Annotations may render inline styling, gutter affordances, or tool-pane content,
but their identity and data come from the plugin, not from DOM lookups.

**Widget decorations** — mount custom UI in the rendered document or adjacent
editor chrome:
```ts
interface WidgetDecoration {
    key: WidgetKey;
    placement: "inline" | "block" | "gutter" | "overlay";
    range: DisplayRange;
    contentRange?: DisplayRange;
    props: unknown;
    render: WidgetRenderer;
    selection: WidgetSelectionBehavior;
}
```
Used for the image editor, code block editor, highlight emoji markers, comment
anchors, and review suggestion controls.

Widget keys are scoped by editor instance and plugin key. They must be stable
across renders of the same plugin entity:

```ts
type WidgetSelectionBehavior =
    | "inline"
    | "atom"
    | "block";

interface WidgetRenderer<TProps = unknown> {
    mount(host: HTMLElement, props: TProps, ctx: WidgetContext): WidgetHandle;
}

interface WidgetHandle<TProps = unknown> {
    update(props: TProps): void;
    destroy(): void;
}
```

The renderer diffs widgets by `WidgetKey`. When a widget appears, the renderer
creates a host element and calls `mount()`. When plugin output changes, the
renderer calls `update()` with new props. When the widget disappears, changes
type, or the editor unmounts, the renderer must call `destroy()` exactly once.
The React adapter is responsible for `createRoot`, `root.render`, and
`root.unmount`; consumers should not maintain global element maps or query the
document to find existing widgets.

No plugin may dispatch transactions, mutate the document, or create DOM while
computing decorations or widgets. Normalization, such as splitting an image into
its own paragraph or inserting space around an atomic block, happens through an
explicit transaction phase before rendering.

Decorations are produced from provider syntax snapshots and plugin state, then
passed to the Renderer as display-space ranges. Adapter decoration compilers
should be range-aware so virtualization can request decorations for the visible
document window plus overscan instead of recompiling the whole document on every
frame.

### 9. Plugin Extension Instances

Widgets are not opaque editor objects. They are projections of provider or
adapter-discovered display ranges, and persistent state must round-trip through a
plugin or host-provided identity scheme.

Plugins that recognize persistent or derived entities produce typed instances:

```ts
interface ExtensionInstance<TData = unknown> {
    key: WidgetKey;
    kind: string;
    range: DisplayRange;
    contentRange?: DisplayRange;
    blockRange?: DisplayRange;
    data: TData;
    identity: ExtensionIdentity;
}

type ExtensionIdentity =
    | { kind: "persistent"; id: string }
    | { kind: "derived"; fingerprint: string }
    | { kind: "ephemeral" };
```

Identity rules:
- Use `persistent` identity for stateful features: comments, review suggestions,
  tracked changes, and any widget whose state must survive reloads or move with a
  host-defined entity. The ID is adapter-defined; core only sees the opaque ID.
- Use `derived` identity for stateless entities such as ordinary code blocks and
  images when no explicit ID exists. The fingerprint is derived from plugin key,
  entity kind, and a stable signature; it is scoped to the editor instance and is
  not written back unless the plugin needs persistent identity.
- Use `ephemeral` identity only for transient UI such as hover markers. Ephemeral
  widgets must not own persistent plugin state.

The extension instance is the common contract for rendering, commands, context
menus, serialization, and tool-pane integration. A code block plugin, for
example, parses a fenced code block into an instance whose `range` spans the
visible fenced block and whose `contentRange` spans the editable code body in
display coordinates. Its widget edits by dispatching an engine-owned display
replacement, not by mutating hidden DOM or storing pending source text in a
widget registry.

Widget contexts should avoid raw source-offset mutation APIs. Prefer commands
that operate in engine concepts:

```ts
interface WidgetContext {
    readonly key: WidgetKey;
    readonly readOnly: boolean;
    dispatch(tr: Transaction): void;
    replaceSelf(text: string): void;
    replaceContent(text: string): void;
    deleteSelf(): void;
    focusEditor(position?: Position): void;
}
```

Adapters map format-aware requests through their projection layer and the core
transaction system. This keeps renderer code independent from source
serialization details.

Host applications may provide renderers and services for specific extension
kinds, but the editor engine owns instance discovery, selection mapping,
transaction dispatch, and lifecycle. Flow and Longhand should be able to install
different renderers for the same source entity without changing the document
model.

### 10. History

History is editor-owned and original to this engine. It records normalized
editor state snapshots rather than exposing inverse-step APIs or mirroring
another editor runtime's history model.

```ts
interface HistorySnapshot {
    readonly doc: DisplayDocument;
    readonly selection: Selection;
    readonly syntax: SyntaxSnapshot;
}

interface HistoryEntry {
    readonly before: HistorySnapshot;
    readonly after: HistorySnapshot;
    readonly batch?: HistoryBatch;
}

type HistoryBatchKind = "typing" | "deleteBackward" | "deleteForward";

interface HistoryBatch {
    readonly kind: HistoryBatchKind;
    readonly updatedAt: number;
    readonly open: boolean;
}
```

Rules:
- Only text-changing dispatches are recorded. Selection-only transactions update
  the selection but do not create undo entries.
- Entries are recorded after plugin normalization, so undo restores the exact
  document, selection, and syntax snapshot rendered to the user.
- `undo()` pops from the undo stack, restores the `before` snapshot, and pushes
  the entry onto the redo stack. `redo()` restores the `after` snapshot and
  pushes the entry back to undo.
- Undo/redo restores notify plugins through the same apply path and emit normal
  change notifications, but they do not record themselves as new history.
- A new text-changing transaction after undo clears redo history.
- Read-only mode disables applying undo/redo without dropping the stored stacks,
  so history is available again if editing is re-enabled.
- `clearHistory()` empties undo and redo stacks without changing the document.
  Host applications should call it when changing editor context without replacing
  content through `setContent()`.
- `setContent()` resets history automatically because it represents an external
  document replacement, such as switching files, not an undoable user edit.

Batching rules:
- Editor-originated text input carries typed history metadata. Continuous typing
  merges into a single open batch while edits stay within the merge timeout.
- Whitespace input merges into the current typing batch and then closes it, so
  typing `hello world` undoes `world` first and `hello ` second.
- Cursor movement and other selection-only transactions close any active typing
  or deletion batch without creating a history entry.
- Contiguous Backspace and Delete operations batch separately. A backward-delete
  run never merges with a forward-delete run or with typing.
- Paste-like programmatic replacements, selected range replacement, cut, Enter,
  widget/source updates, and unclassified text-changing dispatches are boundary
  entries. They undo as complete user actions and do not merge into surrounding
  typing.
- Undo and redo close the active batch before restoring a snapshot.

The implementation stores bounded snapshots because the prototype document is a
small immutable paragraph array and provider syntax snapshots are persistent
values. A future memory-optimized implementation can store inverse steps or
compressed patches behind the same public `canUndo()`, `canRedo()`, `undo()`,
and `redo()` API without changing plugin or renderer contracts.

No collaboration is planned for v1, so the engine does not need rebasing logic in
the history stack.

### 11. Plugin System

Plugins are the extension mechanism for everything that isn't core editing.
Each plugin is an object:

```ts
interface EditorSnapshot {
    readonly doc: DisplayDocument;
    readonly selection: Selection;
    readonly syntax: SyntaxSnapshot;
    readonly readOnly: boolean;
}

interface EditorPlugin<S> {
    key: PluginKey<S>;
    init: (snapshot: EditorSnapshot) => S;
    apply: (tr: Transaction, prevState: S, snapshot: EditorSnapshot) => S;
    instances?: (state: S, snapshot: EditorSnapshot) => ExtensionInstance[];
    decorations?: (state: S, snapshot: EditorSnapshot) => EditorDecoration[];
    widgets?: (state: S, snapshot: EditorSnapshot) => WidgetDecoration[];
    normalize?: (ctx: NormalizeContext<S>) => Step[];
    commands?: (ctx: PluginOutputContext<S>) => EditorCommand[];
    destroy?: (ctx: PluginOutputContext<S>) => void;
    props?: {
        keymap?: readonly EditorKeyBinding[];
        handleKeyDown?: (ctx: PluginKeyDownContext<S>) => boolean;
    };
    contextMenu?: (ctx: ContextMenuContext<S>) => MenuItem[];
}
```

Editor commands and keymaps are the extension point for keyboard behavior.
Legacy keydown handlers remain available during migration, but new behavior
should prefer named commands and key bindings using original engine types rather
than mirroring ProseMirror's API surface.
Decoration providers are synchronous and pure. Async plugins, including
spellcheck, keep their async work outside `decorations()` and dispatch a
transaction when new results are ready.

Plugins can clean up async work or external resources through `destroy()`, which
receives the latest plugin state and editor snapshot. Runtime plugin
reconfiguration preserves state for exact plugin instances that remain installed,
destroys removed plugins once, and initializes added plugins from the current
snapshot.

Editor teardown is idempotent. It destroys active plugins once, unbinds DOM event
listeners, clears renderer transient state, removes renderer-owned DOM, and
restores host attributes that were present before mounting.

The plugin pipeline is ordered and side-effect free until dispatch:

1. Apply transaction steps to produce the next document and selection.
2. Ask the active syntax provider for a new snapshot if the document changed.
3. Let plugins synchronously update state from the transaction and syntax
   snapshot.
4. Run plugin `normalize()` hooks; if they return steps, dispatch one explicit
   follow-up normalization transaction marked outside undo history unless the
   originating command opts in.
5. Ask plugins for extension instances, decorations, annotations, and widgets.
6. Render by diffing immutable output values against the previous frame.

Plugins may keep state, but that state must be keyed by extension identity and
must be pruned when the corresponding instance disappears. The engine provides
the current instance set to plugin state updates so plugins do not need ad-hoc
registries to discover stale widgets.

Widget renderers receive a typed context rather than the raw editor internals:

```ts
interface WidgetContext {
    readonly key: WidgetKey;
    readonly readOnly: boolean;
    dispatch(tr: Transaction): void;
    replaceSelf(text: string): void;
    replaceContent(text: string): void;
    deleteSelf(): void;
    focusEditor(position?: Position): void;
}
```

This keeps Flow and Longhand renderers small: they render UI and call typed
actions. They should not need to inspect document positions, maintain position
maps, or call low-level deletion logic directly.

The current 15 ProseMirror plugins map onto this system:

| Current plugin | Component in new system |
|----------------|------------------------|
| `markdownPlugin` | Markdown adapter plugin producing instances + decorations |
| `nodeMarkerPlugin` | Folded into markdown instance parsing and block decorations |
| `wordCountPlugin` | Plugin with `apply()` counting words |
| `documentChangedPlugin` | Plugin `apply()` that fires callback |
| `pastePlugin` | Editor input hook for paste handling |
| `spellcheckPlugin` | Plugin with async worker/results state + sync `decorations()` |
| `cursorPlugin` | Renderer concern (virtual caret) |
| `highlightMarkerPlugin` | Ephemeral widget plugin with renderer-owned lifecycle |
| `keyboardExtrasPlugin` | Editor input hook for keyboard handling |
| `contextMenuPlugin` | Editor input hook for context menus |
| `searchPlugin` | Plugin with state (query, matches) + decorations |
| `imageEditorPlugin` | Markdown adapter image extension + block widget renderer |
| `codeBlockEditorPlugin` | Markdown adapter fenced-code extension + block widget renderer |
| `fullscreenPlugin` | Application-level concern, not editor |
| `currentSentencePlugin` | Plugin with decorations |
| `copyAsHtmlPlugin` | Editor input hook for copy handling |
| `placeholderPlugin` | Renderer concern |
| `highlightPlugin` | Renderer concern (CSS) |

Additional extension targets:

| New feature | Component in new system |
|-------------|------------------------|
| Comments | Source-identified annotation plugin + side/gutter widgets |
| Review suggestions | Source-identified annotation plugin with accept/reject commands |
| Track changes | Source-identified inline/block annotations + command set |
| Footnotes/endnotes | Source entity plugin + inline references + block widgets |

The old `widgetId` paragraph attribute should not survive into the new engine as
the primary identity mechanism. It is acceptable as an implementation detail for
legacy import, but new widgets derive identity from `ExtensionInstance.identity`
and format ranges.

---

## Markdown Demo Adapter Implementation Plan

### Phase 1 — Projection primitives and roundtrip tests

- Add adapter-owned identity projection primitives for the Markdown demo:
  - `buildTextProjection(doc)`.
- Treat the edited document text as Markdown source in the demo rather than
  demonstrating Flow/Longhand-specific newline normalization.
- Keep the source-map boundary in place so parser token offsets still flow
  through `displayToMarkdown`, `markdownToDisplay`, and range-mapping helpers.

### Phase 2 — Full-parse syntax provider

- Add core `SyntaxSnapshot` and `SyntaxProvider` abstractions to editor state.
- Keep `@saturn9/markoffset` imports in `demo/src/markdown`, not in core editor
  modules or package runtime dependencies.
- When the Markdown provider is installed, serialize the display doc to Markdown
  and run a full parse on creation and document-changing dispatch.
- Keep selection-only dispatches from reparsing.
- Expose syntax snapshots to plugin output functions through the engine
  snapshot/context.

### Phase 3 — Token-driven Markdown decorations and instances

- Replace regex markdown decorations with a compiler from parser tokens to
  display-space decorations.
- Move code block discovery from `findCodeBlocks()` to fence tokens.
- Add token-backed image and highlight instances before app integration.
- Keep extension instances display-ranged in core, with adapter-owned source IDs
  or projections used only inside the demo integration.

### Phase 4 — Incremental syntax updates

- Have display document steps emit `DisplayChange` records.
- Derive Markdown `Change` records through the projection layer.
- Use `parseDocument()` for initial state and `reparse()` for eligible edits.
- Fall back to full parse when:
  - the transaction contains multiple unrelated document changes;
  - projection cannot produce a single source change cheaply;
  - parser metadata says full incremental reparse is required.
- Add invariant tests comparing incremental snapshots to full parses.

### Phase 5 — Viewport-aware output compilation

- Teach decoration and instance compilers to accept a visible display range plus
  overscan.
- Keep global syntax indexes for features that need whole-document knowledge
  (TOC, comments, search, footnotes), but only materialize render decorations
  for the virtualized viewport.
- Ensure widgets outside the viewport retain plugin state by extension identity
  while their renderer hosts are mounted/destroyed by the renderer lifecycle.

### Phase 6 — App-facing migration

- Adapt Flow and Longhand to the engine's original APIs rather than preserving
  ProseMirror compatibility.
- Replace direct source-offset calls in tool integrations with display-position
  APIs (`selectRange`, `revealPosition`, widget context methods, extension
  commands).
- Keep Markdown import/export behavior byte-compatible with existing documents
  before turning on the new engine in either app.

### Test plan

- Projection roundtrip tests copied from current editor serialization behavior.
- Source-map tests around every inserted Markdown-only separator.
- Syntax snapshot tests proving selection-only transactions do not reparse.
- Token compiler tests for headings, emphasis, code spans, links, images,
  fences, lists, blockquotes, highlights, and unsupported/incomplete Markdown.
- Incremental parser invariant tests using display transactions.
- Widget tests proving extension content edits update display document,
  Markdown serialization, syntax tokens, and widget props consistently.
- Virtualization tests proving viewport decoration compilation matches
  full-document compilation clipped to the visible range.
- Browser tests against the demo for real Chromium/WebKit keyboard behavior,
  read-only suppression, widget edits, and available native clipboard paths.

---

## Component Interaction Diagram

```
User input
    │
    ▼
Input Manager ──────────────────────── Transaction
    │                                      │
    │                         DisplayDocument (new)
    │                                      │
    │                  TextProjection + SyntaxSnapshot
    │                                      │
    │                            Plugin apply() × N
    │                                      │
    │                  Plugin instances/decorations/widgets
    │                                      │
    ▼                                      ▼
(textarea position sync) ◄──── Renderer (doc + extension output + selection)
                                           │
                                  Widget mount/update/destroy
                                           │
                                           ▼
                                          DOM
```

---

## Open Questions (To Resolve Before Implementation)

1. **Renderer strategy**: React reconciler vs. custom DOM patching.
   React is preferred if the render cycle stays under ~4ms for a 5k-word
   document; benchmark required.

2. **Caret measurement**: how to position the virtual caret accurately
   across fonts, ligatures, and emoji. `Range.getBoundingClientRect` on a
   zero-width range is the most reliable cross-platform method.

3. **WebKit input edge cases**: `beforeinput` support on WebKit (Tauri/macOS
   and Tauri/Linux) is less complete than on Chromium. Need to verify which
   input types require `keydown` fallbacks.

4. **Document model representation**: immutable array of paragraph records
   (simple, fits the flat schema) vs. a persistent tree (more future-proof).
   Recommendation: start with the array; migrate if collaboration is added.

5. **Accessibility model**: v1 only targets basic keyboard navigation, but the
   hidden-input architecture needs a follow-up spec for screen reader behavior,
   selection announcement, and native text service integration.

6. **Persistent annotation syntax**: comments, review suggestions, and tracked
   changes need a markdown-compatible storage format with stable source IDs.
   Decide whether this uses HTML comments, reference-style sidecar blocks,
   inline directives, or a Longhand/Flow-specific sidecar file before building
   those plugins.
