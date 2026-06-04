import {
  defaultEditorKeymap,
  editorCommandNames,
  keyBindingMatches,
  type EditorCommand,
  type EditorCommandContext,
  type EditorCommandSnapshot,
  type EditorKeyBinding,
} from "./commands";
import { RenderOutput } from "./decorations";
import {
  EditorHistory,
  historyEventMetaKey,
  type HistoryEvent,
  type HistorySnapshot,
} from "./history";
import {
  EditorDocument,
  Position,
  Range,
  Selection,
  clampPosition,
  clampSelection,
  collapsedSelection,
  documentFromText,
  documentToText,
  firstPosition,
  lastPosition,
  nextPosition,
  nextWordPosition,
  normalizeRange,
  previousPosition,
  previousWordPosition,
  selectionIsCollapsed,
  textInRange,
  wordRangeAtPosition,
} from "./model";
import {
  EditorPlugin,
  PluginId,
  PluginSlot,
  createPluginSlot,
} from "./plugin";
import {
  Renderer,
  type RendererRevealOptions,
  type RendererScrollState,
  type RendererVirtualizationOptions,
} from "./renderer";
import {
  emptySyntaxProvider,
  type SyntaxProvider,
  type SyntaxSnapshot,
} from "./syntax";
import { Transaction, createTransaction } from "./transaction";

export type EditorVirtualizationOptions = RendererVirtualizationOptions;
export type EditorRevealOptions = RendererRevealOptions;
export type EditorScrollState = RendererScrollState;

export interface EditorSelectRangeOptions extends EditorRevealOptions {
  readonly reveal?: boolean;
}

export interface EditorStateSnapshot extends EditorCommandSnapshot {}

export interface ModernEditorOptions {
  readonly ariaLabel?: string;
  readonly content?: string;
  readonly doc?: EditorDocument;
  readonly plugins?: readonly EditorPlugin<unknown>[];
  readonly readOnly?: boolean;
  readonly historyLimit?: number;
  readonly historyBatchDelay?: number;
  readonly commands?: readonly EditorCommand[];
  readonly keymap?: readonly EditorKeyBinding[];
  readonly syntaxProvider?: SyntaxProvider;
  readonly scrollContainer?: HTMLElement;
  readonly virtualization?: EditorVirtualizationOptions | false;
  readonly onChange?: (state: EditorStateSnapshot) => void;
}

type TextGranularity = "grapheme" | "word";

const beforeInputMutations = new Set([
  "deleteContentBackward",
  "deleteContentForward",
  "deleteWordBackward",
  "deleteWordForward",
  "insertFromPaste",
  "insertLineBreak",
  "insertParagraph",
  "insertCompositionText",
  "insertText",
]);

const editorRootAttributes = [
  "aria-label",
  "aria-multiline",
  "aria-readonly",
  "role",
  "tabindex",
] as const;

type EditorRootAttribute = (typeof editorRootAttributes)[number];

const captureRootAttributes = (
  element: HTMLElement,
): ReadonlyMap<EditorRootAttribute, string | null> =>
  new Map(
    editorRootAttributes.map((name) => [name, element.getAttribute(name)]),
  );

const restoreRootAttributes = (
  element: HTMLElement,
  snapshot: ReadonlyMap<EditorRootAttribute, string | null>,
): void => {
  editorRootAttributes.forEach((name) => {
    const value = snapshot.get(name);
    if (value === null || value === undefined) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  });
};

export class ModernEditor {
  private doc: EditorDocument;
  private selection: Selection;
  private syntax: SyntaxSnapshot;
  private readOnly: boolean;
  private readonly rootAttributeSnapshot: ReadonlyMap<EditorRootAttribute, string | null>;
  private readonly syntaxProvider: SyntaxProvider;
  private readonly history: EditorHistory;
  private readonly textarea: HTMLTextAreaElement;
  private readonly renderer: Renderer;
  private slots: PluginSlot[];
  private isComposing = false;
  private ignoreNextCompositionInput = false;
  private committedCompositionText = "";
  private destroyed = false;
  private selectionDragAnchor: Position | null = null;
  private preferredSelectionX: number | null = null;

