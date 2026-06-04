import { describe, expect, it } from "vitest";
import {
  createTransaction,
  documentFromText,
  ModernEditor,
  PluginId,
  type EditorPlugin,
  type SyntaxSnapshot,
} from "../src";
import {
  buildMarkdownSyntaxSnapshot,
  buildTextProjection,
  markdownSyntaxProvider,
  requireMarkdownSyntaxSnapshot,
  updateMarkdownSyntaxSnapshot,
} from "../demo/src/markdown";

describe("Markdown demo projection", () => {
  it("uses document text as Markdown text with identity offsets", () => {
    const markdown = "# Heading\n\nThis is body text.\n\nFinal paragraph.";
    const projection = buildTextProjection(documentFromText(markdown));

    expect(projection.displayText).toBe(markdown);
    expect(projection.markdownText).toBe(markdown);
    expect(projection.displayToMarkdown(12)).toBe(12);
    expect(projection.markdownToDisplay(12)).toBe(12);
    expect(projection.displayToMarkdown(-1)).toBe(0);
    expect(projection.markdownToDisplay(markdown.length + 1)).toBe(
      markdown.length,
    );
    expect(projection.displayRangeToMarkdown({ from: 2, to: 9 })).toEqual({
      from: 2,
      to: 9,
    });
    expect(projection.markdownRangeToDisplay({ from: 11, to: 28 })).toEqual({
      from: 11,
      to: 28,
    });
  });

  it("preserves fenced code text without adapter-level newline rewriting", () => {
    const markdown = [
      "Intro",
      "",
      "```ts",
      "const x = 1;",
      "",
      "console.log(x);",
      "```",
      "After",
    ].join("\n");

    expect(buildTextProjection(documentFromText(markdown)).markdownText).toBe(
      markdown,
    );
  });
});

describe("syntax snapshots", () => {
  it("parses Markdown text and maps token ranges back to identical display ranges", () => {
    const markdown = "# Heading\nBody **bold** text";
    const snapshot = buildMarkdownSyntaxSnapshot(documentFromText(markdown));

    expect(snapshot.projection.markdownText).toBe(markdown);

    const heading = snapshot.tokenViews.find((token) => token.kind === "heading");

    expect(heading?.sourceRange).toEqual({ from: 0, to: 9 });
    expect(heading?.displayRange).toEqual({ from: 0, to: 9 });
    expect(
      snapshot.tokenViews.map((token) => ({
        sourceRange: token.sourceRange,
        displayRange: token.displayRange,
      })),
    ).toEqual(
      snapshot.tokenViews.map((token) => ({
        sourceRange: token.sourceRange,
        displayRange: token.sourceRange,
      })),
    );
  });

  it("updates syntax for document changes but reuses it for selection-only transactions", () => {
    const editor = new ModernEditor(document.createElement("div"), {
      content: "# Heading",
      syntaxProvider: markdownSyntaxProvider,
    });
    const initial = editor.getSyntaxSnapshot();

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 1 },
          head: { paragraph: 0, offset: 1 },
        })
        .build(),
    );

    expect(editor.getSyntaxSnapshot()).toBe(initial);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange(
          { paragraph: 0, offset: 9 },
          { paragraph: 0, offset: 9 },
          "\nBody",
        )
        .build(),
    );

    expect(editor.getSyntaxSnapshot()).not.toBe(initial);
    expect(
      requireMarkdownSyntaxSnapshot(editor.getSyntaxSnapshot()).projection
        .markdownText,
    ).toBe("# Heading\nBody");

    editor.destroy();
  });

  it("exposes syntax snapshots to plugin init and output contexts", () => {
    const initSnapshots: SyntaxSnapshot[] = [];
    const snapshots: SyntaxSnapshot[] = [];
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("syntax-observer"),
      init(context) {
        initSnapshots.push(context.syntax);
        return null;
      },
      apply: () => null,
      decorations(context) {
        snapshots.push(context.syntax);
        return [];
      },
    };

    const editor = new ModernEditor(document.createElement("div"), {
      content: "Body",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [plugin],
    });

    expect(
      requireMarkdownSyntaxSnapshot(initSnapshots[initSnapshots.length - 1])
        .projection.markdownText,
    ).toBe("Body");
    expect(
      requireMarkdownSyntaxSnapshot(snapshots[snapshots.length - 1]).projection
        .markdownText,
    ).toBe("Body");

    editor.destroy();
  });

  it("updates syntax snapshots incrementally from display changes", () => {
    const doc = documentFromText("# Heading");
    const initial = buildMarkdownSyntaxSnapshot(doc);
    const tr = createTransaction(doc, {
      anchor: { paragraph: 0, offset: 9 },
      head: { paragraph: 0, offset: 9 },
    })
      .replaceSelection("\nBody")
      .build();

    const updated = updateMarkdownSyntaxSnapshot(
      initial,
      tr.docAfter,
      tr.displayChanges,
    );
    const full = buildMarkdownSyntaxSnapshot(tr.docAfter);

    expect(updated.projection.markdownText).toBe("# Heading\nBody");
    expect(updated.parseState.tokens).toEqual(full.parseState.tokens);
  });
});
