import { describe, expect, it } from "vitest";
import {
  ScribeFrame,
} from "../src";
import {
  codeBlockWidgetPlugin,
  markdownPlugin,
  markdownSyntaxProvider,
  requireMarkdownSyntaxSnapshot,
} from "../demo/src/markdown";

describe("parser-backed markdown plugins", () => {
  it("styles indented ATX headings from parser tokens", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ScribeFrame(container, {
      content: "  # Heading",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    const paragraph = container.querySelector(".s9-paragraph");
    const markupText = [
      ...container.querySelectorAll<HTMLElement>(".s9-md-markup"),
    ].map((element) => element.textContent).join("");

    expect(paragraph?.classList.contains("s9-md-heading-block")).toBe(true);
    expect(markupText).toBe("#");

    editor.destroy();
    container.remove();
  });

  it("creates code widgets from tilded fence tokens and preserves fence markup on edit", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ScribeFrame(container, {
      content: "~~~ts\nconst x = 1;\n~~~",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [codeBlockWidgetPlugin()],
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".s9-code-widget-textarea",
    );

    expect(textarea).not.toBeNull();
    if (!textarea) return;

    textarea.value = "const x = 1;\nconsole.log(x);";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      requireMarkdownSyntaxSnapshot(editor.getSyntaxSnapshot()).projection
        .markdownText,
    ).toBe("~~~ts\nconst x = 1;\nconsole.log(x);\n~~~");

    editor.destroy();
    container.remove();
  });
});
