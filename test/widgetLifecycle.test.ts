import { describe, expect, it, vi } from "vitest";
import {
  EditorPlugin,
  ScribeFrame,
  PluginId,
  WidgetDecoration,
  WidgetRenderer,
  createTransaction,
  editorCommandNames,
} from "../src";
import {
  codeBlockWidgetPlugin,
  markdownSyntaxProvider,
} from "../demo/src/markdown";

interface Counts {
  mounts: number;
  updates: number;
  afterRenders: number;
  destroys: number;
  attachedAfterRender: boolean;
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
        afterRender() {
          counts.afterRenders += 1;
          counts.attachedAfterRender &&= host.isConnected;
        },
        destroy() {
          counts.destroys += 1;
          host.textContent = "";
        },
      };
    },
  };

  return {
    id: new PluginId<null>("lifecycle"),
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
    const counts = {
      mounts: 0,
      updates: 0,
      afterRenders: 0,
      destroys: 0,
      attachedAfterRender: true,
    };
    const editor = new ScribeFrame(container, {
      content: "widget",
      plugins: [lifecyclePlugin(counts)],
    });

    expect(counts.mounts).toBe(1);
    expect(counts.updates).toBe(1);
    expect(counts.afterRenders).toBe(1);
    expect(counts.attachedAfterRender).toBe(true);

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
    expect(counts.afterRenders).toBe(2);

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

  it("applies read-only state when code block widgets mount", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      content: "```ts\nconst x = 1;\n```",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [codeBlockWidgetPlugin()],
      readOnly: true,
    });

    expect(
      container.querySelector<HTMLInputElement>(".s9-code-widget-language")
        ?.readOnly,
    ).toBe(true);
    expect(
      container.querySelector<HTMLTextAreaElement>(".s9-code-widget-textarea")
        ?.readOnly,
    ).toBe(true);

    editor.destroy();
    container.remove();
  });
});

describe("widget focus", () => {
  it("makes widgets with focus handles keyboard focusable", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const input = document.createElement("input");
    const focus = vi.spyOn(input, "focus");
    const renderer: WidgetRenderer<{ readonly label: string }> = {
      mount(host) {
        host.append(input);
        return {
          update() {},
          focus() {
            input.focus({ preventScroll: true });
          },
          destroy() {
            host.replaceChildren();
          },
        };
      },
    };
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("focusable"),
      init: () => null,
      apply: () => null,
      widgets: ({ doc }): readonly WidgetDecoration[] => [
        {
          key: "focusable:demo",
          placement: "block",
          range: {
            from: { paragraph: 0, offset: 0 },
            to: { paragraph: 0, offset: doc.paragraphs[0]?.text.length ?? 0 },
          },
          props: { label: "demo" },
          render: renderer,
          selection: "block",
        },
      ],
    };
    const editor = new ScribeFrame(container, {
      content: "widget",
      plugins: [plugin],
    });
    const host = container.querySelector<HTMLElement>(".s9-widget");

    expect(host?.tabIndex).toBe(0);

    host?.focus();

    expect(focus).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    focus.mockRestore();
    editor.destroy();
    container.remove();
  });

  it("focuses a widget when keyboard movement enters its range", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const input = document.createElement("input");
    const focus = vi.spyOn(input, "focus");
    const renderer: WidgetRenderer<unknown> = {
      mount(host) {
        host.append(input);
        return {
          update() {},
          focus() {
            input.focus({ preventScroll: true });
          },
          destroy() {
            host.replaceChildren();
          },
        };
      },
    };
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("movement-focus"),
      init: () => null,
      apply: () => null,
      widgets: (): readonly WidgetDecoration[] => [
        {
          key: "movement-focus:demo",
          placement: "block",
          range: {
            from: { paragraph: 1, offset: 0 },
            to: { paragraph: 1, offset: 6 },
          },
          props: {},
          render: renderer,
          selection: "block",
        },
      ],
    };
    const editor = new ScribeFrame(container, {
      content: "before\nwidget\nafter",
      plugins: [plugin],
    });
    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 6 },
          head: { paragraph: 0, offset: 6 },
        })
        .build(),
    );

    expect(editor.executeCommand(editorCommandNames.moveRight)).toBe(true);

    expect(focus).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    focus.mockRestore();
    editor.destroy();
    container.remove();
  });

  it("preserves textarea focus, selection, and scroll during source updates", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
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
    textarea.scrollTop = 42;
    textarea.scrollLeft = 7;

    const focus = vi.spyOn(textarea, "focus");
    const setSelectionRange = vi.spyOn(textarea, "setSelectionRange")
      .mockImplementation((start, end) => {
        textarea.selectionStart = start;
        textarea.selectionEnd = end;
        textarea.scrollTop = 0;
        textarea.scrollLeft = 0;
      });
    textarea.value = `${textarea.value}\nconsole.log(x);`;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.scrollTop = 42;
    textarea.scrollLeft = 7;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(focus).toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.scrollTop).toBe(42);
    expect(textarea.scrollLeft).toBe(7);

    setSelectionRange.mockRestore();
    focus.mockRestore();
    editor.destroy();
    container.remove();
  });
});
