import { describe, expect, it } from "vitest";
import { ModernEditor } from "../src";

interface ClipboardStore {
  readonly event: ClipboardEvent;
  readonly data: Map<string, string>;
}

const inputFor = (container: HTMLElement): HTMLTextAreaElement => {
  const input = container.querySelector<HTMLTextAreaElement>(".s9-input-proxy");
  if (!input) throw new Error("Input proxy not found");
  return input;
};

const clipboardEvent = (
  type: "copy" | "cut" | "paste",
  text = "",
): ClipboardStore => {
  const data = new Map<string, string>();
  if (text.length > 0) data.set("text/plain", text);
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => data.get(format) ?? "",
      setData: (format: string, value: string) => {
        data.set(format, value);
      },
    },
  });
  return { event, data };
};

describe("editor clipboard behavior", () => {
  it("copies the selected display text as plain text", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "alpha\nbeta" });

    editor.selectRange({
      from: { paragraph: 0, offset: 2 },
      to: { paragraph: 1, offset: 2 },
    });
    const { event, data } = clipboardEvent("copy");
    inputFor(container).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data.get("text/plain")).toBe("pha\nbe");
    expect(editor.getContent()).toBe("alpha\nbeta");

    editor.destroy();
    container.remove();
  });

  it("cuts selected text as a separate undoable edit", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "alpha beta" });

    editor.selectRange({
      from: { paragraph: 0, offset: 6 },
      to: { paragraph: 0, offset: 10 },
    });
    const { event, data } = clipboardEvent("cut");
    inputFor(container).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data.get("text/plain")).toBe("beta");
    expect(editor.getContent()).toBe("alpha ");

    editor.undo();

    expect(editor.getContent()).toBe("alpha beta");
    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 10 },
    });

    editor.destroy();
    container.remove();
  });

  it("pastes plain text as a boundary edit and clears redo history", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "ab" });

    editor.selectRange({
      from: { paragraph: 0, offset: 1 },
      to: { paragraph: 0, offset: 2 },
    });
    const firstPaste = clipboardEvent("paste", "X\nY");
    inputFor(container).dispatchEvent(firstPaste.event);
    editor.undo();
    expect(editor.canRedo()).toBe(true);

    const secondPaste = clipboardEvent("paste", "Z");
    inputFor(container).dispatchEvent(secondPaste.event);

    expect(firstPaste.event.defaultPrevented).toBe(true);
    expect(secondPaste.event.defaultPrevented).toBe(true);
    expect(editor.getContent()).toBe("aZ");
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("prevents paste and cut mutations in read-only mode while preserving copy output", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "read only",
      readOnly: true,
    });
    const input = inputFor(container);

    editor.selectRange({
      from: { paragraph: 0, offset: 0 },
      to: { paragraph: 0, offset: 4 },
    });

    const paste = clipboardEvent("paste", "write");
    input.dispatchEvent(paste.event);
    const cut = clipboardEvent("cut");
    input.dispatchEvent(cut.event);
    const copy = clipboardEvent("copy");
    input.dispatchEvent(copy.event);

    expect(paste.event.defaultPrevented).toBe(true);
    expect(cut.event.defaultPrevented).toBe(true);
    expect(copy.event.defaultPrevented).toBe(true);
    expect(cut.data.get("text/plain")).toBe("read");
    expect(copy.data.get("text/plain")).toBe("read");
    expect(input.value).toBe("");
    expect(editor.getContent()).toBe("read only");
    expect(editor.canUndo()).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("leaves empty clipboard events unhandled", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });

    const paste = clipboardEvent("paste");
    inputFor(container).dispatchEvent(paste.event);

    expect(paste.event.defaultPrevented).toBe(false);
    expect(editor.getContent()).toBe("abc");
    expect(editor.canUndo()).toBe(false);

    editor.destroy();
    container.remove();
  });
});
