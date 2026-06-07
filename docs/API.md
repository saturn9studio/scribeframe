# Public API

`@saturn9/scribeframe` exports a small TypeScript editor runtime from the
package root:

```ts
import {
  ScribeFrame,
  createTransaction,
  createTransactionMetaKey,
  PluginId,
  textInRange,
  type EditorCommand,
  type EditorInteraction,
  type EditorPlugin,
  type SyntaxProvider,
  type WidgetRenderer,
} from "@saturn9/scribeframe";
import "@saturn9/scribeframe/styles.css";
```

Markdown support in the demo is an example integration, not part of the core
runtime API.

## ScribeFrame

`ScribeFrame` owns document state, input, rendering, history, plugins, and widget
lifecycle for one editor host element.

```ts
const editor = new ScribeFrame(hostElement, {
  content: "Hello\nworld",
  ariaLabel: "Manuscript",
  onChange: (state) => {
    console.log(state.content);
  },
});
```

### Options

| Option | Type | Description |
| --- | --- | --- |
| `ariaLabel` | `string` | Accessible name for the editor root. Defaults to `"Editor"`. |
| `content` | `string` | Initial plain editor text. Newlines split paragraphs. |
| `doc` | `EditorDocument` | Initial document model. Takes precedence over `content`. |
| `plugins` | `readonly EditorPlugin<unknown>[]` | Initial plugin list. Duplicate `PluginId` objects are rejected. |
| `readOnly` | `boolean` | Starts the editor in read-only mode. |
| `historyLimit` | `number` | Maximum undo entries retained by the built-in history. |
| `historyBatchDelay` | `number` | Milliseconds during which compatible typing/delete/widget edits can merge. |
| `commands` | `readonly EditorCommand[]` | App-level commands checked before plugin and built-in commands. |
| `keymap` | `readonly EditorKeyBinding[]` | App-level key bindings checked before plugin and built-in keymaps. |
| `syntaxProvider` | `SyntaxProvider` | Optional parser/projection boundary for syntax snapshots. |
| `scrollContainer` | `HTMLElement` | Element whose scroll position drives renderer virtualization. Defaults to the host element. |
| `virtualization` | `EditorVirtualizationOptions \| false` | Paragraph virtualization settings, or `false` to render all paragraphs. |
| `onChange` | `(state: EditorStateSnapshot) => void` | Called after document-changing operations. Selection-only changes do not call it. |

### Methods

| Method | Description |
| --- | --- |
| `getContent(): string` | Returns the current display text. |
| `getDocument(): EditorDocument` | Returns the immutable paragraph document snapshot. |
| `getSelection(): Selection` | Returns the current anchor/head selection. |
| `getSyntaxSnapshot(): SyntaxSnapshot` | Returns the latest syntax provider snapshot. |
| `getScrollState(): EditorScrollState` | Returns scroll top, scroll height, client height, and scroll fraction. |
| `getPluginState(id): S \| undefined` | Reads a plugin's state by `PluginId` object identity. |
| `executeCommand(name): boolean` | Runs an app, plugin, or built-in command by name. |
| `canUndo()` / `canRedo()` | Reports whether undo/redo is available and not read-only. |
| `undo()` / `redo()` | Restores editor-owned history snapshots. |
| `clearHistory()` | Clears undo and redo stacks without changing content. |
| `setContent(content)` | Replaces the whole document, resets selection and history, and notifies plugins. |
| `setReadOnly(readOnly)` | Toggles read-only state and renderer affordances. |
| `setPlugins(plugins)` | Reconfigures plugins at runtime, preserving state for retained `PluginId` objects. |
| `focus(position?)` | Focuses the hidden input proxy and optionally moves selection first. |
| `revealPosition(position, options?)` | Scrolls a document position into view. |
| `revealSelection(options?)` | Scrolls the current selection into view. |
| `scrollToFraction(fraction)` | Scrolls to a normalized document fraction from `0` to `1`. |
| `selectRange(range, options?)` | Sets selection from `range.from` to `range.to`; `options.reveal` also reveals it. |
| `dispatch(transaction)` | Applies a transaction, updates plugins/syntax/history, and rerenders. |
| `destroy()` | Tears down listeners, plugins, widgets, renderer DOM, and restored host attributes. |

