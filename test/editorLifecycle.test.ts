import { afterEach, describe, expect, it, vi } from "vitest";
import { ModernEditor } from "../src";

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

const textNodeContaining = (container: HTMLElement, text: string): Text => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent === text) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`Text node not found: ${text}`);
};

describe("editor lifecycle cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detaches root pointer handlers on destroy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });
    const staleTextNode = textNodeContaining(container, "abc");
    const caretDocument = document as CaretPositionDocument;
    const originalCaretPositionFromPoint = caretDocument.caretPositionFromPoint;
    caretDocument.caretPositionFromPoint = () => ({
      offsetNode: staleTextNode,
      offset: 1,
    });

    editor.destroy();
    const event = new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector(".s9-input-proxy")).toBeNull();

    caretDocument.caretPositionFromPoint = originalCaretPositionFromPoint;
    container.remove();
  });

  it("detaches input proxy handlers before removing the proxy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });
    const input = inputFor(container);

    editor.destroy();
    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(editor.getContent()).toBe("abc");
    expect(container.querySelector(".s9-editor-surface")).toBeNull();

    container.remove();
  });

  it("configures the input proxy to suppress browser writing assistants", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content: "abc" });
    const input = inputFor(container);

    expect(input.spellcheck).toBe(false);
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("data-ms-editor")).toBe("false");
    expect(input.getAttribute("writingsuggestions")).toBe("false");

    editor.destroy();
    container.remove();
  });
});
