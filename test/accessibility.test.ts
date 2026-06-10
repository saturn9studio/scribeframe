import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScribeFrame } from "../src";
import {
  codeBlockWidgetPlugin,
  markdownSyntaxProvider,
} from "../demo/src/markdown";

const inputFor = (container: HTMLElement): HTMLTextAreaElement => {
  const input = container.querySelector<HTMLTextAreaElement>(".s9-input-proxy");
  if (!input) throw new Error("Input proxy not found");
  return input;
};

describe("renderer accessibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes stable textbox semantics on the editor root", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ScribeFrame(container, {
      ariaLabel: "Draft body",
      content: "First paragraph\nSecond paragraph",
    });

    expect(container.getAttribute("role")).toBe("textbox");
    expect(container.getAttribute("aria-label")).toBe("Draft body");
    expect(container.getAttribute("aria-multiline")).toBe("true");
    expect(container.getAttribute("aria-readonly")).toBe("false");
    expect(container.getAttribute("tabindex")).toBe("0");
    expect(inputFor(container).tabIndex).toBe(-1);
    expect(inputFor(container).getAttribute("aria-label")).toBe(
      "Draft body input",
    );
    expect(
      container
        .querySelector(".s9-selection-layer")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      container.querySelector(".s9-caret")?.getAttribute("aria-hidden"),
    ).toBe("true");

    editor.destroy();
    container.remove();
  });

  it("reflects read-only mode in ARIA and the focus proxy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
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

    const editor = new ScribeFrame(container, {
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

  it("delegates keyboard focus from the visible textbox to the input proxy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      ariaLabel: "Keyboard target",
      content: "",
    });

    container.focus();

    expect(document.activeElement).toBe(inputFor(container));

    editor.destroy();
    container.remove();
  });

  it("focuses the input proxy directly from the editor API", () => {
    const container = document.createElement("div");
    const other = document.createElement("button");
    document.body.append(container, other);
    const editor = new ScribeFrame(container, {
      ariaLabel: "Keyboard target",
      content: "",
    });

    other.focus();
    editor.focus();

    expect(document.activeElement).toBe(inputFor(container));

    editor.destroy();
    container.remove();
    other.remove();
  });

  it("marks the root only while the input proxy owns focus", () => {
    const container = document.createElement("div");
    const other = document.createElement("button");
    document.body.append(container, other);
    const editor = new ScribeFrame(container, {
      ariaLabel: "Keyboard target",
      content: "",
    });

    editor.focus();
    expect(container.classList.contains("s9-editor-root--input-focused")).toBe(
      true,
    );

    other.focus();
    expect(container.classList.contains("s9-editor-root--input-focused")).toBe(
      false,
    );

    editor.destroy();
    container.remove();
    other.remove();
  });

  it("resets stale input proxy focus when focusing the editor API", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      ariaLabel: "Keyboard target",
      content: "",
    });
    const input = inputFor(container);
    const blur = vi.spyOn(input, "blur");
    const focus = vi.spyOn(input, "focus");

    input.focus();
    editor.focus();

    expect(blur).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(input);

    editor.destroy();
    container.remove();
  });

  it("gives code block widget controls accessible names", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      content: "```ts\nconst x = 1;\n```",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [codeBlockWidgetPlugin()],
    });

    expect(
      container
        .querySelector<HTMLElement>(".s9-code-widget")
        ?.getAttribute("role"),
    ).toBe("group");
    expect(
      container
        .querySelector<HTMLInputElement>(".s9-code-widget-language")
        ?.getAttribute("aria-label"),
    ).toBe("Code block language");
    expect(
      container
        .querySelector<HTMLTextAreaElement>(".s9-code-widget-textarea")
        ?.getAttribute("aria-label"),
    ).toBe("Code block content");

    editor.destroy();
    container.remove();
  });

  it("keeps focus, reduced-motion, and forced-colors affordances in core styles", () => {
    const styles = readFileSync(resolve(cwd(), "src/styles.css"), "utf8");
    const reducedMotionCaret =
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)[\s\S]*\.s9-caret[\s\S]*animation:/u;
    const forcedColors =
      /@media\s*\(forced-colors:\s*active\)[\s\S]*Highlight[\s\S]*CanvasText/u;

    expect(styles).toContain(
      ".s9-editor-root:focus-within .s9-editor-surface",
    );
    expect(styles).toMatch(reducedMotionCaret);
    expect(styles).toMatch(forcedColors);
  });
});
