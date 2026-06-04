import { afterEach, describe, expect, it, vi } from "vitest";
import { ModernEditor } from "../src";

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

const beforeInput = (
  container: HTMLElement,
  inputType: string,
  data: string | null = null,
): InputEvent => {
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data,
    inputType,
  });
  inputFor(container).dispatchEvent(event);
  return event;
};

const composition = (type: string, data: string): Event => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "data", { value: data });
  return event;
};

describe("editor input correctness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits beforeinput text data without relying on textarea value", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });

    const event = beforeInput(container, "insertText", "é");

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getContent()).toBe("é");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 1 },
    });

    editor.destroy();
    container.remove();
  });

  it("handles beforeinput line breaks and paste-style insertions as boundary edits", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "a" });

    editor.selectRange({
      from: { paragraph: 0, offset: 1 },
      to: { paragraph: 0, offset: 1 },
    });
    beforeInput(container, "insertLineBreak");
    beforeInput(container, "insertFromPaste", "b\nc");

    expect(editor.getContent()).toBe("a\nb\nc");
    editor.undo();
    expect(editor.getContent()).toBe("a\n");
    editor.undo();
    expect(editor.getContent()).toBe("a");

    editor.destroy();
    container.remove();
  });

  it("handles beforeinput deletion without splitting grapheme clusters", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const emoji = "👩‍💻";
    const editor = new ModernEditor(container, { content: `a${emoji}b` });

    editor.selectRange({
      from: { paragraph: 0, offset: `a${emoji}`.length },
      to: { paragraph: 0, offset: `a${emoji}`.length },
    });
    const event = beforeInput(container, "deleteContentBackward");

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getContent()).toBe("ab");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 1 },
    });

    editor.destroy();
    container.remove();
  });

  it("keeps composition text out of the document until compositionend", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });
    const input = inputFor(container);

    editor.selectRange({
      from: { paragraph: 0, offset: 3 },
      to: { paragraph: 0, offset: 3 },
    });
    input.dispatchEvent(composition("compositionstart", ""));
    input.value = "文";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    keyDown(container, "Backspace");
    expect(editor.getContent()).toBe("abc");

    input.dispatchEvent(composition("compositionend", "文"));
    input.value = "文";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(editor.getContent()).toBe("abc文");
    expect(input.value).toBe("");

    editor.destroy();
    container.remove();
  });

  it("falls back to the composition buffer when compositionend has no data", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "" });
    const input = inputFor(container);

    input.dispatchEvent(composition("compositionstart", ""));
    input.value = "한";
    input.dispatchEvent(composition("compositionend", ""));

    expect(editor.getContent()).toBe("한");
    expect(input.value).toBe("");

    editor.destroy();
    container.remove();
  });

  it("prevents beforeinput mutations in read-only mode and clears the proxy buffer", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "abc",
      readOnly: true,
    });
    const input = inputFor(container);
    input.value = "x";

    const event = beforeInput(container, "insertText", "x");

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(editor.getContent()).toBe("abc");

    editor.destroy();
    container.remove();
  });

  it("supports word-granularity navigation and deletion", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "alpha beta gamma",
    });

    keyDown(container, "ArrowRight", { altKey: true });
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 5 },
      head: { paragraph: 0, offset: 5 },
    });

    keyDown(container, "ArrowRight", { altKey: true, shiftKey: true });
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 5 },
      head: { paragraph: 0, offset: 10 },
    });

    editor.selectRange({
      from: { paragraph: 0, offset: editor.getContent().length },
      to: { paragraph: 0, offset: editor.getContent().length },
    });
    keyDown(container, "Backspace", { altKey: true });
    expect(editor.getContent()).toBe("alpha beta ");

    editor.undo();
    expect(editor.getContent()).toBe("alpha beta gamma");

    editor.destroy();
    container.remove();
  });
});