### Scrolling and virtualization options

`EditorRevealOptions` accepts `block?: "nearest" | "start" | "center" | "end"`
and `padding?: number`. `EditorVirtualizationOptions` accepts
`enabled?: boolean`, `overscan?: number`, and `estimateParagraphHeight?: number`.
Set `virtualization: false` to disable paragraph virtualization.

## Document model

The core document is display text split into immutable paragraphs. Positions use
UTF-16 offsets within a paragraph.

```ts
interface EditorDocument {
  readonly paragraphs: readonly Paragraph[];
}

interface Position {
  readonly paragraph: number;
  readonly offset: number;
}

interface Selection {
  readonly anchor: Position;
  readonly head: Position;
}
```

Helpers exported from the package root include:

| Helper | Purpose |
| --- | --- |
| `paragraph(text?)` | Creates a paragraph. |
| `createDocument(paragraphs?)` | Creates a non-empty document. |
| `documentFromText(text)` / `documentToText(doc)` | Converts between display text and the paragraph model. |
| `firstPosition()` / `lastPosition(doc)` | Document boundary positions. |
| `collapsedSelection(position)` | Creates a collapsed selection. |
| `comparePositions(a, b)` / `isSamePosition(a, b)` | Position comparison helpers. |
| `normalizeRange(selection)` | Returns `{ from, to }` in document order. |
| `clampPosition(doc, position)` / `clampSelection(doc, selection)` | Clamp positions to document bounds. |
| `absoluteOffset(doc, position)` / `positionFromOffset(doc, offset)` | Convert between paragraph positions and whole-document offsets. |
| `paragraphAbsoluteRange(doc, paragraphIndex)` | Whole-document offset span for one paragraph. |
| `textInRange(doc, selection)` | Extracts display text for a selection. |
| `previousPosition` / `nextPosition` | Grapheme-aware document movement. |
| `previousWordPosition` / `nextWordPosition` | Word-aware document movement. |
| `wordRangeAtPosition(doc, position)` | Returns the word range near a position, or `null`. |
| `previousGraphemeOffset` / `nextGraphemeOffset` | Grapheme-aware movement inside a string. |
| `previousWordOffset` / `nextWordOffset` | Word-aware movement inside a string. |

## Transactions

Transactions are the only supported way to edit an existing editor instance.
Build them from the current document and selection.

```ts
const sourceMetaKey = createTransactionMetaKey<{ readonly source: string }>(
  "source",
);

const transaction = createTransaction(editor.getDocument(), editor.getSelection())
  .replaceSelection("replacement")
  .setMeta(sourceMetaKey, { source: "toolbar" })
  .build();

editor.dispatch(transaction);
```

`TransactionBuilder` supports:

| Method | Description |
| --- | --- |
| `replaceRange(from, to, text)` | Replaces a document range. Text may include newlines. |
| `replaceSelection(text)` | Replaces the builder's current selection. |
| `setSelection(selection)` | Updates the resulting selection. |
| `setMeta(key, value)` | Adds typed transaction metadata. |
| `doc` / `selection` | Current builder result before `build()`. |
| `build()` | Produces an immutable `Transaction`. |

`Transaction` exposes `steps`, `displayChanges`, `docBefore`, `docAfter`,
`selectionBefore`, `selectionAfter`, and `meta`. `applyStep(doc, step)` is
available for integrations that need to apply a single `Step` outside an editor.

## Commands and keymaps

Commands are named functions that can dispatch transactions or delegate to other
commands.

```ts
const uppercaseCommand: EditorCommand = {
  name: "example.uppercase",
  run(context) {
    const selectionText = textInRange(context.doc, context.selection);
    if (!selectionText) return false;

    context.dispatch(
      createTransaction(context.doc, context.selection)
        .replaceSelection(selectionText.toUpperCase())
        .build(),
    );
    return true;
  },
};

const editor = new ScribeFrame(host, {
  commands: [uppercaseCommand],
  keymap: [{ key: "Mod+U", command: "example.uppercase" }],
});
```