  private readonly handleSelectionDragMove = (event: MouseEvent): void => {
    if (!this.selectionDragAnchor) return;

    const position = this.renderer.positionAtPoint(event.clientX, event.clientY);
    if (!position) return;

    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection({
          anchor: this.selectionDragAnchor,
          head: position,
        })
        .build(),
    );
    event.preventDefault();
  };

  private readonly handleSelectionDragEnd = (): void => {
    this.selectionDragAnchor = null;
    document.removeEventListener("mousemove", this.handleSelectionDragMove);
    document.removeEventListener("mouseup", this.handleSelectionDragEnd);
  };

  private readonly handleContainerMouseDown = (event: MouseEvent): void => {
    if (this.destroyed) return;
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".s9-widget")) return;
    const position = this.renderer.positionAtPoint(event.clientX, event.clientY);
    if (!position) return;

    if (event.detail >= 3) {
      this.selectParagraphAtPosition(position);
      event.preventDefault();
      return;
    }

    if (event.detail === 2) {
      this.selectWordAtPosition(position);
      event.preventDefault();
      return;
    }

    const anchor = event.shiftKey ? this.selection.anchor : position;
    this.preferredSelectionX = null;
    this.selectionDragAnchor = anchor;
    document.addEventListener("mousemove", this.handleSelectionDragMove);
    document.addEventListener("mouseup", this.handleSelectionDragEnd);
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection(
          event.shiftKey
            ? { anchor, head: position }
            : collapsedSelection(position),
        )
        .build(),
    );
    this.focus();
    event.preventDefault();
  };

  private readonly handleTextareaKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed) return;
    this.handleKeyDown(event);
  };

  private readonly handleTextareaBeforeInput = (event: InputEvent): void => {
    if (this.destroyed) return;
    this.handleBeforeInput(event);
  };

  private readonly handleTextareaInput = (): void => {
    if (this.destroyed) return;
    this.handleInput();
  };

  private readonly handleCompositionStart = (): void => {
    if (this.destroyed) return;
    this.isComposing = true;
    this.ignoreNextCompositionInput = false;
    this.committedCompositionText = "";
  };

  private readonly handleCompositionEnd = (event: CompositionEvent): void => {
    if (this.destroyed) return;
    this.isComposing = false;
    const text = event.data || this.textarea.value;
    this.textarea.value = "";
    this.ignoreNextCompositionInput = text.length > 0;
    this.committedCompositionText = text;
    this.insertText(text, this.historyEventForInput(text));
  };

  private readonly handleTextareaPaste = (event: ClipboardEvent): void => {
    if (this.destroyed) return;
    this.handlePaste(event);
  };

  private readonly handleTextareaCopy = (event: ClipboardEvent): void => {
    if (this.destroyed) return;
    this.handleCopy(event);
  };

  private readonly handleTextareaCut = (event: ClipboardEvent): void => {
    if (this.destroyed) return;
    this.handleCut(event);
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ModernEditorOptions = {},
  ) {
    this.rootAttributeSnapshot = captureRootAttributes(container);
    this.doc = options.doc ?? documentFromText(options.content ?? "");
    this.selection = collapsedSelection(firstPosition());
    this.syntaxProvider = options.syntaxProvider ?? emptySyntaxProvider;
    this.syntax = this.syntaxProvider.create(this.doc);
    this.readOnly = options.readOnly ?? false;
    this.history = new EditorHistory({
      limit: options.historyLimit,
      mergeWindowMs: options.historyBatchDelay,
    });
    const initialSnapshot = this.snapshot();
    this.slots =
      options.plugins?.map((plugin) =>
        createPluginSlot(plugin, initialSnapshot),
      ) ?? [];
    this.container.classList.add("s9-editor-root");
    this.applyRootAccessibility();

    this.renderer = new Renderer(
      this.container,
      {
        dispatch: (transaction) => this.dispatch(transaction),
        focusEditor: (position) => this.focus(position),
      },
      {
        scrollContainer: options.scrollContainer,
        virtualization: options.virtualization,
      },
    );

    this.textarea = document.createElement("textarea");
    this.textarea.className = "s9-input-proxy";
    this.textarea.setAttribute("aria-label", `${this.ariaLabel()} input`);
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("data-ms-editor", "false");
    this.textarea.setAttribute("writingsuggestions", "false");
    this.textarea.spellcheck = false;
    this.container.append(this.textarea);
    this.syncAccessibilityState();
    this.bindEvents();
    this.normalize();
    this.render();
  }

  getContent(): string {
    return documentToText(this.doc);
  }

  getDocument(): EditorDocument {
    return this.doc;
  }

  getSelection(): Selection {
    return this.selection;
  }

  getSyntaxSnapshot(): SyntaxSnapshot {
    return this.syntax;
  }

  getScrollState(): EditorScrollState {
    return this.renderer.getScrollState();
  }

  getPluginState<S>(id: PluginId<S>): S | undefined {
    return this.slots.find((slot) => slot.id.name === id.name)?.getState() as
      | S
      | undefined;
  }

  executeCommand(commandName: string): boolean {
    return this.executeCommandByName(commandName);
  }

  canUndo(): boolean {
    return !this.readOnly && this.history.canUndo();
  }

  canRedo(): boolean {
    return !this.readOnly && this.history.canRedo();
  }

  undo(): void {
    if (this.readOnly) return;
    const restore = this.history.undo();
    if (!restore) return;
    this.restoreHistorySnapshot(restore.snapshot, restore.transaction);
  }

  redo(): void {
    if (this.readOnly) return;
    const restore = this.history.redo();
    if (!restore) return;
    this.restoreHistorySnapshot(restore.snapshot, restore.transaction);
  }

  clearHistory(): void {
    this.history.reset();
  }

  setContent(content: string): void {
    this.doc = documentFromText(content);
    this.selection = collapsedSelection(firstPosition());
    this.syntax = this.syntaxProvider.create(this.doc);
    this.history.reset();
    this.slots.forEach((slot) => {
      const transaction = createTransaction(this.doc, this.selection).build();
      slot.apply(transaction, this.snapshot());
    });
    this.normalize();
    this.render();
    this.emitChange();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.syncAccessibilityState();
    this.render();
  }

  setPlugins(plugins: readonly EditorPlugin<unknown>[]): void {
    if (this.destroyed) return;

    const snapshot = this.snapshot();
    const retained = new Set<PluginSlot>();
    const nextSlots = plugins.map((plugin) => {
      const existing = this.slots.find(
        (slot) => slot.plugin === plugin && !retained.has(slot),
      );
      if (existing) {
        retained.add(existing);
        return existing;
      }
      return createPluginSlot(plugin, snapshot);
    });

    this.slots
      .filter((slot) => !retained.has(slot))
      .forEach((slot) => slot.destroy(snapshot));
    this.slots = nextSlots;
    this.normalize();
    this.render();
  }

  focus(position?: Position): void {
    if (position) {
      this.preferredSelectionX = null;
      this.dispatch(
        createTransaction(this.doc, this.selection)
          .setSelection(collapsedSelection(position))
          .build(),
      );
    }
    this.textarea.focus();
    this.renderer.syncInputProxy(this.textarea);
  }

  revealPosition(position: Position, options: EditorRevealOptions = {}): void {
    this.renderer.revealPosition(position, options);
    this.renderer.syncInputProxy(this.textarea);
  }

  revealSelection(options: EditorRevealOptions = {}): void {
    this.renderer.revealSelection(this.selection, options);
    this.renderer.syncInputProxy(this.textarea);
  }

  scrollToFraction(fraction: number): void {
    this.renderer.scrollToFraction(fraction);
    this.renderer.syncInputProxy(this.textarea);
  }

  selectRange(range: Range, options: EditorSelectRangeOptions = {}): void {
    this.preferredSelectionX = null;
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection({ anchor: range.from, head: range.to })
        .build(),
    );

    if (options.reveal) {
      this.revealSelection(options);
    }
  }

  dispatch(transaction: Transaction): void {
    const historyBefore = this.historySnapshot();
    const changesText = transaction.displayChanges.length > 0;
    this.doc = transaction.docAfter;
    this.selection = clampSelection(this.doc, transaction.selectionAfter);
    if (changesText) {
      this.syntax = this.syntaxProvider.update(
        this.syntax,
        this.doc,
        transaction.displayChanges,
      );
    }
    const snapshot = this.snapshot();
    this.slots.forEach((slot) => slot.apply(transaction, snapshot));
    this.normalize();
    if (changesText) {
      this.history.record({
        before: historyBefore,
        after: this.historySnapshot(),
      }, transaction.meta.get(historyEventMetaKey));
    } else if (transaction.steps.length > 0) {
      this.history.closeBatch();
    }
    this.render();

    if (transaction.steps.some((step) => step.kind !== "setSelection")) {
      this.emitChange();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unbindEvents();
    this.handleSelectionDragEnd();
    const snapshot = this.snapshot();
    this.slots.forEach((slot) => slot.destroy(snapshot));
    this.slots = [];
    this.textarea.remove();
    this.renderer.destroy();
    this.container.classList.remove("s9-editor-root");
    restoreRootAttributes(this.container, this.rootAttributeSnapshot);
  }

  private ariaLabel(): string {
    return this.options.ariaLabel ?? "Editor";
  }

  private applyRootAccessibility(): void {
    this.container.setAttribute("role", "textbox");
    this.container.setAttribute("aria-label", this.ariaLabel());
    this.container.setAttribute("aria-multiline", "true");
    this.container.setAttribute("tabindex", "0");
    this.container.setAttribute("aria-readonly", `${this.readOnly}`);
  }

  private syncAccessibilityState(): void {
    this.container.setAttribute("aria-readonly", `${this.readOnly}`);
    this.textarea.readOnly = this.readOnly;
  }

  private bindEvents(): void {
    this.container.addEventListener("mousedown", this.handleContainerMouseDown);
    this.textarea.addEventListener("keydown", this.handleTextareaKeyDown);
    this.textarea.addEventListener("beforeinput", this.handleTextareaBeforeInput);
    this.textarea.addEventListener("input", this.handleTextareaInput);
    this.textarea.addEventListener("compositionstart", this.handleCompositionStart);
    this.textarea.addEventListener("compositionend", this.handleCompositionEnd);
    this.textarea.addEventListener("paste", this.handleTextareaPaste);
    this.textarea.addEventListener("copy", this.handleTextareaCopy);
    this.textarea.addEventListener("cut", this.handleTextareaCut);
  }

  private unbindEvents(): void {
    this.container.removeEventListener("mousedown", this.handleContainerMouseDown);
    this.textarea.removeEventListener("keydown", this.handleTextareaKeyDown);
    this.textarea.removeEventListener(
      "beforeinput",
      this.handleTextareaBeforeInput,
    );
    this.textarea.removeEventListener("input", this.handleTextareaInput);
    this.textarea.removeEventListener(
      "compositionstart",
      this.handleCompositionStart,
    );
    this.textarea.removeEventListener("compositionend", this.handleCompositionEnd);
    this.textarea.removeEventListener("paste", this.handleTextareaPaste);
    this.textarea.removeEventListener("copy", this.handleTextareaCopy);
    this.textarea.removeEventListener("cut", this.handleTextareaCut);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.isComposing || event.isComposing || event.key === "Process") {
      return;
    }

    if (this.runKeymap(this.options.keymap ?? [], event)) {
      return;
    }

    if (this.runKeymap(this.slots.flatMap((slot) => slot.keymap()), event)) {
      return;
    }

    const handledByPlugin = this.slots.some((slot) =>
      slot.handleKeyDown(this.snapshot(), event, (transaction) =>
        this.dispatch(transaction),
      ),
    );
    if (handledByPlugin) {
      event.preventDefault();
      return;
    }

    this.runKeymap(defaultEditorKeymap, event);
  }

  private runKeymap(
    keymap: readonly EditorKeyBinding[],
    event: KeyboardEvent,
  ): boolean {
    for (const binding of keymap) {
      if (!keyBindingMatches(event, binding)) continue;
      if (!this.executeCommandByName(binding.command)) continue;

      event.preventDefault();
      return true;
    }

    return false;
  }

  private executeCommandByName(commandName: string): boolean {
    const context = this.commandContext();
    const commands = [
      ...(this.options.commands ?? []),
      ...this.slots.flatMap((slot) => slot.commands(this.snapshot())),
    ];

    for (const command of commands) {
      if (command.name !== commandName) continue;
      if (command.run(context)) return true;
    }

    return this.executeBuiltinCommand(commandName);
  }

  private commandContext(): EditorCommandContext {
    return {
      ...this.snapshot(),
      dispatch: (transaction) => this.dispatch(transaction),
      execute: (commandName) => this.executeCommandByName(commandName),
    };
  }

  private executeBuiltinCommand(commandName: string): boolean {
    switch (commandName) {
      case editorCommandNames.undo:
        this.preferredSelectionX = null;
        this.undo();
        return true;
      case editorCommandNames.redo:
        this.preferredSelectionX = null;
        this.redo();
        return true;
      case editorCommandNames.selectAll:
        this.selectAll();
        return true;
      case editorCommandNames.moveDocumentStart:
        this.moveToDocumentBoundary("start", false);
        return true;
      case editorCommandNames.moveDocumentStartExtend:
        this.moveToDocumentBoundary("start", true);
        return true;
      case editorCommandNames.moveDocumentEnd:
        this.moveToDocumentBoundary("end", false);
        return true;
      case editorCommandNames.moveDocumentEndExtend:
        this.moveToDocumentBoundary("end", true);
        return true;
      case editorCommandNames.moveLeft:
        this.moveHorizontally(-1, false);
        return true;
      case editorCommandNames.moveLeftExtend:
        this.moveHorizontally(-1, true);
        return true;
      case editorCommandNames.moveRight:
        this.moveHorizontally(1, false);
        return true;
      case editorCommandNames.moveRightExtend:
        this.moveHorizontally(1, true);
        return true;
      case editorCommandNames.moveWordLeft:
        this.moveByWord(-1, false);
        return true;
      case editorCommandNames.moveWordLeftExtend:
        this.moveByWord(-1, true);
        return true;
      case editorCommandNames.moveWordRight:
        this.moveByWord(1, false);
        return true;
      case editorCommandNames.moveWordRightExtend:
        this.moveByWord(1, true);
        return true;
      case editorCommandNames.moveUp:
        this.moveVertically(-1, false);
        return true;
      case editorCommandNames.moveUpExtend:
        this.moveVertically(-1, true);
        return true;
      case editorCommandNames.moveDown:
        this.moveVertically(1, false);
        return true;
      case editorCommandNames.moveDownExtend:
        this.moveVertically(1, true);
        return true;
      case editorCommandNames.moveLineStart:
        this.moveToLineBoundary("start", false);
        return true;
      case editorCommandNames.moveLineStartExtend:
        this.moveToLineBoundary("start", true);
        return true;
      case editorCommandNames.moveLineEnd:
        this.moveToLineBoundary("end", false);
        return true;
      case editorCommandNames.moveLineEndExtend:
        this.moveToLineBoundary("end", true);
        return true;
      case editorCommandNames.insertLineBreak:
        if (this.readOnly) return false;
        this.insertText("\n", { kind: "boundary" });
        return true;
      case editorCommandNames.deleteBackward:
        if (this.readOnly) return false;
        this.preferredSelectionX = null;
        this.deleteBackward();
        return true;
      case editorCommandNames.deleteForward:
        if (this.readOnly) return false;
        this.preferredSelectionX = null;
        this.deleteForward();
        return true;
      case editorCommandNames.deleteWordBackward:
        if (this.readOnly) return false;
        this.preferredSelectionX = null;
        this.deleteBackward("word");
        return true;
      case editorCommandNames.deleteWordForward:
        if (this.readOnly) return false;
        this.preferredSelectionX = null;
        this.deleteForward("word");
        return true;
      default:
        return false;
    }
  }

  private handleBeforeInput(event: InputEvent): void {
    if (!beforeInputMutations.has(event.inputType)) return;

    if (!event.cancelable) return;

    if (this.readOnly) {
      event.preventDefault();
      this.textarea.value = "";
      return;
    }

    if (
      this.isComposing ||
      event.isComposing ||
      event.inputType === "insertCompositionText"
    ) {
      return;
    }

    if (!this.applyBeforeInput(event.inputType, event.data)) return;

    event.preventDefault();
    this.textarea.value = "";
  }

  private applyBeforeInput(inputType: string, data: string | null): boolean {
    switch (inputType) {
      case "insertText":
        if (data === null) return false;
        this.insertText(data, this.historyEventForInput(data));
        return true;
      case "insertFromPaste":
        if (data === null) return false;
        this.insertText(data, { kind: "boundary" });
        return true;
      case "insertLineBreak":
      case "insertParagraph":
        this.insertText("\n", { kind: "boundary" });
        return true;
      case "deleteContentBackward":
        this.deleteBackward();
        return true;
      case "deleteContentForward":
        this.deleteForward();
        return true;
      case "deleteWordBackward":
        this.deleteBackward("word");
        return true;
      case "deleteWordForward":
        this.deleteForward("word");
        return true;
      default:
        return false;
    }
  }

  private selectAll(): void {
    this.preferredSelectionX = null;
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection({ anchor: firstPosition(), head: lastPosition(this.doc) })
        .build(),
    );
  }

  private selectWordAtPosition(position: Position): void {
    this.preferredSelectionX = null;
    this.handleSelectionDragEnd();
    const wordRange = wordRangeAtPosition(this.doc, position);
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection(
          wordRange
            ? { anchor: wordRange.from, head: wordRange.to }
            : collapsedSelection(position),
        )
        .build(),
    );
    this.focus();
  }

  private selectParagraphAtPosition(position: Position): void {
    this.preferredSelectionX = null;
    this.handleSelectionDragEnd();
    const current = clampPosition(this.doc, position);
    const paragraph = this.doc.paragraphs[current.paragraph];
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection({
          anchor: { paragraph: current.paragraph, offset: 0 },
          head: {
            paragraph: current.paragraph,
            offset: paragraph?.text.length ?? 0,
          },
        })
        .build(),
    );
    this.focus();
  }

  private moveHorizontally(direction: -1 | 1, extend: boolean): void {
    this.preferredSelectionX = null;
    const range = normalizeRange(this.selection);
    const edgePosition = direction < 0 ? range.from : range.to;
    const position =
      !extend && !selectionIsCollapsed(this.selection)
        ? edgePosition
        : direction < 0
          ? previousPosition(this.doc, this.selection.head)
          : nextPosition(this.doc, this.selection.head);
    this.setSelectionHead(position, extend);
  }

  private moveByWord(direction: -1 | 1, extend: boolean): void {
    this.preferredSelectionX = null;
    const range = normalizeRange(this.selection);
    const edgePosition = direction < 0 ? range.from : range.to;
    const position =
      !extend && !selectionIsCollapsed(this.selection)
        ? edgePosition
        : direction < 0
          ? previousWordPosition(this.doc, this.selection.head)
          : nextWordPosition(this.doc, this.selection.head);
    this.setSelectionHead(position, extend);
  }

  private moveVertically(direction: -1 | 1, extend: boolean): void {
    const range = normalizeRange(this.selection);
    if (!extend && !selectionIsCollapsed(this.selection)) {
      this.preferredSelectionX = null;
      this.setSelectionHead(direction < 0 ? range.from : range.to, false);
      return;
    }

    const result = this.renderer.positionVerticallyFrom(
      this.selection.head,
      direction,
      this.preferredSelectionX ?? undefined,
    );
    this.preferredSelectionX = result.preferredX;
    this.setSelectionHead(result.position, extend);
  }

  private moveToLineBoundary(boundary: "start" | "end", extend: boolean): void {
    this.preferredSelectionX = null;
    this.setSelectionHead(
      this.renderer.positionAtLineBoundaryFrom(this.selection.head, boundary),
      extend,
    );
  }

  private moveToDocumentBoundary(boundary: "start" | "end", extend: boolean): void {
    this.preferredSelectionX = null;
    this.setSelectionHead(
      boundary === "start" ? firstPosition() : lastPosition(this.doc),
      extend,
    );
  }

  private setSelectionHead(position: Position, extend: boolean): void {
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .setSelection(
          extend
            ? { anchor: this.selection.anchor, head: position }
            : collapsedSelection(position),
        )
        .build(),
    );
  }

  private handleInput(): void {
    if (this.readOnly) {
      this.textarea.value = "";
      this.ignoreNextCompositionInput = false;
      this.committedCompositionText = "";
      return;
    }
    if (this.isComposing) return;
    const text = this.textarea.value;
    this.textarea.value = "";
    if (
      this.ignoreNextCompositionInput &&
      (text.length === 0 || text === this.committedCompositionText)
    ) {
      this.ignoreNextCompositionInput = false;
      this.committedCompositionText = "";
      return;
    }

    this.ignoreNextCompositionInput = false;
    this.committedCompositionText = "";
    this.insertText(text, this.historyEventForInput(text));
  }

  private insertText(text: string, event: HistoryEvent): void {
    if (this.readOnly || text.length === 0) return;
    this.preferredSelectionX = null;
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .replaceSelection(text)
        .setMeta(historyEventMetaKey, event)
        .build(),
    );
  }

  private historyEventForInput(text: string): HistoryEvent {
    return selectionIsCollapsed(this.selection) && !text.includes("\n")
      ? { kind: "typing", text }
      : { kind: "boundary" };
  }

  private handlePaste(event: ClipboardEvent): void {
    if (this.readOnly) {
      event.preventDefault();
      this.textarea.value = "";
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length === 0) return;
    event.preventDefault();
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .replaceSelection(text)
        .setMeta(historyEventMetaKey, { kind: "boundary" })
        .build(),
    );
  }

  private handleCopy(event: ClipboardEvent): void {
    const text = textInRange(this.doc, this.selection);
    if (text.length === 0) return;
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  }

  private handleCut(event: ClipboardEvent): void {
    const text = textInRange(this.doc, this.selection);
    if (text.length === 0) return;
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    if (this.readOnly) return;
    this.dispatch(
      createTransaction(this.doc, this.selection)
        .replaceSelection("")
        .setMeta(historyEventMetaKey, { kind: "boundary" })
        .build(),
    );
  }

  private deleteBackward(granularity: TextGranularity = "grapheme"): void {
    if (!selectionIsCollapsed(this.selection)) {
      this.dispatch(
        createTransaction(this.doc, this.selection)
          .replaceSelection("")
          .setMeta(historyEventMetaKey, { kind: "boundary" })
          .build(),
      );
      return;
    }

    const previous =
      granularity === "word"
        ? previousWordPosition(this.doc, this.selection.head)
        : previousPosition(this.doc, this.selection.head);
    if (previous.paragraph === this.selection.head.paragraph && previous.offset === this.selection.head.offset) {
      return;
    }

    this.dispatch(
      createTransaction(this.doc, this.selection)
        .replaceRange(previous, this.selection.head, "")
        .setMeta(
          historyEventMetaKey,
          granularity === "word" ? { kind: "boundary" } : { kind: "deleteBackward" },
        )
        .build(),
    );
  }

  private deleteForward(granularity: TextGranularity = "grapheme"): void {
    if (!selectionIsCollapsed(this.selection)) {
      this.dispatch(
        createTransaction(this.doc, this.selection)
          .replaceSelection("")
          .setMeta(historyEventMetaKey, { kind: "boundary" })
          .build(),
      );
      return;
    }

    const next =
      granularity === "word"
        ? nextWordPosition(this.doc, this.selection.head)
        : nextPosition(this.doc, this.selection.head);
    if (next.paragraph === this.selection.head.paragraph && next.offset === this.selection.head.offset) {
      return;
    }

    this.dispatch(
      createTransaction(this.doc, this.selection)
        .replaceRange(this.selection.head, next, "")
        .setMeta(
          historyEventMetaKey,
          granularity === "word" ? { kind: "boundary" } : { kind: "deleteForward" },
        )
        .build(),
    );
  }

  private render(): void {
    const output = this.collectOutput();
    this.renderer.render({
      doc: this.doc,
      selection: this.selection,
      readOnly: this.readOnly,
      decorations: output.decorations,
      widgets: output.widgets,
    });
    this.renderer.syncInputProxy(this.textarea);
  }

  private collectOutput(): RenderOutput {
    const snapshot = this.snapshot();
    return this.slots.reduce<RenderOutput>(
      (combined, slot) => {
        const output = slot.output(snapshot);
        return {
          instances: [...combined.instances, ...output.instances],
          decorations: [...combined.decorations, ...output.decorations],
          widgets: [...combined.widgets, ...output.widgets],
        };
      },
      { instances: [], decorations: [], widgets: [] },
    );
  }

  private normalize(): void {
    const snapshot = this.snapshot();
    const output = this.collectOutput();
    const steps = this.slots.flatMap((slot) =>
      slot.normalize(snapshot, output.instances),
    );

    if (steps.length === 0) return;

    const builder = createTransaction(this.doc, this.selection);
    steps.forEach((step) => {
      if (step.kind === "replaceRange") {
        builder.replaceRange(step.from, step.to, step.text);
      } else {
        builder.setSelection(step.selection);
      }
    });
    const transaction = builder.build();
    const changesText = transaction.displayChanges.length > 0;
    this.doc = transaction.docAfter;
    this.selection = transaction.selectionAfter;
    if (changesText) {
      this.syntax = this.syntaxProvider.update(
        this.syntax,
        this.doc,
        transaction.displayChanges,
      );
    }
    const normalizedSnapshot = this.snapshot();
    this.slots.forEach((slot) => slot.apply(transaction, normalizedSnapshot));
  }

  private snapshot(): EditorStateSnapshot {
    return {
      doc: this.doc,
      selection: this.selection,
      content: this.getContent(),
      readOnly: this.readOnly,
      syntax: this.syntax,
    };
  }

  private historySnapshot(): HistorySnapshot {
    return {
      doc: this.doc,
      selection: this.selection,
      syntax: this.syntax,
    };
  }

  private restoreHistorySnapshot(
    snapshot: HistorySnapshot,
    transaction: Transaction,
  ): void {
    this.doc = snapshot.doc;
    this.selection = clampSelection(this.doc, snapshot.selection);
    this.syntax = snapshot.syntax;
    const state = this.snapshot();
    this.slots.forEach((slot) => slot.apply(transaction, state));
    this.normalize();
    this.render();
    this.emitChange();
  }

  private emitChange(): void {
    this.options.onChange?.(this.snapshot());
  }
}
