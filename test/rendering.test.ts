import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorPlugin,
  ModernEditor,
  PluginId,
  WidgetDecoration,
  WidgetRenderer,
  createTransaction,
} from "../src";
import {
  codeBlockWidgetPlugin,
  markdownPlugin,
  markdownSyntaxProvider,
} from "../demo/src/markdown";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const rectList = (...items: DOMRect[]): DOMRectList =>
  Object.assign([...items], {
    item: (index: number) => items[index] ?? null,
  }) as unknown as DOMRectList;

const splitDecorationPlugin = (): EditorPlugin<null> => ({
  id: new PluginId<null>("split-decoration"),
  init: () => null,
  apply: () => null,
  decorations: () => [
    {
      kind: "inline",
      from: 5,
      to: 10,
      attrs: { class: "decorated" },
    },
  ],
});

const zeroLengthBlockWidgetPlugin = (): EditorPlugin<null> => {
  const renderer: WidgetRenderer = {
    mount(host) {
      host.textContent = "widget";
      return {
        update() {},
        destroy() {
          host.textContent = "";
        },
      };
    },
  };

  return {
    id: new PluginId<null>("zero-length-block-widget"),
    init: () => null,
    apply: () => null,
    widgets: (): readonly WidgetDecoration[] => [
      {
        key: "zero-length-block-widget:placeholder",
        placement: "block",
        range: {
          from: { paragraph: 0, offset: 0 },
          to: { paragraph: 0, offset: 0 },
        },
        props: {},
        render: renderer,
        selection: "block",
      },
    ],
  };
};

describe("rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Range.prototype as Partial<Range>).getClientRects;
  });

  it("derives heading styling from markdown block decorations", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: "# Heading",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    const paragraph = container.querySelector(".s9-paragraph");
    expect(editor.getDocument().paragraphs[0]).toEqual({ text: "# Heading" });
    expect(paragraph?.classList.contains("s9-md-heading-block")).toBe(true);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 0 },
          head: { paragraph: 0, offset: 0 },
        })
        .build(),
    );

    expect(
      container
        .querySelector(".s9-paragraph")
        ?.classList.contains("s9-md-heading-block"),
    ).toBe(true);

    editor.destroy();
    container.remove();
  });

  it("paints selected text ranges with renderer-owned overlay rects", () => {
    Range.prototype.getClientRects = () => rectList();
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (
      this: Range,
    ) {
      return rectList(
        rect(this.startOffset * 10, 4, (this.endOffset - this.startOffset) * 10, 18),
      );
    });

    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: "alpha beta",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 2 },
          head: { paragraph: 0, offset: 7 },
        })
        .build(),
    );

    const selectionRect = container.querySelector<HTMLElement>(
      ".s9-selection-rect",
    );

    expect(selectionRect?.style.left).toBe("20px");
    expect(selectionRect?.style.top).toBe("4px");
    expect(selectionRect?.style.width).toBe("50px");
    expect(selectionRect?.style.height).toBe("18px");
    expect(container.querySelector(".s9-caret-hidden")).not.toBeNull();

    editor.destroy();
    container.remove();
  });

  it("keeps overlay coordinates relative to the editor root with external scrolling", () => {
    Range.prototype.getClientRects = () => rectList();
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (
      this: Range,
    ) {
      return rectList(
        rect(20, 10, (this.endOffset - this.startOffset) * 10, 18),
      );
    });

    const scrollContainer = document.createElement("div");
    const container = document.createElement("div");
    scrollContainer.append(container);
    document.body.append(scrollContainer);
    scrollContainer.scrollTop = 40;
    scrollContainer.scrollLeft = 5;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      rect(0, -40, 400, 400),
    );

    const editor = new ModernEditor(container, {
      content: "alpha beta",
      scrollContainer,
    });

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 0 },
          head: { paragraph: 0, offset: 5 },
        })
        .build(),
    );

    const selectionRect = container.querySelector<HTMLElement>(
      ".s9-selection-rect",
    );
    expect(selectionRect?.style.left).toBe("20px");
    expect(selectionRect?.style.top).toBe("50px");

    editor.destroy();
    scrollContainer.remove();
  });

  it("measures caret positions from the following segment at decoration boundaries", () => {
    const originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function () {
      return this.startContainer.textContent === " beta"
        ? rect(52, 4, 0, 18)
        : rect(50, 4, 0, 18);
    };

    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, {
      content: "alpha beta",
      plugins: [splitDecorationPlugin()],
    });

    try {
      editor.dispatch(
        createTransaction(editor.getDocument(), editor.getSelection())
          .setSelection({
            anchor: { paragraph: 0, offset: 5 },
            head: { paragraph: 0, offset: 5 },
          })
          .build(),
      );

      const caret = container.querySelector<HTMLElement>(".s9-caret");
      expect(caret?.style.left).toBe("52px");
    } finally {
      if (originalRangeRect) {
        Range.prototype.getBoundingClientRect = originalRangeRect;
      } else {
        delete (Range.prototype as Partial<Range>).getBoundingClientRect;
      }
      editor.destroy();
      container.remove();
    }
  });

  it("extends selection with Shift+Arrow and repaints it", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: "abc",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
    });
    const input = container.querySelector<HTMLTextAreaElement>(".s9-input-proxy");

    input?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 1 },
    });
    expect(container.querySelector(".s9-caret-hidden")).not.toBeNull();

    editor.destroy();
    container.remove();
  });

  it("paints selected block widgets as widget overlay rects", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: "```ts\nconst x = 1;\n```",
      syntaxProvider: markdownSyntaxProvider,
      plugins: [codeBlockWidgetPlugin()],
    });
    const widget = container.querySelector<HTMLElement>(".s9-widget");
    expect(widget).not.toBeNull();
    if (!widget) return;

    vi.spyOn(widget, "getBoundingClientRect").mockReturnValue(
      rect(12, 24, 320, 140),
    );

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .setSelection({
          anchor: { paragraph: 0, offset: 0 },
          head: { paragraph: 2, offset: 3 },
        })
        .build(),
    );

    const widgetRect = container.querySelector<HTMLElement>(
      ".s9-selection-rect[data-widget-key='code-block-widgets:0']",
    );
    expect(widgetRect?.style.left).toBe("12px");
    expect(widgetRect?.style.top).toBe("24px");
    expect(widgetRect?.style.width).toBe("320px");
    expect(widgetRect?.style.height).toBe("140px");

    editor.destroy();
    container.remove();
  });

  it("does not hide paragraph text for zero-length block widget ranges", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: "alpha beta",
      plugins: [zeroLengthBlockWidgetPlugin()],
    });

    const paragraph = container.querySelector<HTMLElement>(".s9-paragraph");
    expect(paragraph?.classList.contains("s9-covered-by-widget")).toBe(false);
    expect(paragraph?.textContent).toBe("alpha beta");

    editor.destroy();
    container.remove();
  });
});
