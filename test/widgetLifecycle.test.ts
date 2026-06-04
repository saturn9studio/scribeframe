import { describe, expect, it, vi } from "vitest";
import {
  EditorPlugin,
  ModernEditor,
  PluginKey,
  WidgetDecoration,
  WidgetRenderer,
  createTransaction,
} from "../src";
import {
  codeBlockWidgetPlugin,
  markdownSyntaxProvider,
} from "../demo/src/markdown";

interface Counts {
  mounts: number;
  updates: number;
  destroys: number;
}

const lifecyclePlugin = (counts: Counts): EditorPlugin<null> => {
  const renderer: WidgetRenderer<{ readonly label: string }> = {
    mount(host, props) {
      counts.mounts += 1;
      host.textContent = props.label;
      return {
        update(nextProps) {
          counts.updates += 1;
          host.textContent = nextProps.label;
        },
        destroy() {
          counts.destroys += 1;
          host.textContent = "";
        },
      };
    },
  };

  return {
    key: new PluginKey<null>("lifecycle"),
    init: () => null,
    apply: () => null,
    widgets: ({ doc }): readonly WidgetDecoration[] =>
      doc.paragraphs[0]?.text.includes("widget")
        ? [
            {
              key: "lifecycle:demo",
              placement: "block",
              range: {
                from: { paragraph: 0, offset: 0 },
                to: {
                  paragraph: 0,
                  offset: doc.paragraphs[0].text.length,
                },
              },
              props: { label: doc.paragraphs[0].text },
              render: renderer,
              selection: "block",
            },
          ]
        : [],
  };
};

describe("widget lifecycle", () => {
  it("mounts, updates, and destroys widgets through the renderer", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const counts = { mounts: 0, updates: 0, destroys: 0 };
    const editor = new ModernEditor(container, {
      content: "widget",
      plugins: [lifecyclePlugin(counts)],
    });

    expect(counts.mounts).toBe(1);
    expect(counts.updates).toBe(1);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange(
          { paragraph: 0, offset: 6 },
          { paragraph: 0, offset: 6 },
          " updated",
        )
        .build(),
    );

    expect(counts.mounts).toBe(1);
    expect(counts.updates).toBe(2);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange(
          { paragraph: 0, offset: 0 },
          { paragraph: 0, offset: editor.getDocument().paragraphs[0].text.length },
          "plain text",
        )
        .build(),
    );

    expect(counts.destroys).toBe(1);
    editor.destroy();
    container.remove();
  });
});

describe("widget focus", () => {
  it("preserves textarea focus when a focused widget dispatches source updates", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "```ts\nconst x = 1;\n```",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [codeBlockWidgetPlugin()],
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".s9-code-widget-textarea",
    );

    expect(textarea).not.toBeNull();
    if (!textarea) return;

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const focus = vi.spyOn(textarea, "focus");
    textarea.value = `${textarea.value}\nconsole.log(x);`;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(focus).toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(textarea.value.length);

    focus.mockRestore();
    editor.destroy();
    container.remove();
  });
});