Key bindings use strings like `Mod+Z`, `Shift+ArrowLeft`, `Alt+Backspace`, or
`Meta+ArrowUp`. `Mod` matches Control or Meta. `editorCommandNames` contains the
built-in command names, `defaultEditorKeymap` contains the built-in bindings, and
`keyBindingMatches(event, binding)` is exported for custom key handling.

Keydown resolution order is app keymap, plugin keymaps, plugin
`handleKeyDown`, then the built-in keymap.

## Plugins

Plugins own typed state and describe render output. They do not own editor DOM;
the renderer owns widget hosts and lifecycle.

```ts
interface CounterState {
  readonly transactions: number;
}

const counterId = new PluginId<CounterState>("counter");

const counterPlugin = (): EditorPlugin<CounterState> => ({
  id: counterId,
  init: () => ({ transactions: 0 }),
  apply: ({ state }) => ({ transactions: state.transactions + 1 }),
  decorations: ({ doc }) =>
    doc.paragraphs.map((_paragraph, index) => ({
      kind: "block",
      paragraph: index,
      attrs: { "data-paragraph": String(index) },
    })),
});
```

`EditorPlugin<S>` hooks:

| Hook | Description |
| --- | --- |
| `id` | Stable `PluginId<S>` object used for state identity. |
| `init(context)` | Creates initial plugin state. |
| `apply(context)` | Receives every transaction and returns next state. |
| `instances?(context)` | Returns semantic extension instances discovered from document/syntax state. |
| `decorations?(context)` | Returns inline, block, or annotation decorations. |
| `widgets?(context)` | Returns widget descriptions. |
| `normalize?(context)` | Returns transaction steps to enforce document invariants. |
| `commands?(context)` | Returns plugin-provided commands. |
| `destroy?(context)` | Releases external resources when removed or editor is destroyed. |
| `props.keymap` | Plugin-scoped key bindings. |
| `props.handleKeyDown(context)` | Last plugin-level chance to handle a keydown before built-ins. |
| `props.handleInteraction(context)` | Handles synthesized rendered interactions such as activation on decorations or widgets. |

Plugin contexts include `doc`, `selection`, `content`, `readOnly`, `syntax`, and
the plugin `state`. Apply contexts also include `previousDoc`,
`previousSelection`, and `transaction`. Command/input/interaction contexts expose
`dispatch(transaction)`.

### Rendered interactions

`EditorInteraction` is format-agnostic. It is synthesized by the editor's
selection-owned pointer path, so it remains reliable even when native browser
`click` events are suppressed or the rendered surface is replaced between
`mousedown` and `mouseup`.

| Field | Description |
| --- | --- |
| `type` | Currently `"activate"` for a click-like activation. |
| `event` | The native `MouseEvent` that completed the interaction. |
| `position` | The document position at the pointer, when one can be resolved. |
| `targets` | Rendered decoration and widget targets under the pointer. |
| `decorations` | Decoration targets with the original decoration object and range. |
| `widgets` | Widget targets with key, widget description, and range. |
| `modifiers` | `alt`, `ctrl`, `meta`, and `shift` modifier state. |

Scribeframe does not interpret target semantics. A Markdown adapter can, for
example, detect a link by inspecting the attrs of an inline decoration it owns.

`PluginId` is identity-based: reuse the same exported id object to preserve state
across `setPlugins()` reconfiguration.

## Decorations, widgets, and instances

Decorations are pure descriptions returned by plugins:

| Type | Shape | Purpose |
| --- | --- | --- |
| `InlineDecoration` | `{ kind: "inline", from, to, attrs }` | Adds attributes/classes to text ranges. |
| `BlockDecoration` | `{ kind: "block", paragraph, attrs }` | Adds attributes/classes to a paragraph element. |
| `AnnotationDecoration<T>` | `{ kind: "annotation", key, from, to, annotationKind, data, className? }` | Attaches typed range metadata and optional class styling. |

