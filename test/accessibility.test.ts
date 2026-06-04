import { describe, expect, it } from "vitest";
import { ModernEditor } from "../src";

const inputFor = (container: HTMLElement): HTMLTextAreaElement => {
  const input = container.querySelector<HTMLTextAreaElement>(".s9-input-proxy");
  if (!input) throw new Error("Input proxy not found");
  return input;
};

describe("renderer accessibility", () => {
  it("exposes stable textbox semantics on the editor root", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      ariaLabel: "Draft body",
      content: "First paragraph\nSecond paragraph",
    });

    expect(container.getAttribute("role")).toBe("textbox");
    expect(container.getAttribute("aria-label")).toBe("Draft body");
    expect(container.getAttribute("aria-multiline")).toBe("true");
    expect(container.getAttribute("aria-readonly")).toBe("false");
    expect(container.getAttribute("tabindex")).toBe("0");
    expect(inputFor(container).getAttribute("aria-label")).toBe("Draft body input");
    expect(container.querySelector(".s9-selection-layer")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".s9-caret")?.getAttribute("aria-hidden")).toBe("true");

    editor.destroy();
    container.remove();
  });

  it("reflects read-only mode in ARIA and the focus proxy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "Read-only text",
      readOnly: true,
    });
    const input = inputFor(container);

    expect(container.getAttribute("aria-readonly")).toBe("true");
    expect(input.readOnly).toBe(true);

    editor.setReadOnly(false);

    expect(container.getAttribute("aria-readonly")).toBe("false");
    expect(input.readOnly).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("restores host accessibility attributes and editor classes on destroy", () => {
    const container = document.createElement("div");
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Existing label");
    container.setAttribute("tabindex", "7");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      ariaLabel: "Mounted editor",
      content: "Body",
    });
    expect(container.classList.contains("s9-editor-root")).toBe(true);
    expect(container.classList.contains("s9-editor")).toBe(true);

    editor.destroy();

    expect(container.getAttribute("role")).toBe("region");
    expect(container.getAttribute("aria-label")).toBe("Existing label");
    expect(container.getAttribute("tabindex")).toBe("7");
    expect(container.hasAttribute("aria-multiline")).toBe(false);
    expect(container.hasAttribute("aria-readonly")).toBe(false);
    expect(container.classList.contains("s9-editor-root")).toBe(false);
    expect(container.classList.contains("s9-editor")).toBe(false);
    expect(container.querySelector(".s9-input-proxy")).toBeNull();

    container.remove();
  });
});
