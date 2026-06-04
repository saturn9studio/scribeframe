import { describe, expect, it } from "vitest";
import {
  EditorPlugin,
  ModernEditor,
  PluginId,
  WidgetDecoration,
  WidgetRenderer,
} from "../src";
import { markdownPlugin, markdownSyntaxProvider } from "../demo/src/markdown";

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");

const setViewport = (element: HTMLElement, clientHeight: number): void => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 400,
      bottom: clientHeight,
      width: 400,
      height: clientHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
};

const renderedParagraphs = (container: HTMLElement): number[] =>
  [...container.querySelectorAll<HTMLElement>(".s9-paragraph")].map((item) =>
    Number(item.dataset.paragraph),
  );

interface Counts {
  mounts: number;
  updates: number;
  destroys: number;
}

const viewportWidgetPlugin = (counts: Counts): EditorPlugin<null> => {
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
    id: new PluginId<null>("viewport-widget"),
    init: () => null,
    apply: () => null,
    widgets: ({ doc }): readonly WidgetDecoration[] =>
      doc.paragraphs.length > 10
        ? [
            {
              key: "viewport-widget:ten",
              placement: "block",
              range: {
                from: { paragraph: 10, offset: 0 },
                to: {
                  paragraph: 10,
                  offset: doc.paragraphs[10]?.text.length ?? 0,
                },
              },
              props: { label: "visible widget" },
              render: renderer,
              selection: "block",
            },
          ]
        : [],
  };
};

describe("renderer virtualization and scrolling", () => {
  it("maps scroll fractions onto the virtual document height", () => {
    const container = document.createElement("div");
    setViewport(container, 100);
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: lines(20),
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    expect(editor.getScrollState()).toEqual({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 100,
      fraction: 0,
    });

    editor.scrollToFraction(0.5);

    expect(container.scrollTop).toBe(150);
    expect(editor.getScrollState().fraction).toBe(0.5);

    editor.destroy();
    container.remove();
  });

  it("renders only the visible paragraph window with spacer blocks", () => {
    const container = document.createElement("div");
    setViewport(container, 60);
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: lines(20),
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    expect(renderedParagraphs(container)).toEqual([0, 1, 2]);
    expect(
      container.querySelector<HTMLElement>(".s9-virtual-spacer-before")?.style
        .height,
    ).toBe("0px");
    expect(
      container.querySelector<HTMLElement>(".s9-virtual-spacer-after")?.style
        .height,
    ).toBe("340px");

    container.scrollTop = 200;
    container.dispatchEvent(new Event("scroll"));

    expect(renderedParagraphs(container)).toEqual([10, 11, 12]);
    expect(
      container.querySelector<HTMLElement>(".s9-virtual-spacer-before")?.style
        .height,
    ).toBe("200px");

    editor.destroy();
    container.remove();
  });

  it("reveals an offscreen position and materializes its paragraph", () => {
    const container = document.createElement("div");
    setViewport(container, 60);
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: lines(30),
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    expect(renderedParagraphs(container)).not.toContain(20);

    editor.revealPosition({ paragraph: 20, offset: 0 }, { block: "start" });

    expect(container.scrollTop).toBe(400);
    expect(renderedParagraphs(container)).toEqual([20, 21, 22]);

    editor.destroy();
    container.remove();
  });

  it("selects ranges and reveals the selection with centered scrolling", () => {
    const container = document.createElement("div");
    setViewport(container, 100);
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: lines(30),
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    editor.selectRange(
      {
        from: { paragraph: 15, offset: 0 },
        to: { paragraph: 15, offset: 4 },
      },
      { reveal: true, block: "center" },
    );

    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 15, offset: 0 },
      head: { paragraph: 15, offset: 4 },
    });
    expect(container.scrollTop).toBe(260);
    expect(renderedParagraphs(container)).toContain(15);

    editor.destroy();
    container.remove();
  });

  it("reveals the full selected span when the head is already visible", () => {
    const container = document.createElement("div");
    setViewport(container, 100);
    document.body.append(container);

    const editor = new ModernEditor(container, {
      content: lines(30),
      syntaxProvider: markdownSyntaxProvider,
      plugins: [markdownPlugin()],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    container.scrollTop = 100;
    container.dispatchEvent(new Event("scroll"));

    editor.selectRange(
      {
        from: { paragraph: 3, offset: 0 },
        to: { paragraph: 5, offset: 4 },
      },
      { reveal: true },
    );

    expect(container.scrollTop).toBe(60);
    expect(renderedParagraphs(container)).toContain(3);
    expect(renderedParagraphs(container)).toContain(5);

    editor.destroy();
    container.remove();
  });

  it("mounts and destroys viewport-limited widgets as they enter and leave", () => {
    const container = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container);
    const counts = { mounts: 0, updates: 0, destroys: 0 };

    const editor = new ModernEditor(container, {
      content: lines(20),
      plugins: [viewportWidgetPlugin(counts)],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    expect(counts.mounts).toBe(0);

    editor.revealPosition({ paragraph: 10, offset: 0 }, { block: "start" });
    expect(counts.mounts).toBe(1);
    expect(counts.updates).toBe(1);

    editor.scrollToFraction(0);
    expect(counts.destroys).toBe(1);

    editor.destroy();
    container.remove();
  });
});