`InlineDecoration.from` / `to` and `AnnotationDecoration.from` / `to` are
whole-document display-text offsets. `WidgetDecoration.range` and
`ExtensionInstance.range` use `Range` objects with paragraph `Position`s.

Widgets are renderer-owned DOM islands:

```ts
const renderer: WidgetRenderer<{ readonly label: string }> = {
  mount(host, props, context) {
    const button = document.createElement("button");
    button.textContent = props.label;
    button.addEventListener("click", () => context.replaceSelf("clicked"));
    host.append(button);

    return {
      update(nextProps) {
        button.textContent = nextProps.label;
      },
      destroy() {
        button.remove();
      },
    };
  },
};
```

`WidgetDecoration<TProps>` includes:

| Property | Description |
| --- | --- |
| `key` | Stable plugin-scoped `WidgetKey`, usually `` `${pluginName}:${localId}` ``. |
| `placement` | `"block"` for the current `ScribeFrame` renderer. The public type also reserves `"inline"`, `"gutter"`, and `"overlay"` for advanced/custom renderers and future placement support. |
| `range` | Document range covered by the widget. |
| `contentRange` | Optional editable inner range used by `WidgetContext.replaceContent()`. |
| `props` | Immutable props passed to `mount` and `update`. |
| `render` | `WidgetRenderer<TProps>` implementation. |
| `selection` | `"inline"`, `"atom"`, or `"block"` selection behavior. |

`WidgetContext` exposes `key`, `readOnly`, `dispatch`, `replaceSelf`,
`replaceContent`, `deleteSelf`, and `focusEditor`.

`ExtensionInstance<TData>` is for plugin-defined semantic structures that map
back to document ranges, such as code blocks, comments, or suggestions. Its
`identity` can be persistent, derived, or ephemeral.

## Syntax providers

A `SyntaxProvider` lets an integration attach parser/projection state without
coupling the core runtime to a file format.

```ts
const syntaxProvider: SyntaxProvider = {
  create(doc) {
    return parseDocument(doc);
  },
  update(previous, doc, displayChanges) {
    return reparseDocument(previous, doc, displayChanges);
  },
};
```

`create(doc)` runs for initial content and `setContent()`. `update(previous, doc,
displayChanges)` runs only for text-changing transactions; selection-only
transactions reuse the current snapshot. The exported `emptySyntaxProvider`
returns `emptySyntaxSnapshot` for integrations without syntax.

## Metadata and history

Transaction metadata is typed and identity-keyed:

```ts
const sourceMetaKey = createTransactionMetaKey<"toolbar" | "paste">("source");

const transaction = createTransaction(doc, selection)
  .replaceSelection("text")
  .setMeta(sourceMetaKey, "toolbar")
  .build();

transaction.meta.get(sourceMetaKey); // "toolbar" | "paste" | undefined
```

`historyEventMetaKey` is the built-in metadata key used by the editor to batch
typing, delete, boundary, and widget edit history events. Most consumers should
use `ScribeFrame` history methods rather than constructing `EditorHistory`
directly; `EditorHistory` is exported for advanced integrations and tests.

## Renderer exports

`Renderer`, `RendererInput`, `RendererActions`, and renderer option/result types
are exported for advanced embedders, but the supported application-level entry
point is `ScribeFrame`. Prefer `ScribeFrame` unless you are building a custom
host that intentionally owns editor state, plugin execution, and input handling.

## Styles and DOM contract

Import the package stylesheet once:

```ts
import "@saturn9/scribeframe/styles.css";
```

The editor adds `s9-editor-root` to the host and manages a rendered
`s9-editor-surface`, selection layer, caret, hidden input proxy, and
renderer-owned widget hosts. Apps can theme these classes, but should not mutate
renderer-owned DOM directly. Use transactions, plugins, decorations, and widgets
to change editor behavior.
