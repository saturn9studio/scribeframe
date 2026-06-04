import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModernEditor,
  createTransaction,
} from "../src";
import { markdownPlugin, markdownSyntaxProvider } from "../demo/src/markdown";

type CaretPositionDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
};

const inputFor = (container: HTMLElement): HTMLTextAreaElement => {
  const input = container.querySelector<HTMLTextAreaElement>(".s9-input-proxy");
  if (!input) throw new Error("Input proxy not found");
  return input;
};

const keyDown = (
  container: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): void => {
  inputFor(container).dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      ...init,
    }),
  );
};

const setSelection = (
  editor: ModernEditor,
  anchor: { readonly paragraph: number; readonly offset: number },
  head: { readonly paragraph: number; readonly offset: number },
): void => {
  editor.dispatch(
    createTransaction(editor.getDocument(), editor.getSelection())
      .setSelection({ anchor, head })
      .build(),
  );
};

const textNodeContaining = (container: HTMLElement, text: string): Text => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent === text) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`Text node not found: ${text}`);
};

describe("editor cursor and selection behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves the cursor up and down between paragraphs while preserving offset", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc\ndefg\nhi",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    setSelection(editor, { paragraph: 0, offset: 2 }, { paragraph: 0, offset: 2 });

    keyDown(container, "ArrowDown");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 1, offset: 2 },
      head: { paragraph: 1, offset: 2 },
    });

    keyDown(container, "ArrowDown");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 2, offset: 2 },
      head: { paragraph: 2, offset: 2 },
    });

    keyDown(container, "ArrowUp");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 1, offset: 2 },
      head: { paragraph: 1, offset: 2 },
    });

    editor.destroy();
    container.remove();
  });

  it("extends vertical selections with Shift+Arrow", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc\ndef",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    setSelection(editor, { paragraph: 0, offset: 1 }, { paragraph: 0, offset: 1 });

    keyDown(container, "ArrowDown", { shiftKey: true });

    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 1, offset: 1 },
    });

    editor.destroy();
    container.remove();
  });

  it("collapses range selections to movement edges without Shift", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc\ndef",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    setSelection(editor, { paragraph: 0, offset: 1 }, { paragraph: 1, offset: 2 });

    keyDown(container, "ArrowUp");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 1 },
    });

    setSelection(editor, { paragraph: 0, offset: 1 }, { paragraph: 1, offset: 2 });
    keyDown(container, "ArrowDown");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 1, offset: 2 },
      head: { paragraph: 1, offset: 2 },
    });

    editor.destroy();
    container.remove();
  });

  it("honors Shift+Home and Shift+End", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abcdef",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    setSelection(editor, { paragraph: 0, offset: 2 }, { paragraph: 0, offset: 2 });

    keyDown(container, "End", { shiftKey: true });
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 2 },
      head: { paragraph: 0, offset: 6 },
    });

    keyDown(container, "Home", { shiftKey: true });
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 2 },
      head: { paragraph: 0, offset: 0 },
    });

    editor.destroy();
    container.remove();
  });

  it("allows cursor navigation in read-only mode without allowing edits", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
      readOnly: true,
    });

    keyDown(container, "ArrowRight");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 1 },
    });

    const input = inputFor(container);
    input.value = "X";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.getContent()).toBe("abc");

    keyDown(container, "Backspace");
    expect(editor.getContent()).toBe("abc");

    editor.destroy();
    container.remove();
  });

  it("replaces a non-collapsed selection when text is inserted", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abcdef",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });
    const input = inputFor(container);

    setSelection(editor, { paragraph: 0, offset: 1 }, { paragraph: 0, offset: 4 });
    input.value = "X";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(editor.getContent()).toBe("aXef");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 2 },
      head: { paragraph: 0, offset: 2 },
    });

    editor.destroy();
    container.remove();
  });

  it("extends selection during pointer drag", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abcdef",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });
    const caretDocument = document as CaretPositionDocument;
    const originalCaretPositionFromPoint = caretDocument.caretPositionFromPoint;
    caretDocument.caretPositionFromPoint = (x) => ({
      offsetNode: textNodeContaining(container, "abcdef"),
      offset: Math.max(0, Math.min(6, Math.round(x))),
    });

    container.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 1, bubbles: true }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { button: 0, clientX: 4, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));

    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 4 },
    });

    caretDocument.caretPositionFromPoint = originalCaretPositionFromPoint;
    editor.destroy();
    container.remove();
  });
});
