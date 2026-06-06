import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");

const blockFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u").exec(styles);
  return match?.groups?.body ?? "";
};

describe("Scribeframe styles", () => {
  it("exposes core editor theming variables with current defaults", () => {
    expect(blockFor(".s9-editor-root")).toContain(
      "--s9-editor-paragraph-color: #241f1a;",
    );
    expect(blockFor(".s9-editor-root")).toContain(
      '--s9-editor-font-family: Georgia, "Times New Roman", serif;',
    );
    expect(blockFor(".s9-editor-root")).toContain(
      "--s9-editor-selection-background: rgba(139, 104, 62, 0.22);",
    );
  });

  it("uses variables for core renderer colors and typography", () => {
    const paragraph = blockFor(".s9-paragraph");
    const caret = blockFor(".s9-caret");
    const selection = blockFor(".s9-selection-rect");
    const focus = blockFor(".s9-editor-root:focus-within .s9-editor-surface");

    expect(paragraph).toContain("color: var(--s9-editor-paragraph-color);");
    expect(paragraph).toContain("font-family: var(--s9-editor-font-family);");
    expect(paragraph).toContain("font-size: var(--s9-editor-font-size);");
    expect(paragraph).toContain("line-height: var(--s9-editor-line-height);");
    expect(paragraph).not.toContain("font:");
    expect(caret).toContain("background: var(--s9-editor-caret-color);");
    expect(caret).toContain("width: var(--s9-editor-caret-width);");
    expect(selection).toContain(
      "background: var(--s9-editor-selection-background);",
    );
    expect(focus).toContain("var(--s9-editor-focus-outline-color)");
  });
});
