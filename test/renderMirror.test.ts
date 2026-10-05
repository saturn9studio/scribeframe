import { describe, expect, it } from "vitest";
import {
  PluginId,
  ScribeFrame,
  createTransaction,
  type EditorPlugin,
  type WidgetDecoration,
  type WidgetRenderer,
} from "../src";

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");

const setViewport = (element: HTMLElement, clientHeight: number): void => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
};

const renderedParagraphs = (container: HTMLElement): number[] =>
  [...container.querySelectorAll<HTMLElement>(".s9-paragraph")].map((item) =>
    Number(item.dataset.paragraph),
  );

const blockWidgetPlugin = (
  height: () => number,
): EditorPlugin<null> => ({
  id: new PluginId<null>("mirror-layout-widget"),
  init: () => null,
  apply: () => null,
  widgets: ({ doc }): readonly WidgetDecoration[] => [{
    key: "mirror-layout-widget:ten",
    placement: "block",
    range: {
      from: { paragraph: 10, offset: 0 },
      to: {
        paragraph: 10,
        offset: doc.paragraphs[10]?.text.length ?? 0,
      },
    },
    props: {},
    render: {
      mount(host) {
        host.getBoundingClientRect = () =>
          ({
            left: 0,
            top: 0,
            right: 400,
            bottom: height(),
            width: 400,
            height: height(),
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }) as DOMRect;
        return {
          update() {},
          destroy() {},
        };
      },
    },
    selection: "block",
  }],
});

describe("read-only render mirrors", () => {
  it("renders the complete document while the editor remains virtualized", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 60);
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(renderedParagraphs(container)).toEqual([0, 1, 2]);
    expect(renderedParagraphs(mirrorElement)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    expect(mirrorElement.querySelector(".s9-virtual-spacer")).toBeNull();
    expect(mirrorElement.inert).toBe(true);
    expect(mirrorElement.getAttribute("aria-hidden")).toBe("true");

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("reuses the same decorations and widget renderer output", () => {
    const renderer: WidgetRenderer<{ readonly label: string }> = {
      mount(host, props, context) {
        const input = document.createElement("input");
        input.className = "shared-widget-input";
        input.value = props.label;
        input.readOnly = context.readOnly;
        host.replaceChildren(input);
        return {
          update(nextProps) {
            input.value = nextProps.label;
            input.readOnly = context.readOnly;
          },
          destroy() {
            host.replaceChildren();
          },
        };
      },
    };
    const plugin: EditorPlugin<null> = {
      id: new PluginId<null>("mirror-output"),
      init: () => null,
      apply: () => null,
      decorations: () => [{
        kind: "inline",
        from: 0,
        to: 6,
        attrs: { class: "shared-decoration" },
      }],
      widgets: ({ doc }): readonly WidgetDecoration[] => [{
        key: "mirror-output:widget",
        placement: "block",
        range: {
          from: { paragraph: 1, offset: 0 },
          to: {
            paragraph: 1,
            offset: doc.paragraphs[1]?.text.length ?? 0,
          },
        },
        props: { label: doc.paragraphs[1]?.text ?? "" },
        render: renderer,
        selection: "block",
      }],
    };
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: "before\nwidget\nafter",
      plugins: [plugin],
      virtualization: false,
    });
    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(
      mirrorElement.querySelector(".shared-decoration")?.textContent,
    ).toBe("before");
    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.value,
    ).toBe("widget");
    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.readOnly,
    ).toBe(true);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceRange(
          { paragraph: 1, offset: 0 },
          { paragraph: 1, offset: 6 },
          "updated",
        )
        .build(),
    );

    expect(
      mirrorElement.querySelector<HTMLInputElement>(".shared-widget-input")
        ?.value,
    ).toBe("updated");

    mirror.destroy();
    expect(mirrorElement.childElementCount).toBe(0);
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("destroys attached mirrors with the editor", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, { content: "content" });
    const mirror = editor.attachRenderMirror(mirrorElement);

    editor.destroy();

    expect(mirrorElement.childElementCount).toBe(0);
    expect(mirrorElement.classList.contains("s9-editor-root")).toBe(false);
    expect(mirrorElement.classList.contains("s9-editor-mirror")).toBe(false);
    expect(mirrorElement.inert).toBe(false);
    expect(() => mirror.destroy()).not.toThrow();
    container.remove();
    mirrorElement.remove();
  });

  it("shares complete-document widget measurements with virtualization", () => {
    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container, mirrorElement);
    const editor = new ScribeFrame(container, {
      content: lines(20),
      plugins: [blockWidgetPlugin(() => 100)],
      virtualization: { estimateParagraphHeight: 20, overscan: 0 },
    });

    expect(editor.getScrollState().scrollHeight).toBe(400);

    const mirror = editor.attachRenderMirror(mirrorElement);

    expect(editor.getScrollState().scrollHeight).toBe(480);
    expect(renderedParagraphs(container)).toEqual([0, 1]);

    mirror.destroy();
    editor.destroy();
    container.remove();
    mirrorElement.remove();
  });

  it("refreshes virtual geometry when mirror widgets resize", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const container = document.createElement("div");
    const mirrorElement = document.createElement("div");
    setViewport(container, 40);
    document.body.append(container, mirrorElement);
    let widgetHeight = 40;

    try {
      const editor = new ScribeFrame(container, {
        content: lines(20),
        plugins: [blockWidgetPlugin(() => widgetHeight)],
        virtualization: { estimateParagraphHeight: 20, overscan: 0 },
      });
      const mirror = editor.attachRenderMirror(mirrorElement);
      expect(editor.getScrollState().scrollHeight).toBe(420);

      widgetHeight = 120;
      callbacks.forEach((callback) =>
        callback([], {} as ResizeObserver)
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      expect(editor.getScrollState().scrollHeight).toBe(500);

      mirror.destroy();
      editor.destroy();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      container.remove();
      mirrorElement.remove();
    }
  });
});
