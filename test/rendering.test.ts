import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorPlugin,
  ScribeFrame,
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

const hiddenDecorationPlugin = (): EditorPlugin<null> => ({
  id: new PluginId<null>("hidden-decoration"),
  init: () => null,
  apply: () => null,
  decorations: () => [
    {
      kind: "inline",
      from: 5,
      to: 6,
      attrs: { class: "hidden-one" },
    },
    {
      kind: "inline",
      from: 6,
      to: 7,
      attrs: { class: "hidden-two" },
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

const inlineWidgetPlugin = (): EditorPlugin<null> => {
  const renderer: WidgetRenderer<{ readonly label: string }> = {
    mount(host, props) {
      host.textContent = props.label;
      return {
        update(nextProps) {
          host.textContent = nextProps.label;
        },
        destroy() {
          host.textContent = "";
        },
      };
    },
  };

  return {
    id: new PluginId<null>("inline-widget"),
    init: () => null,
    apply: () => null,
    widgets: (): readonly WidgetDecoration[] => [
      {
        key: "inline-widget:color",
        placement: "inline",
        range: {
          from: { paragraph: 0, offset: 2 },
          to: { paragraph: 0, offset: 4 },
        },
        props: { label: "■" },
        render: renderer,
        selection: "atom",
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

    const editor = new ScribeFrame(container, {
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

    const editor = new ScribeFrame(container, {
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

    const editor = new ScribeFrame(container, {
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
    const editor = new ScribeFrame(container, {
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

  it("measures hidden inline positions from the nearest visible text boundary", () => {
    const originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function () {
      const element = this.startContainer.parentElement;
      if (
        element?.classList.contains("hidden-one") ||
        element?.classList.contains("hidden-two")
      ) {
        return rect(0, 0, 0, 0);
      }
      if (
        this.startContainer.textContent === "alpha" &&
        this.startOffset === 5
      ) {
        return rect(50, 4, 0, 18);
      }
      if (
        this.startContainer.textContent === " beta" &&
        this.startOffset === 0
      ) {
        return rect(70, 4, 0, 18);
      }
      return rect(40, 4, 0, 18);
    };

    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      content: "alphaXX beta",
      plugins: [hiddenDecorationPlugin()],
    });

    try {
      editor.selectRange({
        from: { paragraph: 0, offset: 5 },
        to: { paragraph: 0, offset: 5 },
      });
      expect(
        container.querySelector<HTMLElement>(".s9-caret")?.style.left,
      ).toBe("50px");

      editor.selectRange({
        from: { paragraph: 0, offset: 6 },
        to: { paragraph: 0, offset: 6 },
      });
      expect(
        container.querySelector<HTMLElement>(".s9-caret")?.style.left,
      ).toBe("50px");
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

  it("normalizes text caret height to the paragraph line box", () => {
    const originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => rect(50, 6, 0, 18);
    const container = document.createElement("div");
    const style = document.createElement("style");
    style.textContent = ".s9-paragraph { line-height: 30px; }";
    document.head.append(style);
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      content: "alpha",
    });

    try {
      editor.selectRange({
        from: { paragraph: 0, offset: 1 },
        to: { paragraph: 0, offset: 1 },
      });

      const caret = container.querySelector<HTMLElement>(".s9-caret");
      expect(caret?.style.top).toBe("0px");
      expect(caret?.style.height).toBe("30px");
    } finally {
      if (originalRangeRect) {
        Range.prototype.getBoundingClientRect = originalRangeRect;
      } else {
        delete (Range.prototype as Partial<Range>).getBoundingClientRect;
      }
      editor.destroy();
      container.remove();
      style.remove();
    }
  });

  it("positions the caret at the text indent for empty paragraphs", () => {
    const container = document.createElement("div");
    const style = document.createElement("style");
    style.textContent =
      ".s9-paragraph-empty { line-height: 24px; min-height: 32px; text-indent: 24px; }";
    document.head.append(style);
    document.body.append(container);
    const editor = new ScribeFrame(container, {
      content: "First paragraph\n",
    });
    const elementRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        return this.dataset.paragraph === "1"
          ? rect(10, 20, 300, 18)
          : rect(0, 0, 300, 40);
      });

    try {
      const emptyParagraph = container.querySelector<HTMLElement>(
        '.s9-paragraph[data-paragraph="1"]',
      );
      if (!emptyParagraph) throw new Error("Empty paragraph not found");

      editor.selectRange({
        from: { paragraph: 1, offset: 0 },
        to: { paragraph: 1, offset: 0 },
      });

      const caret = container.querySelector<HTMLElement>(".s9-caret");
      expect(caret?.style.left).toBe("34px");
      expect(caret?.style.top).toBe("20px");
      expect(caret?.style.height).toBe("24px");
    } finally {
      elementRect.mockRestore();
      editor.destroy();
      container.remove();
      style.remove();
    }
  });

  it("extends selection with Shift+Arrow and repaints it", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ScribeFrame(container, {
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

    const editor = new ScribeFrame(container, {
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

    const editor = new ScribeFrame(container, {
      content: "alpha beta",
      plugins: [zeroLengthBlockWidgetPlugin()],
    });

    const paragraph = container.querySelector<HTMLElement>(".s9-paragraph");
    expect(paragraph?.classList.contains("s9-covered-by-widget")).toBe(false);
    expect(paragraph?.textContent).toBe("alpha beta");

    editor.destroy();
    container.remove();
  });

  it("renders inline widgets in paragraph flow while hiding their source range", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = new ScribeFrame(container, {
      content: "a 🟩 mark",
      plugins: [inlineWidgetPlugin()],
    });

    const paragraph = container.querySelector<HTMLElement>(".s9-paragraph");
    const widget = container.querySelector<HTMLElement>(".s9-widget-inline");

    expect(widget?.textContent).toBe("■");
    expect(widget?.tagName).toBe("SPAN");
    expect(paragraph?.textContent).toBe("a ■ mark");

    editor.destroy();
    container.remove();
  });
});
