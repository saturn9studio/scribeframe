import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModernEditor,
  createTransaction,
  firstPosition,
} from "../src";

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

const typeText = (container: HTMLElement, text: string): void => {
  const input = inputFor(container);
  [...text].forEach((character) => {
    input.value = character;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("editor history", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("undoes and redoes text-changing transactions with selection restore", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange(
          { paragraph: 0, offset: 1 },
          { paragraph: 0, offset: 2 },
          "X",
        )
        .build(),
    );

    expect(editor.getContent()).toBe("aXc");
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);

    editor.undo();
    expect(editor.getContent()).toBe("abc");
    expect(editor.getSelection()).toEqual({
      anchor: firstPosition(),
      head: firstPosition(),
    });
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);

    editor.redo();
    expect(editor.getContent()).toBe("aXc");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 2 },
      head: { paragraph: 0, offset: 2 },
    });

    editor.destroy();
    container.remove();
  });

  it("does not record selection-only transactions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 1 },
          head: { paragraph: 0, offset: 1 },
        })
        .build(),
    );

    expect(editor.canUndo()).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("clears redo history when a new edit follows undo", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "a" });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange({ paragraph: 0, offset: 1 }, { paragraph: 0, offset: 1 }, "b")
        .build(),
    );
    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange({ paragraph: 0, offset: 2 }, { paragraph: 0, offset: 2 }, "c")
        .build(),
    );

    editor.undo();
    expect(editor.getContent()).toBe("ab");
    expect(editor.canRedo()).toBe(true);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange({ paragraph: 0, offset: 2 }, { paragraph: 0, offset: 2 }, "d")
        .build(),
    );

    expect(editor.getContent()).toBe("abd");
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("supports platform undo and redo shortcuts", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "a" });
    const input = inputFor(container);

    input.value = "b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.getContent()).toBe("ba");

    keyDown(container, "z", { metaKey: true });
    expect(editor.getContent()).toBe("a");

    keyDown(container, "z", { metaKey: true, shiftKey: true });
    expect(editor.getContent()).toBe("ba");

    keyDown(container, "z", { ctrlKey: true });
    expect(editor.getContent()).toBe("a");

    keyDown(container, "y", { ctrlKey: true });
    expect(editor.getContent()).toBe("ba");

    editor.destroy();
    container.remove();
  });

  it("disables undo and redo while read-only without dropping history", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "a" });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange({ paragraph: 0, offset: 1 }, { paragraph: 0, offset: 1 }, "b")
        .build(),
    );
    editor.setReadOnly(true);

    expect(editor.canUndo()).toBe(false);
    editor.undo();
    expect(editor.getContent()).toBe("ab");

    editor.setReadOnly(false);
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(editor.getContent()).toBe("a");

    editor.destroy();
    container.remove();
  });

  it("clears undo and redo stacks explicitly without changing the document", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "a" });

    typeText(container, "b");
    editor.undo();
    expect(editor.getContent()).toBe("a");
    expect(editor.canRedo()).toBe(true);

    editor.clearHistory();

    expect(editor.getContent()).toBe("a");
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    editor.redo();
    expect(editor.getContent()).toBe("a");

    editor.destroy();
    container.remove();
  });

  it("batches continuous typing into one undo entry", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });

    typeText(container, "abc");

    expect(editor.getContent()).toBe("abc");
    editor.undo();
    expect(editor.getContent()).toBe("");
    expect(editor.canUndo()).toBe(false);

    editor.redo();
    expect(editor.getContent()).toBe("abc");

    editor.destroy();
    container.remove();
  });

  it("starts a new typing batch after a word boundary", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });

    typeText(container, "hello world");

    editor.undo();
    expect(editor.getContent()).toBe("hello ");

    editor.undo();
    expect(editor.getContent()).toBe("");

    editor.destroy();
    container.remove();
  });

  it("starts a new typing batch after the batch timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });

    typeText(container, "a");
    vi.setSystemTime(2000);
    typeText(container, "b");

    editor.undo();
    expect(editor.getContent()).toBe("a");

    editor.undo();
    expect(editor.getContent()).toBe("");

    editor.destroy();
    container.remove();
  });

  it("closes typing batches when the cursor moves", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });

    typeText(container, "ab");
    keyDown(container, "ArrowLeft");
    typeText(container, "X");

    expect(editor.getContent()).toBe("aXb");

    editor.undo();
    expect(editor.getContent()).toBe("ab");

    editor.undo();
    expect(editor.getContent()).toBe("");

    editor.destroy();
    container.remove();
  });

  it("batches contiguous backspace deletes", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abcd" });

    editor.selectRange({
      from: { paragraph: 0, offset: 4 },
      to: { paragraph: 0, offset: 4 },
    });
    keyDown(container, "Backspace");
    keyDown(container, "Backspace");

    expect(editor.getContent()).toBe("ab");

    editor.undo();
    expect(editor.getContent()).toBe("abcd");

    editor.destroy();
    container.remove();
  });

  it("batches contiguous forward deletes", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abcd" });

    keyDown(container, "Delete");
    keyDown(container, "Delete");

    expect(editor.getContent()).toBe("cd");

    editor.undo();
    expect(editor.getContent()).toBe("abcd");

    editor.destroy();
    container.remove();
  });

  it("keeps paste-like programmatic edits and line breaks separate from typing", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });

    typeText(container, "ab");
    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection(" pasted")
        .build(),
    );
    keyDown(container, "Enter");

    expect(editor.getContent()).toBe("ab pasted\n");

    editor.undo();
    expect(editor.getContent()).toBe("ab pasted");

    editor.undo();
    expect(editor.getContent()).toBe("ab");

    editor.undo();
    expect(editor.getContent()).toBe("");

    editor.destroy();
    container.remove();
  });
});
